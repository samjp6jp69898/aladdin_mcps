/**
 * concurrency-limiter.ts — in-memory 併發號誌（semaphore）工廠。
 *
 * 2026-08-20 從「tryAcquire 失敗立刻回 busy、不排隊」的原始設計改成「額度用盡
 * 就在佇列裡等，輪到自己再繼續」——因為 MCP tool call 本身是同步阻塞（呼叫端
 * 會一直等到回應），這裡的「排隊」對呼叫端而言只是「這次比較久」，不是「失敗
 * 要自己重試」。FIFO 佇列，先到先服務；acquire() 回傳的 Promise 要等真的輪到
 * 這次呼叫、名額已經佔用時才 resolve，呼叫端 await 完就可以直接往下跑，不需要
 * 自己寫重試迴圈。
 *
 * 邏輯延續已上線的
 * /Users/user/aladdin/telegram-dispatcher/lib/pipeline-runner/concurrency-limiter.ts
 * 的計數器核心（aladdin_mcps 與 telegram-dispatcher 是兩個獨立 repo，不跨 repo
 * import），額度用盡時的行為改成佇列而不是回傳 false。同一份程式碼被用來建立
 * 兩把互不相干的鎖：tools/generate_tool.ts 的研究/寫代碼名額（N=3）跟
 * agent/deploy-pipeline.ts 的部署序列化鎖（N=1）——各自 module-level 各自
 * 呼叫一次 createConcurrencyLimiter()，不共用計數器。
 */

export type ConcurrencyLimiter = {
    /** 佔用一個名額；名額足夠立刻 resolve，額度用盡就排進佇列，輪到自己（前面
     * 排隊的都 release 過）才 resolve。呼叫端 await 完即代表已經佔用成功。 */
    acquire: () => Promise<void>;
    /** 釋放一個名額。佇列裡有人在等就直接把名額轉交給下一個（不先減後加，
     * 避免中間有第三者用 acquire() 插隊搶到這個名額）；佇列是空的才真的把
     * 計數器減一。多次呼叫、或從未成功 acquire 就呼叫都安全（夾在 0 下限）。 */
    release: () => void;
    /** 目前佔用的名額數，供測試/觀察用。 */
    current: () => number;
};

export function createConcurrencyLimiter(limit: number): ConcurrencyLimiter {
    let count = 0;
    const queue: Array<() => void> = [];

    return {
        acquire() {
            if (count < limit) {
                count++;
                return Promise.resolve();
            }
            return new Promise<void>((resolve) => {
                queue.push(resolve);
            });
        },
        release() {
            const next = queue.shift();
            if (next !== undefined) {
                next();
                return;
            }
            count = Math.max(0, count - 1);
        },
        current() {
            return count;
        },
    };
}
