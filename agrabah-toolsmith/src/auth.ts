/**
 * auth.ts — Bearer token 認證 middleware（單一共用 token）。
 *
 * 與 agrabah-admin/agrabah-platform 的 H3 名冊機制刻意不同：D9/plan.md 的
 * D2 是「每位企劃一把專屬 token」，但 toolsmith 沿用原設計
 * /Users/user/.claude/plans/logical-jumping-cook.md 第 4 節的拍板——「多企劃
 * 先共用一把 token（預期用量小，不做 per-user 管理）」。所以這裡不需要 H3
 * 那套 JSON 名冊 + mtime 熱重載 + per-id 身分傳遞機制，直接比對一把從環境變數
 * 讀到的固定 token 即可。若未來需要 per-user 管理，屬另一個 task 的範圍。
 *
 * 比對邏輯比照已上線的 telegram-dispatcher/lib/security/webhook-secret-guard.ts：
 * timingSafeEqual 常數時間比較、長度不同時不呼叫 timingSafeEqual（它要求等長
 * buffer，長度不同會丟例外）。
 *
 * 只掛在 /mcp（見 http.ts 的 middleware 掛載順序），/health 不驗證，供
 * launchd/監控探測。
 *
 * 缺設定時 fail-closed：一律 401，不阻擋伺服器啟動（比照 agrabah-admin H1
 * 「認證層缺設定不阻擋啟動」的先例——這支服務尤其不該因為忘了設 token 就
 * 意外變成無認證公開端點）。
 */

import { timingSafeEqual } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';

export function createBearerAuthGuard(expectedToken: string | undefined): MiddlewareHandler {
    const expected = expectedToken !== undefined && expectedToken.length > 0
        ? Buffer.from(expectedToken)
        : null;
    if (expected === null) {
        console.error('[agrabah-toolsmith auth] 環境變數 TOOLSMITH_API_TOKEN 未設定或為空，所有 /mcp 請求將一律回 401（fail-closed）');
    }

    return async (c, next) => {
        const header = c.req.header('authorization');
        if (header === undefined || !header.startsWith('Bearer ')) {
            return c.text('Unauthorized', 401);
        }
        if (expected === null) {
            return c.text('Unauthorized', 401);
        }

        const presented = Buffer.from(header.slice('Bearer '.length));
        if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) {
            return c.text('Unauthorized', 401);
        }

        await next();
    };
}
