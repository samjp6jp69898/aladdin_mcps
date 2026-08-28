/**
 * tools/list_user_fund.ts — aladdin_platform_fund_adjustment_platform_list_user_fund
 *
 * rajah: FundAdjustmentPlatform.ListUserFund(search ListUserFundSearch 1, page i32 2, pageSize i32 3)
 * (rows [UserFund] 1, totalPage i32 2)
 * （fund_adjustment_back_office.rajah:483；service FundAdjustmentPlatform 定義於同檔 471 行、
 * @Module "FundAdjustment"（469）、service 級 @Permission "Finance.FundAdjustment"（470），
 * 這支 method 另掛 @Permission "Finance.FundAdjustment.Apply"（482）——後台
 * 「帳務管理 > 資金調整 > 申請調整」的用戶資金查詢頁（前端 abu/platform/src/pages/finance/UserFundList.vue）。
 * 非 @NoPublic、非 Placeholder、無 @Totp。）
 *
 * agrabah 對應實作：fund_adjustment_platform.ts:136-219 methodListUserFund，確認有真實 override
 * （真的解析帳號 → 跨服務查錢包 → 批次補支付統計），不是 notImplemented stub。
 *
 * 分類：method-category-checklist.md 第 2 節「讀取清單」的 **A 級**——search struct
 * （ListUserFundSearch，rajah:3-10）裡有 `identifiers`（會員帳號複數）與 `userIds`（會員 id 複數）
 * 兩個可鎖定單一目標的欄位，不是只有範圍鍵+分頁的 B 級。A 級要求「zod schema 必須對照 rajah
 * model 全部欄位列出，包含 @Hide 欄位」——ListUserFundSearch 只有 accurate / identifiers /
 * userIds 三個欄位，沒有 @Hide 欄位，本 tool 三個全部列出，無遺漏。
 *
 * agrabah 實作細節（讀源碼查證，非推測；行號對 agrabah main 於 2026-08-28 的內容）：
 *
 * - **search 實質上是必填**：methodListUserFund 一開始就呼叫 #tidyUserFundUserId（:227-272）
 *   把 identifiers/userIds 解析成 userId 清單，`searchUserIds.length === 0` 時直接
 *   `return GenieResult.success`（:144-146）——**RPC 成功、rows 空、totalPage 0**。也就是說
 *   「不帶任何搜尋條件」不會列出全平台用戶，而是安靜回空清單。本 tool 因此在呼叫前就擋下
 *   「identifiers 與 userIds 都沒帶」的情況並回明確訊息，不讓呼叫端把空結果誤讀成「查無此人」。
 *   （注意：同 service 的 ListUserFundAdjustment 行為相反，不帶 user 條件時是真的列全平台，
 *   兩支不要互相類推。）
 *
 * - **identifiers 與 userIds 同時帶是「交集」不是「聯集」**：#tidyUserFundUserId 把兩個條件各自
 *   收成一個 Set 推進 userIdSets，最後用 `reduce` 做 `filter(x => current.has(x))`（:265-267），
 *   這是交集運算。兩個都帶且不相交時結果為空——這是後端語意，不是查詢失敗。description 已明講。
 *
 * - **accurate 只作用在 identifiers、對 userIds 無效**：accurate 被傳進
 *   resolveAppUserDetailsByIdentifiers（:235）決定帳號精準或模糊比對（ALDREQ-636 的行為）；
 *   userIds 分支（:254-259）只是把數字原樣收進 Set，完全不看 accurate。
 *   本 tool 的 accurate **預設 true（精準）**，與後台頁面的預設一致
 *   （UserFundList.vue:36 `{ identifiers: '', userIds: [], accurate: true }`）——模糊預設會讓
 *   「查 ian000」連 ian001 一起回來，agent 很容易把第一列誤當成目標會員。
 *
 * - **一列 = 一個（會員 × 幣別）錢包，不是一個會員**：分頁是打在錢包上——
 *   `remote.wallet.walletInternal.GetUserWalletByUserIds(searchUserIds, WalletTypeEnum.normal,
 *   page, pageSize)`（:149），該 method（wallet.ts:641-663）的 SQL 條件是
 *   `platform_id = ? AND user_id IN (?) AND type = ?`（wallet.ts:646）**沒有任何幣別條件**
 *   （對照同檔 :468 另一支查單一錢包的才有 `AND currency_code = ?`），其註解也明寫
 *   「不限制單一幣別：傳入的使用者若在該 walletType 下持有不同幣別的錢包，都會回傳」
 *   （wallet.ts:638）。所以同一個會員持有 CNY/INR 兩個錢包時會佔兩列，rowCount 不等於人數。
 *   只查 normal 錢包（WalletTypeEnum.normal），其他錢包類型查不到。
 *   ⚠️ **這一條是源碼推得、dev 上找不到可驗證的資料**（理由見驗證第 9/10 點：該站有三種啟用幣別，
 *   也確實存在非 CNY 錢包的會員，但掃過的每一個會員都只持有一個幣別的錢包）。
 *
 * - **⚠️ pageSize=0 是真的會踩到的地雷，本 tool 用 zod min(1) 擋掉**：pageSize 在 rajah 是裸
 *   `i32`（不是 PageSizeEnum），protobuf 未設值時會以 0 傳到後端。後端兩個吃 pageSize 的地方
 *   都是 TypeScript 預設參數（`pageSize = DefaultPageSize`，database_helper.ts:13、21），
 *   **預設值只在 undefined 時生效、0 是有效值會照用**：withPage(page, 0) 產出 `LIMIT 0, 0`
 *   → 永遠 0 列。至於 totalPage，getTotalPage(totalRow, 0) 在 wallet service 內部算出的是
 *   `Math.ceil(n / 0)` = Infinity，但 rajah 的 totalPage 是 **i32**，protobuf 編碼會把 Infinity
 *   寫成 0，再加上 `response.totalPage` 是在 rows 為空的 early return 之前就先賦值的
 *   （:154 賦值、:155-157 才 return），**呼叫端最終看到的是 `rows=[] + totalPage=0`**，
 *   跟「查無資料」長得一模一樣、無從分辨。所以本 tool 的 pageSize required、min 1，
 *   不提供「不帶就用後端預設」的選項（後端根本沒有那個行為）。
 *
 * - **⚠️ totalPage 只有 page=1 時才會真的計算**：共用 helper getPageData（database_helper.ts:204-230）
 *   只有 `if (page === 1)`（:208）才呼叫 count 並算 totalPage，其他頁一律沿用初始值 0。翻到第 2 頁
 *   以後拿到的 totalPage=0 不代表沒有資料。已 dev 實測（見下方驗證第 5 點）。本 tool 因此回傳
 *   `totalPageValid`（= page === 1）讓呼叫端逐次判斷，而不是回一個恆真的旗標。
 *
 * - **金額欄位全部是 stored value，本 tool 不做換算**：後端這支從頭到尾沒有呼叫
 *   Exchange.storedToNormal*（同檔真正有呼叫的是 :110-111、:120 的稽核資料組裝與 :491/:498、
 *   :1041-1042、:1119-1121，都不在這支的路徑上），balance 直接取 `wallet.balance`、
 *   depositAmount/withdrawAmount 直接由支付統計相加（:198-199）。換算公式是
 *   `normal = stored / 10^(decimalPlaces + 2)`（jafar/src/exchange.ts:32-38 storedToNormal，
 *   未指定 exchangeRate 時 rate/RateBase = 1），decimalPlaces 依幣別而異，要用
 *   aladdin_platform_currency_platform_get_currencies 查。常見 2 位小數幣別即除以 10000。
 *   本 tool 不代為換算（不知道呼叫端要哪個幣別的精度、也避免多做一次可能出錯的推測），
 *   只在 description 講清楚並導向查幣別的 tool。前端佐證：UserFundList.vue:48 是用
 *   CurrencyHelper.storedAmountToDisplay 才顯示成金額。
 *
 * - **profit 的正負號方向與直覺相反**：`profit: withdrawAmount - depositAmount`（:212），
 *   是「提現總額 − 充值總額」＝**會員的獲利**（對平台是損失），不是平台利潤。rajah 欄位註解
 *   寫的就是「會員利潤」（rajah:30-31）。
 *
 * - **depositAmount/withdrawAmount 含手動加扣款**：depositAmount =
 *   `depositAmount + manualDepositAmount`、withdrawAmount = `withdrawAmount + manualWithdrawAmount`
 *   （:198-199），不是只有真實金流。lastDepositAtTimestamp/lastWithdrawAtTimestamp 同樣取
 *   「真實」與「手動」兩者中**較晚**的那個（:213-214）。
 *
 * - **支付統計 RPC 失敗時不會讓整支失敗，而是靜默降級**：BatchUserPaymentStatistics 失敗只寫
 *   error log（:179，不 return），接著 `paymentStatisticsResult.data?.rows ?? []`（:189，
 *   對應 :134 的 2026-04 防呆註解）——結果是錢包餘額正常、但 depositAmount/withdrawAmount/
 *   profit/最後充提時間**全部變成 0**。呼叫端無法從回傳值分辨「這個會員真的沒充提過」還是
 *   「統計服務當下掛了」。這是後端既有行為，description 已據實告知。
 *
 * - **identifier/userLevelId 查無會員資料時是空字串/0**：`appUserInfo?.identifier || ''`（:205）、
 *   `appUserInfo?.userLevelId || 0`（:207），#batchGetAppUsers（:274-306）在 RPC 失敗時
 *   直接回傳已有的 map、不報錯。userLevelId 是 `@Type "Select:UserLevelSetting"`（rajah:20-21）
 *   的 id，不是等級數字，要對照 aladdin_platform_vip_level_platform_get_vip_level_settings 解讀。
 *
 * - **userIds 的 i32 邊界**：rajah 是 `userIds [i32] 2`（rajah:9），proto 為 repeated int32。
 *   超過 2147483647 會被 protobuf **無聲截斷成另一個合法 userId**，於是這支唯讀 tool 會若無其事地
 *   回傳「別的會員」的餘額。本 tool 因此加 `.max(2147483647)`，比照同 server 既有慣例
 *   （create_or_update_room_mute.ts:155，該處是 2026-08-25 review 實測確認「會禁言到錯的人」後補上的）。
 *
 * - **identifiers 的成本邊界**：模糊比對（accurate=false）走
 *   resolveAppUserDetailsByIdentifiers → collectPagedAppUserDetails，
 *   agrabah/src/managers/app_user_identifier_search_manager.ts:15 的註解明寫「命中數不設上限
 *   （ALDREQ-636 需求方確認）」，會 keyset 游標撈到底再把結果整包塞進 `user_id IN (?)`。
 *   單一寬鬆片段（如 "a"）就能命中上千會員。本 tool 對 identifiers 加保守的陣列長度上限並在
 *   describe 提醒，但**無法**限制單一片段的命中數（那是後端行為）。
 *
 * - PII（第 8 節）：回傳的 UserFund（rajah:14-36）只有 identifier（會員帳號）、userId、
 *   userLevelId 與金額欄位，**沒有 realName、銀行卡號、手機、email 等第 8 節列管的真實個資欄位**，
 *   不需要額外遮罩。identifier 本身就是呼叫端用來查詢的鍵，遮罩了反而無法對應。回傳的餘額與
 *   充提總額仍屬會員財務資料，不應寫入未加密的持久化 log。
 *
 * 這是純讀取查詢，不修改任何資料，可安全重複呼叫。
 *
 * --- dev 驗證（2026-08-28，pk-platform.alddev.com，帳號 landon001；獨立 spike script 用
 *     @modelcontextprotocol/sdk 的 Client + StdioClientTransport spawn 本 worktree 的
 *     src/stdio.ts，呼叫真正註冊起來的 tool，不是繞過 tool 直接打 RPC）---
 * 1. identifiers=["a"], accurate=false, page=1, pageSize=5：success，rowCount=5，totalPage=315
 *    （即該模糊條件命中約 1575 個錢包）。回傳欄位實測為 identifier / userId / balance /
 *    currencyCode / depositAmount / withdrawAmount / profit / lastDepositAtTimestamp /
 *    lastWithdrawAtTimestamp / userLevelId，與 rajah model UserFund 一致，無多餘內部欄位。
 * 2. **「目標記錄不在第一頁」情境（第 2 節強制驗收案例）**：同條件 page=2, pageSize=5 回
 *    rowCount=5，identifier 為 QA000000 / ethan000 / sakiko0802 / 2mnsn84bn4abojfgst9r /
 *    1mnsn84bg4abljfgstvy，與第 1 頁的 5 筆（ian001 / ian000 / abc123 / …）完全不重疊，
 *    證實翻頁真的取得到第一頁以外的資料。
 * 3. accurate=true, identifiers=["ian000"]：rowCount=1、totalPage=1，只回 ian000（userId
 *    265441，CNY），證實精準比對真的生效（同一個帳號在 accurate=false 的模糊模式下會連帶
 *    命中 ian001 等）。
 * 4. **交集語意實測（兩組對照）**：identifiers=["ian000"](accurate) + userIds=[265435] →
 *    rowCount=**0**（ian000 的 userId 是 265441，與 265435 不相交）；改成
 *    identifiers=["ian000"] + userIds=[265441] → rowCount=**1**。證實兩個條件是 AND 交集
 *    而非 OR 聯集，與 #tidyUserFundUserId 的 reduce/filter 源碼一致。
 * 5. **totalPage 陷阱實測驗證**：同一組條件 page=1 回 totalPage=315、page=2 回 totalPage=0
 *    （但 rows 仍正確回 5 筆，不是查詢失敗），與 getPageData 只在 page=1 計算的源碼一致。
 * 6. **空條件守門實測**：不帶 identifiers 也不帶 userIds → 本 tool 在呼叫後端前回傳
 *    success=false + message/hint，未送出 RPC。
 * 7. **pageSize=0 守門實測**：pageSize=0 被 zod 擋在 tool 邊界，回
 *    `MCP error -32602 ... Too small: expected number to be >=1 at pageSize`，不會送到後端。
 *    （後端拿到 0 會產生 LIMIT 0,0、且呼叫端會看到 totalPage=0 這件事是源碼推得的——withPage /
 *    getTotalPage 的 TS 預設參數只對 undefined 生效、i32 無法承載 Infinity——本輪未也不打算
 *    實際送 0 去復現。）
 * 8. **stored value 換算實測對帳**：ian000 balance=89340000、depositAmount=99990000、
 *    withdrawAmount=10810000、profit=-89180000。用 get_currencies 查得 CNY decimalPlaces=2
 *    → 除數 10^(2+2)=10000，換算後為餘額 8934.00 / 充值 9999.00 / 提現 1081.00 /
 *    利潤 -8918.00，且 1081 − 9999 = −8918 與源碼 `profit = withdrawAmount - depositAmount`
 *    完全吻合，同時證實 profit 是「會員獲利」方向（此人淨輸 8918）。
 * 9. **幣別清單實測（本輪 review 修正過的一條錯誤事實）**：初版檔頭寫「該站只有 CNY 一種幣別在啟用」，
 *    那是只讀了截斷輸出的前三筆造成的錯誤。重跑 aladdin_platform_currency_platform_get_currencies
 *    的完整結果是 **6 種幣別**：INR(status=2, dp=2) / CNY(1, 2) / TWD(2, 2) / **JPY(2, dp=0)** /
 *    **USD(1, 2)** / **USDT(1, 2)**——**啟用中的有三種：CNY、USD、USDT**。
 *    另注意 JPY 的 decimalPlaces 是 **0**，是「不能假設所有幣別都是 2 位小數」的真實反例，
 *    description 要求逐幣別查 decimalPlaces 不是形式主義。
 * 10. **「一列＝會員×幣別錢包」的實測嘗試（修正第 9 點後重做）**：既然啟用幣別有三種，
 *    原本「只有一種幣別所以無法驗證」的理由不成立，因此重新針對性搜尋——
 *    用 5 個模糊詞（a / e / 0 / 1 / test）各掃最多 200 筆、合計約 857 個錢包列，
 *    其中確實找到**非 CNY 的錢包**（identifier=code056、userId=275395、USD、balance=0），
 *    證實該站不是只有 CNY 錢包。但用 userIds=[275395] 精準回查只得 1 列（只有 USD），
 *    再用 get_user_adjustment_info 逐幣別交叉確認：CNY → 401 walletNotExists、
 *    USD → balance=0、USDT → 401 walletNotExists，該會員確實只持有單一幣別錢包。
 *    全部 857 列裡 **沒有任何一個 userId 出現超過一次**。
 *    結論：這條仍是源碼推得（wallet.ts:646 的 SQL 無幣別條件 + wallet.ts:638 的註解），
 *    但「無法實測」的正確理由是**該 dev 站沒有持有多幣別錢包的會員**，
 *    不是先前寫的「只有一種幣別在啟用」。
 * 全程唯讀查詢，未寫入/修改任何 dev 資料，無需清理。
 *
 * --- 2026-08-28 獨立 review 後的修正 ---
 * 本檔初版的 agrabah 行號有大面積偏移（約 14 處，內容正確但指標指到不相干的行），
 * 已逐一用 grep -n 覆核後回填正確行號；另補上 userIds 的 i32 上限、identifiers 長度上限、
 * accurate 預設改為 true（對齊後台 UI）、把「totalPage=Infinity」這個呼叫端實際觀察不到的
 * 敘述改正為「totalPage=0，與查無資料無法分辨」、把恆真的
 * totalPageOnlyValidOnFirstPage 旗標改成逐次判斷的 totalPageValid、
 * description 補上 userLevelId 的解讀方式，並補寫 server README 的 tool 清單。
 *
 * 修正後的 dev 回歸驗證（同一套 stdio spike，2026-08-28）：
 * A. 不傳 accurate（走新的預設 true）+ identifiers=["ian000"] → rowCount=1、只回 ian000，
 *    totalPage=1、totalPageValid=true——確認預設真的變成精準比對。
 * B. 顯式 accurate=false + identifiers=["ian00"] → rowCount=4（ian001/ian000/ian002/ian003），
 *    模糊模式仍可用、沒有被預設值改動壓掉。
 * C. page=2 → totalPage=0 且 **totalPageValid=false**，新旗標如預期逐次判斷。
 * D. userIds=[2147483648] → 被 zod 擋下：`Too big: expected number to be <=2147483647 at userIds[0]`，
 *    不會送到後端被無聲截斷。
 * E. identifiers 帶 51 筆 → 被 zod 擋下：`Too big: expected array to have <=50 items at identifiers`。
 * 回歸驗證同樣全程唯讀，無資料需要清理。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { ListUserFundSearch } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { deepFixLongs, I32_MAX } from '../const.ts';

export function registerListUserFundTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_fund_adjustment_platform_list_user_fund',
        {
            title: 'Look up members\' wallet balance and deposit/withdraw totals (fund adjustment page)',
            description:
                '依會員帳號或會員 id 查詢本平台會員的資金概況——錢包餘額、充值總額、提現總額、會員利潤、' +
                '最後充提時間（rajah: FundAdjustmentPlatform.ListUserFund），對應後台' +
                '「帳務管理 > 資金調整 > 申請調整」的用戶資金查詢頁。' +
                '⚠️ **必須至少帶 identifiers 或 userIds 其中一個**：後端沒有「不帶條件就列出全平台」的行為，' +
                '搜尋條件解析後為空時它會直接回傳成功 + 空清單，看起來跟「查無此人」一模一樣。' +
                '本 tool 會在呼叫前擋下這種情況並明講，不會讓你誤判。' +
                '⚠️ **但「帳號打錯／查無此人」本 tool 擋不住**：條件有帶、只是解析後命中 0 人時，' +
                '後端一樣是回「成功 + 空清單」，與「這個人確實沒有錢包」完全無法分辨。' +
                '查到 0 筆時請先確認帳號本身存在。' +
                '（注意：查「資金調整單」的 aladdin_platform_fund_adjustment_platform_list_user_fund_adjustment ' +
                '行為相反，不帶會員條件時是真的列全平台，兩支不要互相類推。）' +
                '⚠️ **identifiers 與 userIds 同時帶是「交集」不是「聯集」**：兩個都帶時只會回傳' +
                '「帳號符合 **且** id 也在清單裡」的會員，兩者不相交就回空。要一次查多個不相干的會員，' +
                '請只用其中一個欄位、把目標全部放進那一個陣列。' +
                '⚠️ **一列是一個「會員 × 幣別」錢包，不是一個會員**：同一個會員若持有 CNY 與 INR 兩個錢包' +
                '會佔兩列（rowCount 不等於人數），每列的 currencyCode 不同。只查一般錢包（normal），' +
                '不含其他錢包類型。' +
                '⚠️ **所有金額欄位都是 stored value（未換算的資料庫原始整數），不是可直接顯示的金額**：' +
                '換算公式為 normal = stored / 10^(該幣別 decimalPlaces + 2)，2 位小數的幣別即除以 10000。' +
                'decimalPlaces 請用 aladdin_platform_currency_platform_get_currencies 依 currencyCode 查，' +
                '不要假設所有幣別都一樣。' +
                'profit 是「提現總額 − 充值總額」＝**會員的獲利**（對平台而言是損失），不是平台利潤，正負號別看反。' +
                'depositAmount/withdrawAmount **含手動加扣款**（真實金流 + 手動調整相加），' +
                'lastDepositAtTimestamp/lastWithdrawAtTimestamp 取真實與手動兩者中較晚的那一個（毫秒 epoch，0 代表沒有）。' +
                'userLevelId 是 VIP 等級設定的 id（不是等級數字），要對照 ' +
                'aladdin_platform_vip_level_platform_get_vip_level_settings 才知道是哪一級；查無會員資料時為 0，' +
                'identifier 同樣情況下為空字串。' +
                '⚠️ 後端的支付統計是另一支 RPC，它失敗時本 method 不會報錯，而是把 depositAmount / ' +
                'withdrawAmount / profit / 兩個最後時間**全部降級成 0**，只有 balance 仍正確——' +
                '看到這些欄位整排為 0 時無法分辨是「真的沒充提過」還是「統計服務當下異常」，需要時請另外覆核。' +
                '⚠️ totalPage 只有在 page=1 時後端才會真的計算，翻到第 2 頁以後一律回 0（已 dev 實測，' +
                '非本工具的 bug）——回傳的 totalPageValid 欄位會告訴你這次的 totalPage 可不可信；' +
                '不可信時請用「這次回傳筆數 < pageSize」判斷是否為最後一頁。' +
                '純讀取查詢，不修改任何資料，可安全重複呼叫。回傳含會員財務資料，請勿寫入未加密的持久化紀錄。',
            inputSchema: {
                identifiers: z
                    .array(z.string().min(1))
                    .max(50)
                    .optional()
                    .describe(
                        '會員帳號清單（rajah ListUserFundSearch.identifiers）。與 userIds 至少要帶一個。' +
                        '比對方式由 accurate 決定：accurate=true（預設）為完全相等，false 為模糊比對。' +
                        '⚠️ 模糊比對時後端**不設命中數上限**，單一寬鬆片段（如 "a"）可命中上千會員並讓後端撈到底，' +
                        '請盡量給完整帳號。陣列長度上限 50 是本 tool 自訂的保護，不是後端限制。',
                    ),
                userIds: z
                    .array(z.number().int().min(1).max(I32_MAX))
                    .max(200)
                    .optional()
                    .describe(
                        '會員 id 清單（rajah ListUserFundSearch.userIds，型別 [i32]）。與 identifiers 至少要帶一個。' +
                        '這個欄位一律精準比對，不受 accurate 影響。' +
                        `⚠️ 必須落在 i32 範圍（1 ~ ${ I32_MAX }）：超過會被 protobuf 無聲截斷成另一個合法的 userId，` +
                        '結果會若無其事地回傳別的會員資料，故本 tool 直接擋下。',
                    ),
                accurate: z
                    .boolean()
                    .default(true)
                    .describe(
                        '帳號是否精準搜尋（rajah ListUserFundSearch.accurate）。true（預設，與後台頁面一致）= ' +
                        'identifiers 需完全相等；false = 模糊比對，會連帶命中所有包含該片段的帳號。' +
                        '**只作用於 identifiers，對 userIds 無效**。',
                    ),
                page: z.number().int().min(1).default(1).describe('頁碼，從 1 開始'),
                pageSize: z
                    .number()
                    .int()
                    .min(1)
                    .max(200)
                    .default(50)
                    .describe(
                        '每頁筆數（以「會員 × 幣別」錢包計算）。⚠️ 不能傳 0：後端拿到 0 會產出 LIMIT 0,0，' +
                        '回傳空清單且 totalPage 也是 0，與「查無資料」完全無法分辨（後端不會套用自己的預設值），' +
                        '所以本 tool 強制至少 1。上限 200 是本 tool 自訂的保護，後端沒有上界。',
                    ),
            },
        },
        async ({ identifiers, userIds, accurate, page, pageSize }) => {
            const cleanIdentifiers = identifiers ?? [];
            const cleanUserIds = userIds ?? [];

            // 後端在搜尋條件解析為空時會回傳「成功 + 空清單」（fund_adjustment_platform.ts:144-146），
            // 與「查無此人」無法分辨。這裡先擋下來，避免呼叫端誤讀。
            if (cleanIdentifiers.length === 0 && cleanUserIds.length === 0) {
                return asTextResult({
                    success: false,
                    message: '必須至少提供 identifiers（會員帳號）或 userIds（會員 id）其中一個，且不可為空陣列。',
                    hint:
                        '這支後端 method 沒有「不帶條件就列出全平台會員」的行為——條件為空時它會直接回傳成功 + 空清單，' +
                        '與「查無此人」完全無法分辨，因此本 tool 在呼叫前先擋下。' +
                        '請帶入要查詢的會員帳號或會員 id；注意兩者同時帶是取交集，不是聯集。',
                });
            }

            const search = ListUserFundSearch.create({
                accurate: accurate ?? true,
                identifiers: cleanIdentifiers,
                userIds: cleanUserIds,
            });

            const r = await withAutoRelogin(() =>
                remote.fundAdjustmentBackOffice.fundAdjustmentPlatform.ListUserFund(search, page, pageSize),
            );
            if (r.failed) return asErrorResult(r);

            const rows = deepFixLongs(r.data?.rows ?? []);
            return asTextResult({
                success: true,
                page,
                pageSize,
                rowCount: rows.length,
                totalPage: r.data?.totalPage,
                // totalPage 只有 page=1 時後端才真的算（database_helper.ts:208），其他頁恆為 0。
                totalPageValid: page === 1,
                rowsAreWalletPerCurrency: true,
                amountsAreStoredValue: true,
                rows,
            });
        },
    );
}
