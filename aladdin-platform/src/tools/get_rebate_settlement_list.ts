/**
 * tools/get_rebate_settlement_list.ts — aladdin_platform_rebate_platform_get_rebate_settlement_list
 *
 * rajah: RebatePlatform.GetRebateSettlementList(options GetRebateSettlementOptions 1, page i32 2,
 * pageSize PageSizeEnum 3) (rows [RebateSettlement] 1, totalPage i32 2)
 * （rebate_back_office.rajah:298，method 級 @Permission "BonusCenter.Rebate.RebateDetail"（297）；
 * service RebatePlatform 定義於同檔 268 行、@Module "Rebate"（267）；非 @NoPublic、非 Placeholder）
 * ——後台「優惠中心 > 返水明細」（單一會員的返水結算明細）。
 *
 * agrabah 對應實作：rebate_platform.ts:909-994 methodGetRebateSettlementList，確認有真實 override，
 * 不是 notImplemented stub。
 *
 * 分類：method-category-checklist.md 第 2 節「讀取清單」的 **A 級**——search struct
 * GetRebateSettlementOptions（rajah:443-457）有 userId/account/orderId 三個能唯一鎖定目標的欄位。
 * 依 A 級要求，zod schema 對照該 model **全部 6 個欄位**列出，**包含 @Hide 的 `orderId`**
 * （rajah:455-456；@Hide 只代表後台表單不顯示，API 仍支援，正是 MCP 最需要的精準查找鍵）。
 *
 * ⚠️ **這支不是「查全平台清單」，而是「查某一個會員」——account 或 userId 至少要帶一個**
 * （簽名完全看不出來，是讀 agrabah 才確認的硬性前提）：
 * rebate_platform.ts:926-953 的三分支——userId > 0 走 id→account 反查；否則 account 非空走
 * account→id 反查；**兩者都沒有就直接回 `ErrorCode.invalidData`（9）+ message "account is empty"**。
 * 最後無條件 `conditions.push('user_id = ?')`（:954），所以查詢一定被限縮在單一會員。
 * 本 tool 因此在 handler 開頭用一個普通的前置 `if` 先擋掉「兩個都沒帶」，不讓呼叫端浪費一次往返
 * （不是 zod refine/superRefine——`inputSchema` 收的是 ZodRawShape 欄位字典、不是 ZodObject，
 * 掛不上 refine；這種「在打後端之前用普通 if 擋下並回 `asTextResult({ success: false, message })`」
 * 的寫法在本 server 有先例，見 get_audit_logs.ts:99-104、create_or_update_room_mute.ts:180-185）。
 *
 * agrabah 實作細節（讀源碼查證）：
 * - **userId 優先於 account**：帶了 userId>0 就走 userId，account 參數會被忽略並被反查結果覆寫
 *   （:927-941 的 `account = appUserInfos[0].identifier`）。這與
 *   aladdin_platform_rebate_platform_get_rebate_record_list 的「兩者 AND、互相打架回 0 筆」
 *   **行為不同**，同一組概念在兩支 method 的處理方式不一致，呼叫端不要類推。
 * - 會員查不到（不論走哪個分支）一律回 `ErrorCode.idNotExists`（11）+ "account not exists"，
 *   不是回空清單（:936-938、:948-950）。
 * - 其餘篩選：beginTimestamp（`created_at >= ?`）、endTimestamp（`created_at < ?`）、
 *   statuses（`status IN (?)`，直接比對、**沒有**返水紀錄那支的 verified/expired 改寫魔法）、
 *   orderId（`order_id = ?` 精確比對）。
 * - 排序 `ORDER BY id desc`（:980），跨頁順序穩定。
 * - 回傳的 `account` 是後端統一用反查結果填的同一個值（:986），每筆都一樣；
 *   `rebateName` 查不到對應返水配置時回退成字面字串 `{id: 123}`（:988）；
 *   `startAtTimestamp`/`endAtTimestamp` 由 DB 的 start_at/end_at 轉毫秒（:990-991）——
 *   這兩欄在此 method 沒有 nullable 保護（不像返水紀錄那支用 `?.getTime() || 0`），
 *   源碼直接 `.getTime()`，理論上 DB 若為 null 會拋例外落到 errorCode=1。
 * - rajah 回傳只宣告 rows + totalPage（**沒有 totalRow**，與返水紀錄那兩支不同）；
 *   totalPage 一樣只有 page=1 才計算（database_helper.ts:204-230）。
 * - `wageringMultiplier` 是 @Type "Rate" 的**裸 i32**（rajah:432-434），不是 CurrencyLink 陣列
 *   ——與返水配置那邊同名欄位的形狀不同，不要混用。
 * - `claimAmount`（已領取金額）與 `id` 標 @Hide，API 照樣回傳。
 *
 * 第 8 節（敏感資料/PII）：回傳含 `account`（會員登入帳號）；逐欄檢查 model RebateSettlement
 * （rajah:411-440）確認沒有 realName／銀行卡號／開戶姓名／token／密碼。不套用遮罩，但這支本來就是
 * 「指定單一會員」的查詢，呼叫端已經知道對象是誰。
 *
 * 這是純讀取查詢，不修改任何資料，可安全重複呼叫。
 *
 * --- dev 驗證（2026-08-28，pk-platform.alddev.com，帳號 landon001；獨立 spike script 用
 *     @modelcontextprotocol/sdk 的 Client + StdioClientTransport spawn 本 worktree 的
 *     src/stdio.ts，呼叫真正註冊起來的 tool）---
 * 1. 完全不帶參數：本 tool 的前置檢查直接擋下（success=false + 說明），沒有送到後端。
 * 2. account="tttest001", pageSize=size10：success，rowCount=10、totalPage=4。
 *    首筆 = { id: 45676, account: "tttest001", rebateName: "返水測試",
 *    startAtTimestamp: 1787827592000, endAtTimestamp: 1787827923000, validBetAmount: 56000,
 *    profitAndLoss: -41400, settlementCount: 14, rebateAmount: 5600, currencyCode: "CNY",
 *    wageringMultiplier: 100000, status: 1 }——確認 wageringMultiplier 是**單一整數**
 *    （不是 CurrencyLink 陣列）、profitAndLoss 可為負值、i64 已轉一般數字。
 *    claimAmount 為 0 的紀錄不會出現該 key（protobuf 空值不輸出）。
 *    回傳中**沒有 totalRow**，與 rajah 宣告一致。
 * 3. userId=276773（tttest001 的 id）：結果與第 2 點**完全相同**（同樣 10 筆、同樣 ids、
 *    totalPage=4），證實 account 與 userId 兩條路徑等價。
 * 4. **「userId 優先於 account」實證**：故意帶
 *    account="no_such_user_zzz"（不存在）+ userId=276773 → **成功**回 10 筆 tttest001 的資料。
 *    若後端有把 account 納入條件（像返水紀錄那支那樣 AND），這組必定失敗或回 0 筆；
 *    成功本身就證明了 account 分支被整段跳過。
 * 5. **會員不存在**：只帶 account="no_such_user_zzz" → success=false、errorCode=11、
 *    message="account not exists"。
 * 6. statuses=["claimed"]（值 1）：回傳 status 全為 1，直接比對、無改寫魔法。
 * 7. **「目標記錄不在第一頁」情境**：account="tttest001", page=2 → 10 筆，
 *    ids 開頭 [45561, 45557, 45556, 45555]，與第 1 頁的 [45676, 45636, 45587, 45568...]
 *    完全不重疊；同時 totalPage 回 0（page≠1 不計算的既有陷阱）。
 * 全程唯讀查詢，未寫入/修改任何 dev 資料，無需清理。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { GetRebateSettlementOptions } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { PAGE_SIZE_KEYS, PAGE_SIZE_MAP, REBATE_BET_STATUS_KEYS, REBATE_BET_STATUS_MAP, deepFixLongs } from '../const.ts';

export function registerGetRebateSettlementListTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_rebate_platform_get_rebate_settlement_list',
        {
            title: 'Search one member\'s rebate settlement details',
            description:
                '分頁查詢**單一會員**的返水結算明細（rajah: RebatePlatform.GetRebateSettlementList），' +
                '對應後台「優惠中心 > 返水明細」。' +
                '⚠️ **account 或 userId 至少要帶一個**：後端兩者都沒帶時直接回 errorCode=9' +
                '（invalidData）+ "account is empty"，這支沒有「查全平台」的用法。' +
                '⚠️ 兩個都帶時 **userId 優先**，account 會被忽略並以 userId 反查的帳號覆寫——' +
                '注意這跟 aladdin_platform_rebate_platform_get_rebate_record_list 的行為不同' +
                '（那支是把兩個條件 AND 起來、指向不同人就回 0 筆），不要類推。' +
                '會員查不到時回 errorCode=11（idNotExists）+ "account not exists"，不是空清單。' +
                '其他篩選（選填）：orderId 訂單號（精確比對，rajah 標 @Hide 但 API 支援，' +
                '是最快鎖定單筆的方式）、statuses 狀態多選（**直接比對，沒有返水紀錄那支的 ' +
                'verified/expired 即時改寫**）、beginTimestamp/endTimestamp 依「結算建立時間」' +
                '篩選（毫秒 timestamp，>= 起始、< 結束）。' +
                '回傳每筆：id（結算明細 id，rajah 標 @Hide 但 API 照樣回傳）、' +
                'account（每筆都是同一個人）、rebateName（返水層級名稱，查不到時回退成' +
                '字面字串「{id: 數字}」）、startAtTimestamp/endAtTimestamp（結算區間）、' +
                'validBetAmount 有效投注、profitAndLoss 損益、settlementCount 統計筆數、' +
                'rebateAmount 返水金額、claimAmount 已領取金額、currencyCode 幣別、' +
                'wageringMultiplier 稽核倍率（Rate 型別的**單一整數**，不是多幣別陣列）、status 狀態。' +
                '⚠️ 本 method 只回 totalPage，**沒有 totalRow**；而且 totalPage 只有 page=1 時' +
                '後端才會真的計算，第 2 頁起一律回 0。排序固定 id 由大到小，跨頁順序穩定。' +
                '金額欄位是 i64 stored value，已轉成一般數字。' +
                '純讀取查詢，不修改任何資料，可安全重複呼叫。',
            inputSchema: {
                account: z.string().optional().describe('會員帳號。與 userId 至少擇一必填；兩者都帶時 userId 優先、本欄被忽略'),
                userId: z.number().int().min(1).optional().describe('會員 id。與 account 至少擇一必填；帶了就優先於 account'),
                orderId: z.string().optional().describe('結算訂單號，精確比對（rajah 標 @Hide，API 仍支援）'),
                statuses: z.array(z.enum(REBATE_BET_STATUS_KEYS)).optional().describe('結算狀態多選，直接比對 DB 值（unclaimed 未提領 / claimed 已提領 / blacklisted 黑名單 / disabled 設定未開啟 / configNotFound 找不到設定 / exceedDailyLimit 超出每日上限 / clawBack 已撤銷）'),
                beginTimestamp: z.number().int().min(0).optional().describe('結算建立時間起（毫秒 timestamp，>=）'),
                endTimestamp: z.number().int().min(0).optional().describe('結算建立時間迄（毫秒 timestamp，<）'),
                page: z.number().int().min(1).default(1).describe('頁碼，從 1 開始'),
                pageSize: z.enum(PAGE_SIZE_KEYS).default('serverDefault').describe('每頁筆數，只能是固定選項之一；serverDefault 由後端轉成 100'),
            },
        },
        async (input) => {
            if (!input.userId && !input.account) {
                return asTextResult({
                    success: false,
                    message: '必須帶 account 或 userId 其中之一：這支 method 只能查單一會員的返水結算明細，兩者都不帶時後端會回 invalidData("account is empty")。',
                });
            }

            const options = GetRebateSettlementOptions.create({
                account: input.account ?? '',
                userId: input.userId ?? 0,
                orderId: input.orderId ?? '',
                statuses: (input.statuses ?? []).map((s) => REBATE_BET_STATUS_MAP[ s ]),
                beginTimestamp: input.beginTimestamp ?? 0,
                endTimestamp: input.endTimestamp ?? 0,
            });

            const r = await withAutoRelogin(() => remote.rebateBackOffice.rebatePlatform.GetRebateSettlementList(options, input.page, PAGE_SIZE_MAP[ input.pageSize ]));
            if (r.failed) {
                return asErrorResult(r, {
                    hint: 'errorCode=11（idNotExists）+ "account not exists" 代表帶的 account/userId 在本平台查無此會員；'
                        + 'errorCode=9（invalidData）+ "account is empty" 代表 account 與 userId 都沒帶到後端。'
                        + '兩者都不代表這個人沒有返水結算明細。',
                });
            }

            const rows = deepFixLongs(r.data?.rows ?? []);
            return asTextResult({
                success: true,
                page: input.page,
                rowCount: rows.length,
                totalPage: r.data?.totalPage,
                totalPageOnlyValidOnFirstPage: true,
                rows,
            });
        },
    );
}
