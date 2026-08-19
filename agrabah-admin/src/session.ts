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
 * 已用 spike script 實測驗證過這個假設成立（H5 重構後用併發交錯呼叫的 spike
 * 重新驗證過仍成立，細節見 H5 changelog）。
 *
 * H5：登入態從 module-level 單例改為 per-identity 容器
 * ------------------------------------------------------------
 * 舊版是 `let session: { token: string } | null = null` 一個檔案一份、全行程
 * 共用。hosted 模式下多個企劃併發打同一個行程，`remote` 這個 export 卻是
 * module-level 單例（`export const remote = new Remote()`），若 session 仍是
 * 單例，後登入的人會覆蓋先登入的人的 JWT——這正是 D2「操作紀錄要能歸屬到
 * 人」的反面。
 *
 * 技術路線：AsyncLocalStorage（ALS）+ 單例 Remote，而非「per-identity 各建
 * 一個 Remote 實例」。理由：
 *   1. `genie/src/client/index.ts` 的 `ClientServiceBase.doRequest` 每次呼叫
 *      都同步跑一次 `this.headerHandler(...)`，headers 是 per-call 算出來、
 *      per-call 傳給 `Client.global.request(...)`的——也就是說 headerHandler
 *      本來就有「每次呼叫當下重新決定要帶哪個 JWT」的天然掛勾點，不需要靠
 *      物件實例切換來做隔離。
 *   2. 若改成「per-identity 各建一個 Remote」，`remote` 就不能再是
 *      `export const remote = new Remote()` 這種單例——但目前全部 9 支
 *      tools/*.ts 都是 `import { remote } from '../session.ts'` 後直接呼叫
 *      `remote.<group>.<service>.<Method>(...)`，要嘛得把 `remote` 換成一個
 *      「先取得目前身分的 Remote 再呼叫」的 function（等於改寫全部 tool
 *      檔案的呼叫語法，違背 D8「tools 程式碼不重寫」與 CLAUDE.md Rule 3
 *      Surgical Changes），要嘛得用 Proxy 動態轉發——本質上還是需要一個
 *      「目前是誰在呼叫」的 context 機制，繞了一圈又回到 ALS，不如直接用。
 *   3. ALS 保留 `remote`/`Client.global`/`Client.encoded` 全部維持單例，不
 *      更動檔頭這段已用 spike 驗證過的 static flag 假設；ALS 只影響
 *      headerHandler 這個 closure 內部「這次要讀哪個身分的 JWT」，對外沒有
 *      任何 API 變動，9 支 tool 檔案零改動。
 *
 * 身分（identity）：hosted 模式下是 H3 名冊的唯一 id（string，由
 * http.ts 的 Bearer middleware 解出、透過 runWithIdentity() 灌進 ALS）；
 * stdio 模式沒有名冊、沒有 Bearer request，用一個模組內部的 Symbol
 * （STDIO_IDENTITY）當固定 key，取代舊版單例——單一隱容身分、行為不變。
 * 用 Symbol 而不是像 '__stdio__' 這種保留字串，是為了讓「stdio 身分」與
 * 「任何合法的名冊 id」在型別層面就不可能撞號，不必爭論保留字串夠不夠怪。
 */

import { AsyncLocalStorage } from 'node:async_hooks';
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

/** stdio 模式的固定隱含身分（單一 Symbol，不可能與任何名冊 id 字串撞號）。 */
const STDIO_IDENTITY = Symbol('agrabah-admin-stdio-identity');
type Identity = string | typeof STDIO_IDENTITY;

const identityStorage = new AsyncLocalStorage<Identity>();

/**
 * http.ts 在處理每個 /mcp request 時，用這支包住整個 request 的處理範圍
 * （見 http.ts 的 app.all('/mcp', ...)），把「這個 request 屬於哪位企劃」
 * （H3 名冊唯一 id）灌進 ALS。之後這個 request 觸發的所有 tool handler、
 * 乃至它們呼叫的 remote.*、login()、withAutoRelogin() 都能透過
 * currentIdentity() 讀回同一個值——即使多個 request 併發交錯執行也彼此
 * 互不干擾（ALS 是 per async-context，不是 per-module 全域變數）。
 * stdio.ts 完全不呼叫這支，currentIdentity() 會 fallback 到 STDIO_IDENTITY。
 */
export function runWithIdentity<T>(identity: string, fn: () => T): T {
    return identityStorage.run(identity, fn);
}

function currentIdentity(): Identity {
    return identityStorage.getStore() ?? STDIO_IDENTITY;
}

/**
 * per-identity 登入態容器（D2）。只存 agrabah JWT（D3：絕不存帳密）。
 * key 是 H3 名冊唯一 id 或 STDIO_IDENTITY，不是顯示名。
 */
const sessions = new Map<Identity, { token: string }>();

export const remote = new Remote();
remote.setBaseUrlToAllGroup(BASE_URL);
remote.setHeaderHandlerToAllGroup(() => {
    const headers: Record<string, string> = { 'platform-code': ADMIN_HEADER_PLATFORM_CODE };
    const session = sessions.get(currentIdentity());
    if (session?.token) headers['Authorization'] = `Bearer ${ session.token }`;
    return headers;
});

export type LoginResult =
    | { success: true; message: string; mustBindTotp: boolean }
    | { success: false; errorCode: number; message: string };

/**
 * identifier/password 只存在本函式的區域變數（含 opts 解構出來的值），全程
 * 未寫入任何 module-level 變數、Map、或會被 headerHandler 之類長生命週期
 * closure 捕獲的位置——函式 return 後即可被 GC 回收，符合 D3「絕不留企劃
 * 帳密」。sessions Map 只存 `{ token }`（agrabah JWT），沒有 password 欄位。
 */
export async function login(opts: { identifier?: string; password?: string; totpCode?: string } = {}): Promise<LoginResult> {
    const identifier = opts.identifier ?? DEFAULT_USER;
    const password = opts.password ?? DEFAULT_PASSWORD;
    if (!identifier || !password) {
        throw new Error('缺少登入帳密：請在呼叫時提供 identifier/password，或在 .mcp.json 設定 AGRABAH_ADMIN_USER / AGRABAH_ADMIN_PASSWORD');
    }

    const identity = currentIdentity();
    const r = await remote.admin.auth.Login(identifier, password, opts.totpCode ?? '', '', '');
    if (r.failed || !r.data) {
        sessions.delete(identity);
        return { success: false, errorCode: r.errorCode, message: r.message };
    }

    sessions.set(identity, { token: r.data.loginToken });
    return { success: true, message: '登入成功', mustBindTotp: r.data.mustBindTotp };
}

async function ensureLoggedIn(): Promise<void> {
    if (sessions.has(currentIdentity())) return;
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
