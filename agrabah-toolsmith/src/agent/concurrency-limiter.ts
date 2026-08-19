/**
 * concurrency-limiter.ts — in-memory 併發計數器工廠。
 *
 * 邏輯比照已上線的
 * /Users/user/aladdin/telegram-dispatcher/lib/pipeline-runner/concurrency-limiter.ts
 * 複製重寫（obsidian 與 telegram-dispatcher 是兩個獨立 repo，不跨 repo
 * import）。toolsmith 用 limit=1（見 ../const.ts 的 CONCURRENCY_LIMIT）：任一
 * 時刻只服務一個 sub-agent 請求，tryAcquire 失敗立刻回 busy，不排隊、不讓
 * 連線懸掛（logical-jumping-cook.md「已知風險」明確定案）。
 */

export type ConcurrencyLimiter = {
    /** 嘗試佔用一個名額；額度足夠回 true 並佔用，額度用盡回 false（不佔用）。 */
    tryAcquire: () => boolean;
    /** 釋放一個名額。夾在 0 下限——多次呼叫、或從未成功 acquire 就呼叫都安全，
     * 不會讓計數器變成負數進而讓後續 tryAcquire 誤放行超過 limit 的請求。 */
    release: () => void;
    /** 目前佔用的名額數，供測試/觀察用。 */
    current: () => number;
};

export function createConcurrencyLimiter(limit: number): ConcurrencyLimiter {
    let count = 0;
    return {
        tryAcquire() {
            if (count >= limit) return false;
            count++;
            return true;
        },
        release() {
            count = Math.max(0, count - 1);
        },
        current() {
            return count;
        },
    };
}
