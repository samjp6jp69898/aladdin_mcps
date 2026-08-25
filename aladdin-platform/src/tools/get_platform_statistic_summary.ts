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
 * - **searchStartDate 為必填**，格式與月份區間解析（`YYYY-MM`/`YYYY/MM`，左閉右開單月）與
 *   aladdin_platform_room_gift_platform_get_anchor_statistic_summary 共用同一支
 *   `parseMonthRange`，行為完全一致（格式不合法回 requestNotValid）。
 * - **與 GetAnchorStatisticSummary 的差異**：這支聚合到「月份+幣別」維度（`GROUP BY
 *   statistic_month, currency_code` 對 `platform_income` 做 SUM），不分主播；那支聚合到
 *   「主播」維度。
 * - `currencyCode` 為必填，只查該幣別。
 * - row 的 `platformIncome` 是 SQL `SUM(platform_income)` 的**原始加總**（DB 欄位本身已是
 *   stored 值？需注意：這支與 GetAnchorStatisticSummary 不同，SQL 直接 SUM 沒有經過
 *   `RateHelper.storedToNormal()` 轉換——2026-08-25 dev 實測比對兩支輸出的數量級以確認
 *   是否為同一種值域，本工具不假設兩者可直接互相比較）。
 * - 頂層 `platformTotalIncome` 是**當前這一頁 rows 的加總**（前端 reduce），不是 DB 全量
 *   加總，檔頭註解明確標註過這一點。
 * - i64 欄位（row 的 platformIncome、頂層 platformTotalIncome）經 protobufjs decode 可能是
 *   Long 物件，已用 `toPlainNumber()` 轉換。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { RoomGiftPlatformSummaryParams } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { toPlainNumber } from '../const.ts';

export function registerGetPlatformStatisticSummaryTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_room_gift_platform_get_platform_statistic_summary',
        {
            title: 'Get monthly platform income statistics for room gifts',
            description:
                '查詢本平台的月度送禮平台收入統計摘要（依月份+幣別聚合，不分主播）（rajah: ' +
                'RoomGiftPlatform.GetPlatformStatisticSummary）。searchStartDate（月份，格式 "YYYY-MM" 或 ' +
                '"YYYY/MM"）與 currencyCode（幣別代碼）皆為必填，只回傳單一幣別的資料，格式不合法會回錯誤。' +
                '與 aladdin_platform_room_gift_platform_get_anchor_statistic_summary 的差異：這支聚合到' +
                '月份+幣別維度（不分主播），那支聚合到主播維度；兩支的金額計算路徑不同（這支是 DB SQL ' +
                'SUM 原始加總，未必與那支的 RateHelper 換算結果同量級，不建議直接互相比較）。頂層' +
                'platformTotalIncome 是**當前這一頁**的加總，不是全量加總。' +
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
            }));

            return asTextResult({
                success: true,
                rows,
                totalPage: r.data?.totalPage,
                totalRow: r.data?.totalRow,
                platformTotalIncome: toPlainNumber(r.data?.platformTotalIncome),
            });
        },
    );
}
