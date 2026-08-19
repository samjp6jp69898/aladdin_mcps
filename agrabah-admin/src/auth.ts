/**
 * auth.ts — Bearer token 名冊載入與認證 middleware。
 *
 * H3 拍板契約（H4/H5/H19/H28/H32 沿用）：
 *   - 名冊是獨立 JSON 檔（不放 .env：多筆 token→身分映射用單行 KEY=VALUE 很
 *     彆扭，且 .env 是啟動時 grep 匯出、改動要重啟）。
 *   - 每次認證「現讀檔案 + 用 mtime 做快取」，讓新增/撤銷 token 不需要重啟
 *     行程——這不是效能考量而是正確性考量：撤銷一把離職者的 token 若需要
 *     重啟 server，重啟會清空 H5 的 per-token 登入態容器，等於把所有在職
 *     企劃一起踢下線。
 *   - 驗證通過後傳遞下去的「這個 request 屬於哪位企劃」是名冊裡的**唯一
 *     id**，不是顯示名（display_name 只用於 log，允許重複、不可信任其
 *     唯一性）。H5 會拿它當登入態容器的 key，顯示名重複（打錯字/同名同姓）
 *     會讓兩個人的 JWT 共用同一格且不會報錯。
 *   - admin 與 platform 是兩台獨立發 token 的服務（D11），各自一份名冊檔，
 *     本檔只認呼叫端傳入的 registryPath，不知道另一台服務的名冊在哪，
 *     也不做任何跨服務比對——「platform token 打不進 admin」單純是因為
 *     兩份名冊檔互不相交。
 *
 * 名冊檔案格式（JSON，UTF-8），範例：
 *   {
 *     "tokens": [
 *       {
 *         "id": "landon",                          // 唯一，程式當 key
 *         "token": "<randomBytes(32).toString('base64url')>",
 *         "display_name": "Landon",                // 只用於 log
 *         "issued_at": "2026-08-19T00:00:00Z",
 *         "expected_agrabah_identifier": null        // 選填，H6 用於帳號綁定
 *       }
 *     ]
 *   }
 * token 產生方式：bun -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
 *
 * 名冊格式驗證：載入時若發現重複 token 或重複 id，一律拒絕本次載入（含第一
 * 次載入），log 到 stderr 並沿用前一份有效名冊；第一次載入本身失敗（檔案
 * 不存在、JSON 壞掉、格式錯誤）則沿用「空名冊」——所有請求 401，但不阻擋
 * 伺服器啟動（比照 H1「認證層缺設定不阻擋啟動」，同時對認證本身維持
 * fail-closed：缺設定時一律拒絕，絕不放行）。
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
import { readFileSync, statSync } from 'node:fs';
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

interface RegistryCache {
    mtimeMs: number;
    entries: TokenRegistryEntry[];
}

// 每個 registryPath 各自快取，admin/platform（未來 H4）互不干擾，也讓
// auth.test.ts 能用彼此獨立的暫存名冊檔測試而不互相污染快取。
const cacheByPath = new Map<string, RegistryCache>();

/**
 * 現讀名冊檔 + mtime 快取，回傳目前有效的 entries（可能是沿用前一份，見
 * 檔頭「名冊格式驗證」）。找不到檔案時回傳空陣列且不建立快取——下次請求
 * 會再試著讀一次，讓「先啟動服務、稍晚才補名冊檔」這個操作順序也能生效。
 *
 * 驗證刻意做到「每個欄位的型別/存在性都檢查」而不是只擋重複值：一份手誤
 * 缺了 id 或 token 欄位的名冊，若被當成合法資料快取起來，輕則某個身分的
 * agrabahIdentity 變成 undefined（H5 登入態容器會用它當 key，undefined
 * 不是一個安全的 key），重則後面比對 token 時對 undefined 呼叫
 * `Buffer.from()` 直接拋例外——而且是在「這次載入本身」的 try/catch 之外
 * （比對邏輯屬於每個 request 各自執行），一份壞名冊會讓**所有**身分（不只
 * 壞掉那筆）從下一次快取失效開始全部 500，等於整層認證被單一筆手誤打掛。
 * 所有拒絕訊息只帶 index 或已驗證過的 id，絕不印出 token 或整筆 entry
 * （entry 內容含真實 token 值，印出來就是把祕密寫進 log）。
 */
function loadRegistry(registryPath: string): TokenRegistryEntry[] {
    const previous = cacheByPath.get(registryPath);

    let mtimeMs: number;
    try {
        mtimeMs = statSync(registryPath).mtimeMs;
    } catch {
        return previous?.entries ?? [];
    }

    if (previous && previous.mtimeMs === mtimeMs) {
        return previous.entries;
    }

    const reject = (reason: string): TokenRegistryEntry[] => {
        console.error(`[auth] 名冊格式錯誤：${ reason }，拒絕本次載入，沿用前一份有效名冊（${ registryPath }）`);
        return previous?.entries ?? [];
    };

    let parsed: unknown;
    try {
        parsed = JSON.parse(readFileSync(registryPath, 'utf-8'));
    } catch (err) {
        return reject(`JSON 解析失敗：${ err instanceof Error ? err.message : String(err) }`);
    }

    if (parsed === null || typeof parsed !== 'object' || !Array.isArray((parsed as RegistryFile).tokens)) {
        return reject('tokens 欄位不存在或不是陣列');
    }

    const rawEntries = (parsed as RegistryFile).tokens;
    const entries: TokenRegistryEntry[] = [];
    const seenTokens = new Set<string>();
    const seenIds = new Set<string>();
    for (let i = 0; i < rawEntries.length; i++) {
        const entry = rawEntries[i];
        if (typeof entry?.id !== 'string' || entry.id.length === 0) {
            return reject(`第 ${ i } 筆條目缺少合法的 id`);
        }
        if (typeof entry.token !== 'string' || entry.token.length === 0) {
            return reject(`id=${ entry.id } 缺少合法的 token`);
        }
        if (seenTokens.has(entry.token)) {
            return reject(`token 重複（id=${ entry.id }）`);
        }
        if (seenIds.has(entry.id)) {
            return reject(`id 重複（id=${ entry.id }）`);
        }
        seenTokens.add(entry.token);
        seenIds.add(entry.id);
        entries.push(entry);
    }

    cacheByPath.set(registryPath, { mtimeMs, entries });
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

/** H5/H6/H8 讀取「這個 request 屬於哪位企劃」：名冊唯一 id，不是顯示名。 */
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
