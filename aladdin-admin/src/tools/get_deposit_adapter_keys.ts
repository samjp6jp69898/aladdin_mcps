/**
 * tools/get_deposit_adapter_keys.ts — aladdin_admin_deposit_admin_get_adapter_keys
 *
 * rajah: DepositAdmin.GetAdapterKeys() (keys [string] 1)
 * （payment_back_office.rajah:2907，@Permission "PaymentDepositAdmin.Adapter.Ops.Keys"）
 *
 * agrabah 對應實作：src/servers/payment_back_office/services/deposit_admin.ts 的
 * methodGetAdapterKeys，真的有 override（不是落回 base class notImplemented）；讀原始碼
 * 確認底層是 getDepositAdapterKeys()（src/servers/payment/adapters/deposit/index.ts），
 * 回傳的是編譯期寫死在 adapters Map 裡的 adapter 識別字串（如 fake/gwallet/saas/...），
 * 完全不查 DB，屬於 method-category-checklist.md 第 2 節「完全不分頁的全撈」中
 * 「小型列舉表可放心用」的情況；回傳值本身是 adapter 代碼清單，不含任何金鑰/密碼等
 * 敏感內容（第 8 節不適用——這不是 GetMerchantSecret 這類真的回傳密鑰的 method，
 * 純粹是新增/選擇 adapter 時前端下拉選單的 options 來源）。
 *
 * dev 驗證：呼叫 aladdin_admin_deposit_admin_get_adapter_keys（無參數），確認回傳
 * success=true 且 keys 為非空字串陣列。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerGetDepositAdapterKeysTool(server: McpServer): void {
    server.registerTool(
        'aladdin_admin_deposit_admin_get_adapter_keys',
        {
            title: 'Get deposit adapter keys',
            description:
                '取得系統中所有已實作的充值（Deposit）adapter 代碼清單（rajah: DepositAdmin.GetAdapterKeys，' +
                'payment_back_office.rajah:2907）。這是編譯期決定的固定清單（後端 getDepositAdapterKeys() 讀的是' +
                '寫死在程式碼裡的 adapter 註冊表，不查 DB），數量不會隨業務資料成長，一次全撈是安全的。' +
                '用途：超管新增充值 adapter（見 aladdin_admin_deposit_admin_create_adapter 之類的寫入 tool，若已存在）' +
                '時，前端用這份清單當「adapter 代碼」欄位的下拉選單 options；回傳值不含任何金鑰/密碼/token，' +
                '只是 adapter 的識別字串（如 fake、gwallet、saas 等）。無參數。',
            inputSchema: {},
        },
        async () => {
            const r = await withAutoRelogin(() => remote.paymentBackOffice.depositAdmin.GetAdapterKeys());
            if (r.failed) return asErrorResult(r);
            return asTextResult({ success: true, keys: r.data?.keys ?? [] });
        },
    );
}
