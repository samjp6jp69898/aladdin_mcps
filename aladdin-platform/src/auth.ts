/**
 * auth.ts — Bearer token 名冊載入與認證 middleware。
 *
 * H3 在 aladdin-admin/src/auth.ts 拍板的契約，本檔原樣複製（H4：兩個 server
 * 目前各自獨立 package、沒有共用套件層，複製一份小檔案優於臨時造共用套件
 * 層——CLAUDE.md Rule 2 Simplicity First）。與 admin 版本逐行一致，僅檔頭
 * 這段註解與下方模組指涉（H4 而非 H3）不同：
 *   - 名冊是獨立 JSON 檔（不放 .env：多筆 token→身分映射用單行 KEY=VALUE 很
 *     彆扭，且 .env 是啟動時 grep 匯出、改動要重啟）。
 *   - 每次認證「現讀檔案 + 用 mtime 做快取」，讓新增/撤銷 token 不需要重啟
 *     行程——這不是效能考量而是正確性考量：撤銷一把離職者的 token 若需要
 *     重啟 server，重啟會清空登入態容器，等於把所有在職企劃一起踢下線。
 *   - 驗證通過後傳遞下去的「這個 request 屬於哪位企劃」是名冊裡的**唯一
 *     id**，不是顯示名（display_name 只用於 log，允許重複、不可信任其
 *     唯一性）。若拿它當登入態容器的 key，顯示名重複（打錯字/同名同姓）
 *     會讓兩個人的 JWT 共用同一格且不會報錯。
 *   - admin 與 platform 是兩台獨立發 token 的服務（D11），各自一份名冊檔，
 *     本檔只認呼叫端傳入的 registryPath，不知道另一台服務的名冊在哪，
 *     也不做任何跨服務比對——「admin token 打不進 platform」單純是因為
 *     兩份名冊檔互不相交（見 http.ts 傳入的 TOKENS_PATH 預設值）。
 *
 * 名冊檔案格式（JSON，UTF-8），範例：
 *   {
 *     "tokens": [
 *       {
 *         "id": "landon",                          // 唯一，程式當 key
 *         "token": "<randomBytes(32).toString('base64url')>",
 *         "display_name": "Landon",                // 只用於 log
 *         "issued_at": "2026-08-19T00:00:00Z",
 *         "expected_agrabah_identifier": null        // 選填，供帳號綁定用
 *       }
 *     ]
 *   }
 * token 產生方式：bun -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
 *
 * 名冊載入語意（M3 修正，取代原先的「拒絕本次載入並沿用前一份有效名冊」）：
 * **每次認證都重讀名冊檔，且只有一份完整通過驗證的名冊能授權請求**。任何讀不
 * 到、解析不了、或驗證不過的情況（檔案被刪除、JSON 壞掉、tokens 不是陣列、
 * 條目缺 id/token、token 或 id 重複）一律回空名冊 → 所有請求 401，並在 stderr
 * 印一行明確的「已進入拒絕所有請求狀態」。伺服器仍不會因此拒絕啟動（比照
 * 「認證層缺設定不阻擋啟動」）。
 *
 * 為什麼不再沿用前一份：舊寫法在「曾經成功載入、之後檔案消失或損毀」時，會繼續
 * 拿記憶體裡的舊名冊授權——等於用一份磁碟上已不存在的狀態放行請求。外洩通報後
 * 最直覺的兩個止血動作（把名冊檔刪掉、或手改存壞）因此都不會撤銷任何 token，
 * 畫面上還完全沒有回饋，維運者會以為已經止血。撤銷必須在**所有**誤操作下都生效；
 * 只保證其中一部分（移除條目存檔）形同沒有保證，因為維運者無法分辨自己踩到哪種。
 *
 * 這個統一也讓「單筆條目格式錯誤」變成全體 401。這是刻意的取捨：代價有界且可
 * 自癒——改好檔案後下一個 request 重讀就恢復，不必重啟，session.ts 的 per-token
 * 登入態容器（`sessions`）完全不受影響，沒有人需要重新登入；換到的是「撤銷一定
 * 生效」這個不分情境都成立的保證。原本這段驗證要防的事情依然成立，見
 * loadRegistry 上方註解：不合格的條目在任何情況下都不會進入授權路徑。
 *
 * 不做 mtime/size 快取：名冊只有幾 KB，每個 request 讀一次的成本遠低於本服務每
 * 次 tool call 對 agrabah 的 RPC（也低於同一條失敗路徑上 audit_log 的寫檔），而
 * 任何「檔案沒變」的推測都可能被騙——撤銷後把 mtime 還原成相同值、或就地改掉
 * 一個字元讓 size 與 ino 都不變，都會讓快取繼續放行已撤銷的 token。認證正確性
 * 優先於效能，同上面第二點。
 *
 * timingSafeEqual 用法比照已上線的
 * telegram-dispatcher/lib/security/webhook-secret-guard.ts：逐一比對名冊內
 * 每把候選 token，長度不同時直接跳過（不呼叫 timingSafeEqual——它要求等長
 * buffer，長度不同會丟例外），找到一個 byte-exact 相符即視為該身分，全部
 * 比對完仍無相符則 401。刻意不用「Map.get(presentedToken)」這種以字串相等
 * 查表的寫法：JS 的字串比較是提早跳出的 byte-by-byte 比較，等於繞過我們
 * 特意要做的常數時間比較。
 */

import { timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Context, MiddlewareHandler } from 'hono';
import { logAuthFailure } from './audit_log.ts';

export interface TokenRegistryEntry {
    id: string;
    token: string;
    display_name: string;
    issued_at: string;
    expected_agrabah_identifier?: string | null;
}

interface RegistryFile {
    tokens: TokenRegistryEntry[];
}

// 名冊載入失敗時的 stderr 去重狀態。**只影響 log，不參與任何授權判斷**：授權
// 一律以「本次讀檔的結果」為準。沒有它的話，一份壞名冊會讓每個 request 都印一
// 行，真正該被維運者看見的第一行瞬間被洗掉。key 是 registryPath，value 是上次
// 印過的原因，原因變了或修好後再壞都會重新印。
const lastFailureByPath = new Map<string, string>();

/**
 * fail-closed：回空名冊（→ 所有請求 401），並確保維運者在 stderr 看得見。
 *
 * reason 只帶固定字串、條目 index、或已驗證是字串的 id，**絕不帶 token 值、
 * 整筆 entry、或 JSON 解析器的原始訊息**（H17/H18 教訓）。解析器訊息尤其危險：
 * Bun 的 `JSON.parse` 會把出錯位置附近的原文嵌進訊息，實測
 * `{"tokens": <未加引號的 token>}` 會產生 `Unexpected identifier "<token 原文>"`
 * ——手滑漏一組引號就等於把 token 寫進 log。
 */
function failClosed(registryPath: string, reason: string): TokenRegistryEntry[] {
    if (lastFailureByPath.get(registryPath) !== reason) {
        lastFailureByPath.set(registryPath, reason);
        console.error(`[auth] 名冊載入失敗，已進入拒絕所有請求狀態（所有 token 一律 401，直到名冊修好）：${ reason }（${ registryPath }）`);
    }
    return [];
}

/**
 * 每次認證都重讀名冊檔並完整驗證，回傳這一刻磁碟上真正有效的 entries；讀不到
 * 或驗證不過一律回空陣列（fail-closed），不保留、也不沿用任何前一次的結果。
 * 沒有快取同時也讓「先啟動服務、稍晚才補名冊檔」這個操作順序自動生效。
 *
 * 驗證刻意做到「每個欄位的型別/存在性都檢查」而不是只擋重複值：一份手誤缺了
 * id 或 token 欄位的名冊，若被當成合法資料收下，輕則某個身分的 agrabahIdentity
 * 變成 undefined（登入態容器若用它當 key，undefined 不是一個安全的 key），重則
 * 後面比對 token 時對 undefined 呼叫 `Buffer.from()` 直接拋例外——而且是在本函式
 * try/catch 之外（比對邏輯屬於每個 request 各自執行），會讓**所有**身分（不只
 * 壞掉那筆）全部 500。改成 fail-closed 後這層保護不但還在，而且更強：不合格的
 * 條目連「這次」都不會進入授權路徑，結果是乾淨的 401 而不是 500。
 */
