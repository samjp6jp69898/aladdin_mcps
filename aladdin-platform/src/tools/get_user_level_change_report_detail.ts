/**
 * tools/get_user_level_change_report_detail.ts — aladdin_platform_user_level_get_change_report_detail
 *
 * rajah: UserLevel.GetChangeReportDetail(targetLevelId i32 1, dateTimeStamp i64 2, page i32 3,
 * @Validate pageSize PageSizeEnum 4) (rows [UserLevelChangeReportDetail] 1, totalPage i32 2)
 * （user_level_back_office.rajah:244，@LoginRequired、無 @Permission）——層級變更報表某一格
 * （某天 × 某目標層級）展開後的會員明細。
 *
 * 2026-08-28 讀 agrabah 後端原始碼查證
 * （agrabah/src/servers/user_level_back_office/services/user_level.ts:767-820，
 * methodGetChangeReportDetail）：真的查 DB（DbUserLevelChangeRecord JOIN DbLoginProviderUser）、
 * 非 placeholder。三個要寫進 description 的事實：
 * 1. 兩個參數都是**必填且必須成對**：`target_level_id = ?` AND `DATE(a.created_at) = ?`
 *    （user_level.ts:777-783）——dateTimeStamp 被後端丟進 `new Date()` 後只比對到「日」，
 *    所以同一天內任何毫秒值效果相同，但不能省略、也不能單獨帶其中一個。
 * 2. 有 `ORDER BY a.created_at DESC`（user_level.ts:789），分頁順序穩定——跟同 service 的
 *    methodGetUserList（沒有 ORDER BY）不同，不要把兩者的分頁穩定性混為一談。
 * 3. `originalLevel` 是把 original_level_id 反查層級設定表得到的**名稱字串**；查不到時填空字串
 *    （user_level.ts:800-806），不是 null 也不是 id。
 *
 * 分類（method-category-checklist.md 第 2 節「讀取清單」）：A 級——targetLevelId + dateTimeStamp
 * 是能鎖定單一報表格的複合鍵，非「只有範圍鍵+分頁」。（該節 A 級的字面條件是「有 search struct」，
 * 本 method 是攤平參數不是 struct，這裡是依實質風險判定而非字面符合，比照同目錄 list_users.ts 的但書寫法。）回傳的 totalPage 語意正確（此支的 count 與
 * rows 都是同一組未聚合的紀錄，與 GetChangeReport 的聚合查詢不同），但仍受 agrabah 分頁框架限制：
 * 只有 page===1 才會算 count，page>1 一律回 0（agrabah/src/common/database_helper.ts:208-217）。
 *
 * 第 8 節（PII）：回傳含會員帳號（account），不含 realName／銀行卡號那類第 8 節點名要遮罩的欄位
 * （rajah model UserLevelChangeReportDetail，user_level_back_office.rajah:193-206），故不遮罩；
 * 先例同 get_message_board_posts.ts（真實 app 會員識別資訊原樣回傳），不是 list_users.ts
 * （那支是後台管理員帳號，自述效力不涵蓋一般會員 PII）。
 *
 * i64/Long：registerTimestamp／updateTimestamp 為 i64，用 deepFixLongs 轉一般數字。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { PAGE_SIZE_KEYS, PAGE_SIZE_MAP, deepFixLongs } from '../const.ts';

export function registerGetUserLevelChangeReportDetailTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_user_level_get_change_report_detail',
        {
            title: 'List members whose level changed to a given level on a given day',
            description:
                '查詢層級變更報表某一格的會員明細（rajah: UserLevel.GetChangeReportDetail，' +
                '後台「會員管理」→「會員層級」→「層級變更報表」點某天某層級展開）。' +
                'targetLevelId 與 dateTimeStamp **兩個都必填、且必須是同一格的成對值**——' +
                '直接把 aladdin_platform_user_level_get_change_report 回傳的 targetLevelId 與 ' +
                'dateTimeStamp 原樣帶進來，不要自己組。dateTimeStamp 後端只比對到「日」' +
                '（DATE(created_at) = 該日期），所以同一天內的任何毫秒值等效。' +
                '結果依變更時間由新到舊排序（後端有 ORDER BY，分頁順序穩定）。' +
                'changeType 是 UserLevelChangeTypeEnum（auto=0 由層級策略自動變更／manual=1 後台人工變更）；' +
                'originalLevel 是變更前的層級**名稱字串**（查不到時為空字串），不是 id；' +
                'registerTimestamp 是會員註冊時間、updateTimestamp 是本次變更時間，皆為毫秒 epoch。' +
                '**totalPage／totalRow 只有 page=1 才是真值**：agrabah 的分頁框架只在 page===1 時才做 count' +
                '（agrabah/src/common/database_helper.ts:208-217），page>1 一律回 0，即使那一頁有資料；' +
                '翻頁請先用第 1 頁拿總頁數，或用「rows 為空／筆數 < pageSize」判斷是否已到最後一頁。' +
                '2026-08-28 dev 實測（pk-platform.alddev.com）：有資料的格、不存在的組合（回空陣列不報錯）兩種情境皆驗過。',
            inputSchema: {
                targetLevelId: z.number().int().describe('變更後的目標層級 id，必填；用 aladdin_platform_user_level_get_change_report 回傳的 targetLevelId'),
                dateTimeStamp: z.number().int().describe('該筆報表的日期（毫秒 epoch），必填；後端只比對到日。用 aladdin_platform_user_level_get_change_report 回傳的 dateTimeStamp'),
                page: z.number().int().min(1).default(1).describe('頁碼，從 1 開始'),
                pageSize: z.enum(PAGE_SIZE_KEYS).default('size50').describe('每頁筆數，只能是固定選項之一；serverDefault 由後端轉成 100'),
            },
        },
        async ({ targetLevelId, dateTimeStamp, page, pageSize }) => {
            const r = await withAutoRelogin(() => remote.userLevelBackOffice.userLevel.GetChangeReportDetail(
                targetLevelId,
                dateTimeStamp,
                page,
                PAGE_SIZE_MAP[ pageSize ],
            ));
            if (r.failed) return asErrorResult(r);
            return asTextResult({ success: true, rows: deepFixLongs(r.data?.rows ?? []), totalPage: r.data?.totalPage });
        },
    );
}
