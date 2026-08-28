/**
 * tools/list_user_levels.ts — aladdin_platform_user_level_get_list
 *
 * rajah: UserLevel.GetList(type UserLevelTypeEnum 1, name string 2, page i32 3,
 * @Validate pageSize PageSizeEnum 4) (rows [UserLevelConfig] 1, totalPage i32 2)
 * （user_level_back_office.rajah:231，@LoginRequired、無 @Permission）——後台「會員管理」→
 * 「會員層級」主列表，分自動層級／固定層級兩個分頁檢視。
 *
 * 2026-08-28 讀 agrabah 後端原始碼查證
 * （agrabah/src/servers/user_level_back_office/services/user_level.ts:152-222，methodGetList）：
 * 真的查 DB、非 placeholder。三個必須寫進 description 的實際行為：
 * 1. `type` 不是「選填篩選」——後端無條件 `conditions.push('type = ?')`（user_level.ts:161-162），
 *    不帶就等於帶 auto(0)，**永遠查不到固定層級**。所以本 tool 把它設成必填，強迫呼叫端明確選邊。
 * 2. `name` 是 LIKE '%name%' 模糊比對（user_level.ts:166-169），空字串代表不篩。
 * 3. `deleted = 0`（user_level.ts:164）——軟刪的層級不會出現。
 *
 * 分類（method-category-checklist.md 第 2 節「讀取清單」）：形狀上比較接近 B 級——沒有 search struct、
 * 沒有 id 欄位，name 又只是 `LIKE '%name%'` 模糊比對（user_level.ts:166-169），不是能精確鎖定單一列的鍵。
 * 判定為風險可控而非套用 B 級的逐頁掃描要求，理由是**本 tool 不做任何「用業務鍵反查單筆」的內部掃描**
 * （要 id→名稱對照請用 aladdin_platform_user_level_get_name_list，那支一次全撈、不分頁），
 * B 級真正禁止的是那種用法；本 tool 只是原樣把分頁結果交給呼叫端，並在 description 說清楚分頁的可信度。
 *
 * i64/Long：UserLevelConfig.strategyRules 底下的 depositAmountAmount/validBetAmount 是
 * [CurrencyLink]，其 value 為 i64（common.rajah），protobufjs decode 後是 Long 物件，
 * 統一用 deepFixLongs 轉一般數字。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { PAGE_SIZE_KEYS, PAGE_SIZE_MAP, USER_LEVEL_TYPE_KEYS, USER_LEVEL_TYPE_MAP, deepFixLongs } from '../const.ts';

export function registerListUserLevelsTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_user_level_get_list',
        {
            title: "List the current platform's user level configs",
            description:
                '分頁查詢本平台的會員層級設定（rajah: UserLevel.GetList，後台「會員管理」→「會員層級」主列表）。' +
                '**type 必填**：後端固定用 type 當查詢條件，一次只能查一種——auto 自動層級（由層級策略自動升降）' +
                '或 static 固定層級，要看全部就分兩次呼叫。name 是模糊比對（LIKE %name%），省略代表不篩。' +
                '已軟刪除的層級不會出現。結果固定依 level 由小到大排序。' +
                '每筆的 userCount 是「目前在此層級的會員數」（刪除層級前必須先清空，否則後端會擋）；' +
                'strategyRules 是該層級對應的自動升降級規則（只有 auto 型層級才有意義），' +
                '其中 depositAmountAmount／validBetAmount 是多幣別 CurrencyLink 陣列，' +
                '**value 是 stored 值、不是人類可讀金額**（依幣別精度縮放，常見 ÷10000），本工具不做換算。' +
                '若只是要拿層級 id 對應名稱，改用 aladdin_platform_user_level_get_name_list（一次全撈、不分頁）。' +
                '**totalPage／totalRow 只有 page=1 才是真值**：agrabah 的分頁框架只在 page===1 時才做 count' +
                '（agrabah/src/common/database_helper.ts:208-217），page>1 一律回 0，即使那一頁有資料。' +
                '所以翻頁請先用第 1 頁拿總頁數，或直接用「rows 為空／rows 筆數 < pageSize」判斷是否已到最後一頁。' +
                '另實測 static 型層級的 level 欄位目前都是 0（固定層級不參與 auto 的連號重排，後端也不驗證這個值，'
                + '所以 0 只是目前 dev 上的觀測結果、不是後端強制），auto 型才是 1,2,3… 連號。' +
                '2026-08-28 dev 實測（pk-platform.alddev.com）：auto／static 兩種 type、name 模糊查詢、' +
                '建立 6 筆測試層級後驗證第 2 頁真的取得第一頁以外的資料（測完已刪除復原）、' +
                '以及超出範圍的頁碼回空陣列，皆已驗過。',
            inputSchema: {
                type: z.enum(USER_LEVEL_TYPE_KEYS).describe('層級種類，必填：auto=自動層級／static=固定層級。後端一次只查一種'),
                name: z.string().optional().describe('層級名稱關鍵字，LIKE 模糊比對；省略代表不篩'),
                page: z.number().int().min(1).default(1).describe('頁碼，從 1 開始'),
                pageSize: z.enum(PAGE_SIZE_KEYS).default('size50').describe('每頁筆數，只能是固定選項之一；serverDefault 由後端轉成 100'),
            },
        },
        async ({ type, name, page, pageSize }) => {
            const r = await withAutoRelogin(() => remote.userLevelBackOffice.userLevel.GetList(
                USER_LEVEL_TYPE_MAP[ type ],
                name ?? '',
                page,
                PAGE_SIZE_MAP[ pageSize ],
            ));
            if (r.failed) return asErrorResult(r);
            return asTextResult({
                success: true,
                rows: deepFixLongs(r.data?.rows ?? []),
                totalPage: r.data?.totalPage,
                totalPageNote: page === 1
                    ? undefined
                    : 'page != 1 時 totalPage/totalRow 恆為 0（後端只在 page=1 才計算 COUNT），非「沒有下一頁」的訊號；請用 rows 為空或筆數 < pageSize 判斷是否到底',
            });
        },
    );
}
