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
import { Remote, AgrabahErrorCodeEnum } from '/Users/user/aladdin/abu/admin/src/generated/remote.gen.ts';
import { HOSTED_RELOGIN_REQUIRED_MESSAGE } from './const.ts';

const BASE_URL = process.env.ALADDIN_ADMIN_API_URL;
const DEFAULT_USER = process.env.ALADDIN_ADMIN_USER;
const DEFAULT_PASSWORD = process.env.ALADDIN_ADMIN_PASSWORD;

if (!BASE_URL) {
    throw new Error('缺少環境變數 ALADDIN_ADMIN_API_URL，請確認 .mcp.json 的 aladdin-admin server env 是否已設定');
}

/**
 * H36（plan.md D13）：這個 server 實例是否是正式環境（prod）。比照 BASE_URL 等環境相關
 * 設定的讀法，行程啟動時讀一次、存成 module 層級常數；未設定或空字串＝false（非 prod），
 * 向後相容既有的 dev/pre/evi 部署行為不變。
 *
 * 只放在這裡（而不是 const.ts）：const.ts 檔頭明寫「帳號/URL 等環境相關設定不放這裡，
 * 一律走 process.env」，這個旗標跟 BASE_URL/DEFAULT_USER 同一類，比照辦理放在 session.ts。
 *
 * H36 review 收尾：讀法容錯 trim+小寫（`'TRUE'`/`' true'` 等寫法都算合法的 true），但對
 * 「有設定值、trim+小寫後卻不是 'true' 也不是 'false'」的情況（拼字錯誤如 `'1'`/`'yes'`/
 * `'True '`之外的怪值、或其他手誤）直接 throw——比照本檔 `BASE_URL` 缺失即 throw 的既有
 * 慣例，fail-loud。這個旗標一旦被靜默判成非 prod，就等於整個 confirm 閘門機制形同虛設，
 * 寧可讓一個設錯值的部署直接啟動失敗，也不要讓它悄悄跑起來卻沒有任何防線。
 */
const IS_PROD_RAW = process.env.ALADDIN_ADMIN_IS_PROD;
const IS_PROD_NORMALIZED = IS_PROD_RAW?.trim().toLowerCase();
if (IS_PROD_NORMALIZED !== undefined && IS_PROD_NORMALIZED !== '' && IS_PROD_NORMALIZED !== 'true' && IS_PROD_NORMALIZED !== 'false') {
    throw new Error(
        `環境變數 ALADDIN_ADMIN_IS_PROD 的值不合法："${ IS_PROD_RAW }"，只接受 true 或 false（大小寫、前後空白不拘）。` +
        '請修正部署設定——這個旗標控制 prod confirm 閘門是否生效，拼字錯誤不應該被靜默當成非 prod。',
    );
}
/** H36 review 收尾：暴露給 http.ts 開機時印一行閘門啟用狀態 log（見 http.ts 檔頭附近）。 */
export const IS_PROD = IS_PROD_NORMALIZED === 'true';

/**
 * H38（缺口一）：只驗證「有沒有設定合法值」還不夠。H15 安全審查用 `ps eww` 實測確認
 * 所有已部署的 launchd 腳本都沒有設定 `ALADDIN_ADMIN_IS_PROD`——目前這個旗標「未設定」
 * 就是正常部署現況，不是異常。問題在於：若有人把 `ALADDIN_ADMIN_API_URL` 改指向真正的
 * prod 後端、卻忘了同時明確設這個旗標，`IS_PROD` 會照舊靜默判成 false，整條
 * `assertProdConfirmed()` 閘門變成 no-op——而且開機 log 還是印「停用（非 prod 實例）」，
 * 肉眼完全看不出異常，這正是這個機制存在的唯一理由被繞過的方式。
 *
 * 修法：交叉檢查——BASE_URL 不符合任何已知的非 prod 網域特徵，且 IS_PROD 不是明確的
 * true，一律 fail-loud 拒絕啟動（比照同檔 IS_PROD 值不合法即 throw 的既有慣例）。
 *
 * 已知非 prod 網域清單涵蓋：目前實際部署過的 dev（alddev.com）/pre（ald777.com）/
 * evi（godev2.com），加上 `.env.example` 已預留、尚未部署的 uat（jxpre.com）——這四個
 * 網域就是 DEPLOY-TO-NEW-MACHINE.md §2.1 表列的全部已知環境；以及本機測試慣用的
 * localhost/127.0.0.1（session.test.ts / http.test.ts / list_game_vendors.test.ts
 * 等多個既有測試檔把 BASE_URL 設成 `http://127.0.0.1:.../...` 當作不會真的發網路請求的
 * 佔位值，且完全不設這個旗標——若這裡誤判會讓所有既有測試連帶炸掉，見同一批 test 檔）。
 *
 * 這個檢查只在 `!IS_PROD` 時生效：`IS_PROD===true` 時（不論 URL 是什麼）完全略過，
 * 保留 H36 既有的測試手法——`ALADDIN_ADMIN_IS_PROD=true` + URL 仍指向 dev 的臨時實例，
 * 因為目前沒有真實 prod 網址可測，只能用這種組合矛盾驗證閘門邏輯本身。
 *
 * 新增一個真正的 prod 部署時，唯一合法路徑是明確設定 `ALADDIN_ADMIN_IS_PROD=true`；
 * 新增一個「不是 prod、但網域剛好不在清單裡」的新測試/開發環境時，把該網域加進
 * KNOWN_NON_PROD_URL_MARKERS——這兩種情境不能都不做，否則新環境會直接啟動失敗。
 *
 * review 發現的真實繞過（H38 收尾修正）：一開始用 `BASE_URL.includes(marker)` 對整個
 * URL 字串做子字串比對，`https://prod-alddev.com-attacker.evil.com` 這種刻意（或巧合）
 * 把 marker 字串塞進網域任何位置的 URL 會被誤判成「已知非 prod」而放行，讓這個檢查
 * 本身出現一個跟它想堵住的「靜默放行」同類型的縫隙。改成只比對 `new URL(url).hostname`，
 * 且要求 hostname 精確等於 marker 或以 `.` + marker 結尾（真正的子網域關係），
 * `evil.com` 掛在後面、`attacker.` 掛在前面都無法再通過。
 */
