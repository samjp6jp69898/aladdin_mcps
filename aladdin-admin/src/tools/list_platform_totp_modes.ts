/**
 * tools/list_platform_totp_modes.ts — aladdin_admin_time_based_otp_admin_list_platform_totp_modes
 *
 * rajah: TimeBasedOtpAdmin.ListPlatformTotpModes（otp_code_back_office.rajah:128，
 * @Permission "PlatformManagementAdmin.Totp"）
 *
 * 2026-08-25 讀 agrabah 後端原始碼查證（time_based_otp_admin.ts:96-127）：真實實作，
 * 非 stub。先讀 DB totp_modes 表，再合併 core.main.GetPlatforms() 取得的全部平台，
 * 尚未設定過模式的平台一律視為 normal（後端預設值，不是遺漏）。回傳陣列第一筆固定是
 * platformId=0、platformCode=''，代表 admin 後台本身（非個別平台）的全域 TOTP 模式。
 *
 * 2026-08-25 dev 站台實測（admin.alddev.com）：登入後實打，回傳 16 筆（1 個全域 +
 * 15 個平台），全部 mode=0（normal），符合尚未手動設定過的預期。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerListPlatformTotpModesTool(server: McpServer): void {
    server.registerTool(
        'aladdin_admin_time_based_otp_admin_list_platform_totp_modes',
        {
            title: 'List each platform current TOTP mode',
            description:
                '列出 admin 後台全域與每個平台目前的 TOTP（雙因子驗證）模式（rajah: ' +
                'TimeBasedOtpAdmin.ListPlatformTotpModes，需要權限節點 PlatformManagementAdmin.Totp）。' +
                '回傳陣列第一筆固定是 platformId=0、platformCode=""，代表 admin 後台自己（全域）的模式，' +
                '其餘每一筆對應一個平台。mode 是 TotpModeEnum 數值：normal=0（一般，使用者可自行選擇是否綁定）、' +
                'force=1（強制，該範圍下所有後台帳號登入時必須綁定 TOTP）。尚未手動設定過的平台一律回傳 normal，' +
                '這是後端預設值、不代表資料缺漏。搭配 aladdin_admin_time_based_otp_admin_set_mode 組成讀寫配對。',
            inputSchema: {},
        },
        async () => {
            const r = await withAutoRelogin(() => remote.otpCodeBackOffice.timeBasedOtpAdmin.ListPlatformTotpModes());
            if (r.failed) return asErrorResult(r);
            return asTextResult({ success: true, rows: r.data?.rows ?? [] });
        },
    );
}
