/**
 * tools/update_totp_route_setting_status.ts — aladdin_admin_time_based_otp_update_route_setting_status
 *
 * rajah: TimeBasedOtp.UpdateRouteSettingStatus（otp_code_back_office.rajah:80）——
 * 這支 method 目前完全沒有掛 `@Permission`（連註解狀態都沒有；歷史上曾生效過
 * `AdminManagement.Setting.Totp`，2026-07-14 commit 33b6e2dd 移除，完整沿革見
 * list_totp_route_settings.ts 檔頭；agrabah 後端 doc comment 稱「被註解」是過時
 * 敘述）。2026-08-25 讀 agrabah 後端原始碼查證（time_based_otp.ts:160-186）確認
 * 目前無權限節點攔截。
 *
 * 只改 status（是否啟用 TOTP 驗證），不動 validMinutes；路由尚未有設定記錄時會以
 * loadOrCreate 模式先建立一筆（validMinutes 預設 0）。範圍同 list_totp_route_settings.ts：
 * 只影響 admin gate 自己的設定。
 *
 * 寫入後 publish TotpRouteChanged 訊息通知 Gate 更新記憶體快取（背景執行，不影響
 * 本次呼叫的回傳值）。
 *
 * 2026-08-25 dev 站台實測：對 routeId=3647（原值 disabled）做 enabled→disabled 完整
 * round-trip，讀回值正確且已還原成原值。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { STATUS_MAP, STATUS_KEYS } from '../const.ts';

export function registerUpdateTotpRouteSettingStatusTool(server: McpServer): void {
    server.registerTool(
        'aladdin_admin_time_based_otp_update_route_setting_status',
        {
            title: 'Enable/disable TOTP re-verification on a route (admin gate)',
            description:
                '啟用或停用 admin 後台某個路由的 TOTP 二次驗證需求（rajah: TimeBasedOtp.UpdateRouteSettingStatus；' +
                '目前無 @Permission 攔截，任何登入 admin 後台的帳號皆可呼叫）。status 合法值沿用 rajah StatusEnum ' +
                '（unknown/enabled/disabled/frozen/deleted），但此欄位只有 enabled/disabled 兩種有實際業務意義：' +
                'enabled=此路由的呼叫需先通過 TOTP 驗證，disabled=不需要（預設值）。停用會降低安全性，執行前確認' +
                '這是操作者本人明確要的變更；帶其他列舉值（frozen/deleted/unknown）雖然後端會接受寫入，但對此欄位' +
                '沒有已知業務意義，不建議使用。只改 status，不影響 validMinutes（那是 ' +
                'aladdin_admin_time_based_otp_update_route_setting 的範圍）。' +
                'routeId 從 aladdin_admin_time_based_otp_list_route_settings 取得。' +
                '寫入後自動呼叫 aladdin_admin_time_based_otp_list_route_settings 讀回驗證。' +
                'prod 執行前確認（H36 同構機制）：當這個 server 是正式環境（prod）時，執行本工具前必須先用 AskUserQuestion' +
                '（或功能相同的方式）明確詢問使用者是否要在正式環境執行這個操作，取得明確同意後才可以帶上 confirm 參數；' +
                '絕不能自行假設使用者同意。非 prod 環境（dev/pre/evi）不需要、也會忽略 confirm 欄位。',
            inputSchema: {
                routeId: z.number().int().describe('路由 id，來自 aladdin_admin_time_based_otp_list_route_settings 的回傳結果'),
                status: z.enum(STATUS_KEYS).describe('目標狀態；此欄位只有 enabled/disabled 有實際業務意義，見 description'),
                confirm: z.string().optional().describe(
                    `正式環境（prod）專用的強制確認欄位；非 prod 環境會被忽略、不需提供。當這個 server 是正式環境時，` +
                    `必須先取得使用者明確同意，再帶上精確字串 "${ PROD_CONFIRM_TOKEN }" 才會執行，否則本工具會拒絕執行並回錯誤。`,
                ),
            },
        },
        async ({ routeId, status, confirm }) => {
            assertProdConfirmed(confirm);
            const r = await withAutoRelogin(() => remote.otpCodeBackOffice.timeBasedOtp.UpdateRouteSettingStatus(routeId, STATUS_MAP[ status ]));
            if (r.failed) return asErrorResult(r);

            const listResult = await withAutoRelogin(() => remote.otpCodeBackOffice.timeBasedOtp.ListRouteSettings());
            const matched = !listResult.failed
                ? listResult.data?.rows?.find((row) => row.routeId === routeId)
                : undefined;

            return asTextResult({
                success: true,
                message: '更新成功',
                readBack: matched ?? (!listResult.failed ? { note: '讀回清單中沒找到這個 routeId，非預期，請人工確認', rows: listResult.data?.rows } : null),
            });
        },
    );
}
