/**
 * tools/get_daily_user_game_vendor_tag_bet_user_summary.ts —
 * aladdin_platform_statistic_platform_get_daily_user_game_vendor_tag_bet_user_summary
 *
 * rajah: StatisticPlatform.GetDailyUserGameVendorTagBetUserSummary(userId i32 1, @Validate search
 * DailyUserGameVendorTagBetSearch 2) (summaries [DailyUserGameVendorTagBetUserSummary] 1)
 * （rajah/services/statistic.rajah:2421，非 @NoPublic，**無 @Permission**——不會出現在前端權限樹，
 * 後端也未見對應的 access control 檢查，任何有效登入的操作者皆可呼叫，含跨平台任意 userId）
 *
 * method-category-checklist.md 第 0 節排除規則已過：agrabah 對應 Service
 * （statistic_platform.ts:281 methodGetDailyUserGameVendorTagBetUserSummary）確認有真實實作
 * （聚合 daily_user_game_vendor_tag_bet_statistics 表，依 userId 過濾），非 notImplemented。
 * 分類：第 2 節「讀取清單」——A 級：以 userId + game_vendor_id/game_display_tag/currency_code 分組，
 * 有明確可鎖定範圍的 userId 欄位，非 B 級高風險模式。
 * 跨租戶風險：**method 簽名沒有另外要求 platformId，但後端 SQL 有 `platform_id = ?`（用
 * context 當前登入平台，非 userId 所屬平台）過濾**——傳入不屬於目前平台的 userId 只會查到空清單，
 * 不會洩漏別平台資料，也不會報錯（實測需在 dev 驗證此行為）。
 *
 * 2026-08-26 讀 agrabah 後端原始碼查證（statistic_platform.ts:281-329）：
 * - **startTimestamp 必填，且有 92 天回溯上限**（同 GetDailyUserGameVendorTagBetSummary，錯誤碼
 *   searchDateRangeLimitExceeded=2802）。
 * - **endTimestamp 實測必填，帶 0（或不帶）會在驗證層直接報錯**（errorCode=9，message 含
 *   `DailyUserGameVendorTagBetSearch.endTimestamp`）：rajah model `DailyUserGameVendorTagBetSearch`
 *   本身標記 `@Rules "Required"`，`@Validate` 會在進入 method body 前擋下。**這點與 method 內部程式碼
 *   註解（statistic_platform.ts:277-278「endTimestamp 未提供時不加上限條件」）矛盾**——2026-08-26 於
 *   pk-platform.alddev.com dev 環境實測驗證：`endTimestamp=0` 確實回驗證錯誤，代碼註解描述的「未提供」
 *   分支因 Required 驗證擋在前面而不可達，是後端既有的文件與實際行為不一致（非本工具臆測），本工具將
 *   endTimestamp 設為必填參數。
 * - gameVendorTagSearchList 規則同平台總計版本：留空＝不篩選，帶值用「廠商+分類」組合精確配對。
 * - **totalProfit 方向與平台總計版本相反**：這支是 `SUM(bet − win)`（正值＝玩家淨輸／平台淨賺），
 *   平台總計版本 `aladdin_platform_statistic_platform_get_daily_user_game_vendor_tag_bet_summary` 是
 *   `SUM(win − bet)`（方向相反）。後端原始碼註解本身標記這是待確認的規範不一致（agrabah
 *   statistic_platform.ts:276 `[TBD: 需開發者確認哪個是規範]`），不是本工具誤植，跨兩支工具比較
 *   totalProfit 時務必留意方向相反。
 * - **totalWin 欄位 rajah 標記 `@Hide`**（class 檔頭註解：「未完成功能用 @Hide 暫擋」，代表 abu 後台
 *   表單刻意不顯示這個欄位，可能是尚未驗收完成的功能）；但後端 SQL 確實計算並回傳
 *   （`SUM(win) AS totalWin`），本工具原樣輸出，呼叫端應知道這個值在正式後台 UI 尚未曝光/信賴。
 * - 純讀取查詢，可安全重複呼叫。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { DailyUserGameVendorTagBetSearch, GameVendorTagSearch } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { toPlainNumber } from '../const.ts';

export function registerGetDailyUserGameVendorTagBetUserSummaryTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_statistic_platform_get_daily_user_game_vendor_tag_bet_user_summary',
        {
            title: 'Get single user daily betting summary grouped by vendor/tag/currency',
            description:
                '查詢單一會員的日投注統計（依遊戲廠商+分類+幣別分組：注單總數/投注總額/有效投注總額/' +
                '派彩總額/總損益）（rajah: StatisticPlatform.GetDailyUserGameVendorTagBetUserSummary）。' +
                '**startTimestamp 必填，且有 92 天回溯上限**，早於「今日 − 92 天」直接報錯' +
                '（errorCode=searchDateRangeLimitExceeded）。' +
                '**endTimestamp 為必填**（rajah model 標記 @Rules Required，帶 0 或不帶會在驗證層直接報錯，' +
                '2026-08-26 dev 實測驗證；method 內部程式碼註解聲稱「未提供時不加上限」的分支實際不可達，' +
                '是後端既有的文件與行為不一致）。' +
                'gameVendorTagSearchList 留空＝不篩選，帶值用「廠商+分類」組合精確配對。' +
                '**totalProfit 正負號＝玩家視角淨輸（bet − win），正值代表玩家輸、平台賺**——與平台總計版本方向' +
                '相反（那支是 win − bet），這是後端既有的規範不一致（未修正），跨兩支工具比較時務必留意。' +
                '**totalWin 欄位在 rajah 標記 @Hide（後台前端因功能尚未驗收完成而不顯示），本工具仍原樣輸出' +
                '後端算出的值，但使用前應知道這個欄位在正式 UI 上尚未曝光/信賴**。' +
                '傳入不屬於目前登入平台的 userId 只會查到空清單，不會報錯也不會洩漏別平台資料。純讀取查詢，' +
                '可安全重複呼叫。',
            inputSchema: {
                userId: z.number().int().describe('會員 userId（內部 id）'),
                startTimestamp: z.number().int().describe('派彩開始時間（毫秒時間戳，必填，不可早於今日 − 92 天，否則報 searchDateRangeLimitExceeded）'),
                endTimestamp: z.number().int().describe('派彩結束時間（毫秒時間戳，必填——rajah 驗證層強制要求，帶 0 會報錯）'),
                gameVendorTagSearchList: z
                    .array(z.object({
                        gameVendorId: z.number().int().describe('遊戲廠商 ID'),
                        displayTag: z.number().int().describe('遊戲分類（GameDisplayTagEnum 數值）'),
                    }))
                    .optional()
                    .describe('廠商+分類組合篩選清單，留空或不帶＝不篩選'),
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

            const r = await withAutoRelogin(() =>
                remote.statistic.statisticPlatform.GetDailyUserGameVendorTagBetUserSummary(input.userId, search),
            );
            if (r.failed) return asErrorResult(r);

            const summaries = (r.data?.summaries ?? []).map((row) => ({
                gameVendorId: row.gameVendorId,
                gameDisplayTag: row.gameDisplayTag,
                currencyCode: row.currencyCode,
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
