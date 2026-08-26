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
 * - **2026-08-25 review 發現並修正的錯誤描述——查詢區間不是單一月份**：`parseMonthRange` 的
 *   結束日期是用**今天**的日期算下個月（`const now = new Date()`，room_gift_platform.ts:
 *   28-31），不是 searchStartDate 的下個月。實際查詢區間是「searchStartDate 那個月 1 號 ~
 *   目前為止」的**多個月份**，每個月各一列，不是只回傳單一月份。呼叫端若只想看特定一個月，
 *   需自行從回傳 rows 依 `month` 欄位篩選。
 * - `currencyCode` 為必填（`@Rules "Required"`），只查該幣別的統計列（不同幣別各自獨立列）。
 *   **2026-08-25 review 提醒**：currencyCode 打錯（如帶系統不存在的幣別代碼）後端只是多一個
 *   `WHERE currency_code = ?` 條件，不會報錯，直接回空結果——呼叫端可能誤以為「這個月沒有
 *   資料」，實際是幣別代碼打錯，請確認 currencyCode 拼字正確。
 * - `anchorUid` 在此 model 型別是**字串**（跟 ListRecords 的 anchorUid 是 i32 不同，rajah
 *   model 定義本身如此，非本工具刻意改型別），後端用 `Number(params.anchorUid)` 轉數字後
 *   查詢，帶非數字字串會查不到任何資料（非錯誤，回空結果）。
 * - 回傳的 `anchorIncome`/`platformIncome`（row 層級，i64）是後端用
 *   `RateHelper.storedToNormal()` 算好的顯示值。row 層級的 `anchorTotalIncome`/
 *   `platformTotalIncome`（CurrencyLink[]，rajah model 定義有這兩個欄位）**2026-08-25
 *   review 發現後端 `RoomGiftAnchorSummaryItem.create()`（room_gift_platform.ts:245-252）
 *   根本沒有賦值這兩欄，永遠是空陣列**，本工具原樣透傳這個「恆空」的事實，不代表資料遺失。
 *   頂層 `anchorTotalIncome`（i64，本頁 rows 加總，非 DB 全量加總）才是有效的收入加總欄位。
 * - **2026-08-25 review 發現：頂層 `totalRow` 後端從未賦值，恆為 0**——
 *   `methodGetAnchorStatisticSummary` 只設定 `response.rows`/`totalPage`/
 *   `anchorTotalIncome`，沒有設定 `totalRow`（rajah 有宣告這個欄位，但後端漏實作），本工具
 *   已從輸出移除這個誤導欄位，不對外回傳恆為 0 的假數據。
 * - i64 欄位（頂層 anchorTotalIncome、row 的 anchorIncome/platformIncome）經 protobufjs
 *   decode 可能是 Long 物件，已用 `toPlainNumber()` 轉換；row 的 `anchorTotalIncome`/
 *   `platformTotalIncome`（CurrencyLink[]）雖然恆空，仍用 `toPlainCurrencyLinks()`
 *   保持與其他 tool 一致的轉換方式（2026-08-25 review 發現原本漏轉，已修正）。
 * - `searchStartDate` 省略（空字串）時後端回傳空結果而非錯誤，但本工具已把此欄位設為 zod
 *   必填，不會讓呼叫端意外送出空字串走到這個分支。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { RoomGiftAnchorSummaryParams } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { toPlainNumber, toPlainCurrencyLinks } from '../const.ts';

export function registerGetAnchorStatisticSummaryTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_room_gift_platform_get_anchor_statistic_summary',
        {
            title: 'Get monthly anchor income statistics for room gifts',
            description:
                '查詢本平台主播的月度送禮收益統計摘要（rajah: RoomGiftPlatform.GetAnchorStatisticSummary）。' +
                'searchStartDate（月份，格式 "YYYY-MM" 或 "YYYY/MM"）與 currencyCode（幣別代碼）皆為必填，' +
                '只回傳**單一幣別**的資料，格式不合法會回錯誤。**查詢區間不是單一月份**：後端結束日期用' +
                '「今天」推算，實際回傳的是「searchStartDate 那個月 ~ 目前為止」的多個月份資料（每月各一' +
                '列），若只想看特定月份請自行依回傳 rows 的 month 欄位篩選。currencyCode 打錯不會報錯，只會' +
                '靜默回空結果，請確認拼字正確。anchorUid 若帶非數字字串會查不到資料（回空結果，非錯誤）。' +
                'row 的 anchorIncome/platformIncome、頂層 anchorTotalIncome 皆為後端已算好的顯示值；' +
                '頂層 anchorTotalIncome 是**當前這一頁**的加總，不是全量加總。row 的 anchorTotalIncome/' +
                'platformTotalIncome（CurrencyLink[]）後端從未賦值、恆為空陣列。' +
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
                anchorTotalIncome: toPlainCurrencyLinks(row.anchorTotalIncome),
                platformTotalIncome: toPlainCurrencyLinks(row.platformTotalIncome),
            }));

            // totalRow 未輸出：後端 methodGetAnchorStatisticSummary 從未賦值這個欄位，恆為 0，
            // 對外回傳只會誤導呼叫端，見檔頭註解。
            return asTextResult({
                success: true,
                rows,
                totalPage: r.data?.totalPage,
                anchorTotalIncome: toPlainNumber(r.data?.anchorTotalIncome),
            });
        },
    );
}
