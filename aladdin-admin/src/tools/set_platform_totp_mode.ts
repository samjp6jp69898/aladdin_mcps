/**
 * tools/set_platform_totp_mode.ts — aladdin_admin_time_based_otp_admin_set_mode
 *
 * rajah: TimeBasedOtpAdmin.SetMode（otp_code_back_office.rajah:124，
 * @Permission "PlatformManagementAdmin.Totp.Ops.Edit"）
 *
 * 2026-08-25 讀 agrabah 後端原始碼查證（time_based_otp_admin.ts:42-81）：真實實作，
 * 非 stub。platformId !== 0 時會先呼叫 core.main.GetPlatformDetailById 驗證平台存在，
 * 不存在會直接失敗、不寫入；platformId = 0 代表 admin 後台本身（全域），不驗證平台。
 * 寫入用 UPDATE ... 影響列數 0 才轉 INSERT（loadOrCreate 語意），完成後會 publish
 * TotpModeChanged 訊息通知其他 server 更新記憶體快取，屬正常非同步行為、不影響本次
 * 呼叫的回傳值。
 *
 * 沒有帶 platformId 的單筆查詢 method，寫入成功後改用不分頁的
 * aladdin_admin_time_based_otp_admin_list_platform_totp_modes 讀回驗證（比照
 * update_game_vendor_status.ts 的 round-trip 模式）。
 *
 * 2026-08-25 dev 站台實測：對 platformId=39（ZT01，非 MAIN/TEST 等常用測試平台）
 * 做 force→normal 完整 round-trip，讀回值正確且已還原成原值；另實測不存在的
 * platformId（999999）確認會直接失敗、不寫入。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { TOTP_MODE_MAP, TOTP_MODE_KEYS } from '../const.ts';

export function registerSetPlatformTotpModeTool(server: McpServer): void {
    server.registerTool(
        'aladdin_admin_time_based_otp_admin_set_mode',
        {
            title: 'Set a platform (or admin global) TOTP mode',
            description:
                '設定 admin 後台全域、或某個平台的 TOTP（雙因子驗證）模式（rajah: TimeBasedOtpAdmin.SetMode，' +
                '需要權限節點 PlatformManagementAdmin.Totp.Ops.Edit）。platformId=0 代表 admin 後台本身（全域）；' +
                '帶其他值代表指定平台，platformId 從 aladdin_admin_platform_management_list_platform_details 取得，' +
                '不存在的 platformId 會直接失敗、不寫入。' +
                '**重要影響**：切到 force 後，該範圍（admin 全域或指定平台）下「所有後台帳號」下次登入時都會被要求' +
                '綁定 TOTP，尚未安裝 Authenticator App 的使用者會被擋在登入流程外，直到完成綁定；從 force 切回 normal ' +
                '是安全性放寬，執行前務必確認這是操作者本人明確要做的變更，不要在不確定影響範圍時代為執行。' +
                '寫入後沒有帶 platformId 的單筆查詢 method 可驗證，改用不分頁的 ' +
                'aladdin_admin_time_based_otp_admin_list_platform_totp_modes 讀回全部列表比對 platformId 做 round-trip。' +
                'prod 執行前確認（H36 同構機制）：當這個 server 是正式環境（prod）時，執行本工具前必須先用 AskUserQuestion' +
                '（或功能相同的方式）明確詢問使用者是否要在正式環境執行這個操作，取得明確同意後才可以帶上 confirm 參數；' +
                '絕不能自行假設使用者同意。非 prod 環境（dev/pre/evi）不需要、也會忽略 confirm 欄位。',
            inputSchema: {
                platformId: z.number().int().describe('目標平台 id；0 代表 admin 後台本身（全域），其餘值代表指定平台，來自 aladdin_admin_platform_management_list_platform_details'),
                mode: z.enum(TOTP_MODE_KEYS).describe('目標模式：normal=一般（使用者可自行選擇是否綁定）、force=強制（該範圍下所有後台帳號登入時必須綁定 TOTP，見 description 重要影響說明）'),
                confirm: z.string().optional().describe(
                    `正式環境（prod）專用的強制確認欄位；非 prod 環境會被忽略、不需提供。當這個 server 是正式環境時，` +
                    `必須先取得使用者明確同意，再帶上精確字串 "${ PROD_CONFIRM_TOKEN }" 才會執行，否則本工具會拒絕執行並回錯誤。`,
                ),
            },
        },
        async ({ platformId, mode, confirm }) => {
            assertProdConfirmed(confirm);

            const r = await withAutoRelogin(() => remote.otpCodeBackOffice.timeBasedOtpAdmin.SetMode(platformId, TOTP_MODE_MAP[ mode ]));
            if (r.failed) return asErrorResult(r);

            const listResult = await withAutoRelogin(() => remote.otpCodeBackOffice.timeBasedOtpAdmin.ListPlatformTotpModes());
            const matched = !listResult.failed
                ? listResult.data?.rows?.find((row) => row.platformId === platformId)
                : undefined;

            return asTextResult({
                success: true,
                message: '更新成功',
                readBack: matched ?? (!listResult.failed ? { note: '讀回清單中沒找到這個 platformId，非預期，請人工確認', rows: listResult.data?.rows } : null),
            });
        },
    );
}
