/**
 * tools/create_or_update_role.ts — aladdin_platform_role_create_or_update_role
 *
 * rajah: Role.CreateOrUpdateRole(roleId i32 1, roleName string 2, permissionIds [i32] 3,
 * platformId i32 4)（rajah/services/role.rajah:69，service Role 定義於同檔 51 行，非 @NoPublic，
 * `@Permission "AdminManagement.Permission.Role.AddEdit"`——呼叫者本身要有這個權限節點才能新增/
 * 編輯角色）。對應後台「系統管理 > 權限管理 > 角色管理」頁面的「新增角色」（本工具主要用途）與
 * 「編輯角色權限」功能。
 *
 * 2026-09-01 讀 agrabah 後端原始碼查證：
 * - platformId 參數在 platform gate 完全被忽略——agrabah/src/common_services/role.ts:107-110
 *   （methodCreateOrUpdateRole）`if (context.platformId !== 0) { platformId = context.platformId; }`，
 *   platform 登入者的 context.platformId 恆不為 0（此 server 以來訪 host 判定平台），呼叫端傳什麼值
 *   都會被目前登入平台覆蓋，本工具固定傳 0，不對外暴露這個參數以免誤導。
 * - 回傳型別是 Empty（agrabah/src/generated/types.gen.ts:194，`RoleCreateOrUpdateRoleResponse =
 *   Empty`）——**新增時後端不回傳新 roleId**，本工具在建立前後各讀一次
 *   `aladdin_platform_role_get_platform_id_roles` 的清單，用「後讀到的清單裡多出來的 id」精確定位
 *   新建的那一筆（比對 id 集合差集，比同名工具 create_or_update_classification.ts 依賴 name 比對更
 *   精確，因為 roles.name 沒有唯一性約束）。
 * - agrabah/src/servers/core/services/role_internal.ts:218-326（methodCreateOrUpdateRole）確認
 *   create 分支（roleId===0）：`createRole()` 建立新角色，`parentId` 自動設為呼叫者自己的 roleId
 *   （階層式子角色設計，line 90 `role.parentId = (platformId === userRole.platformId ? userRole.id
 *   : 0)`），`isSuper=0`、`status=enabled`；create 分支的 `storedPermissionIds` 起始為空 Set，
 *   所以 create 時 permissionIds 是「全部視為新增」，不是 diff（diff 只發生在 update 分支，見下）。
 *   若呼叫者本身不是超管，`permissionsToAdd` 每一項必須存在於呼叫者自己擁有的權限集合中，否則整個
 *   transaction 回滾並回傳 `AgrabahErrorCodeEnum.permissionDenied`（line 287-295）——這是防止非超管
 *   帳號把自己都沒有的權限授予新角色的權限提升防護，不是本工具的限制。
 * - update 分支（roleId>0）：`roleName` 無條件覆蓋（line 248-260，強制更新 name 或 updated_at）；
 *   `permissionIds` 是**與現有 role_permissions 表做差異運算**（method-category-checklist.md 4.4
 *   節明確記載的陷阱：add = 傳入有但現有沒有；delete = 現有有但傳入沒有），呼叫端必須傳「完整目標
 *   權限集合」，不能只傳想新增的那幾個 id，否則現有沒被提到的權限會被當成「要求刪除」而被清空。
 *   為避免這個陷阱，本工具在 update 且呼叫端省略 permissionIds 時，會先呼叫
 *   `Role.GetRolePermissionsById(roleId)` 讀現有權限集合原樣代入（等同「不改權限」），呼叫端只有
 *   明確帶入 permissionIds 才會變更權限，且該值會被視為完整目標集合整批套用。roleName 省略時比照
 *   （讀現有 name 代入，等同「不改名稱」）。
 *
 * 分類：method-category-checklist.md 第 4 節「Upsert / CreateOrUpdate」，套用 4.4 節
 * `CreateOrUpdateRole` 專屬陷阱處理（見上）。完成後 round-trip：update 用原 roleId 讀回
 * name/status（GetPlatformIdRoles）+ permissionIds（GetRolePermissionsById）比對；create 用
 * 前後兩次 GetPlatformIdRoles 的 id 差集定位新角色，同樣讀回 permissionIds 比對。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { STATUS_MAP } from '../const.ts';

function describeStatus(value: number | null | undefined): string | number {
    if (value === null || value === undefined) return value as never;
    const hit = Object.entries(STATUS_MAP).find(([ , v ]) => v === value);
    return hit ? hit[ 0 ] : value;
}

function formatRole(role: { id?: number | null; name?: string | null; parentId?: number | null; status?: number | null }) {
    return {
        id: role.id,
        name: role.name,
        parentId: role.parentId,
        status: describeStatus(role.status),
    };
}

export function registerCreateOrUpdateRoleTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_role_create_or_update_role',
        {
            title: 'Create a new backoffice role (or update an existing one\'s name/permissions) on this platform',
            description:
                '新增或更新本平台後台角色（rajah: Role.CreateOrUpdateRole），對應「系統管理 > 權限管理 > ' +
                '角色管理」頁面的「新增角色」（本工具主要用途）；也支援編輯既有角色的名稱/權限。' +
                '呼叫者本身需要 "AdminManagement.Permission.Role.AddEdit" 權限節點。\n\n' +
                'roleId 省略或帶 0 走新增：新角色的 parentId 會自動設為目前登入者自己的 roleId（形成' +
                '階層式子角色），roleName 必填，permissionIds 省略等同空陣列（角色沒有任何選單/操作權限）。\n\n' +
                'roleId 帶既有值（來自 aladdin_platform_role_get_platform_id_roles）走更新：roleName 省略' +
                '會沿用現值；permissionIds 省略會沿用現有權限（不會被清空），若明確帶入則會被當成「完整' +
                '目標權限集合」整批套用（後端內部做差異運算：這次沒帶到的既有權限會被視為要求移除，不是' +
                '單純新增）——如果只想新增/移除少數幾個權限節點，務必先查現有權限（本工具的 update round-trip' +
                '會回傳現值，或用 aladdin_platform_role_get_platform_id_roles 系列另外查）再組出完整清單傳入，' +
                '不要只傳想新增的那幾個。\n\n' +
                'permissionIds 的合法值來自 aladdin_platform_role_get_permissions（不查就填等於亂猜）。非超管' +
                '帳號只能把自己已擁有的權限節點指派給新角色/子角色，指派自己沒有的權限會整包失敗並回 ' +
                'permissionDenied（不是本工具的限制，是後端的權限提升防護）。\n\n' +
                '新增時後端不會回傳新 roleId（RPC 回傳空結果），本工具會在建立前後各讀一次角色清單，用' +
                '「新出現的 id」精確定位剛建立的角色；極少數情況（同時有他人也在建立角色）可能無法唯一' +
                '定位，此時會如實列出全部候選，不會自行猜測是哪一筆。\n\n' +
                'prod 執行前確認：當這個 server 是正式環境（prod）時，執行本工具前必須先用 AskUserQuestion' +
                '（或功能相同的方式）明確詢問使用者是否要在正式環境執行，取得明確同意後才可以帶上 confirm 參數；' +
                '絕不能自行假設使用者同意。非 prod 環境不需要、也會忽略 confirm 欄位。',
            inputSchema: {
                roleId: z.number().int().optional().describe(
                    '既有角色 id（來自 aladdin_platform_role_get_platform_id_roles）；省略或 0 代表新增角色',
                ),
                roleName: z.string().max(20).optional().describe(
                    '角色名稱；新增時必填，更新時省略會沿用現值。DB 欄位 roles.name 是 VARCHAR(20)，超過 20 字元' +
                    '後端會回傳 errorCode=12（unknownDatabaseError，MySQL ER_DATA_TOO_LONG），本欄位已用 zod 在' +
                    'MCP 層擋下避免送出去才失敗；同一平台下 (platform_id, name) 有唯一約束，重複名稱同樣會失敗',
                ),
                permissionIds: z.array(z.number().int()).optional().describe(
                    '這個角色開啟的權限節點 id 清單，合法值來自 aladdin_platform_role_get_permissions。' +
                    '新增時省略等同空陣列（無任何權限）。更新時省略會沿用現有權限（不會被清空）；' +
                    '若明確帶入，會被視為「完整目標權限集合」整批套用（後端會刪除現有但這次沒帶到的權限），' +
                    '不是單純新增，只想加/減少數幾個時務必先查現有權限、組出完整清單再傳入',
                ),
                confirm: z.string().optional().describe(
                    `正式環境（prod）專用的強制確認欄位；非 prod 環境會被忽略、不需提供。當這個 server 是正式環境時，` +
                    `必須先取得使用者明確同意，再帶上精確字串 "${ PROD_CONFIRM_TOKEN }" 才會執行，否則本工具會拒絕執行並回錯誤。`,
                ),
            },
        },
        async ({ roleId, roleName, permissionIds, confirm }) => {
            assertProdConfirmed(confirm);
            const targetId = roleId ?? 0;
            const isUpdate = targetId > 0;

            const listBefore = await withAutoRelogin(() => remote.platform.role.GetPlatformIdRoles());
            if (listBefore.failed) return asErrorResult(listBefore);
            const rolesBefore = listBefore.data?.roles ?? [];

            let finalName = roleName;
            let finalPermissionIds = permissionIds;

            if (isUpdate) {
                const before = rolesBefore.find(role => role.id === targetId);
                if (!before) {
                    return asTextResult({
                        success: false,
                        message: `roleId=${ targetId } 不存在於本平台的角色清單，無法更新`,
                    });
                }
                if (finalName === undefined) finalName = before.name ?? undefined;
                if (finalPermissionIds === undefined) {
                    const permBefore = await withAutoRelogin(() => remote.platform.role.GetRolePermissionsById(targetId));
                    if (permBefore.failed) return asErrorResult(permBefore);
                    finalPermissionIds = (permBefore.data?.permissions ?? []).map(permission => permission.id).filter((id): id is number => id !== null && id !== undefined);
                }
            } else {
                if (roleName === undefined) {
                    return asTextResult({ success: false, message: '新增角色時 roleName 為必填' });
                }
                finalPermissionIds = finalPermissionIds ?? [];
            }

            const r = await withAutoRelogin(() => remote.platform.role.CreateOrUpdateRole(targetId, finalName as string, finalPermissionIds as number[], 0));
            if (r.failed) {
                return asErrorResult(r, {
                    hint: 'permissionDenied 常見原因：非超管帳號嘗試把自己沒有的權限節點指派給新角色/子角色' +
                        '（後端只允許指派呼叫者自己擁有的權限）；idNotExists 於更新時代表 roleId 不存在於本平台。',
                });
            }

            const listAfter = await withAutoRelogin(() => remote.platform.role.GetPlatformIdRoles());
            if (listAfter.failed) {
                return asTextResult({
                    success: true,
                    message: isUpdate ? '更新成功' : '建立成功',
                    warning: '讀回角色清單失敗，無法附上 round-trip 驗證結果',
                });
            }
            const rolesAfter = listAfter.data?.roles ?? [];

            if (isUpdate) {
                const after = rolesAfter.find(role => role.id === targetId);
                const permAfter = await withAutoRelogin(() => remote.platform.role.GetRolePermissionsById(targetId));
                return asTextResult({
                    success: true,
                    message: '更新成功',
                    readBack: {
                        role: after ? formatRole(after) : { note: '讀回清單中找不到這個 roleId，非預期，請人工確認' },
                        permissionIds: permAfter.failed
                            ? undefined
                            : (permAfter.data?.permissions ?? []).map(permission => permission.id),
                        permissionReadBackWarning: permAfter.failed ? '讀回權限清單失敗，無法驗證權限是否套用成功' : undefined,
                    },
                });
            }

            const beforeIds = new Set(rolesBefore.map(role => role.id));
            const newRoles = rolesAfter.filter(role => role.id !== null && role.id !== undefined && !beforeIds.has(role.id));

            if (newRoles.length === 1) {
                const created = newRoles[ 0 ];
                const permAfter = await withAutoRelogin(() => remote.platform.role.GetRolePermissionsById(created.id as number));
                return asTextResult({
                    success: true,
                    message: '建立成功',
                    role: formatRole(created),
                    permissionIds: permAfter.failed
                        ? undefined
                        : (permAfter.data?.permissions ?? []).map(permission => permission.id),
                    permissionReadBackWarning: permAfter.failed ? '讀回權限清單失敗，無法驗證權限是否套用成功' : undefined,
                });
            }

            const note = newRoles.length === 0
                ? '後端未回傳新 id，且前後兩次讀回角色清單之間沒有偵測到任何新增的 roleId，非預期，請人工確認'
                : `後端未回傳新 id，且前後兩次讀回角色清單之間偵測到 ${ newRoles.length } 筆新增角色` +
                    '（可能與其他人同時建立角色有關），請依 name 等欄位人工判斷哪一筆是剛建立的';
            return asTextResult({
                success: true,
                message: '建立成功',
                note,
                candidates: newRoles.map(formatRole),
            });
        },
    );
}
