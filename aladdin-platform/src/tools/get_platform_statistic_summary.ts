/**
 * tools/get_platform_statistic_summary.ts — aladdin_platform_room_gift_platform_get_platform_statistic_summary
 *
 * rajah: RoomGiftPlatform.GetPlatformStatisticSummary(params RoomGiftPlatformSummaryParams 1)
 * (rows [RoomGiftPlatformSummaryItem] 1, totalPage i32 2, platformTotalIncome i64 3, totalRow i32 4)
 * （rajah/services/room_gift_back_office.rajah:262，非 @NoPublic）
 *
 * method-category-checklist.md 第 0 節排除規則已過：agrabah 對應 Service
 * （room_gift_platform.ts:methodGetPlatformStatisticSummary）確認有真實實作，非 notImplemented。
 * 分類：第 2 節「讀取清單」——search 有 searchStartDate（月份，@Rules Required）+
 * currencyCode（@Rules Required）強制篩選，天然限制範圍，不套 B 級規則。
 *
 * 2026-08-25 讀 agrabah 後端原始碼查證（room_gift_platform.ts:284-350，
 * methodGetPlatformStatisticSummary）：
 * - **searchStartDate 為必填**，格式與月份區間解析共用 `parseMonthRange`（room_gift_platform.ts:
 *   22-34），與 aladdin_platform_room_gift_platform_get_anchor_statistic_summary 行為完全一致
 *   （格式不合法回 requestNotValid）。
 * - **2026-08-25 review 發現並修正的錯誤描述——查詢區間不是單一月份**：`parseMonthRange` 的
 *   結束日期是用 **今天** 的日期算下個月（`const now = new Date(); endMonth = now.getMonth()+2`
 *   等，room_gift_platform.ts:28-31），不是 searchStartDate 的下個月。實際查詢區間是
 *   「searchStartDate 那個月 1 號 ~ 今天所在月份的下個月 1 號」——換句話說是「從指定月份查到
 *   目前為止」的**多個月份**，`GROUP BY statistic_month, currency_code` 後每個月各自一列，
 *   不是只回傳單一月份。呼叫端若只想看特定一個月，需自行從回傳 rows 依 `month` 欄位篩選。
 * - **與 GetAnchorStatisticSummary 的差異**：這支聚合到「月份+幣別」維度（`GROUP BY
 *   statistic_month, currency_code` 對 `platform_income` 做 SUM），不分主播；那支聚合到
 *   「主播」維度。
 * - `currencyCode` 為必填，只查該幣別。**2026-08-25 review 提醒**：currencyCode 打錯（如帶
 *   系統不存在的幣別代碼）後端只是多一個 WHERE 條件，不會報錯，直接回空結果——呼叫端可能
 *   誤以為「這個月沒有資料」，實際是幣別代碼打錯，請確認 currencyCode 拼字正確。
 * - **2026-08-25 review 發現並修正的錯誤描述——RateHelper 換算**：row 的 `platformIncome`
 *   雖然是 SQL `SUM(platform_income)` 算出來的，但取出後仍會經過
 *   `RateHelper.storedToNormal(Number(r.platformIncome))`（room_gift_platform.ts:351）才組進
 *   回應，跟 GetAnchorStatisticSummary 的換算方式相同，**兩支金額量級一致，可以互相比較**
 *   （先前版本誤寫成「未經換算、不可比較」，已更正）。
 * - row 層級的 `platformTotalIncome`（CurrencyLink[]，rajah model 定義有這個欄位）
 *   **2026-08-25 review 發現後端 `RoomGiftPlatformSummaryItem.create()`（room_gift_platform.ts:
 *   348）沒有賦值這個欄位，永遠是空陣列**，本工具原樣透傳這個「恆空」的事實。頂層
 *   `platformTotalIncome`（i64，本頁 rows 加總，非 DB 全量加總）才是有效欄位。
 * - **2026-08-25 review 發現：頂層 `totalRow` 後端從未賦值，恆為 0**——
 *   `methodGetPlatformStatisticSummary` 只設定 `response.rows`/`totalPage`/
 *   `platformTotalIncome`，沒有設定 `totalRow`，本工具已從輸出移除這個誤導欄位。
 * - i64 欄位（row 的 platformIncome、頂層 platformTotalIncome）經 protobufjs decode 可能是
 *   Long 物件，已用 `toPlainNumber()` 轉換；row 的 `platformTotalIncome`（CurrencyLink[]）
 *   雖然恆空，仍用 `toPlainCurrencyLinks()` 保持一致（2026-08-25 review 發現原本漏轉，已修正）。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { RoomGiftPlatformSummaryParams } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { toPlainNumber, toPlainCurrencyLinks } from '../const.ts';

export function registerGetPlatformStatisticSummaryTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_room_gift_platform_get_platform_statistic_summary',
        {
            title: 'Get monthly platform income statistics for room gifts',
            description:
                '查詢本平台的月度送禮平台收入統計摘要（依月份+幣別聚合，不分主播）（rajah: ' +
                'RoomGiftPlatform.GetPlatformStatisticSummary）。searchStartDate（月份，格式 "YYYY-MM" 或 ' +
                '"YYYY/MM"）與 currencyCode（幣別代碼）皆為必填，只回傳單一幣別的資料，格式不合法會回錯誤。' +
                '**查詢區間不是單一月份**：後端結束日期用「今天」推算，實際回傳的是「searchStartDate 那個' +
                '月 ~ 目前為止」的多個月份資料（每月各一列），不是只有 searchStartDate 那一個月，若只想看' +
                '特定月份請自行依回傳 rows 的 month 欄位篩選。currencyCode 打錯不會報錯，只會靜默回空結果，' +
                '請確認拼字正確。' +
                '與 aladdin_platform_room_gift_platform_get_anchor_statistic_summary 的差異：這支聚合到' +
                '月份+幣別維度（不分主播），那支聚合到主播維度；兩支金額皆經過 RateHelper 換算，量級一致，' +
                '可以互相比較。頂層 platformTotalIncome 是**當前這一頁**的加總，不是全量加總；row 層級的' +
                'platformTotalIncome（CurrencyLink[]）後端從未賦值、恆為空陣列。' +
                '這是純讀取查詢，可安全重複呼叫。',
            inputSchema: {
                searchStartDate: z.string().min(1).describe('帳單月份，格式 "YYYY-MM" 或 "YYYY/MM"（必填）'),
                currencyCode: z.string().min(1).describe('幣別代碼，如 "USD"（必填）'),
                page: z.number().int().min(1).optional().describe('頁碼，從 1 開始，預設 1'),
                pageSize: z.number().int().min(1).optional().describe('每頁筆數，預設 20'),
            },
        },
        async (input) => {
            const params = RoomGiftPlatformSummaryParams.create({
                searchStartDate: input.searchStartDate,
                currencyCode: input.currencyCode,
                page: input.page ?? 1,
                pageSize: input.pageSize ?? 20,
            });

            const r = await withAutoRelogin(() => remote.roomBackOffice.roomGiftPlatform.GetPlatformStatisticSummary(params));
            if (r.failed) return asErrorResult(r);

            const rows = (r.data?.rows ?? []).map((row) => ({
                ...row,
                platformIncome: toPlainNumber(row.platformIncome),
                platformTotalIncome: toPlainCurrencyLinks(row.platformTotalIncome),
            }));

            // totalRow 未輸出：後端 methodGetPlatformStatisticSummary 從未賦值這個欄位，恆為 0，
            // 對外回傳只會誤導呼叫端，見檔頭註解。
            return asTextResult({
                success: true,
                rows,
                totalPage: r.data?.totalPage,
                platformTotalIncome: toPlainNumber(r.data?.platformTotalIncome),
            });
        },
    );
}
