/**
 * tools/get_anchor_statistic_summary.ts — aladdin_platform_room_gift_platform_get_anchor_statistic_summary
 *
 * rajah: RoomGiftPlatform.GetAnchorStatisticSummary(params RoomGiftAnchorSummaryParams 1)
 * (rows [RoomGiftAnchorSummaryItem] 1, totalPage i32 2, anchorTotalIncome i64 3, totalRow i32 4)
 * （rajah/services/room_gift_back_office.rajah:259，非 @NoPublic）
 *
 * method-category-checklist.md 第 0 節排除規則已過：agrabah 對應 Service
 * （room_gift_platform.ts:methodGetAnchorStatisticSummary）確認有真實實作，非 notImplemented。
 * 分類：第 2 節「讀取清單」——search 有 searchStartDate（月份，@Rules Required）+
 * currencyCode（@Rules Required）強制篩選，天然限制在單一月份+單一幣別範圍內，非全表掃描
 * 情境，不套 B 級規則。
 *
 * 2026-08-25 讀 agrabah 後端原始碼查證（room_gift_platform.ts:203-282，methodGetAnchorStatisticSummary
 * + parseMonthRange）：
 * - **searchStartDate 為必填**（rajah `@Rules "Required"`），格式必須是 `YYYY-MM` 或
 *   `YYYY/MM`（`parseMonthRange` 用 `/[\/\-]/` 切割年月，年份需在 1970~9999、月份需在
 *   1~12），格式不合法回錯誤（ErrorCode.requestNotValid）；帶了完整日期（如 `2026-08-15`）
 *   也能解析（只取年月，忽略日），但語意上這是「月份」查詢，不建議帶日期造成混淆。
 * - 實際查詢區間是「該月 1 號 ~ 次月 1 號」（左閉右開），只回傳**單一月份**的資料，不是
 *   從 searchStartDate 到現在的區間。
 * - `currencyCode` 為必填（`@Rules "Required"`），只查該幣別的統計列（不同幣別各自獨立列）。
 * - `anchorUid` 在此 model 型別是**字串**（跟 ListRecords 的 anchorUid 是 i32 不同，rajah
 *   model 定義本身如此，非本工具刻意改型別），後端用 `Number(params.anchorUid)` 轉數字後
 *   查詢，帶非數字字串會查不到任何資料（非錯誤，回空結果）。
 * - 回傳的 `anchorIncome`/`platformIncome`（row 層級，i64）是後端用
 *   `RateHelper.storedToNormal()` 算好的顯示值；`anchorTotalIncome`/`platformTotalIncome`
 *   （row 層級，CurrencyLink[]）與頂層 `anchorTotalIncome`（i64，本頁 rows 加總，**非
 *   DB 全量加總**——只反映當前這一頁）皆原樣透傳/已計算好，不需額外換算。
 * - i64 欄位（頂層 anchorTotalIncome、row 的 anchorIncome/platformIncome）經 protobufjs
 *   decode 可能是 Long 物件，已用 `toPlainNumber()` 轉換。
 * - `searchStartDate` 省略（空字串）時後端回傳空結果而非錯誤，但本工具已把此欄位設為 zod
 *   必填，不會讓呼叫端意外送出空字串走到這個分支。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { RoomGiftAnchorSummaryParams } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { toPlainNumber } from '../const.ts';

export function registerGetAnchorStatisticSummaryTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_room_gift_platform_get_anchor_statistic_summary',
        {
            title: 'Get monthly anchor income statistics for room gifts',
            description:
                '查詢本平台主播的月度送禮收益統計摘要（rajah: RoomGiftPlatform.GetAnchorStatisticSummary）。' +
                'searchStartDate（月份，格式 "YYYY-MM" 或 "YYYY/MM"）與 currencyCode（幣別代碼）皆為必填，' +
                '只回傳**單一月份、單一幣別**的資料，格式不合法會回錯誤。anchorUid 若帶非數字字串會查不到' +
                '資料（回空結果，非錯誤）。row 的 anchorIncome/platformIncome、頂層 anchorTotalIncome 皆為' +
                '後端已算好的顯示值；頂層 anchorTotalIncome 是**當前這一頁**的加總，不是全量加總。' +
                '這是純讀取查詢，可安全重複呼叫。',
            inputSchema: {
                searchStartDate: z.string().min(1).describe('帳單月份，格式 "YYYY-MM" 或 "YYYY/MM"（必填）'),
                currencyCode: z.string().min(1).describe('幣別代碼，如 "USD"（必填）'),
                anchorName: z.string().optional().describe('主播暱稱，精準搜尋'),
                anchorUid: z.string().optional().describe('主播 uid（字串），精準搜尋；帶非數字字串會查不到資料'),
                page: z.number().int().min(1).optional().describe('頁碼，從 1 開始，預設 1'),
                pageSize: z.number().int().min(1).optional().describe('每頁筆數，預設 20'),
            },
        },
        async (input) => {
            const params = RoomGiftAnchorSummaryParams.create({
                searchStartDate: input.searchStartDate,
                currencyCode: input.currencyCode,
                anchorName: input.anchorName ?? '',
                anchorUid: input.anchorUid ?? '',
                page: input.page ?? 1,
                pageSize: input.pageSize ?? 20,
            });

            const r = await withAutoRelogin(() => remote.roomBackOffice.roomGiftPlatform.GetAnchorStatisticSummary(params));
            if (r.failed) return asErrorResult(r);

            const rows = (r.data?.rows ?? []).map((row) => ({
                ...row,
                anchorIncome: toPlainNumber(row.anchorIncome),
                platformIncome: toPlainNumber(row.platformIncome),
            }));

            return asTextResult({
                success: true,
                rows,
                totalPage: r.data?.totalPage,
                totalRow: r.data?.totalRow,
                anchorTotalIncome: toPlainNumber(r.data?.anchorTotalIncome),
            });
        },
    );
}