const KNOWN_NON_PROD_URL_MARKERS = [ 'alddev.com', 'ald777.com', 'godev2.com', 'jxpre.com', '127.0.0.1', 'localhost' ];
/** hostname 精確比對或真正的子網域關係——不接受任何形式的子字串包含。 */
function isKnownNonProdUrl(url: string): boolean {
    let hostname: string;
    try {
        hostname = new URL(url).hostname.toLowerCase();
    } catch {
        return false; // 連 hostname 都解析不出來，一律視為不安全，交叉檢查照樣生效。
    }
    return KNOWN_NON_PROD_URL_MARKERS.some(marker => hostname === marker || hostname.endsWith(`.${ marker }`));
}
if (!IS_PROD && !isKnownNonProdUrl(BASE_URL)) {
    throw new Error(
        `環境變數 ALADDIN_ADMIN_API_URL（"${ BASE_URL }"）不符合任何已知的非 prod 網域特徵` +
        `（${ KNOWN_NON_PROD_URL_MARKERS.join('、') }），但 ALADDIN_ADMIN_IS_PROD 不是明確的 true。` +
        '這個組合被視為「可能是正式環境卻忘了開啟 prod confirm 閘門」，拒絕啟動。' +
        '若這真的是正式環境，請明確設定 ALADDIN_ADMIN_IS_PROD=true；' +
        '若這是一個新的非 prod 環境，請把它的網域加進 session.ts 的 KNOWN_NON_PROD_URL_MARKERS 清單。',
    );
}

/** H36：prod 寫入操作要求的明確確認字串。四支寫入 tool 共用同一個值與同一支檢查函式。 */
export const PROD_CONFIRM_TOKEN = 'CONFIRM_PROD_WRITE';

/**
 * H36 review 收尾：`assertProdConfirmed` 攔截時拋的專屬 Error 子類，讓 http.ts 的稽核包裝層
 * 能用 `instanceof` 把「被 confirm 閘門擋下」跟其他未預期例外區分開，audit.jsonl 記成可辨識
 * 的 `error:prod_confirm_required` 而非泛用的 `error:exception`（見 http.ts
 * withStderrStackLogging 的 catch 分支）。
 */
export class ProdConfirmRequiredError extends Error {}

/**
 * H36：prod 執行前的伺服器端強制 confirm 閘門。只有 IS_PROD===true 的實例才會檢查——
 * 非 prod 實例（dev/pre/evi，或未設定 ALADDIN_ADMIN_IS_PROD）完全略過這支函式的檢查，
 * 呼叫端就算帶了 confirm 欄位也不影響行為、不帶也不受影響，向後相容。
 *
 * 這是一個軟體層面的防線，不能保證上游的 agent 一定會先問過使用者才帶上正確的 confirm
 * 值——tool description 裡對 AskUserQuestion 的指示只是引導；真正的硬防線是「沒有帶對
 * confirm 就不執行任何下游 RPC」這件事本身，所以這支函式必須在 tool handler 呼叫任何
 * remote.* / withAutoRelogin 之前被呼叫，讓沒過閘門的呼叫連 ensureLoggedIn 都不會觸發。
 */
