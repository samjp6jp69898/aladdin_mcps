/**
 * session.ts — agrabah platform 後台的登入態管理，被所有 tools/*.ts 共用。
 *
 * 不重新定義任何 protobuf 型別或 RPC client：直接以絕對路徑重用
 * abu/platform 已經 rajah generate 出來的 remote.gen.ts，做法比照
 * abu/.claude/skills/test-method 的實測腳本（同一套 Client + Remote）。
 *
 * 為什麼用絕對路徑 import 而不是 npm 依賴、且 genie/client 也走絕對路徑：
 * 見 obsidian/mcps/agrabah-admin/src/session.ts 同一段註解——已用 spike script
 * 實測驗證過 abu/platform/node_modules/genie 是 symlink 回
 * /Users/user/aladdin/genie，兩種 import 方式最終是同一個 Client class 實例，
 * `Client.encoded = true` 這個 static flag 才會真的對 remote.gen.ts 內部生效
 * （H5 重構後用併發交錯呼叫的 spike 重新驗證過仍成立，細節見 H5 changelog）。
 *
 * H5：登入態從 module-level 單例改為 per-identity 容器。設計理由與 admin 端
 * 逐字相同，完整說明見 obsidian/mcps/agrabah-admin/src/session.ts 同一段
 * 註解（AsyncLocalStorage + 單例 Remote，不做 per-identity 多個 Remote 實例，
 * 因為 tools/*.ts 全部直接 `remote.<group>.<service>.<Method>(...)` 呼叫
 * module-level 單例，ALS 能在不改任何 tool 檔案的前提下讓 headerHandler
 * 這個 closure 拿到「當前這次呼叫」對應的身分）。
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { Client } from '/Users/user/aladdin/genie/src/client/index.ts';
import { Remote, AgrabahErrorCodeEnum } from '/Users/user/aladdin/abu/platform/src/generated/remote.gen.ts';
import { HOSTED_RELOGIN_REQUIRED_MESSAGE } from './const.ts';

const BASE_URL = process.env.AGRABAH_PLATFORM_API_URL;
const DEFAULT_USER = process.env.AGRABAH_PLATFORM_USER;
const DEFAULT_PASSWORD = process.env.AGRABAH_PLATFORM_PASSWORD;

if (!BASE_URL) {
    throw new Error('缺少環境變數 AGRABAH_PLATFORM_API_URL，請確認 .mcp.json 的 agrabah-platform server env 是否已設定');
}

Client.encoded = true; // request/response bytes 走 XOR，client 內部自動處理，見 genie/src/client/index.ts

/** stdio 模式的固定隱含身分（單一 Symbol，不可能與任何名冊 id 字串撞號）。 */
const STDIO_IDENTITY = Symbol('agrabah-platform-stdio-identity');
type Identity = string | typeof STDIO_IDENTITY;

const identityStorage = new AsyncLocalStorage<Identity>();

/**
 * http.ts 在處理每個 /mcp request 時，用這支包住整個 request 的處理範圍，把
 * 「這個 request 屬於哪位企劃」（H3/H4 名冊唯一 id）灌進 ALS，讓這個 request
 * 觸發的所有 tool handler（含它們呼叫的 remote.*、login()、
 * withAutoRelogin()）都能透過 currentIdentity() 讀回同一個值，多個 request
 * 併發交錯執行也彼此互不干擾。stdio.ts 完全不呼叫這支，currentIdentity()
 * 會 fallback 到 STDIO_IDENTITY。
 */
export function runWithIdentity<T>(identity: string, fn: () => T): T {
    return identityStorage.run(identity, fn);
}

function currentIdentity(): Identity {
    return identityStorage.getStore() ?? STDIO_IDENTITY;
}

/** hosted 模式：identity 是名冊字串（經 runWithIdentity 灌入）；stdio 模式：identity 是固定的 STDIO_IDENTITY Symbol。 */
function isHostedIdentity(): boolean {
    return currentIdentity() !== STDIO_IDENTITY;
}

