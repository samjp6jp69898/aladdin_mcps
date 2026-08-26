/**
 * tools/get_deposit_adapter_for_edit.ts — aladdin_admin_deposit_admin_get_adapter_for_edit
 *
 * rajah: DepositAdmin.GetAdapterForEdit(id i32 1) (adapter DepositAdapterEdit 1)
 * （payment_back_office.rajah:2913，@Permission "PaymentDepositAdmin.Adapter.Ops.Edit"）
 *
 * agrabah 對應實作：src/servers/payment_back_office/services/deposit_admin.ts 的
 * methodGetAdapterForEdit（真的有 override），委派 vendorDepositManager.getAdapterById。
 * 分類：method-category-checklist.md 第 1 節「讀取單筆」，id 不存在時的行為已 dev 實測
 * （見下方）。回傳的 DepositAdapterEdit（payment_back_office.rajah:43-70）不含任何金鑰/
 * 密碼欄位，`parameterList` 只是該 adapter 需要哪些憑證欄位的名稱清單（非實際值），
 * 第 8 節敏感資料規則不適用。
 *
 * dev 驗證：對已知存在的 id（用 aladdin_admin_deposit_admin_list_adapters 查到的 id=1）
 * 呼叫成功；對不存在的 id（99999）呼叫，確認實際錯誤碼與行為，如實記錄在下方 description。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerGetDepositAdapterForEditTool(server: McpServer): void {
    server.registerTool(
        'aladdin_admin_deposit_admin_get_adapter_for_edit',
        {
            title: 'Get a deposit adapter for editing',
            description:
                '依內部 id 取得單一充值（Deposit）adapter 的編輯用完整資料（rajah: DepositAdmin.GetAdapterForEdit，' +
                'payment_back_office.rajah:2913）。id 來自 aladdin_admin_deposit_admin_list_adapters 回傳的 rows[].id。' +
                'id 不存在時 2026-08-26 dev 站台（https://admin.alddev.com）實測回傳 errorCode=606' +
                '（paymentAdapterInstanceNotExist，這支方法定義的業務錯誤碼，不是通用參數驗證錯誤），' +
                '不是拋例外或回傳空物件，呼叫端需檢查 success 欄位。回傳不含任何金鑰/密碼，`parameterList` 只是' +
                '該 adapter 需要哪些憑證欄位的名稱清單（非實際值）。',
            inputSchema: {
                id: z.number().int().describe('adapter 的內部 id，來自 aladdin_admin_deposit_admin_list_adapters'),
            },
        },
        async ({ id }) => {
            const r = await withAutoRelogin(() => remote.paymentBackOffice.depositAdmin.GetAdapterForEdit(id));
            if (r.failed) return asErrorResult(r);
            return asTextResult({ success: true, adapter: r.data?.adapter });
        },
    );
}
