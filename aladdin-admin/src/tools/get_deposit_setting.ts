/**
 * tools/get_deposit_setting.ts — aladdin_admin_deposit_admin_get_deposit_setting_for_edit
 *
 * rajah: DepositAdmin.GetDepositSettingForEdit() (setting DepositSettingEdit 1)
 * （payment_back_office.rajah:2937，@Permission "PaymentDepositAdmin.Setting"）
 *
 * agrabah 對應實作：src/servers/payment_back_office/services/deposit_admin.ts 的
 * methodGetDepositSettingForEdit（真的有 override），委派 DepositManager.getDepositSetting。
 * 分類：method-category-checklist.md 第 1 節「讀取單筆」，這是全域唯一一筆設定（無 id 參數），
 * `DepositSettingEdit`（payment_back_office.rajah:2264-2271）只有兩個 URL 欄位
 * （callbackBaseUrl / paymentAssetUrl），不含任何金鑰/密碼，第 8 節敏感資料規則不適用。
 * 與 `GetPlatformDepositSettingForEdit(platformId)` 的差異：本方法是全域設定，那支是特定平台的
 * 覆蓋設定，不要混淆。
 *
 * dev 驗證：呼叫（無參數），確認回傳結構與實際值。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerGetDepositSettingTool(server: McpServer): void {
    server.registerTool(
        'aladdin_admin_deposit_admin_get_deposit_setting_for_edit',
        {
            title: 'Get the global deposit setting',
            description:
                '取得全域充值（Deposit）設定，供編輯用（rajah: DepositAdmin.GetDepositSettingForEdit，' +
                'payment_back_office.rajah:2937）。無參數，這是全域唯一一筆設定，不分平台——若要查「某個平台的' +
                '充值設定覆蓋值」，那是不同的 method（GetPlatformDepositSettingForEdit，本 server 尚未包裝成 ' +
                'tool），不要混淆。回傳只有兩個 URL 欄位（callbackBaseUrl / paymentAssetUrl），不含任何金鑰/密碼。',
            inputSchema: {},
        },
        async () => {
            const r = await withAutoRelogin(() => remote.paymentBackOffice.depositAdmin.GetDepositSettingForEdit());
            if (r.failed) return asErrorResult(r);
            return asTextResult({ success: true, setting: r.data?.setting });
        },
    );
}
