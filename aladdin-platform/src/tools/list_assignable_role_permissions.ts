/**
 * tools/list_assignable_role_permissions.ts — aladdin_platform_role_get_permissions
 *
 * rajah: Role.GetPermissions() (permissions [Permission] 1)
 * （rajah/services/role.rajah:56，service Role 定義於同檔 51 行，非 @NoPublic，`@Permission` 已被
 * 註解掉——只要求 @LoginRequired，任何已登入的後台帳號皆可查詢，不受角色權限節點限制。）
 *
 * method-category-checklist.md 第 0 節排除規則已過：非 Placeholder、非 @NoPublic；agrabah 對應實作
 * agrabah/src/common_services/role.ts:95-105（methodGetPermissions）確認有真實實作，代理呼叫
 * `core.roleInternal.GetPermissions(context.gate)`——`context.gate` 由這個請求實際打中的 gate
 * 決定，本工具固定經由 aladdin-platform server 呼叫，恆為 'platform' gate，不需要、也無法由呼叫端
 * 指定。agrabah/src/servers/core/services/role_internal.ts:186-198（methodGetPermissions）確認底層
 * SQL 是 `SELECT DISTINCT p.id, p.name FROM routes r LEFT JOIN permissions p ON r.permission_id =
 * p.id WHERE r.gate = ? AND r.permission_id > 0 ORDER BY p.name`——回傳的是「這個 gate 下全部有掛
 * @Permission 節點的權限」，不分角色、不看呼叫者自己有沒有這個權限（跟 GetRoleAndPermissions 那種
 * 「某角色擁有的權限」不同，也跟 GetRolePermissionsById(roleId) 不同，三者不要混淆）。
 *
 * 分類：method-category-checklist.md 第 2 節「讀取清單」——無參數、不分頁全撈，語意上是靜態的
 * 權限節點列舉表（隨程式碼部署變動，不是會持續成長的營運資料表），可放心全撈。
 *
 * 這是 aladdin_platform_role_create_or_update_role 的 permissionIds 參數合法值來源——rajah 對
 * permissionIds 沒有標記 `@Type "Select:xxx"`，但功能上就是同等的「必須是後端既有清單裡的值」
 * 依賴：後端只接受這份清單裡真實存在的 permission id，傳入不存在的 id 不會報錯（INSERT 只是插入
 * 一筆不會被任何權限檢查用到的孤兒列），所以呼叫端必須先查這份清單再挑 id，不能憑空猜數字。
 *
 * 2026-09-01 dev 實測（pk-platform.alddev.com）：回傳 name 是英文點號階層字串（如
 * "GameVendor.InHouse.Vendor"、"BonusCenter.Activity.Config"），對應 rajah 各 service 裡
 * `@Permission "..."` 掛載的字串，不是後台顯示用的中文選單名稱——中文選單名稱只存在於 .rajah
 * 原始碼旁的註解與前端 i18n（`permission.*` 系列 key），本工具不做翻譯。若呼叫端只知道中文選單
 * 名稱（例如「優惠中心」），可依經驗判斷常見字首對應關係（例如「優惠中心／活動」多半對應
 * `BonusCenter.*`、「系統管理」對應 `AdminManagement.*`、「遊戲廠商」對應 `GameVendor.*`），或
 * 用回傳的 name 字串在後台介面/i18n 資源裡反查比對，本工具僅提供原始 id/name 清單，不做這層轉換。
 *
 * 純讀取查詢，不修改任何資料，可安全重複呼叫。回傳的權限節點字串是系統設計、非使用者個資，
 * 不需遮罩。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerListAssignableRolePermissionsTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_role_get_permissions',
        {
            title: 'List all permission nodes assignable to a role on this platform',
            description:
                '列出當前平台後台（platform gate）全部可被指派給角色的權限節點（rajah: Role.GetPermissions，' +
                '無 @Permission 限制，只要登入即可查詢）。無輸入參數，不分頁全撈。這是 ' +
                'aladdin_platform_role_create_or_update_role 的 permissionIds 參數合法值來源——那個欄位' +
                '雖然 rajah 沒有標記 Select 依賴，但功能上必須是這份清單裡真實存在的 id，不能憑空填數字。' +
                '回傳的 name 是英文點號階層字串（如 "GameVendor.InHouse.Vendor"、"BonusCenter.Activity.Config"），' +
                '對應後台選單/子選單/操作的權限節點，不是中文選單名稱——本工具不做中文翻譯，若使用者用中文選單名稱' +
                '（例如「優惠中心」）描述需求，需自行依字首經驗判斷（優惠中心/活動類多半對應 BonusCenter.*）或另外' +
                '查證對應關係，不要在不確定時憑印象猜一個 id。純讀取查詢，可安全重複呼叫。',
            inputSchema: {},
        },
        async () => {
            const r = await withAutoRelogin(() => remote.platform.role.GetPermissions());
            if (r.failed) return asErrorResult(r);

            return asTextResult({
                success: true,
                permissions: (r.data?.permissions ?? []).map(permission => ({
                    id: permission.id,
                    name: permission.name,
                })),
            });
        },
    );
}
