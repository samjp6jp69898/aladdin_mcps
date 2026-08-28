/**
 * tools/get_user_adjustment_info.ts — aladdin_platform_fund_adjustment_platform_get_user_adjustment_info
 *
 * rajah: FundAdjustmentPlatform.GetUserAdjustmentInfo(userId i32 1, currencyCode string 2)
 * (info UserAdjustmentInfo 1)
 * （fund_adjustment_back_office.rajah:486；service FundAdjustmentPlatform 定義於同檔 471 行、
 * @Module "FundAdjustment"（469）、service 級 @Permission "Finance.FundAdjustment"（470），
 * 這支 method 另掛 @Permission "Finance.FundAdjustment.Apply.Ops.Edit"（485）——後台
 * 「帳務管理 > 資金調整 > 申請調整」按下某會員的「調整」後、開啟加扣款彈窗時抓的那一次查詢。
 * 非 @NoPublic、非 Placeholder、無 @Totp。）
 *
 * agrabah 對應實作：fund_adjustment_platform.ts:317-341 methodGetUserAdjustmentInfo，
 * 確認有真實 override（並行打兩支跨服務 RPC 取會員資料與錢包），不是 notImplemented stub。
 *
 * 分類：method-category-checklist.md 第 1 節「讀取單筆」，且是其中的**複合 key**情形
 * （userId + currencyCode 兩個 key 一起定位一個錢包），該節明列「複合 key 要驗證『兩個 key
 * 都存在但不成對』的行為，不只驗證單一 key 不存在」——見下方 dev 驗證第 3 點。
 *
 * ⚠️ **這支不是「取得調整紀錄」，是「取得要調整的那個會員的當前資訊」**：名字裡的
 * AdjustmentInfo 容易被讀成「某張調整單的資訊」。它回傳的是會員帳號 + 會員 id + 該幣別的
 * 當前錢包餘額，是加扣款前給操作者確認身分與餘額用的。要查某張調整單的內容，請用
 * aladdin_platform_fund_adjustment_platform_get_user_fund_adjustment_review_info（吃調整單 id）。
 *
 * agrabah 實作細節（讀源碼查證，非推測；行號對 agrabah main 於 2026-08-28 的內容）：
 *
 * - **兩支跨服務 RPC 並行、任一失敗就整支失敗**：
 *   `context.remote.appUser.appUserInternal.GetAppUserInfo(platformId, userId)`（:322）與
 *   `context.remote.wallet.walletInternal.GetUserWallet(userId, WalletTypeEnum.normal, currencyCode)`
 *   （:323）用 Promise.all 並行（:321-324），先檢查 userInfoResult.failed、再檢查 userWalletsResult.failed
 *   （:325-329）。所以 userId 不存在與「該會員沒有這個幣別的錢包」會回不同的錯誤碼，
 *   本 tool 把原始 errorCode/message 原樣呈現，不自行歸納成同一種「查無資料」。
 *
 * - **只查 normal（一般）錢包**：walletType 寫死 WalletTypeEnum.normal（:323），查不到其他
 *   錢包類型的餘額。⚠️ 這是**中心錢包**餘額——會員轉進三方遊戲場館裡的錢不在這個數字內，
 *   不要把它當成「這名會員全部的錢」。
 *
 * - **平台範圍由登入態決定**：platformId 取自 context.platformId（:318），不是呼叫端參數，
 *   所以查不到別的平台的會員——跨租戶風險（第 1 節要求檢查的項目）由後端結構性擋住，
 *   不是靠本 tool 的參數驗證。GetAppUserInfo 明確吃 platformId；GetUserWallet 沒有 platformId
 *   參數，是由 wallet 服務內部用 context.platformId 過濾。
 *
 * - **balance 是 stored value，本 tool 不做換算**：`balance: wallet.balance`（:338）直接取原始
 *   值，這支從頭到尾沒有呼叫 Exchange.storedToNormal*。換算公式
 *   `normal = stored / 10^(decimalPlaces + 2)`（jafar/src/exchange.ts:32-38），decimalPlaces
 *   依幣別而異，用 aladdin_platform_currency_platform_get_currencies 查。
 *
 * - **回傳的 currencyCode 來自錢包本身、不是你傳進去的字串**：`currencyCode: wallet.currencyCode`
 *   （:339），所以可以拿它反查後端實際命中的是哪個幣別的錢包。
 *
 * - **⚠️ 幣別大小寫不敏感是 DB collation 的副產物，不是程式碼保證**：實測傳 "cny" 會命中 "CNY"
 *   （見下方驗證第 5 點），但查詢路徑上**沒有任何正規化程式碼**——WalletManager.getUserWallet
 *   （wallet_manager.ts:250-269）的條件就是 `platform_id = ? AND user_id = ? AND type = ? AND
 *   currency_code = ?`（:251-252），沒有 toUpperCase。大小寫不敏感純粹來自 MySQL 的預設
 *   collation，換成 binary collation 或改走 StarRocks 就可能不成立。**不要依賴它**，請照
 *   get_currencies 回傳的原始大小寫傳入。
 *
 * - **還有第三種錯誤碼：406 walletSignNotMatch**：錢包列有防竄改簽章，`checkSign()` 失敗時回
 *   AgrabahErrorCodeEnum.walletSignNotMatch（wallet_manager.ts:264-267）。這代表 DB 被繞過改過
 *   餘額，是**資料異常**不是查無資料，遇到時應停下來回報而不是當成「沒有錢包」。
 *
 * - **回傳 model 只有 4 個欄位**：UserAdjustmentInfo（rajah:40-49）= identifier / userId /
 *   balance / currencyCode。比同 service 的 UserFund（rajah:14-36）少了 userLevelId 與所有
 *   充提統計欄位——要那些請改用 aladdin_platform_fund_adjustment_platform_list_user_fund。
 *
 * - PII（第 8 節）：只有 identifier（會員帳號，同時是操作者要確認的身分）與餘額，**沒有
 *   realName、銀行卡號、手機、email** 等第 8 節列管欄位，不需額外遮罩。餘額屬會員財務資料，
 *   不應寫入未加密的持久化紀錄。
 *
 * - **userId 的 i32 邊界**：rajah 是 `userId i32 1`（rajah:486）。超過 2147483647 會被 protobuf
 *   無聲截斷成另一個合法 userId，於是這支會回傳**別的會員**的帳號與餘額而且看起來完全正常。
 *   本 tool 用 const.ts 的 I32_MAX 擋下，比照同 server 既有慣例
 *   （create_or_update_room_mute.ts:155，2026-08-25 review 實測確認過會操作到錯的人）。
 *
 * 這是純讀取查詢，不修改任何資料，可安全重複呼叫。
 *
 * --- dev 驗證（2026-08-28，pk-platform.alddev.com，帳號 landon001；獨立 spike script 用
 *     @modelcontextprotocol/sdk 的 Client + StdioClientTransport spawn 本 worktree 的
 *     src/stdio.ts，呼叫真正註冊起來的 tool，不是繞過 tool 直接打 RPC）---
 * 1. 正常查詢 userId=265441（帳號 ian000）+ currencyCode="CNY"：success，info =
 *    { identifier: "ian000", userId: 265441, balance: 89340000, currencyCode: "CNY" }，
 *    恰好四個欄位、與 rajah model UserAdjustmentInfo 一致，沒有多餘的內部欄位。
 *    balance 89340000 與 aladdin_platform_fund_adjustment_platform_list_user_fund 對同一會員
 *    查到的餘額完全相同，兩支交叉對帳一致（stored value，CNY decimalPlaces=2 → 8934.00）。
 * 2. **單一 key 不存在**：userId=999999999（不存在）+ "CNY" → success=false，
 *    **errorCode=204 userNotExists**。
 * 3. **複合 key「兩個 key 都存在但不成對」（第 1 節強制驗收案例）**：userId=265441（存在）
 *    + currencyCode="INR"（平台有這個幣別、但該會員沒有 INR 錢包）→ success=false，
 *    **errorCode=401 walletNotExists**——與第 2 點的 204 是**不同的錯誤碼**，證實後端真的能區分
 *    「會員不存在」與「會員存在但沒有這個幣別的錢包」，本 tool 原樣呈現、不歸納成同一種。
 * 4. 幣別亂填：userId=265441 + "ZZZ" → 同樣是 errorCode=401 walletNotExists。也就是說
 *    「幣別代碼根本不存在」與「幣別存在但該會員沒有該錢包」後端回同一個錯誤碼，**無法分辨**，
 *    description 已據實只承諾「會員不存在 vs 沒有錢包」這一組區分。
 * 5. **幣別大小寫**：currencyCode="cny"（小寫）→ success，且回傳的 info.currencyCode 是
 *    **"CNY"**（大寫）。這證實的是**回傳值取自命中的錢包、而非原樣回吐輸入**
 *    （與源碼 `currencyCode: wallet.currencyCode`（:339）一致）；
 *    ⚠️ **不能據此說「後端會正規化」**——查詢路徑上沒有任何 toUpperCase
 *    （wallet_manager.ts:251-252 只有 `currency_code = ?`），大小寫不敏感是 MySQL collation
 *    的副產物。這一句初版寫成「證實後端會正規化」，與檔頭上方的說明自相矛盾，本輪 review 後改正。
 * 全程唯讀查詢，未寫入/修改任何 dev 資料，無需清理。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { deepFixLongs, I32_MAX } from '../const.ts';

export function registerGetUserAdjustmentInfoTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_fund_adjustment_platform_get_user_adjustment_info',
        {
            title: 'Get one member\'s account + current wallet balance for a currency (before fund adjustment)',
            description:
                '取得單一會員在指定幣別的當前資金資訊——會員帳號、會員 id、該幣別一般錢包的餘額' +
                '（rajah: FundAdjustmentPlatform.GetUserAdjustmentInfo），對應後台' +
                '「帳務管理 > 資金調整 > 申請調整」按下某會員的「調整」時、加扣款彈窗開啟前的那一次確認查詢。' +
                '⚠️ **這支不是「查某張調整單」**：名字裡的 AdjustmentInfo 指的是「要被調整的那個會員的資訊」，' +
                '不是調整紀錄。要看某張調整單的內容與審核資訊，請用 ' +
                'aladdin_platform_fund_adjustment_platform_get_user_fund_adjustment_review_info（吃調整單 id）；' +
                '要列出調整單，請用 aladdin_platform_fund_adjustment_platform_list_user_fund_adjustment。' +
                '⚠️ 需要**同時**給對 userId 與 currencyCode：兩者是一組複合鍵，' +
                '會員存在但沒有該幣別的一般錢包時會回錯誤（不是回餘額 0）。錯誤碼與訊息會原樣呈現，' +
                '「會員不存在」與「該幣別沒有錢包」是不同的錯誤，不要一律當成查無資料。' +
                '⚠️ 只查**中心錢包**（normal）：會員轉進三方遊戲場館裡的錢不在這個數字內，' +
                '不要把它當成這名會員的全部資產。其他錢包類型也查不到。' +
                '⚠️ 另有第三種錯誤碼 **406 walletSignNotMatch**（錢包簽章不符，代表 DB 被繞過改過餘額）：' +
                '那是資料異常、不是查無資料，遇到請停下來回報，不要當成「沒有錢包」重試。' +
                '⚠️ **balance 是 stored value（未換算的資料庫原始整數）**：換算公式為 ' +
                'normal = stored / 10^(該幣別 decimalPlaces + 2)，2 位小數的幣別即除以 10000；' +
                'decimalPlaces 用 aladdin_platform_currency_platform_get_currencies 依 currencyCode 查，' +
                '不要假設所有幣別都一樣。' +
                '回傳的 currencyCode 取自命中的錢包本身（不是原樣回吐你傳的字串），可用來確認實際命中哪個幣別。' +
                '⚠️ 幣別大小寫實測不敏感（傳 cny 會命中 CNY），但那是 DB collation 的副產物、**程式碼裡沒有任何正規化**，' +
                '不要依賴——請照 get_currencies 回傳的原始大小寫傳入。' +
                '只查得到目前登入平台的會員（平台範圍由登入態決定，不是參數）。' +
                '回傳只有 identifier / userId / balance / currencyCode 四個欄位；需要會員層級、' +
                '充值提現總額等更多欄位請改用 aladdin_platform_fund_adjustment_platform_list_user_fund。' +
                '純讀取查詢，不修改任何資料，可安全重複呼叫。回傳含會員餘額，請勿寫入未加密的持久化紀錄。',
            inputSchema: {
                userId: z
                    .number()
                    .int()
                    .min(1)
                    .max(I32_MAX)
                    .describe(
                        '會員 id（rajah 型別 i32）。不知道 id 時先用 ' +
                        'aladdin_platform_fund_adjustment_platform_list_user_fund 以帳號查出 userId。' +
                        `⚠️ 必須落在 i32 範圍（1 ~ ${ I32_MAX }）：超過會被 protobuf 無聲截斷成另一個合法 userId，` +
                        '結果會若無其事地回傳別的會員資料，故本 tool 直接擋下。',
                    ),
                currencyCode: z
                    .string()
                    .min(1)
                    .describe(
                        '幣別代碼，例如 "CNY"。合法值請用 aladdin_platform_currency_platform_get_currencies 查' +
                        '（同時可取得換算餘額所需的 decimalPlaces）。該會員沒有這個幣別的一般錢包時會回錯誤，不是回 0。',
                    ),
            },
        },
        async ({ userId, currencyCode }) => {
            const r = await withAutoRelogin(() =>
                remote.fundAdjustmentBackOffice.fundAdjustmentPlatform.GetUserAdjustmentInfo(userId, currencyCode),
            );
            if (r.failed) return asErrorResult(r);

            const info = deepFixLongs(r.data?.info ?? null);
            return asTextResult({
                success: true,
                requestedUserId: userId,
                requestedCurrencyCode: currencyCode,
                balanceIsStoredValue: true,
                walletType: 'normal',
                info,
            });
        },
    );
}