function loadRegistry(registryPath: string): TokenRegistryEntry[] {
    let raw: string;
    try {
        raw = readFileSync(registryPath, 'utf-8');
    } catch (err) {
        const code = (err as { code?: string }).code;
        return failClosed(registryPath, code === 'ENOENT' ? '名冊檔不存在' : `名冊檔無法讀取（${ code ?? 'unknown' }）`);
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return failClosed(registryPath, 'JSON 解析失敗（解析器原始訊息刻意不輸出，它會夾帶出錯位置附近的原文，那可能就是 token 值）');
    }

    if (parsed === null || typeof parsed !== 'object' || !Array.isArray((parsed as RegistryFile).tokens)) {
        return failClosed(registryPath, 'tokens 欄位不存在或不是陣列');
    }

    const rawEntries = (parsed as RegistryFile).tokens;
    const entries: TokenRegistryEntry[] = [];
    const seenTokens = new Set<string>();
    const seenIds = new Set<string>();
    for (let i = 0; i < rawEntries.length; i++) {
        const entry = rawEntries[i];
        if (typeof entry?.id !== 'string' || entry.id.length === 0) {
            return failClosed(registryPath, `第 ${ i } 筆條目缺少合法的 id`);
        }
        if (typeof entry.token !== 'string' || entry.token.length === 0) {
            return failClosed(registryPath, `id=${ entry.id } 缺少合法的 token`);
        }
        if (seenTokens.has(entry.token)) {
            return failClosed(registryPath, `token 重複（id=${ entry.id }）`);
        }
        if (seenIds.has(entry.id)) {
            return failClosed(registryPath, `id 重複（id=${ entry.id }）`);
        }
        seenTokens.add(entry.token);
        seenIds.add(entry.id);
        entries.push(entry);
    }

    // 只在「剛剛還是壞的」時候印恢復訊息：維運者修好檔案後要有正向回饋，才知道
    // 上面那行「拒絕所有請求」已經解除，而不是自己還在盲猜。
    if (lastFailureByPath.delete(registryPath)) {
        console.error(`[auth] 名冊已重新載入成功（${ entries.length } 筆條目），恢復正常認證（${ registryPath }）`);
    }
    return entries;
}

/** 常數時間比對：presented 是否等於某個候選 token 的 bytes。長度不同直接 false，不丟例外。 */
function tokenMatches(presented: Buffer, candidateToken: string): boolean {
    const candidate = Buffer.from(candidateToken);
    if (presented.length !== candidate.length) {
        return false;
    }
    return timingSafeEqual(presented, candidate);
}

export type AuthVariables = { agrabahIdentity: string; agrabahDisplayName: string };

/** 下游讀取「這個 request 屬於哪位企劃」：名冊唯一 id，不是顯示名。 */
export function getIdentity(c: Context<{ Variables: AuthVariables }>): string {
    return c.get('agrabahIdentity');
}

/** H32 稽核 log 用：讀取這個 request 的顯示名（僅供 log，不可當任何容器的 key，見上方檔頭說明）。 */
export function getDisplayName(c: Context<{ Variables: AuthVariables }>): string {
    return c.get('agrabahDisplayName');
}

/**
 * Bearer 認證 middleware。驗證失敗一律回泛用的 401 + 純文字 body，不透露
 * 「是缺 header 還是 token 錯誤」以外的任何資訊（不回傳正確 token 的片段、
 * 長度、或名冊內容）。
 */
export function createBearerAuthGuard(registryPath: string): MiddlewareHandler<{ Variables: AuthVariables }> {
    return async (c, next) => {
        const header = c.req.header('authorization');
        if (header === undefined || !header.startsWith('Bearer ')) {
            // H32：認證失敗也要留稽核紀錄（來源 IP + 原因），不含嘗試的 token 值——
            // 這個分支甚至沒有 token 可記（header 缺失或格式不對）。
            logAuthFailure(c, 'missing_or_malformed_authorization_header');
            return c.text('Unauthorized', 401);
        }
        const presented = Buffer.from(header.slice('Bearer '.length));

        const entries = loadRegistry(registryPath);
        let matched: TokenRegistryEntry | undefined;
        for (const entry of entries) {
            if (tokenMatches(presented, entry.token)) {
                matched = entry;
                break;
            }
        }

        if (matched === undefined) {
            // H32：同上，只記「token 不合法」這個事實，presented 本身絕不寫進 log。
            logAuthFailure(c, 'invalid_token');
            return c.text('Unauthorized', 401);
        }

        c.set('agrabahIdentity', matched.id);
        c.set('agrabahDisplayName', matched.display_name);
        await next();
    };
}
