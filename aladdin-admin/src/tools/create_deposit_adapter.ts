/**
 * tools/create_deposit_adapter.ts — aladdin_admin_deposit_admin_create_adapter
 *
 * rajah: DepositAdmin.CreateAdapter(@Validate adapter DepositAdapterEdit 1) (id i32 1)
 * （payment_back_office.rajah:2916，@Permission "PaymentDepositAdmin.Adapter.Add"）
 *
 * agrabah 對應實作：src/servers/payment_back_office/services/deposit_admin.ts 的
 * methodCreateAdapter（真的有 override）。讀原始碼確認：
 * - status 一律被後端強制設為 enabled（`dbDepositAdapter.status = StatusEnum.enabled`），
 *   呼叫端無法建立時就設成停用；但新建的 adapter 預設不會被任何 platform 綁定/啟用
 *   （見 payment_back_office.rajah 的 ListPlatformDepositAdapters/UpdatePlatformDepositAdapterStatus），
 *   建立後不會立刻影響任何真實金流，比照 aladdin_admin_create_game_vendor「建立後預設不出現在任何
 *   platform 清單」的既有先例。
 * - `DepositAdapterEdit` 不含任何金鑰/密碼欄位（`parameterList` 只是宣告該 adapter 需要哪些
 *   憑證欄位名稱，數值語意見 rajah payment.rajah 的 `PaymentAdapterFieldEnum`：hashKey=1/
 *   publicKey=2/privateKey=4），本方法不寫入/不接受任何實際密鑰值，第 8 節敏感資料規則不適用。
 * - 沒有 adapterKey 重複檢查（同一 adapterKey 可以建立多個實例，用 name 區分），不需要先查重。
 * - **已知資料陷阱（2026-08-26 dev 實測踩到，非推測）**：`name` 欄位 DB schema 是 `VARCHAR(30)`
 *   （migrations/payment/202411281816_create_deposit_tables.sql），但 rajah `@Rules` 只標
 *   `Required`、沒有 `MaxLength`；實測帶入 34 字元的 name 時，後端不是回傳明確的「欄位過長」
 *   業務錯誤，而是通用的 errorCode=12（unknownDatabaseError）——本工具已在 zod schema 加上
 *   `max(30)` 提前擋下，避免呼叫端收到語意不明的通用錯誤碼。
 * - **已知資料陷阱（2026-08-26 dev 實測踩到，非推測）**：`specialRequestCurrency` 欄位在 rajah 標
 *   `@NoEdit`（abu 前端表單不顯示輸入框），但後端 `#specialRequestCurrencyHandle` 私有方法真的會讀
 *   這個欄位——@NoEdit 只是「前端不渲染輸入框」的顯示控制，不代表 API 層忽略此欄位（method-category-
 *   checklist.md 第 4 節同類陷阱的另一實例）。實測不帶 specialRequestCurrency（預設 false）且不帶
 *   requestCurrencyCode 時，後端直接回 errorCode=682（paymentSpecialRequestCurrencyRequired），必須
 *   明確帶入合法的 requestCurrencyCode 才能建立成功。
 * - 沒有對應的 Delete 方法，只有 EnableAdapter 可切換 enabled/disabled——本 server 已包裝成
 *   aladdin_admin_deposit_admin_enable_adapter（update_deposit_adapter_status.ts）；dev 驗證後
 *   應呼叫該 tool 停用剛建立的測試記錄，比照 create_game_vendor.ts 的「建議測試前綴 ZZZ_TEST_」
 *   慣例，方便事後辨識與人工清理殘留測試資料。
 *
 * dev 驗證：以 adapterKey=fake、name 帶 ZZZ_TEST_ 前綴建立一筆，round-trip 用回傳 id 呼叫
 * GetAdapterForEdit 讀回確認欄位一致，再呼叫 EnableAdapter(id, disabled) 停用清理。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { DepositAdapterEdit } from '/Users/user/aladdin/abu/admin/src/generated/types.gen.js';
import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { PAYMENT_ADAPTER_FIELD_MAP } from '../const.ts';

export function registerCreateDepositAdapterTool(server: McpServer): void {
    server.registerTool(
        'aladdin_admin_deposit_admin_create_adapter',
        {
            title: 'Create a deposit adapter instance',
            description:
                '在 agrabah admin 後台新增一筆充值（Deposit）adapter 實例（rajah: DepositAdmin.CreateAdapter，' +
                'payment_back_office.rajah:2916）。adapterKey 必須是 aladdin_admin_deposit_admin_get_adapter_keys ' +
                '回傳清單中的值，同一個 adapterKey 可以建立多個實例（用 name 區分，不會重複檢查）。' +
                '後端會強制把新建的 adapter 狀態設成 enabled，但預設不會被任何 platform 綁定/啟用，建立後不會立刻' +
                '影響任何真實金流（比照 aladdin_admin_game_vendor_admin_create_or_update_game_vendor 的既有先例）。' +
                '本方法不接受、也不會寫入任何實際密鑰值——`parameterList` 只是宣告這個 adapter 需要哪些憑證欄位' +
                '（hashKey/publicKey/privateKey），不是欄位的值本身。' +
                '**沒有對應的刪除方法**，只能之後呼叫 aladdin_admin_deposit_admin_enable_adapter 停用，' +
                '建議 name 加測試前綴如 ZZZ_TEST_ 方便事後人工辨識/清理殘留測試資料。' +
                'prod 執行前確認（H36）：當這個 server 是正式環境（prod）時，執行本工具前必須先用 AskUserQuestion' +
                '（或功能相同的方式）明確詢問使用者是否要在正式環境執行這個操作，取得明確同意後才可以帶上 confirm 參數；' +
                '絕不能自行假設使用者同意。非 prod 環境（dev/pre/evi）不需要、也會忽略 confirm 欄位。',
            inputSchema: {
                name: z.string().min(1).max(30).describe(
                    'adapter 顯示名稱，DB 欄位限制 30 字元（rajah 未標示此限制，超長會回通用 errorCode=12）；' +
                    '建議加測試前綴如 ZZZ_TEST_ 方便事後辨識/清理',
                ),
                adapterKey: z.string().describe('必須是 aladdin_admin_deposit_admin_get_adapter_keys 回傳清單中的值'),
                baseUrl: z.string().optional().describe('廠商 API base URL'),
                callbackBaseUrl: z.string().optional().describe('回調 base URL'),
                parameterList: z.array(z.enum([ 'hashKey', 'publicKey', 'privateKey' ])).optional().describe(
                    '這個 adapter 實例需要哪些憑證欄位（僅宣告欄位名稱，不是實際密鑰值）',
                ),
                specialRequestCurrency: z.boolean().optional().describe(
                    '是否使用「特殊請求幣別」模式。rajah 欄位標 @NoEdit（前端表單不顯示輸入框），但後端 API 實際會讀取此值，' +
                    '不是純顯示欄位。留空＝false，此時 requestCurrencyCode 為必填（否則後端回 errorCode=682 ' +
                    'paymentSpecialRequestCurrencyRequired，2026-08-26 dev 站台實測過）；設為 true 時後端會忽略/清空 requestCurrencyCode。',
                ),
                requestCurrencyCode: z.string().optional().describe(
                    '請求幣別代碼（例如 CNY），須為平台既有幣別（可用 aladdin_admin_get_currencies 查合法值）。' +
                    'specialRequestCurrency 未設為 true 時為必填，留空會被後端拒絕。',
                ),
                confirm: z.string().optional().describe(
                    `正式環境（prod）專用的強制確認欄位；非 prod 環境會被忽略、不需提供。當這個 server 是正式環境時，` +
                    `必須先取得使用者明確同意，再帶上精確字串 "${ PROD_CONFIRM_TOKEN }" 才會執行，否則本工具會拒絕執行並回錯誤。`,
                ),
            },
        },
        async ({ name, adapterKey, baseUrl, callbackBaseUrl, parameterList, specialRequestCurrency, requestCurrencyCode, confirm }) => {
            assertProdConfirmed(confirm);

            const adapter = DepositAdapterEdit.create({
                name,
                adapterKey,
                baseUrl: baseUrl ?? '',
                callbackBaseUrl: callbackBaseUrl ?? '',
                parameterList: (parameterList ?? []).map(f => PAYMENT_ADAPTER_FIELD_MAP[ f ]),
                specialRequestCurrency: specialRequestCurrency ?? false,
                requestCurrencyCode: requestCurrencyCode ?? '',
            });
            const r = await withAutoRelogin(() => remote.paymentBackOffice.depositAdmin.CreateAdapter(adapter));
            if (r.failed) return asErrorResult(r);

            const id = r.data?.id;
            const readBack = id != null
                ? await withAutoRelogin(() => remote.paymentBackOffice.depositAdmin.GetAdapterForEdit(id))
                : null;

            return asTextResult({
                success: true,
                id,
                message: '建立成功；沒有對應的刪除方法，測試後請呼叫 aladdin_admin_deposit_admin_enable_adapter(id, disabled) 停用清理',
                readBack: readBack && !readBack.failed ? readBack.data?.adapter : null,
            });
        },
    );
}
