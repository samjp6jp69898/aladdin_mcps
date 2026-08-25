/**
 * tools/list_totp_route_settings.ts — aladdin_admin_time_based_otp_list_route_settings
 *
 * rajah: TimeBasedOtp.ListRouteSettings（otp_code_back_office.rajah:74）——
 * 這支 method 目前完全沒有掛 `@Permission`（連註解狀態都沒有）。2026-08-25 查
 * git 歷史（rajah repo）：早期曾是 `# @Permission "Totp.Route"`（註解狀態），
 * 之後 commit 4dee743d 改成生效的 `@Permission "AdminManagement.Setting.Totp"`，
 * 2026-07-14 commit 33b6e2dd（「admin權限樹，移除系統配置下的TOTP」）把整個
 * `@Permission` 移除——agrabah 後端 doc comment（time_based_otp.ts:82，寫著
 * 「rajah 中 @Permission "Totp.Route" 被註解」）是過時敘述，未同步更新，本檔
 * 以 rajah 原始碼現況為準：目前任何登入 admin 後台的帳號皆可呼叫，無權限攔截。
 *
 * TimeBasedOtp 同時被 abu/admin 與 abu/platform 的 project.json 引入（雙模組共用
 * service），但實際回傳內容依呼叫端登入的 gate 而定：從 aladdin-admin 呼叫時
 * context.gateId 固定是 admin、context.platformId 固定是 0（admin 角色沒有平台
 * scope，AdminGate 結構上不載入 domains 表，見 aladdin-admin/README.md「已知限制」），
 * 回傳的是 admin 後台自己的路由 TOTP 設定，不是任何平台的。平台各自的路由 TOTP
 * 設定屬於 aladdin-platform 的範圍，不在本工具涵蓋。
 *
 * 真實實作（非 stub）：先呼叫 core.main.GetRoutes(gateId) 取得全部路由並篩出
 * route.isTotp 的路由，再用 DB 既有設定（若有）覆蓋 validMinutes/status，尚未
 * 設定過的路由回傳預設值 validMinutes=0、status=disabled（純記憶體合併預設值，
 * 這支 List 本身不寫入 DB；不代表資料缺漏）。回傳筆數等於系統中標記為 isTotp 的路由總數，屬小型列舉規模
 * （後端路由清單），不套用第 2 節 B 級分頁掃描規則。
 *
 * 2026-08-25 dev 站台實測：回傳 4 筆（InHouseGameRecords 的 4 支結算相關 route），
 * 均為預設值 validMinutes=0、status=disabled。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerListTotpRouteSettingsTool(server: McpServer): void {
    server.registerTool(
        'aladdin_admin_time_based_otp_list_route_settings',
        {
            title: 'List admin-gate TOTP route settings',
            description:
                '列出 admin 後台目前所有「可設定 TOTP 二次驗證」的路由與其當前設定（rajah: ' +
                'TimeBasedOtp.ListRouteSettings；目前無 @Permission 攔截，任何登入 admin 後台的帳號皆可呼叫）。' +
                '只回傳 admin gate 自己的路由設定，不涉及任何平台（TimeBasedOtp 雖同時服務 admin/platform 兩端，' +
                '但範圍由呼叫端登入的 gate 決定，見檔頭註解）。' +
                'validMinutes：驗證通過後幾分鐘內免再次輸入 TOTP，0 代表每次呼叫該路由都需要驗證。' +
                'status 是 rajah StatusEnum 數值：enabled=1（此路由納入 TOTP 驗證流程）、disabled=2（不需要驗證，' +
                '預設值），其餘列舉值在此欄位無業務意義。尚未手動設定過的路由一律回傳 validMinutes=0、status=disabled，' +
                '這是後端預設值、不代表資料缺漏。搭配 aladdin_admin_time_based_otp_update_route_setting（改 ' +
                'validMinutes）與 aladdin_admin_time_based_otp_update_route_setting_status（改 status）組成讀寫配對，' +
                '兩支寫入 tool 都需要這裡回傳的 routeId。',
            inputSchema: {},
        },
        async () => {
            const r = await withAutoRelogin(() => remote.otpCodeBackOffice.timeBasedOtp.ListRouteSettings());
            if (r.failed) return asErrorResult(r);
            return asTextResult({ success: true, rows: r.data?.rows ?? [] });
        },
    );
}
