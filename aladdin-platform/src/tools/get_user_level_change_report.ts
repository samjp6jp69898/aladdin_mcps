/**
 * tools/get_user_level_change_report.ts — aladdin_platform_user_level_get_change_report
 *
 * rajah: UserLevel.GetChangeReport(@Validate options GetChangeReportOptions 1, page i32 2,
 * @Validate pageSize PageSizeEnum 3) (rows [UserLevelChangeReport] 1, totalPage i32 2, totalRow i32 3)
 * （user_level_back_office.rajah:242，@LoginRequired、無 @Permission）——後台「會員管理」→
 * 「會員層級」→「層級變更報表」的每日聚合數字。
 *
 * 2026-08-28 讀 agrabah 後端原始碼查證
 * （agrabah/src/servers/user_level_back_office/services/user_level.ts:698-751，methodGetChangeReport）：
 * 真的查 DB（DbUserLevelChangeRecord）、非 placeholder。四個要寫進 description 的事實：
 * 1. 時間區間**起含、迄不含**：`created_at >= beginTimestamp` 但 `created_at < endTimestamp`
 *    （user_level.ts:707-715）；兩者都是「> 0 才生效」，0／不帶代表不篩該邊界。
 * 2. `options.userLevelId` 篩的是 `target_level_id`，也就是**變更後**的目標層級，不是原層級；
 *    同樣 > 0 才生效（user_level.ts:717-720）。
 * 3. SQL 是 `GROUP BY DATE(created_at), target_level_id`、`ORDER BY day DESC`
 *    （user_level.ts:723-728），所以一列＝某一天某個目標層級的新增人數，不是單筆變更紀錄。
 * 4. **totalPage/totalRow 不可信**：count 用的是同一組 where 條件對「未聚合的原始紀錄」做
 *    COUNT（user_level.ts:731），而 rows 是聚合後的列——兩者語意不同，totalRow 會遠大於實際聚合列數，
 *    totalPage 也跟著偏大（agrabah 原始碼註解本身標記為 [TBD: 需開發者確認]）。翻頁終止條件
 *    一律用「rows 為空」判斷，不要信 totalPage。
 *
 * 分類（method-category-checklist.md 第 2 節「讀取清單」）：A 級——options.userLevelId 可鎖定
 * 單一目標層級、時間區間可收斂到單日，非「只有範圍鍵+分頁」。但因為第 4 點，本 tool 在回傳裡
 * 原樣附上 totalPage/totalRow 之外，另在 description 明講它們不能當終止判斷（第 2 節「回傳沒有
 * 可信 total 的：用 rows.length < pageSize 視為最後一頁」）。
 *
 * i64/Long：dateTimeStamp 是 i64（由後端 `row.day.getTime()` 產生），用 deepFixLongs 轉一般數字。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { GetChangeReportOptions } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { PAGE_SIZE_KEYS, PAGE_SIZE_MAP, deepFixLongs } from '../const.ts';

export function registerGetUserLevelChangeReportTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_user_level_get_change_report',
        {
            title: 'Get the daily user level change report (aggregated)',
            description:
                '查詢本平台的層級變更報表（rajah: UserLevel.GetChangeReport，後台「會員管理」→「會員層級」→' +
                '「層級變更報表」）。**一列＝某一天某個目標層級的新增人數**（後端 GROUP BY 日期+目標層級），' +
                '不是單筆會員變更紀錄；要看某天某層級是哪些會員，改用 ' +
                'aladdin_platform_user_level_get_change_report_detail，把本 tool 回傳的 dateTimeStamp 與 ' +
                'targetLevelId 原樣帶過去。' +
                '時間區間**起含迄不含**（created_at >= begin、created_at < end），毫秒 epoch，' +
                '0 或不帶代表不篩該邊界。userLevelId 篩的是**變更後的目標層級**（不是原層級），' +
                '合法值用 aladdin_platform_user_level_get_name_list 查。結果依日期由新到舊排序。' +
                '**totalPage／totalRow 不可信，有兩層原因**：(1) 後端的 count 是對未聚合的原始變更紀錄數做的，' +
                '跟聚合後的列數語意不同（會偏大）；(2) agrabah 的分頁框架只在 page===1 時才做 count' +
                '（agrabah/src/common/database_helper.ts:208-217），page>1 一律回 0。' +
                '翻頁一律以「rows 為空」或 rows 筆數 < pageSize 判斷到底，不要用 totalPage。' +
                '2026-08-28 dev 實測（pk-platform.alddev.com）：不帶篩選、指定目標層級、指定時間區間三種情境皆驗過。',
            inputSchema: {
                beginTimestamp: z.number().int().optional().describe('變更時間區間起（毫秒 epoch，含），0 或不帶代表不篩'),
                endTimestamp: z.number().int().optional().describe('變更時間區間迄（毫秒 epoch，**不含**），0 或不帶代表不篩'),
                userLevelId: z.number().int().optional().describe('只看變更「後」為此層級的紀錄；0 或不帶代表全部。用 aladdin_platform_user_level_get_name_list 取得合法值'),
                page: z.number().int().min(1).default(1).describe('頁碼，從 1 開始'),
                pageSize: z.enum(PAGE_SIZE_KEYS).default('size50').describe('每頁筆數，只能是固定選項之一；serverDefault 由後端轉成 100'),
            },
        },
        async ({ beginTimestamp, endTimestamp, userLevelId, page, pageSize }) => {
            const options = GetChangeReportOptions.create({
                beginTimestamp: beginTimestamp ?? 0,
                endTimestamp: endTimestamp ?? 0,
                userLevelId: userLevelId ?? 0,
            });
            const r = await withAutoRelogin(() => remote.userLevelBackOffice.userLevel.GetChangeReport(
                options,
                page,
                PAGE_SIZE_MAP[ pageSize ],
            ));
            if (r.failed) return asErrorResult(r);
            return asTextResult({
                success: true,
                rows: deepFixLongs(r.data?.rows ?? []),
                totalPage: r.data?.totalPage,
                totalRow: r.data?.totalRow,
                hint: 'totalPage/totalRow 由未聚合的原始紀錄數算出（與聚合後的列數語意不同、偏大），且只有 page=1 才會計算、page>1 一律回 0；請用 rows 是否為空判斷是否已到最後一頁',
            });
        },
    );
}
