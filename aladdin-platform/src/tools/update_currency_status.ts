/**
 * tools/update_currency_status.ts — aladdin_platform_currency_platform_update_currency_status
 *
 * rajah: CurrencyPlatform.UpdateCurrencyStatus(code string 1, status StatusEnum 2)
 * （rajah/services/core.rajah:22-27，需要權限節點 AdminManagement.Setting.Currency.Status.Toggle）。
 *
 * method-category-checklist.md 第 0 節排除規則已過：非 Placeholder、非 @NoPublic；agrabah 對應實作
 * agrabah/src/servers/core_back_office/services/currency_platform.ts:53-93（methodUpdateCurrencyStatus）
 * 確認有真實實作，非 base class 的 notImplemented。
 *
 * 分類：method-category-checklist.md 第 6 節「狀態轉換」——UpdateXxxStatus，帶明確目標狀態（非
 * bit-flip），符合套用第 6 節。
 *
 * 2026-08-25 讀源碼查證 + dev 實測：
 * - 這支改的是「這個幣別代碼在**當前這個 platform**底下」的啟停狀態（`platform_supported_currencies`
 *   表，以 platformId+currencyCode 定位），不是全域幣別狀態；platformId 取自登入 context（本 MCP
 *   server 綁定單一 platform），RPC 簽名沒有 platformId 參數。
 * - **首次對某幣別操作時該平台尚無對應列**：後端先查 `platform_supported_currencies` 有沒有
 *   `platform_id+currency_code` 這筆，沒有的話先 insert 一筆 status=disabled 的列，再套用目標狀態
 *   （currency_platform.ts:66-89）——這也解釋了為什麼 `aladdin_platform_currency_platform_get_currencies`
 *   對「該平台尚未收錄」的幣別一律顯示 disabled（見該工具檔頭說明），不是資料缺漏。
 * - **重要業務規則（已讀源碼+dev 實測驗證）**：code 等於該平台目前的 defaultCurrencyCode、且目標
 *   status 不是 enabled 時，後端在寫入任何資料前就直接拒絕（currency_platform.ts:62-64，回
 *   `ErrorCode.requestNotValid`，dev 實測 errorCode=7，非 AgrabahErrorCodeEnum 命名範圍內、
 *   asErrorResult 會顯示「未知錯誤碼」，本工具特判給明確訊息）——平台的預設幣別不能被停用。
 * - **僅在該平台已啟用的全域幣別才會出現在清單裡**：底層 `_ListCurrencies`
 *   （agrabah/src/servers/core/services/currency.ts:111）在建立 platform 視角前，會先把全域
 *   status≠enabled 的幣別整批濾掉——若 code 是被 admin 端全域停用的幣別，即使曾經在本平台啟用過，
 *   呼叫 GetCurrencies 也完全看不到它；本工具的「讀現值」步驟找不到 code 時無法區分是「code 打錯」
 *   還是「該幣別已被 admin 端全域停用」，會如實回報「查無此 code」，不臆測原因。
 * - 目標狀態與現值相同時，本工具直接短路不呼叫後端（比照同目錄 update_game_vendor_status.ts 慣例，
 *   純粹省一次不必要的寫入 RPC）——2026-08-25 dev 實測過「同值呼叫後端」本身也會成功（errorCode=0，
 *   不像 CurrencyAdmin.UpdateCurrency 那支會回 nothingChanged），短路純粹是省一次 RPC，不是規避錯誤。
 * - 2026-08-25 dev 實測：對非預設幣別 disabled→enabled→disabled round-trip 成功、讀回驗證通過、
 *   復原無殘留；對平台當前 defaultCurrencyCode 嘗試 disabled 被拒絕（errorCode=7），未產生任何寫入
 *   （檢查層在 transaction 之前，dev 實測讀回確認狀態未變動）。
 * - **後端本身完全不驗證 code 是否為真實存在的幣別**（讀 currency_platform.ts:53-93 全文確認，非推論）：
 *   `platform_supported_currencies` 沒有外鍵約束（agrabah/migrations/core/202508291533_create_platform_supported_currencies.sql
 *   全文沒有 FOREIGN KEY），methodUpdateCurrencyStatus 也沒有對主表 `currencies` 做存在性檢查——一個
 *   ≤4 字元的假 code（如「ZZZZ」）後端會照單全收：insert 一筆孤兒列、更新成功、回 errorCode=0，還會
 *   發 ReloadCurrency。**真正擋住這種輸入的是本工具自己的「讀現值找不到即拒絕」pre-check**
 *   （見下方程式碼），不是後端保護，這是本工具存在的實質防線之一，不只是省一次查詢。
 *   >4 字元的 code 則會被 DB 直接拒絕（2026-08-25 dev 實測對 5 字元假 code 回 errorCode=12
 *   unknownDatabaseError，讀回確認未產生孤兒資料）：`platform_supported_currencies.currency_code`
 *   被改成 `CHAR(4)`（agrabah/migrations/core/202509031612_change_currency_code_type.sql:1）；
 *   主表 `currencies.code` 後續也被改成同樣的 `CHAR(4)`
 *   （agrabah/migrations/core/202602101600_change_currency_code_type.sql:1，比前一支改動晚），
 *   兩張表現在欄位寬度一致，不存在「未來新增 >4 字元 code 幣別會恆常失敗」的結構性不一致——
 *   >4 字元的幣別 code 在主表層級就無法被建立，errorCode=12 這條路徑經由本工具的正常呼叫流程
 *   （code 必須先出現在 GetCurrencies 清單，見 96-100 行）實際不可達，只有繞過本工具直呼 RPC 才會
 *   觸發，此段純記錄查證過程與 dev 實測結果。
 *
 * prod 執行前確認（比照本 server 既有寫入 tool 慣例）：正式環境需先取得使用者明確同意、帶上
 * confirm 參數。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { ErrorCode } from '/Users/user/aladdin/genie/src/common/index.ts';

import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { STATUS_MAP, STATUS_KEYS } from '../const.ts';

export function registerUpdateCurrencyStatusTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_currency_platform_update_currency_status',
        {
            title: "Update a currency's enable/disable status under the current platform",
            description:
                '把某個幣別代碼「在當前這個平台底下」的啟停狀態改成指定值（rajah: ' +
                'CurrencyPlatform.UpdateCurrencyStatus，需要權限節點 AdminManagement.Setting.Currency.Status.Toggle）。' +
                'code 從 aladdin_platform_currency_platform_get_currencies 取得（該工具回傳的 status 就是本平台視角，' +
                '兩者語意一致）。只改本平台的啟停狀態，不影響全域幣別資料本身，也不影響其他平台。' +
                '⚠️ code 若是該平台目前的 defaultCurrencyCode，且目標 status 不是 enabled，後端會直接拒絕' +
                '（不會寫入任何資料），本工具會識別這個特定錯誤並給出明確訊息，而非泛用錯誤格式——平台的預設' +
                '幣別不能被停用。' +
                '⚠️ 若某幣別已被 aladdin-admin 端全域停用，即使曾在本平台啟用過，本工具也會回報「查無此 code」' +
                '（該幣別完全不會出現在 GetCurrencies 的清單裡），無法區分是 code 打錯還是已被全域停用。' +
                'status 合法值（rajah StatusEnum）：unknown/enabled/disabled/frozen/deleted，一般啟用/停用只會用到 ' +
                'enabled/disabled，其餘值語意不在本工具範圍內描述。' +
                '目標狀態與現值相同時本工具會先讀現值短路、不呼叫後端 RPC。' +
                '寫入成功後本工具會重新讀回驗證。' +
                'prod 執行前確認：當這個 server 是正式環境（prod）時，執行本工具前必須先用 AskUserQuestion' +
                '（或功能相同的方式）明確詢問使用者是否要在正式環境執行這個操作，取得明確同意後才可以帶上 confirm 參數；' +
                '絕不能自行假設使用者同意。非 prod 環境不需要、也會忽略 confirm 欄位。',
            inputSchema: {
                code: z.string().min(1).describe('幣別代碼，來自 aladdin_platform_currency_platform_get_currencies 的回傳結果'),
                status: z.enum(STATUS_KEYS).describe('目標狀態：unknown/enabled/disabled/frozen/deleted，一般啟用/停用用 enabled/disabled'),
                confirm: z.string().optional().describe(
                    `正式環境（prod）專用的強制確認欄位；非 prod 環境會被忽略、不需提供。當這個 server 是正式環境時，` +
                    `必須先取得使用者明確同意，再帶上精確字串 "${ PROD_CONFIRM_TOKEN }" 才會執行，否則本工具會拒絕執行並回錯誤。`,
                ),
            },
        },
        async ({ code, status, confirm }) => {
            assertProdConfirmed(confirm);
            const targetStatus = STATUS_MAP[ status ];

            const listBefore = await withAutoRelogin(() => remote.coreBackOffice.currencyPlatform.GetCurrencies(false));
            if (listBefore.failed) return asErrorResult(listBefore);
            const before = listBefore.data?.currencies?.find((c) => c.code === code);
            if (!before) {
                return asTextResult({
                    success: false,
                    message: `查無 code="${ code }"——可能是 code 打錯，也可能是該幣別已被 aladdin-admin 端全域停用（本工具無法區分）`,
                    currencies: listBefore.data?.currencies,
                });
            }
            if (before.status === targetStatus) {
                return asTextResult({ success: true, message: '目標狀態與現值相同，未呼叫後端 RPC', readBack: before });
            }

            const r = await withAutoRelogin(() => remote.coreBackOffice.currencyPlatform.UpdateCurrencyStatus(code, targetStatus));
            if (r.failed) {
                // genie ErrorCode.requestNotValid（非 AgrabahErrorCodeEnum，asErrorResult 查不到名稱會顯示
                // 「未知錯誤碼」）：code 是本平台的 defaultCurrencyCode 且目標不是 enabled，後端在寫入前直接拒絕。
                if (r.errorCode === ErrorCode.requestNotValid) {
                    return asTextResult({
                        success: false,
                        message: `拒絕：code="${ code }" 是本平台目前的預設幣別（defaultCurrencyCode），目標狀態不是 enabled 時一律被拒絕（後端回 requestNotValid，未寫入任何資料）`,
                        before,
                    });
                }
                return asErrorResult(r);
            }

            const listAfter = await withAutoRelogin(() => remote.coreBackOffice.currencyPlatform.GetCurrencies(false));
            const after = !listAfter.failed ? listAfter.data?.currencies?.find((c) => c.code === code) : undefined;

            return asTextResult({
                success: true,
                message: after?.status === targetStatus ? '更新成功，讀回驗證相符' : '寫入 RPC 已成功，但讀回結果與預期不符，請人工確認',
                before,
                readBack: after ?? (!listAfter.failed ? { note: '讀回時找不到此 code，非預期', currencies: listAfter.data?.currencies } : null),
            });
        },
    );
}