/**
 * H9：暴露目前呼叫身分的字串形式，供 tools（onboard_vendor_game.ts）解析
 * fileId → 本機路徑時比對身分（見 files.ts 的 resolveFileIdForIdentity）。
 * stdio 模式的 STDIO_IDENTITY 是 Symbol，不是任何合法的名冊 id，回傳
 * undefined——這對應到「stdio 模式本來就不會有合法 fileId 可用」的事實
 * （POST /files 只存在於 hosted 的 http.ts），消費端據此直接判斷沒有身分
 * 可用，而不是誤把 Symbol 字串化後的值當成一個假的身分 key。
 */
export function currentIdentityForFiles(): string | undefined {
    const id = currentIdentity();
    return typeof id === 'string' ? id : undefined;
}

/**
 * per-identity 登入態容器（D2）。只存 agrabah JWT（D3：絕不存帳密）。
 * key 是 H3/H4 名冊唯一 id 或 STDIO_IDENTITY，不是顯示名。
 */
const sessions = new Map<Identity, { token: string }>();

export const remote = new Remote();
remote.setBaseUrlToAllGroup(BASE_URL);
remote.setHeaderHandlerToAllGroup(() => {
    // platform 是「同一部署服務多個 platform，以來訪 host 判定平台」，所以認證 platform 靠
    // BASE_URL 本身的 Host（core.domains 查表），不是靠這裡的 header——這裡只需要帶登入 token。
    const headers: Record<string, string> = {};
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
        throw new Error('缺少登入帳密：請在呼叫時提供 identifier/password，或在 .mcp.json 設定 AGRABAH_PLATFORM_USER / AGRABAH_PLATFORM_PASSWORD');
    }

    const identity = currentIdentity();
    const r = await remote.platform.auth.Login(identifier, password, opts.totpCode ?? '', '', '');
    if (r.failed || !r.data) {
        sessions.delete(identity);
        return { success: false, errorCode: r.errorCode, message: r.message };
    }

    sessions.set(identity, { token: r.data.loginToken });
    return { success: true, message: '登入成功', mustBindTotp: r.data.mustBindTotp };
}

/**
 * hosted 模式「需要重新登入」的專屬 Error 子類，設計理由與 admin 端逐字相同，
 * 完整說明見 obsidian/mcps/agrabah-admin/src/session.ts 同一段註解。
 */
export class ReloginRequiredError extends Error {}

/**
 * H7：雙模式（plan.md D3/D4），設計理由與 admin 端逐字相同，完整說明見
 * obsidian/mcps/agrabah-admin/src/session.ts 同一段註解。stdio 模式沒有
 * session 時用 env 帳密自動登入（行為不變）；hosted 模式拋 ReloginRequiredError，
 * 由 http.ts 的包裝層轉成一般的 tool result 回給 agent，符合 D11「只陳述事實」。
 */
async function ensureLoggedIn(): Promise<void> {
    if (sessions.has(currentIdentity())) return;
    if (isHostedIdentity()) {
        throw new ReloginRequiredError(HOSTED_RELOGIN_REQUIRED_MESSAGE);
    }
    const r = await login();
    if (!r.success) throw new Error(`自動登入失敗：errorCode=${ r.errorCode } ${ r.message }`);
}

/**
 * 包一層自動登入 + token 失效自動重登重試，比照 test-method skill 的規則。
 * 傳入的 call 應該是一個「已經帶好參數、只差呼叫」的 thunk，例如：
 *   withAutoRelogin(() => remote.gameBackOffice.gameVendorPlatform.ListGameVendors(search, page, pageSize))
 *
 * H7：JWT 過期（AgrabahErrorCodeEnum.loginRequired）時同樣雙模式——stdio 用 env 帳密
 * 自動重登（行為不變）；hosted 模式拋 ReloginRequiredError，不嘗試用 env 帳密重登（D3）。
 */
export async function withAutoRelogin<T>(
    call: () => Promise<{ failed: boolean; errorCode: number; message: string; data: T | null }>,
): Promise<{ failed: boolean; errorCode: number; message: string; data: T | null }> {
    await ensureLoggedIn();
    let r = await call();

    if (r.failed && r.errorCode === AgrabahErrorCodeEnum.loginRequired) {
        if (isHostedIdentity()) {
            throw new ReloginRequiredError(HOSTED_RELOGIN_REQUIRED_MESSAGE);
        }
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
 * 綁 Redis、1 小時效期的 `token`（由 GetUploadGameImageToken 之類的 method 取得）
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
