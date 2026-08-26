/**
 * tools/get_platform_id_roles.ts — aladdin_platform_role_get_platform_id_roles
 *
 * rajah: Role.GetPlatformIdRoles() (roles [Role] 1)
 * （rajah/services/role.rajah:74-75，service Role 定義於同檔 51 行，非 @NoPublic，本方法無
 * @Permission、無任何輸入參數。原始碼旁註解：「## platformId 下所有」。）
 *
 * ⚠️ 命名陷阱：role.rajah 同時有 `Role.GetPlatformIdRoles()`（本工具，公開，platform/admin/agent
 * 等 gate 皆各自掛載，本工具走 platform gate）與 `RoleInternal.GetPlatformIdRoles()`（role.rajah:113，
 * @NoPublic 內部 RPC，只給 server-to-server 呼叫，agent 打不到）——兩支同名不同 service，本工具是
 * 前者。2026-08-26 實測發現另一支同檔的 `Role.GetChildRoles()`（無參數版本，role.rajah:53）在
 * platform gate 打 errorCode=2 method not implemented（base class 未 override）；`GetPlatformIdRoles`
 * 則是真的有實作，兩者容易被誤判成同一種「查角色」入口，實測結果不同，不可假設同名/同語意方法
 * 行為一致。
 *
 * method-category-checklist.md 第 0 節排除規則已過：非 Placeholder、非 @NoPublic；agrabah 對應實作
 * agrabah/src/common_services/role.ts:172-175（methodGetPlatformIdRoles，RoleService 掛載於
 * agrabah/src/servers/platform/index.ts:29）確認有真實實作，代理呼叫
 * `core.roleInternal.GetPlatformIdRoles()`（@NoPublic 內部 RPC，由本方法對外開放）。
 *
 * 分類：method-category-checklist.md 第 2 節「讀取清單」——無參數、不分頁全撈，回傳當前
 * `context.platformId` 底下 `gate=platform` 的**全部**角色（含已停用者，未過濾 status）。
 * 這是 aladdin_platform_platform_new_user 的 roleId 合法值來源——`Platform.NewUser` 的 roleId
 * 帶隱含的 `@Type "Select:Role"` 語意（後端用 ensureChildRole 驗證是登入者的子角色），本工具讓呼叫端
 * 能先查到候選 roleId 清單與其 parentId 階層，而不是盲填數字。
 *
 * 2026-08-26 dev 實測（pk-platform.alddev.com）：回傳 32 筆真實角色資料，含 Super（id=5，isSuper=true）
 * 與多筆一般角色，parentId 呈現階層關係（如 id=1100 的 parentId=1098）。
 *
 * 純讀取查詢，不修改任何資料，可安全重複呼叫。無密鑰/PII 欄位（角色名稱為後台內部管理用途，非會員個資），
 * 不需遮罩。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { STATUS_MAP } from '../const.ts';

function describeStatus(value: number | null | undefined): string | number {
    if (value === null || value === undefined) return value as never;
    const hit = Object.entries(STATUS_MAP).find(([ , v ]) => v === value);
    return hit ? hit[ 0 ] : value;
}

export function registerGetPlatformIdRolesTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_role_get_platform_id_roles',
        {
            title: 'List all roles under the current platform',
            description:
                '列出當前平台（依登入 token 綁定的 platformId）底下的全部後台角色（rajah: Role.GetPlatformIdRoles，' +
                '無 @Permission，只要登入後台即可查詢）。無輸入參數，不分頁全撈，含已停用角色（未過濾 status）。' +
                '這是 aladdin_platform_platform_new_user 建立新管理員帳號時 roleId 參數的合法值來源——後端會' +
                '驗證 roleId 必須是登入者角色的子角色（依 parentId 階層），本工具回傳完整角色清單與 parentId，' +
                '呼叫端應依此判斷可用的子角色範圍，不要盲填數字。⚠️ 同名陷阱：不要跟同檔另一支無參數的 ' +
                'Role.GetChildRoles() 混淆，那支在 platform gate 是未實作的 stub（errorCode=2），本工具是' +
                '真正有實作的方法。純讀取查詢，可安全重複呼叫。',
            inputSchema: {},
        },
        async () => {
            const r = await withAutoRelogin(() => remote.platform.role.GetPlatformIdRoles());
            if (r.failed) return asErrorResult(r);

            return asTextResult({
                success: true,
                roles: (r.data?.roles ?? []).map(role => ({
                    id: role.id,
                    name: role.name,
                    isSuper: role.isSuper,
                    status: describeStatus(role.status as number),
                    parentId: role.parentId,
                })),
            });
        },
    );
}