export function assertProdConfirmed(confirm: string | undefined): void {
    if (!IS_PROD) return;
    if (confirm !== PROD_CONFIRM_TOKEN) {
        throw new ProdConfirmRequiredError(
            '這是正式環境（prod），需要明確確認才能執行這個寫入操作：請先用 AskUserQuestion（或功能相同的方式）' +
            '向使用者明確詢問是否要在正式環境執行，取得明確同意後帶上 confirm="' + PROD_CONFIRM_TOKEN + '" 重新呼叫；' +
            '絕不能自行假設使用者同意。',
        );
    }
}

Client.encoded = true; // request/response bytes 走 XOR，client 內部自動處理，見 genie/src/client/index.ts

/** stdio 模式的固定隱含身分（單一 Symbol，不可能與任何名冊 id 字串撞號）。 */
const STDIO_IDENTITY = Symbol('aladdin-admin-stdio-identity');
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

/** hosted 模式：identity 是名冊字串（經 runWithIdentity 灌入）；stdio 模式：identity 是固定的 STDIO_IDENTITY Symbol。 */
function isHostedIdentity(): boolean {
    return currentIdentity() !== STDIO_IDENTITY;
}

/**
 * H9：暴露目前呼叫身分的字串形式，供 tools（edit_game.ts）解析 fileId → 本機
 * 路徑時比對身分（見 files.ts 的 resolveFileIdForIdentity）。stdio 模式的
 * STDIO_IDENTITY 是 Symbol，不是任何合法的名冊 id，回傳 undefined——這對應
 * 到「stdio 模式本來就不會有合法 fileId 可用」的事實（POST /files 只存在於
 * hosted 的 http.ts），消費端據此直接判斷沒有身分可用，而不是誤把 Symbol
 * 字串化後的值當成一個假的身分 key。
 */
export function currentIdentityForFiles(): string | undefined {
    const id = currentIdentity();
    return typeof id === 'string' ? id : undefined;
}

/**
 * per-identity 登入態容器（D2）。只存 agrabah JWT（D3：絕不存帳密）。
 * key 是 H3 名冊唯一 id 或 STDIO_IDENTITY，不是顯示名。
 */
const sessions = new Map<Identity, { token: string }>();

export const remote = new Remote();
remote.setBaseUrlToAllGroup(BASE_URL);
remote.setHeaderHandlerToAllGroup(() => {
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
        throw new Error('缺少登入帳密：請在呼叫時提供 identifier/password，或在 .mcp.json 設定 ALADDIN_ADMIN_USER / ALADDIN_ADMIN_PASSWORD');
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

/**
 * hosted 模式「需要重新登入」的專屬 Error 子類，比照 H36 的 ProdConfirmRequiredError：
 * 讓 http.ts 的包裝層能用 instanceof 把這個**預期中的業務狀態**與真正的未預期例外
 * 分開處理。
 *
 * 為什麼需要一個子類、而不是繼續拋泛用 Error：泛用 Error 會被包裝層原樣往上拋，
 * MCP SDK 收到 tool handler 拋出的例外後會把它變成 JSON-RPC 層的錯誤，企劃端的
 * Claude Code 把那種錯誤解讀成傳輸問題、畫面只顯示「連線失敗」——寫得再清楚的
 * 重登訊號都到不了企劃眼前（真實使用者測試中發生過）。改成可辨識的子類後，
 * 包裝層會把它轉成一般的 tool result 回傳（見 http.ts withStderrStackLogging），
 * 訊號才真的送得到 agent 手上。
 */
export class ReloginRequiredError extends Error {}

/**
 * H7：雙模式（plan.md D3/D4）。stdio 模式沒有 session 時用 env 帳密自動登入
 * （行為不變）；hosted 模式 server 記憶體不留帳密（D3），沒有 env 帳密可用，
 * 改拋 ReloginRequiredError 這個明確、機器可辨識的重登信號，由 http.ts 的包裝層
 * 轉成 tool result 回給 agent，交由呼叫端（企劃端登入 skill）重跑 POST /login
 * 後重試。措辭止於 HOSTED_RELOGIN_REQUIRED_MESSAGE，符合 D11「只陳述事實」。
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
 *   withAutoRelogin(() => remote.gameBackOffice.gameVendorAdmin.ListGameVendors(search, page, pageSize))
 *
 * H7：JWT 過期（AgrabahErrorCodeEnum.loginRequired）時同樣雙模式——stdio 用 env 帳密
 * 自動重登（行為不變）；hosted 模式拋 ReloginRequiredError，不嘗試用 env 帳密重登
 * （D3：hosted 模式沒有帳密可用）。
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
