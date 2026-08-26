/**
 * tools/get_daily_user_game_vendor_tag_bet_summary.ts —
 * aladdin_platform_statistic_platform_get_daily_user_game_vendor_tag_bet_summary
 *
 * rajah: StatisticPlatform.GetDailyUserGameVendorTagBetSummary(@Validate search
 * DailyUserGameVendorTagBetSearch 1) (summaries [DailyUserGameVendorTagBetSummary] 1)
 * （rajah/services/statistic.rajah:2418，非 @NoPublic，@Permission "AppUser.BettingData.BettingStatistics"）
 *
 * method-category-checklist.md 第 0 節排除規則已過：agrabah 對應 Service
 * （statistic_platform.ts:220 methodGetDailyUserGameVendorTagBetSummary）確認有真實實作
 * （聚合 daily_user_game_vendor_tag_bet_statistics 表），非 notImplemented。
 * 分類：第 2 節「讀取清單」——A 級：search 天然依 currency_code GROUP BY，無分頁，回傳列數 =
 * 該平台幣別種類數（小型列舉表等級），非「用 List 冒充定位單筆」的高風險 B 級模式。
 *
 * 2026-08-26 讀 agrabah 後端原始碼查證（statistic_platform.ts:220-270）：
 * - **startTimestamp 必填，且有 92 天回溯上限**：早於「今日 − 92 天」會直接回錯誤碼
 *   searchDateRangeLimitExceeded（2802），不是靜默截斷。
 * - **endTimestamp 為必填，帶 0 會在驗證層直接報錯**：`search` 參數的 model `DailyUserGameVendorTagBetSearch`
 *   （rajah/services/statistic.rajah:355-364）標記 `@Validator`，且 endTimestamp 欄位標記
 *   `@Rules "Required"`，這層檢查在進入 method body 之前執行，早於 statistic_platform.ts:228 那段
 *   「未帶或晚於今日則改成今日 00:00」的程式碼——**該分支在「未帶」（0）這個情境下其實不可達**，
 *   因為驗證層會先擋下並回錯誤碼 9（`DailyUserGameVendorTagBetSearch.endTimestamp`），不會進到那段
 *   邏輯。2026-08-26 於 pk-platform.alddev.com dev 環境實測驗證：`endTimestamp=0` 確實回驗證錯誤；
 *   帶一個晚於今日的真實時間戳則呼叫成功（此時才會真的走到「靜默改成今日 00:00」的 clamp 邏輯）。
 *   呼叫端必須帶一個非 0 的真實時間戳，不能用 0 表示「不設上限」。
 * - **gameVendorTagSearchList 為空陣列時完全不篩選廠商/分類**（回傳全平台加總）；非空時用
 *   `(game_vendor_id, game_display_tag) IN (...)` 精確配對篩選，是「廠商+分類」的組合條件，不是各自獨立的
 *   OR 篩選。
 * - **totalProfit 的正負號方向**：這支是 `SUM(win - bet)`（正值＝玩家淨賺／平台淨損）。**注意**：同檔
 *   `aladdin_platform_statistic_platform_get_daily_user_game_vendor_tag_bet_user_summary`（單一玩家版本）
 *   totalProfit 用的是 `SUM(bet - win)`（正負號相反，正值＝玩家淨輸／平台淨賺）——後端原始碼註解本身
 *   標記這是待確認的規範不一致（agrabah statistic_platform.ts:276 `[TBD: 需開發者確認哪個是規範]`），
 *   **不是本工具誤植**，呼叫端跨兩支工具比較 totalProfit 時務必留意方向相反。
 * - 純讀取查詢，可安全重複呼叫。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { DailyUserGameVendorTagBetSearch, GameVendorTagSearch } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { toPlainNumber } from '../const.ts';

export function registerGetDailyUserGameVendorTagBetSummaryTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_statistic_platform_get_daily_user_game_vendor_tag_bet_summary',
        {
            title: 'Get platform-wide daily betting summary grouped by currency',
            description:
                '查詢全平台日投注統計摘要，依幣別分組（會員總數/注單總數/投注總額/有效投注總額/派彩總額/總損益）' +
                '（rajah: StatisticPlatform.GetDailyUserGameVendorTagBetSummary）。用於會員投注數據分析後台頁面。' +
                '**startTimestamp 必填，且有 92 天回溯上限**：早於「今日 − 92 天」直接報錯' +
                '（errorCode=searchDateRangeLimitExceeded）。**endTimestamp 為必填，帶 0 會在驗證層直接報錯**' +
                '（errorCode=9），不能用 0 表示「不設上限」；帶一個晚於今日的真實時間戳會被後端靜默改成今日 ' +
                '00:00（不會報錯），不要誤以為查到了完整區間。' +
                'gameVendorTagSearchList 留空＝不篩選（全平台加總）；帶值則用「廠商+分類」組合精確配對篩選' +
                '（不是分別 OR）。' +
                '**totalProfit 正負號＝玩家視角淨賺（win − bet），正值代表玩家賺、平台虧**——與單一玩家版本 ' +
                'aladdin_platform_statistic_platform_get_daily_user_game_vendor_tag_bet_user_summary 的 totalProfit ' +
                '方向相反（那支是 bet − win），這是後端既有的規範不一致（未修正），跨兩支工具比較時務必留意。' +
                '純讀取查詢，可安全重複呼叫。',
            inputSchema: {
                startTimestamp: z.number().int().describe('派彩開始時間（毫秒時間戳，必填，不可早於今日 − 92 天，否則報 searchDateRangeLimitExceeded）'),
                endTimestamp: z.number().int().describe('派彩結束時間（毫秒時間戳，必填——帶 0 會被驗證層拒絕；帶晚於今日的真實時間戳會被靜默改成今日 00:00）'),
                gameVendorTagSearchList: z
                    .array(z.object({
                        gameVendorId: z.number().int().describe('遊戲廠商 ID'),
                        displayTag: z.number().int().describe('遊戲分類（GameDisplayTagEnum 數值）'),
                    }))
                    .optional()
                    .describe('廠商+分類組合篩選清單，留空或不帶＝不篩選（全平台加總）'),
            },
        },
        async (input) => {
            const search = DailyUserGameVendorTagBetSearch.create({
                startTimestamp: input.startTimestamp,
                endTimestamp: input.endTimestamp,
                gameVendorTagSearchList: (input.gameVendorTagSearchList ?? []).map((t) =>
                    GameVendorTagSearch.create({ gameVendorId: t.gameVendorId, displayTag: t.displayTag }),
                ),
            });

            const r = await withAutoRelogin(() => remote.statistic.statisticPlatform.GetDailyUserGameVendorTagBetSummary(search));
            if (r.failed) return asErrorResult(r);

            const summaries = (r.data?.summaries ?? []).map((row) => ({
                currencyCode: row.currencyCode,
                totalUsers: row.totalUsers,
                totalBetCount: row.totalBetCount,
                totalBet: toPlainNumber(row.totalBet),
                totalValidBet: toPlainNumber(row.totalValidBet),
                totalWin: toPlainNumber(row.totalWin),
                totalProfit: toPlainNumber(row.totalProfit),
            }));

            return asTextResult({ success: true, summaries });
        },
    );
}
