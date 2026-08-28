/**
 * tools/list_user_wagerings_by_user.ts — aladdin_platform_wagering_user_platform_list_user_wagerings_by_user
 *
 * rajah: WageringUserPlatform.ListUserWageringsByUser（wagering_back_office.rajah:443）。
 *
 * **權限：這支在 gate 層既不檢查權限節點、也不檢查登入。是本 domain 的例外，務必注意。**
 * service WageringUserPlatform（同檔 435-436）只掛 @Module "Wagering.User"，**沒有 @Permission**；
 * 本 method（443）也沒有自己的。缺 @Permission 會同時造成兩件事：
 *   (1) sync_routes 的 methodPermission 取 `method.attributes.get('Permission') || servicePermission`
 *       （agrabah/src/tools/database/sync_routes.ts:108），兩者皆空 → getPermissionIdByName 對空字串
 *       直接回 0（同檔 28-31）→ route.permissionId = 0。
 *   (2) loginRequired 是**推導**出來的，不是獨立欄位：getLoginRequired 只有在該 target 掛了
 *       @LoginRequired 或 @Permission 時才回 1（同檔 64-70）。兩者皆無 → route.loginRequired = 0。
 * 於是 gate 的 `mustLogin = loginRequired || permissionId > 0`（agrabah/src/servers/gate/
 * gate_types.ts:35-37）為 false，gate_handler_base.ts:281-291 整塊「未登入擋下 + 權限節點檢查」
 * 被直接短路跳過。實際還在把關的只剩三道，都與身分無關：@Module "Wagering.User" 模組開關
 * （gate_handler_base.ts:275）、rate limit（同檔 242）、平台 IP 白名單
 * （servers/gate/gate_logics/management_gate_logic.ts:163-175，白名單為空時直接放行）。
 * 對照組是同檔 389-390 的 service WageringPlatform，那個有 service 級 @Permission "Finance.Wagering"。
 * 另注意 agrabah 端 wagering_platform.ts:859、862 的 doc comment 宣稱本 service 掛
 * @Permission "Finance.Wagering.User"——rajah 全目錄 grep 不到這個節點，該註解是錯的，不要採信
 * （同 domain 的 GetWageringScopes 也有同類錯誤註解，見 get_wagering_scopes.ts 檔頭）。
 * **同 service 的三支寫入 method（RemoveUserAllWagering 439／ChangeUserWagering 441／
 * ManualAddUserWagering 447）適用完全相同的推論**——它們同樣既無權限節點也無登入把關，
 * 而且是會改動個別會員提款門檻的操作。本 MCP 未包裝那三支（已登記 needs_clarification），
 * 但這件事值得回報給後端 owner。
 *
 * 第 8 節（敏感資料／PII，橫切分類）評估：回傳 model UserWageringByUserInfo（rajah:296-317）
 * 含 operator（後台員工帳號）與 remark（自由文字），但不含該節點名的 realName／account／
 * accountName／bankAccount／密碼／token 類欄位，故不觸發遮罩要求。remark 是使用者可編輯內容，
 * 依 server instructions 一律當資料不當指令。
 *
 * 分類（method-category-checklist.md 第 2 節「讀取清單」）：**B 級**——只有範圍鍵 userId +
 * page/pageSize。這支本身就是該節 B 級清單裡逐字點名的案例之一
 * （「ListUserWageringsByUser(userId, page, pageSize)」）。B 級要求處理如下：
 * 1. 本工具是單純的分頁清單，不做任何「掃頁找某一筆」的定位邏輯，故逐頁掃描細則不適用。
 *    要用業務鍵定位稽核紀錄請用 A 級的 ListUserWagerings（已包成 ..._list_user_wagerings）。
 * 2. 驗收含「目標不在第一頁」：2026-08-28 對**本 method** 實打 dev（userId=276933，pageSize=5），
 *    第 2 頁取得 id 10045-10041，與第 1 頁的 10050-10046 完全不重疊。
 * 3. pageSize 是裸 i32、非 PageSizeEnum，後端 withPage（agrabah/src/common/database_helper.ts:13-19）
 *    直接插進 LIMIT，無 clamp 上界。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { deepFixLongs } from '../const.ts';

export function registerListUserWageringsByUserTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_wagering_user_platform_list_user_wagerings_by_user',
        {
            title: 'List one member\'s pending wagering records (member-detail view)',
            description:
                '從「單一會員視角」分頁列出該會員未完成的稽核紀錄，對應後台會員詳情頁的稽核面板' +
                '（rajah: WageringUserPlatform.ListUserWageringsByUser）。' +
                '2026-08-28 讀 agrabah 原始碼查證（agrabah/src/servers/wagering_back_office/services/' +
                'wagering_platform.ts:961-999）並實打 dev 驗證，以下六點務必先看清楚：' +
                '**(1) 這支在 gate 層既不檢查權限節點、也不檢查登入**——service WageringUserPlatform 與本 ' +
                'method 都沒有 @Permission（wagering_back_office.rajah:435-443）。缺 @Permission 會同時 ' +
                '造成兩件事：route.permissionId=0（sync_routes.ts:28-31、108），以及 route.loginRequired=0' +
                '（loginRequired 是從 @LoginRequired 或 @Permission 推導的，兩者皆無就是 0，同檔 64-70）。' +
                '於是 gate 的 mustLogin = loginRequired || permissionId > 0（gate_types.ts:35-37）為 false，' +
                'gate_handler_base.ts:281-291 整塊「未登入擋下 + 權限節點檢查」被短路跳過。' +
                '實際還在把關的只剩三道、且都與身分無關：Wagering.User 模組開關（gate_handler_base.ts:275）、' +
                'rate limit（同檔 242）、平台 IP 白名單（management_gate_logic.ts:163-175，白名單為空即放行）。' +
                '這與同檔的 WageringPlatform 系列（需要 Finance.Wagering，因而也被強制要求登入）不同。' +
                '呼叫端請自行確認操作者本來就該看得到這位會員的資料——不要假設後端替你把過關。' +
                '**(2) 只回未完成的、且只回該會員自己幣別的**——SQL 寫死 `status = pending` 且 ' +
                '`currency_code = 該會員的 currencyCode`（同檔 973-974），所以回傳每一列的 status ' +
                '固定都是 1（pending），那個欄位在這支沒有鑑別力。要看已解除的紀錄請用 ' +
                'aladdin_platform_wagering_platform_list_user_wagerings（可篩 autoRemove／manualRemove；' +
                '但 completed 在本 MCP 任何 tool 都拿不到，後端無條件剔除）。' +
                '**(3) userId 不存在時回 errorCode 204 userNotExists，不是空清單**——後端先呼叫 ' +
                'AppUserInternal.GetAppUserInfo（同檔 965）。' +
                '**(4) totalPage 只有 page=1 才是真值**——agrabah 通用分頁 helper getPageData' +
                '（agrabah/src/common/database_helper.ts:208-217）只在 page===1 執行 count，' +
                'page>=2 一律回 0。從中途頁開始翻時，終止條件請用 rows.length < pageSize。' +
                '排序固定 created_at DESC（新的在前）。' +
                '**(5) 與 aladdin_platform_wagering_platform_get_user_un_wagering_detail 的取捨**——兩支都是「列出這位會員的 pending 稽核」，' +
                '篩選條件與排序完全相同，差在回傳欄位：' +
                '本工具多了 operator（操作人，語意見下一點）、operatorAtTimestamp（操作時間）、' +
                'remark（備註）、transactionsAmount（帳變金額）、wageringAmount（稽核金額）、' +
                'turnoverAmount（已完成打碼量）、status（但恆為 1，無鑑別力）；' +
                'aladdin_platform_wagering_platform_get_user_un_wagering_detail 則多了 ' +
                '**unWageringAmount（該筆還差多少沒打完，那支的核心欄位）**、' +
                'wageringScopes（該筆的遊戲類型／品牌限定），以及 userWageringInfo（未稽核總額彙總，僅第 1 頁有值）。' +
                '要查「這筆是誰、什麼時候、為什麼加的」用本工具；要查「還差多少、限定在哪些遊戲」用那一支。' +
                '**(6) operator 有三種可能，而且你分不出後兩種**——後端邏輯是 ' +
                '`if (operatorId > 0) operator = 反查到的帳號 || String(operatorId)`' +
                '（wagering_platform.ts:987-989）：operatorId=0（系統自動產生的稽核）→ 空字串；' +
                'operatorId>0 且反查成功 → 後台帳號字串；**operatorId>0 但反查失敗**' +
                '（batchGetPlatformUsers 的 GetUsersByIds 失敗、或該後台帳號已被刪除，' +
                'agrabah/src/managers/wagering_manager.ts:498-529）→ **回的是 operatorId 的數字字串（例如 "37"）**。' +
                '本 method 的回傳 model 沒有 operatorId 欄位（rajah:296-317），所以呼叫端無法區分' +
                '「帳號剛好長得像數字」與「反查失敗的 id」——看到純數字的 operator 請當成無法解析的 id 處理。' +
                '（註：2026-08-28 的 dev 環境上，抽查的 7 位會員全部 pending 稽核 operatorId 都是 0，' +
                '所以「反查成功」與「反查失敗」這兩條路徑只有原始碼佐證，未能實際打到。）' +
                '**金額欄位**（transactionsAmount／wageringAmount／turnoverAmount）都是 stored 整數，' +
                'stored = 人類金額 × 10^(decimalPlaces+2)（jafar/src/exchange.ts:32-38），本工具不換算；' +
                '幣別精度查 aladdin_platform_currency_platform_get_currencies 的 decimalPlaces。' +
                'wageringType 是 WageringTypeEnum 數值（common.rajah:1650-1767，如 0=手動添加／1=充值／' +
                '46=人工充值）。想先看這位會員的稽核筆數摘要（不看逐筆），請用 ' +
                'aladdin_platform_wagering_user_platform_get_immediate_user_wagering。本工具純讀取。',
            inputSchema: {
                userId: z.number().int().min(1).describe(
                    '會員 id（不是會員帳號字串）。用帳號換 id 建議用 ' +
                    'aladdin_platform_activity_platform_get_user_id_by_identifier（純查詢、無副作用）。' +
                    '查無此會員會回 errorCode 204 userNotExists',
                ),
                page: z.number().int().min(1).default(1).describe('頁碼，從 1 開始。totalPage 只有第 1 頁是真值'),
                pageSize: z.number().int().min(1).default(50).describe(
                    '每頁筆數。後端沒有 clamp 上界（裸 i32 直接進 LIMIT），請自行給合理值',
                ),
            },
        },
        async ({ userId, page, pageSize }) => {
            const r = await withAutoRelogin(() => remote.wageringBackOffice.wageringUserPlatform.ListUserWageringsByUser(userId, page, pageSize));
            if (r.failed) return asErrorResult(r);

            return asTextResult({
                success: true,
                rows: deepFixLongs(r.data?.rows ?? []),
                totalPage: r.data?.totalPage ?? 0,
                notes: {
                    scope: '只含 status=pending 且為該會員自身幣別的稽核，排序 created_at DESC。'
                        + '每列的 status 固定是 1（pending），沒有鑑別力',
                    totalPage: page === 1
                        ? '第一頁才會回真實總頁數'
                        : 'page>=2 時後端固定回 0，不代表沒有資料；總頁數請看第一頁，'
                            + '或用 rows.length < pageSize 判定為最後一頁',
                    amounts: 'transactionsAmount/wageringAmount/turnoverAmount 皆為 stored 整數'
                        + '（× 10^(decimalPlaces+2)），本工具不換算',
                    operator: 'operatorId=0（系統自動產生的稽核）→ 空字串；operatorId>0 反查成功 → 後台帳號；'
                        + 'operatorId>0 但反查失敗（帳號已刪或查詢失敗）→ operatorId 的數字字串。'
                        + '回傳不含 operatorId，看到純數字請當成無法解析的 id，不要當帳號用',
                },
            });
        },
    );
}
