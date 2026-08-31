/**
 * login_throttle.ts — H6：帳號層登入失敗節流，被 http.ts 的 POST /login 使用。
 * 設計理由與 admin 端逐字相同，完整說明見
 * aladdin-admin/src/login_throttle.ts 同一段註解（與 H31 流量層
 * rate limit 的差異、冷卻用時間戳比較不用 sleep、狀態 key 與生命週期）。
 */

const FAILURE_THRESHOLD = 5;
const COOLDOWN_MS = 5 * 60 * 1000; // 5 分鐘

interface ThrottleState {
    failCount: number;
    lockedUntil: number | null;
}

const stateByIdentity = new Map<string, ThrottleState>();

export type ThrottleCheck =
    | { allowed: true }
    | { allowed: false; retryAfterSeconds: number };

/**
 * 呼叫 agrabah 之前先檢查：這個身分目前是否仍在冷卻期。
 * 冷卻期一過即視為新的一輪、自動放行（不需要任何人手動重置狀態）。
 */
export function checkThrottle(identity: string, now: () => number = Date.now): ThrottleCheck {
    const state = stateByIdentity.get(identity);
    if (!state || state.lockedUntil === null) return { allowed: true };

    const remainingMs = state.lockedUntil - now();
    if (remainingMs > 0) {
        return { allowed: false, retryAfterSeconds: Math.ceil(remainingMs / 1000) };
    }

    // 冷卻期已過：整段狀態捨棄，這次請求視為全新一輪，允許放行打 agrabah。
    stateByIdentity.delete(identity);
    return { allowed: true };
}

/** 登入成功：該身分的失敗計數與鎖定狀態全部歸零。 */
export function recordSuccess(identity: string): void {
    stateByIdentity.delete(identity);
}

/** 登入失敗：計數 +1，達門檻（預設 5 次）即進入冷卻期。 */
export function recordFailure(identity: string, now: () => number = Date.now): void {
    const state = stateByIdentity.get(identity) ?? { failCount: 0, lockedUntil: null };
    state.failCount += 1;
    if (state.failCount >= FAILURE_THRESHOLD) {
        state.lockedUntil = now() + COOLDOWN_MS;
    }
    stateByIdentity.set(identity, state);
}
