/**
 * auth.ts — Bearer token 名冊載入與認證 middleware。
 *
 * 2026-08-20：從「單一共用 token」改成比照 aladdin-admin/aladdin-platform 的
 * H3 per-user 名冊機制——原因：deploy-pipeline 現在會自動 commit+push+reload，
 * 需要知道「這次部署是誰觸發的」才能把 commit message、Telegram 通知、
 * scratch/{requestId}/conversation.json 都歸屬到人，共用 token 完全做不到這件事
 * （見同日 const.ts/deploy-pipeline.ts 的異動）。邏輯逐字沿用
 * aladdin-admin/src/auth.ts 的 loadRegistry/failClosed/tokenMatches 設計。
 *
 * 2026-08-31：補上 audit_log.ts 後，認證失敗（缺 header / token 不合法）也在
 * 這裡記一行稽核（來源 IP + 原因，不含 token 值），比照 aladdin-admin/src/
 * auth.ts 同一處呼叫——上一段「認證失敗只寫 stderr」的說明已過時。
 *
 * 名冊語意（跟 admin 一致）：每次認證都重讀名冊檔、完整驗證，讀不到/解析不了/
 * 驗證不過一律回空名冊（fail-closed → 全體 401），不保留、不沿用前一次結果，
 * 讓撤銷一定生效、修好後下一個 request 立刻自動恢復，不需要重啟行程。
 *
 * 名冊檔案格式（JSON，UTF-8），範例：
 *   {
 *     "tokens": [
 *       { "id": "landon", "token": "<randomBytes(32).toString('base64url')>",
 *         "display_name": "Landon", "issued_at": "2026-08-20T00:00:00Z" }
 *     ]
 *   }
 *
 * 只掛在 /mcp（見 http.ts 的 middleware 掛載順序），/health 不驗證，供
 * launchd/監控探測、且經 proxy 後公網可達，不透露服務身分。
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
}

interface RegistryFile {
    tokens: TokenRegistryEntry[];
}

// 名冊載入失敗時的 stderr 去重狀態，只影響 log、不參與授權判斷（授權一律以
// 「本次讀檔的結果」為準）。理由同 aladdin-admin/src/auth.ts：沒有它的話一份
// 壞名冊會讓每個 request 都印一行，真正該被看見的第一行會被洗掉。
const lastFailureByPath = new Map<string, string>();

/** fail-closed：回空名冊（→ 所有請求 401），並確保維運者在 stderr 看得見。 */
function failClosed(registryPath: string, reason: string): TokenRegistryEntry[] {
    if (lastFailureByPath.get(registryPath) !== reason) {
        lastFailureByPath.set(registryPath, reason);
        console.error(`[toolsmith auth] 名冊載入失敗，已進入拒絕所有請求狀態（所有 token 一律 401，直到名冊修好）：${ reason }（${ registryPath }）`);
    }
    return [];
}

/** 逐字沿用 aladdin-admin/src/auth.ts 的驗證邏輯：每個欄位型別/存在性都檢查，不只擋重複值。 */
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
        const entry = rawEntries[ i ];
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

    if (lastFailureByPath.delete(registryPath)) {
        console.error(`[toolsmith auth] 名冊已重新載入成功（${ entries.length } 筆條目），恢復正常認證（${ registryPath }）`);
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

export type AuthVariables = { toolsmithIdentity: string; toolsmithDisplayName: string };

/** 讀取「這個 request 屬於哪位企劃/同事」：名冊唯一 id，不是顯示名。 */
export function getIdentity(c: Context<{ Variables: AuthVariables }>): string {
    return c.get('toolsmithIdentity');
}

/** 供 log/通知訊息用的顯示名（僅供顯示，不可當任何容器的 key）。 */
export function getDisplayName(c: Context<{ Variables: AuthVariables }>): string {
    return c.get('toolsmithDisplayName');
}

/**
 * Bearer 認證 middleware。驗證失敗一律回泛用的 401 + 純文字 body，不透露
 * 「是缺 header 還是 token 錯誤」以外的任何資訊。
 */
export function createBearerAuthGuard(registryPath: string): MiddlewareHandler<{ Variables: AuthVariables }> {
    return async (c, next) => {
        const header = c.req.header('authorization');
        if (header === undefined || !header.startsWith('Bearer ')) {
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
            logAuthFailure(c, 'invalid_token');
            return c.text('Unauthorized', 401);
        }

        c.set('toolsmithIdentity', matched.id);
        c.set('toolsmithDisplayName', matched.display_name);
        await next();
    };
}
