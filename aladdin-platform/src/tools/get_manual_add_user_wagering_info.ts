/**
 * tools/get_manual_add_user_wagering_info.ts — aladdin_platform_wagering_platform_get_manual_add_user_wagering_info
 *
 * rajah: WageringPlatform.GetManualAddUserWageringInfo（wagering_back_office.rajah:405）。
 * 方法本身沒有獨立 @Permission，套用 service 級的 @Permission "Finance.Wagering"（同檔 389）。
 *
 * 分類（method-category-checklist.md 第 1 節「讀取單筆」）：吃一個小型 search struct
 * （userId 或 identifier 二擇一）、回傳單一 model。該節要求逐項處理：
 *
 * - **「Get 前綴不保證唯讀」——查證結果是「有條件寫入」，不是純讀取。**
 *   呼叫鏈：methodGetManualAddUserWageringInfo（agrabah/src/servers/wagering_back_office/
 *   services/wagering_platform.ts:480）→ WalletInternal.GetUserBalance
 *   → methodGetUserBalance（agrabah/src/servers/wallet/services/wallet.ts:388）
 *   → getBalanceAndCurrency（同檔 97-98）→ walletManager.**getOrCreateWallet**
 *   （agrabah/src/managers/wallet_manager.ts:272-280）→ errorCode 為 walletNotExists 時
 *   → createUserWallet（同檔 230-248）→ **insertObject（同檔 241）**。
 *   也就是說：對「normal 錢包 + 該幣別」尚不存在的會員呼叫本工具，會在 app_user_wallets
 *   新增一列（balance=0、status=enabled、version=1、帶簽章），而且沒有對應的刪除 API。
 *   這正是第 1 節那條規則要抓的東西，必須在 description 明講，不能宣稱唯讀。
 *   實務上多數會員錢包早已存在（第二次以後呼叫走 getUserWallet 直接命中），所以拿既有會員
 *   實測是測不到這條路徑的——不能因為 dev 實測沒事就推論它唯讀。
 *   其餘下游確認唯讀：GetAppUserInfo(ByIdentifier)（agrabah/src/common_services/app_user.ts:42-69、
 *   181-209，SELECT + id_links 查詢 + BatchDecrypt 純運算）、
 *   wageringManager.getUnWageringInfo（agrabah/src/managers/wagering_manager.ts:270-278，單一 SELECT）。
 *
 * - **id 不存在的行為**：實打 dev 驗證，見 description。
 * - **跨租戶**：查會員的兩支 RPC 都帶 context.platformId（wagering_platform.ts:466、468），
 *   建錢包時的 platformId 也取自 context（wallet_manager.ts:232），呼叫端無法指定。
 *
 * **整包透傳的邊界依賴（給未來維護者）**：本工具用 deepFixLongs(r.data?.info) 無條件透傳整個
 * info 物件。目前安全，是因為 rajah 的 GetManualAddUserWageringInfoResponse
 * （wagering_back_office.rajah:202-209）只有 userId/balance/unWageringAmount 三欄；
 * 底層 GetAppUserInfoByIdentifier 其實已經把該會員的 mobile/email/qq/wechat 解密成明文
 * （app_user.ts:206），只是沒被放進這個 response model。若後端日後擴充這個 model 的欄位，
 * 本工具會自動把新欄位吐給呼叫端——屆時要重新檢查 method-category-checklist.md 第 8 節。
 *
 * 回傳的 balance / unWageringAmount 是 i64，需要 deepFixLongs。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { GetManualAddUserWageringInfoSearch } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { deepFixLongs } from '../const.ts';

export function registerGetManualAddUserWageringInfoTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_wagering_platform_get_manual_add_user_wagering_info',
        {
            title: 'Get one member\'s wallet balance + outstanding wagering total',
            description:
                '用會員帳號或會員 id 查該會員的「錢包餘額 + 目前未稽核（未打完的流水）總額」，' +
                '對應後台「財務」→「稽核」→「手動添加稽核」彈窗開啟時的預查步驟' +
                '（rajah: WageringPlatform.GetManualAddUserWageringInfo，套用 service 級權限節點 Finance.Wagering）。' +
                '名稱裡的 ManualAdd 指的是它服務於哪個後台流程，**它不會新增任何稽核**。' +
                '**但它也不是完全唯讀，有一個副作用必須知道**：本 method 內部呼叫 WalletInternal.GetUserBalance，' +
                '而那支的實作是 getOrCreateWallet（agrabah/src/managers/wallet_manager.ts:272-280）——' +
                '若該會員在「normal 錢包 + 自身幣別」這個組合下還沒有錢包列，它會**直接建一列**' +
                '（同檔 230-248 的 createUserWallet → insertObject，balance=0、status=enabled），' +
                '而且沒有對應的刪除 API。對已有錢包的會員（絕大多數情況）則純粹是讀取。' +
                '如果你只是想把「會員帳號」換成「會員 id」、不想承擔這個副作用，' +
                '**請改用 aladdin_platform_activity_platform_get_user_id_by_identifier**（純查詢、無此副作用）；' +
                'aladdin_platform_wagering_platform_list_user_wagerings 帶 accurate=true 也可以。' +
                '只有在你確實需要 balance／unWageringAmount 時才用本工具。' +
                '以下三點是簽名看不出來的行為，都已實打 dev 驗證：' +
                '**(1) identifier 優先，帶了就完全忽略 userId**——後端是 `if (search.identifier !== \'\')` ' +
                '走帳號查、否則才走 id 查（wagering_platform.ts:465-469），之後一律以查到的 userInfo.id 為準' +
                '（同檔 475），從不回頭比對你傳的 userId。dev 實測「identifier=pkyftest + userId=999999」' +
                '直接回 pkyftest 的資料，不報錯也不做一致性檢查——不要同時帶兩個然後以為後端會幫你驗。' +
                '**(2) identifier 是精準比對，不是模糊**——後端 where 是 `u.identifier = ?` 等號' +
                '（app_user.ts:184）。dev 實測帶前綴 "pkyf" 查不到 pkyftest，回 errorCode 204 userNotExists。' +
                '要模糊找人請用 list_user_wagerings（accurate=false）。' +
                '**(3) 查無此會員回 errorCode 204 userNotExists**；至於 identifier 與 userId 兩個都不帶，' +
                '本工具會在送出前先擋下、回 success=false 加說明訊息（**不會有 errorCode 欄位**），' +
                '不會真的送出（真送出的話後端會拿 userId=0 去查、同樣回 204，但訊息看不出真正原因）。' +
                '**金額欄位語意**：balance 是該會員 normal 錢包（WalletTypeEnum.normal）在其自身 ' +
                'currencyCode 下的餘額；unWageringAmount 是該會員**終身 status=pending 的未稽核總額，' +
                '且同樣只統計該會員自身 currencyCode 的部分**（wageringManager.getUnWageringInfo，' +
                'agrabah/src/managers/wagering_manager.ts:270-278，SQL 的 WHERE 同時寫死 status=pending ' +
                '與 currency_code，不含已完成／已解除、也不跨幣別）。兩者都是 stored 整數，' +
                'stored = 人類金額 × 10^(decimalPlaces+2)（jafar/src/exchange.ts:31-37），本工具不換算；' +
                '幣別精度查 aladdin_platform_currency_platform_get_currencies 的 decimalPlaces。' +
                '注意回傳不含 currencyCode（rajah response model 只有三欄）——要知道是哪個幣別，' +
                '請用 aladdin_platform_wagering_platform_get_user_un_wagering_detail' +
                '（其 userWageringInfo.currencyCode 有值）。' +
                '本工具不提供「實際新增稽核」的能力：那是 WageringPlatform.ManualAddUserWagering' +
                '（rajah:409，需 Finance.Wagering.List.ManualAddUserWagering + @Totp），' +
                '會直接改動個別會員的提款門檻，本 MCP 未包成 tool。',
            inputSchema: {
                identifier: z.string().optional().describe(
                    '會員帳號，**精準比對**。與 userId 二擇一；兩個都帶時後端只看這個、完全忽略 userId。' +
                    '查無此帳號回 errorCode 204 userNotExists',
                ),
                userId: z.number().int().min(1).optional().describe(
                    '會員 id。只有在完全不帶 identifier 時才會被使用。查無此 id 回 errorCode 204 userNotExists',
                ),
            },
        },
        async ({ identifier, userId }) => {
            if (!identifier && userId === undefined) {
                return asTextResult({
                    success: false,
                    message: 'identifier 與 userId 至少要帶一個。本工具在送出前先擋下（所以這個回應沒有 errorCode）：' +
                        '兩個都不帶時後端會拿 userId=0 去查、回 errorCode 204 userNotExists，' +
                        '那個訊息無法反映真正的原因。',
                });
            }

            const search = GetManualAddUserWageringInfoSearch.create({
                identifier: identifier ?? '',
                userId: userId ?? 0,
            });

            const r = await withAutoRelogin(() => remote.wageringBackOffice.wageringPlatform.GetManualAddUserWageringInfo(search));
            if (r.failed) return asErrorResult(r);

            return asTextResult({
                success: true,
                info: deepFixLongs(r.data?.info ?? null),
                notes: {
                    resolvedBy: identifier ? 'identifier（精準比對；本次已忽略 userId）' : 'userId',
                    sideEffect: '非純讀取：內部的 WalletInternal.GetUserBalance 走 getOrCreateWallet，'
                        + '該會員若還沒有「normal 錢包 + 自身幣別」的錢包列會被建出一列（balance=0），且無刪除 API。'
                        + '只想用帳號換 id 請改用 aladdin_platform_activity_platform_get_user_id_by_identifier（無此副作用）',
                    balance: 'normal 錢包在該會員自身 currencyCode 下的餘額，stored 整數（× 10^(decimalPlaces+2)），本工具不換算',
                    unWageringAmount: '該會員終身 status=pending、且限該會員自身 currencyCode 的未稽核總額；'
                        + '不含已完成／已解除，不跨幣別。同為 stored 整數',
                    currencyCode: '本 method 不回傳幣別。需要幣別請改用 '
                        + 'aladdin_platform_wagering_platform_get_user_un_wagering_detail（userWageringInfo.currencyCode）',
                },
            });
        },
    );
}
