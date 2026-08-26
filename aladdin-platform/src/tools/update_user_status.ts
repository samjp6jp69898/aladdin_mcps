/**
 * tools/update_user_status.ts — aladdin_platform_platform_update_user_status
 *
 * rajah: Platform.UpdateUserStatus(id i32 1, status StatusEnum 2)
 * （rajah/services/platform.rajah:89-90，@Permission "AdminManagement.Permission.Users.Status.Toggle"）。
 *
 * 改的是「platform 後台管理員帳號」（後台登入帳號，非 app 一般會員）的狀態，跟
 * aladdin_platform_platform_list_users 是同一批資料。
 *
 * method-category-checklist.md 第 0 節排除規則已過：非 Placeholder、非 @NoPublic；agrabah 對應實作
 * agrabah/src/servers/platform/services/platform.ts:300-323（methodUpdateUserStatus）確認有真實
 * 實作，非 base class 的 notImplemented。
 *
 * 分類：method-category-checklist.md 第 6 節「狀態轉換」——輸入帶明確目標狀態（`status`），是
 * 「設定為指定狀態」而非無參數 bit-flip，工具不做「先查現況再反轉」的自作聰明。
 *
 * 2026-08-26 讀 agrabah 後端原始碼查證（platform.ts:300-323）：
 * - **不可對自己操作**：`context.userId === id` 時直接回 `canNotDisableSelf`，不論目標狀態是什麼
 *   （不只是 disable，改成任何狀態都會被擋，AgrabahErrorCodeEnum 名稱字面意義是「不能停用自己」
 *   但程式碼實際判斷式沒有限定 status===disabled，本工具 description 如實描述為「不可對自己操作」）。
 * - **子角色範圍限制**：target 帳號存在時，用 `ensureChildRole(context.roleId, 該帳號的 roleId)` 確認
 *   目標帳號的角色是登入者角色的子角色，非子角色範圍內的帳號一律拒絕（同 ListUsers 的可見範圍限制，
 *   是後端依登入身分自動套用的邊界，工具無法繞過）。
 * - ⚠️ **id 不存在時實際上不是 objectNotFound，是後端真實 bug**：`loadObject()`（agrabah 引擎層，
 *   `mysql_relational_database_engine.ts:271-296`）查無資料時回傳的是 `ServiceResult.fromData(null)`
 *   （success=true，非 failed），不是失敗結果。`methodUpdateUserStatus` 只判斷 `getUserResult.failed`，
 *   id 不存在時這個判斷是 false，會繼續執行 `ensureChildRole(context.roleId, getUserResult.data.roleId)`，
 *   對 `null.roleId` 解參照拋例外，被框架接住後回傳泛用的 `unknown`（errorCode=1，2026-08-26 dev 實測
 *   對不存在的 id 呼叫確認過），**不是**原本預期的 `objectNotFound`（errorCode=14）。本工具無法修正
 *   後端這個既有 bug，description 已如實揭露 errorCode=1 才是「id 不存在」的實際訊號，避免呼叫端
 *   誤判成其他未知錯誤而困惑。
 * - **底層 `updateStatus()`**（common/database_helper.ts:25-49）：`UPDATE users SET status=? WHERE id=?
 *   AND platform_id=?`（帶 platform 範圍限定，跟上面 `loadObject` 用的 `id=?`——不帶 platform 限定——不同），
 *   非法列舉值先被擋下回 `invalidData`（errorCode=9）；`affectedRows===0` 回 `objectNotFound`（errorCode=14）。
 *   因為前置的 `loadObject`/`ensureChildRole` 沒有 platform 範圍檢查，這條路徑實際只會在「id 存在、
 *   通過子角色檢查，但這個 id 屬於別的 platform（`platform_id` 不符）」時才會真正走到，不是「id 完全
 *   不存在」的情境（那個情境是上面的 errorCode=1）。這條路徑 2026-08-26 未實測（需要另一平台的合法
 *   id 才能觸發，如實記錄為未實測而非斷言）。
 * - **沒有直接查詢單筆帳號現值的方法**：`Platform.ListUsers` 不支援用 id 篩選（只有 account 模糊比對 +
 *   statuses 篩選 + 分頁），無法用它高效率地在寫入前後核對「這個 id」的現值——本工具因此不做
 *   「先讀現值、同值短路」的優化，直接呼叫寫入，description 已如實揭露此限制，呼叫端若要核對變更
 *   結果，需另外用 `aladdin_platform_platform_list_users` 的 account 篩選自行查找（若知道對應帳號）。
 * - 成功後對 `status=disabled` 會額外觸發 `kickUser`（背景踢除該帳號所有現有登入 session，非同步
 *   `.then()`，RPC 回應不等待完成）。
 *
 * 純狀態轉換寫入，非批量、單筆明確目標狀態，無多語系/陣列欄位需要合併保留的疑慮。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { STATUS_MAP, STATUS_KEYS } from '../const.ts';

export function registerUpdateUserStatusTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_platform_update_user_status',
        {
            title: 'Update a platform back-office admin user status',
            description:
                '把某個「platform 後台管理員帳號」（非 app 一般會員）的狀態改成指定值（rajah: ' +
                'Platform.UpdateUserStatus，需要權限節點 AdminManagement.Permission.Users.Status.Toggle）。' +
                'id 來自 aladdin_platform_platform_list_users 的回傳結果。' +
                '⚠️ 不可對自己（目前登入這個帳號本身）操作，任何目標狀態皆會被拒絕回 canNotDisableSelf。' +
                '⚠️ 只能操作登入者角色的子角色底下的帳號，非子角色範圍內的帳號一律查無或拒絕，這是後端' +
                '依登入身分自動套用的邊界，本工具無法繞過或關閉。' +
                'status 合法值（rajah StatusEnum）：unknown/enabled/disabled/frozen/deleted，一般啟用/停用' +
                '只會用到 enabled/disabled，其餘值語意不在本工具範圍內描述。' +
                '⚠️ id 不存在時回傳的是 errorCode=1（unknown），不是預期中的 objectNotFound——這是後端既有 bug' +
                '（對不存在的 id 查詢結果做 null 解參照，2026-08-26 dev 實測確認），本工具無法修正，如實告知' +
                '呼叫端這個訊號代表 id 可能不存在。' +
                '⚠️ 這支 RPC 沒有帶 id 篩選的單筆查詢方法（ListUsers 只支援 account 模糊比對），本工具' +
                '因此不做「先讀現值、同值短路」的優化，直接呼叫寫入；若要核對變更結果，需另外用' +
                'aladdin_platform_platform_list_users 依已知帳號名稱查找。' +
                '設為 disabled 時會背景踢除該帳號所有現有登入 session（非同步，本工具呼叫不等待其完成）。' +
                'prod 執行前確認：當這個 server 是正式環境（prod）時，執行本工具前必須先用 AskUserQuestion' +
                '（或功能相同的方式）明確詢問使用者是否要在正式環境執行這個操作，取得明確同意後才可以帶上' +
                'confirm 參數；絕不能自行假設使用者同意。非 prod 環境不需要、也會忽略 confirm 欄位。',
            inputSchema: {
                id: z.number().int().describe('目標帳號 id，來自 aladdin_platform_platform_list_users 的回傳結果'),
                status: z.enum(STATUS_KEYS).describe('目標狀態：unknown/enabled/disabled/frozen/deleted，一般啟用/停用用 enabled/disabled'),
                confirm: z.string().optional().describe(
                    `正式環境（prod）專用的強制確認欄位；非 prod 環境會被忽略、不需提供。當這個 server 是正式環境時，` +
                    `必須先取得使用者明確同意，再帶上精確字串 "${ PROD_CONFIRM_TOKEN }" 才會執行，否則本工具會拒絕執行並回錯誤。`,
                ),
            },
        },
        async ({ id, status, confirm }) => {
            assertProdConfirmed(confirm);
            const r = await withAutoRelogin(() => remote.platform.main.UpdateUserStatus(id, STATUS_MAP[ status ]));
            if (r.failed) return asErrorResult(r);

            return asTextResult({ success: true, id, status });
        },
    );
}
