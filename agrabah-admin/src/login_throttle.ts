/**
 * login_throttle.ts — H6：帳號層登入失敗節流，被 http.ts 的 POST /login 使用。
 *
 * 與 H31（尚未實作）的「流量層 rate limit」是兩回事：那個是不分身分、對三條
 * 對外 route 整體的請求量體控制；這裡是**每個 Bearer 身分各自**的登入失敗
 * 計數器，目的是避免我方 /login 端點被拿去當暴力破解 agrabah 帳密的跳板——
 * 即使 H31 上線後把流量壓到每分鐘 60 次，跑一整天仍有 86400 次嘗試機會，
 * 這一層必須獨立存在，不能指望流量層間接擋下。
 *
 * 冷卻用時間戳比較，不用 sleep（CLAUDE.md 硬規則：禁止用等待解決正確性
 * 問題）：只記錄「鎖到哪個時間點」，每次請求進來時拿 now() 跟它比較，
 * 從不主動等待；`now` 參數預設 `Date.now`，可在測試中注入假時鐘推進時間，
 * 不必真的等 COOLDOWN_MS 過去。
 *
 * 狀態存在 process 記憶體、key 是 H3/H4 名冊唯一 id（與 session.ts 的
 * sessions Map 用同一種 identity，但這是完全獨立的 Map，不共用儲存）。
 * launchd 重啟行程會清空節流狀態——可接受：重啟同時也會清空 H5 的登入態，
 * 所有身分本來就得重新走一次登入流程。
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
