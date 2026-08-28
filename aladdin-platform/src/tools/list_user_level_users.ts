/**
 * tools/list_user_level_users.ts — aladdin_platform_user_level_get_user_list
 *
 * rajah: UserLevel.GetUserList(userLevelId i32 1, account string 2, page i32 3,
 * @Validate pageSize PageSizeEnum 4) (rows [UserListResponse] 1, totalPage i32 2, totalRow i32 3)
 * （user_level_back_office.rajah:236，@LoginRequired、無 @Permission）——後台「會員層級」→
 * 某層級底下的會員清單。
 *
 * 2026-08-28 讀 agrabah 後端原始碼查證
 * （agrabah/src/servers/user_level_back_office/services/user_level.ts:446-520，methodGetUserList）：
 * 真的查 DB（DbUserLevel JOIN DbLoginProviderUser）、非 placeholder。三個要寫進 description 的事實：
 * 1. `userLevelId` 是必填範圍鍵；`account` 是 `b.identifier LIKE '%account%'` 模糊比對
 *    （user_level.ts:461-464），空字串代表不篩。
 * 2. **後端 SQL 沒有 ORDER BY**（user_level.ts:467-470，僅 LIMIT offset,count），
 *    分頁順序由 MySQL 自行決定、不保證穩定——翻頁時可能重複或遺漏同一筆。
 * 3. 存款/提款/有效投注是跨 server RPC 補值（user_level.ts:545-575），查不到時填 0；
 *    `agentName` 查不到上級代理時填 '-'，不是空字串。
 *
 * 分類（method-category-checklist.md 第 2 節「讀取清單」）：A 級——`account` 是能鎖定單一會員的
 * 業務鍵（`login_provider_users` 對 platform_id+provider_id+identifier 有 UNIQUE，帶完整帳號即唯一命中），
 * 不是「只有範圍鍵+分頁」的 B 級。本 tool 不做任何內部逐頁掃描定位。
 * 注意 totalPage/totalRow **不能**當成「有可信終點」的理由：agrabah 的分頁框架只在 page===1 才計算
 * （agrabah/src/common/database_helper.ts:204-217），page>1 一律回 0，這點已寫進 description。
 *
 * 第 8 節（PII）：回傳含會員帳號（account）與上級代理帳號（agentName），屬會員識別資訊但不是
 * realName／銀行卡號／accountName／bankAccount 那類第 8 節點名要遮罩的欄位——rajah model
 * UserListResponse（user_level_back_office.rajah:149-170）確認沒有這些欄位，因此不套用強制遮罩。
 * 有效先例是 get_message_board_posts.ts（同樣把真實 app 會員的 uid／帳號／暱稱原樣回傳）。
 * **不要拿 list_users.ts 當先例**：那支查的是後台管理員帳號，它自己的檔頭就聲明「風險層級遠低於
 * 第 8 節針對 app 一般會員 PII 的規範對象」，效力範圍不涵蓋這裡的真實會員資料。
 *
 * i64/Long：registerTimestamp／validBet／totalWithdrawal／netAmount 皆為 i64，
 * protobufjs decode 後是 Long 物件，統一用 deepFixLongs 轉一般數字。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { PAGE_SIZE_KEYS, PAGE_SIZE_MAP, deepFixLongs } from '../const.ts';

export function registerListUserLevelUsersTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_user_level_get_user_list',
        {
            title: 'List members currently in a given user level',
            description:
                '分頁查詢某個會員層級底下的會員（rajah: UserLevel.GetUserList，後台「會員管理」→「會員層級」→' +
                '點層級的會員數進去的清單）。userLevelId 必填，合法值先用 ' +
                'aladdin_platform_user_level_get_name_list 查，不要自己猜數字。' +
                'account 是會員帳號模糊比對（LIKE %account%），帶完整帳號即可鎖定單一會員；省略代表不篩。' +
                '**注意後端這支 SQL 沒有 ORDER BY**，分頁順序不保證穩定，逐頁抓全量時可能出現重複或遺漏；' +
                '要精確找特定會員請直接帶 account，不要靠翻頁比對。' +
                'locked 是該會員的層級鎖定狀態（StatusEnum：enabled=1 代表**已鎖定**、disabled=2 代表未鎖定，' +
                '語意反直覺，鎖定後不會被層級策略自動升降級，可用 aladdin_platform_user_level_lock_user 變更）。' +
                'totalDeposit／totalWithdrawal／validBet／netAmount 是跨 server 統計補值，查不到時為 0；' +
                '這些金額是 stored 值、不是人類可讀金額（依幣別精度縮放，常見 ÷10000），本工具不做換算。' +
                'agentName 查不到上級代理時後端固定填 "-"。registerTimestamp 是毫秒 epoch。' +
                '**totalPage／totalRow 只有 page=1 才是真值**：agrabah 的分頁框架只在 page===1 時才做 count' +
                '（agrabah/src/common/database_helper.ts:208-217），page>1 一律回 0，即使那一頁有資料；' +
                '翻頁請先用第 1 頁拿總頁數，或用「rows 為空／筆數 < pageSize」判斷是否已到最後一頁。' +
                '2026-08-28 dev 實測（pk-platform.alddev.com，userLevelId=20 共 859 人／86 頁）：' +
                '第 1 頁、第 5 頁、用 account 直接命中「不在第一頁」的會員（erer000，實際落在第 5 頁）、' +
                '以及空層級（userLevelId=22 回空陣列不報錯）四種情境皆驗過。',
            inputSchema: {
                userLevelId: z.number().int().describe('會員層級 id，必填；用 aladdin_platform_user_level_get_name_list 取得合法值'),
                account: z.string().optional().describe('會員帳號關鍵字，LIKE 模糊比對；省略代表不篩'),
                page: z.number().int().min(1).default(1).describe('頁碼，從 1 開始'),
                pageSize: z.enum(PAGE_SIZE_KEYS).default('size50').describe('每頁筆數，只能是固定選項之一；serverDefault 由後端轉成 100'),
            },
        },
        async ({ userLevelId, account, page, pageSize }) => {
            const r = await withAutoRelogin(() => remote.userLevelBackOffice.userLevel.GetUserList(
                userLevelId,
                account ?? '',
                page,
                PAGE_SIZE_MAP[ pageSize ],
            ));
            if (r.failed) return asErrorResult(r);
            return asTextResult({
                success: true,
                rows: deepFixLongs(r.data?.rows ?? []),
                totalPage: r.data?.totalPage,
                totalRow: r.data?.totalRow,
            });
        },
    );
}
