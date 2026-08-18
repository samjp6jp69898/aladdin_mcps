/**
 * session.ts — agrabah admin 後台的登入態管理，被所有 tools/*.ts 共用。
 *
 * 不重新定義任何 protobuf 型別或 RPC client：直接以絕對路徑重用
 * abu/admin 已經 rajah generate 出來的 remote.gen.ts，做法比照
 * abu/.claude/skills/test-method 的實測腳本（同一套 Client + Remote）。
 *
 * 為什麼用絕對路徑 import 而不是 npm 依賴：
 * 本 MCP server 實體位置不在 abu/admin 底下、行程 cwd 也不固定，用絕對路徑
 * 才能穩定 resolve。`genie/client` 同樣用絕對路徑指到 canonical 原始檔
 * （/Users/user/aladdin/abu/admin/node_modules/genie 其實是 symlink 回
 * /Users/user/aladdin/genie），確保跟 remote.gen.ts 內部 import 的是同一個
 * Client class（否則 `Client.encoded = true` 這個 static flag 設在別的模組
 * 實例上不會生效，實際送出去的 request 不會做 XOR 編碼，Gate 會解不了）。
 * 已用 spike script 實測驗證過這個假設成立。
 */

import { Client } from '/Users/user/aladdin/genie/src/client/index.ts';
import { Remote } from '/Users/user/aladdin/abu/admin/src/generated/remote.gen.ts';
import { LOGIN_REQUIRED_ERROR_CODE, ADMIN_HEADER_PLATFORM_CODE } from './const.ts';

const BASE_URL = process.env.AGRABAH_ADMIN_API_URL;
const DEFAULT_USER = process.env.AGRABAH_ADMIN_USER;
const DEFAULT_PASSWORD = process.env.AGRABAH_ADMIN_PASSWORD;

if (!BASE_URL) {
    throw new Error('缺少環境變數 AGRABAH_ADMIN_API_URL，請確認 .mcp.json 的 agrabah-admin server env 是否已設定');
}

Client.encoded = true; // request/response bytes 走 XOR，client 內部自動處理，見 genie/src/client/index.ts

let session: { token: string } | null = null;

export const remote = new Remote();
remote.setBaseUrlToAllGroup(BASE_URL);
remote.setHeaderHandlerToAllGroup(() => {
    const headers: Record<string, string> = { 'platform-code': ADMIN_HEADER_PLATFORM_CODE };
    if (session?.token) headers['Authorization'] = `Bearer ${ session.token }`;
    return headers;
});

export type LoginResult =
    | { success: true; message: string; mustBindTotp: boolean }
    | { success: false; errorCode: number; message: string };

export async function login(opts: { identifier?: string; password?: string; totpCode?: string } = {}): Promise<LoginResult> {
    const identifier = opts.identifier ?? DEFAULT_USER;
    const password = opts.password ?? DEFAULT_PASSWORD;
    if (!identifier || !password) {
        throw new Error('缺少登入帳密：請在呼叫時提供 identifier/password，或在 .mcp.json 設定 AGRABAH_ADMIN_USER / AGRABAH_ADMIN_PASSWORD');
    }

    const r = await remote.admin.auth.Login(identifier, password, opts.totpCode ?? '', '', '');
    if (r.failed || !r.data) {
        session = null;
        return { success: false, errorCode: r.errorCode, message: r.message };
    }

    session = { token: r.data.loginToken };
    return { success: true, message: '登入成功', mustBindTotp: r.data.mustBindTotp };
}

async function ensureLoggedIn(): Promise<void> {
    if (session) return;
    const r = await login();
    if (!r.success) throw new Error(`自動登入失敗：errorCode=${ r.errorCode } ${ r.message }`);
}

/**
 * 包一層自動登入 + token 失效自動重登重試，比照 test-method skill 的規則。
 * 傳入的 call 應該是一個「已經帶好參數、只差呼叫」的 thunk，例如：
 *   withAutoRelogin(() => remote.gameBackOffice.gameVendorAdmin.ListGameVendors(search, page, pageSize))
 */
export async function withAutoRelogin<T>(
    call: () => Promise<{ failed: boolean; errorCode: number; message: string; data: T | null }>,
): Promise<{ failed: boolean; errorCode: number; message: string; data: T | null }> {
    await ensureLoggedIn();
    let r = await call();

    if (r.failed && r.errorCode === LOGIN_REQUIRED_ERROR_CODE) {
        const relogin = await login();
        if (!relogin.success) {
            throw new Error(`token 失效後重新登入失敗：errorCode=${ relogin.errorCode } ${ relogin.message }`);
        }
        r = await call();
    }

    return r;
}

export type UploadResult =
    | { success: true; path: string }
    | { success: false; message: string };

/**
 * 上傳一個本機檔案到 agrabah Gate 的 `/upload` 端點。
 *
 * 這個端點跟一般 RPC 是分開的兩套機制：不吃 Authorization Bearer，改用一次性、
 * 綁 Redis、1 小時效期的 `token`（由 GetUploadGameVendorGameImageToken 之類的 method 取得）
 * 當唯一授權依據——所以這裡不用 withAutoRelogin。
 *
 * genie/client 內建的 `Client.global.upload()` 是瀏覽器專屬的 XMLHttpRequest 實作，
 * bun 環境沒有 XMLHttpRequest，這裡改用標準 fetch + FormData 重新實作同樣的 multipart
 * POST 語意（body 欄位固定是 `token` / `file`，見 agrabah/src/servers/gate/handlers/file_handler.ts）。
 */
export async function uploadFile(token: string, filePath: string): Promise<UploadResult> {
    const file = Bun.file(filePath);
    if (!(await file.exists())) {
        return { success: false, message: `本機檔案不存在：${ filePath }` };
    }

    const formData = new FormData();
    formData.append('token', token);
    formData.append('file', file, filePath.split('/').pop());

    const response = await fetch(`${ BASE_URL }/upload`, { method: 'POST', body: formData });
    const json = await response.json() as { errorCode: number; data?: string };

    if (json.errorCode !== 0 || !json.data) {
        return { success: false, message: `上傳失敗，errorCode=${ json.errorCode }（token 可能已過期或用過一次；每次上傳都要重新拿新 token）` };
    }

    return { success: true, path: json.data };
}
