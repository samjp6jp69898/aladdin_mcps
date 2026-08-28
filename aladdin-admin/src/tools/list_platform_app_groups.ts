/**
 * tools/list_platform_app_groups.ts — aladdin_admin_app_admin_list_platform_app_groups
 *
 * rajah: AppAdmin.ListPlatformAppGroups(platformId i32 1) (rows [PlatformAppGroup] 1)
 * （rajah/services/app_back_office.rajah:38，service AppAdmin 定義於同檔 29-41 行）。
 * 本方法**沒有 @Permission**（同 service 的 ListAppGroups / CreateOrUpdateAppGroup 有，這兩支沒有），
 * 只要登入 admin 後台即可呼叫；rajah 上方的 `## 平台管理/平台列表/app群組` 只是選單位置註解，不是權限節點。
 *
 * method-category-checklist.md 第 0 節排除規則已過：非 `Placeholder*` 前綴；service AppAdmin 無 @NoPublic；
 * agrabah 對應實作 AppAdminService.methodListPlatformAppGroups
 * （agrabah/src/servers/app_back_office/services/app_admin.ts:149-172）確認有真實 override，
 * 非 base class 的 notImplemented。
 *
 * 分類：method-category-checklist.md 第 2 節「讀取清單」。有範圍鍵 platformId 但**沒有分頁參數**
 * （簽名與實作都沒有 page/pageSize），所以不適用該節 B 級的「逐頁掃描到底」要求；屬於「完全不分頁的
 * 全撈」，底層就是 ListAppGroups 那張全域小型列舉表（app_groups）再標上平台級 status，筆數與
 * aladdin_admin_app_admin_list_app_groups 完全一致（2026-08-28 dev 實測兩支皆 6 筆）。
 *
 * ⚠️ **回傳的是「母表全集 + 每筆在該平台的啟用狀態」，不是「該平台已啟用的清單」**
 * （2026-08-28 讀 app_admin.ts:149-172 查證，非推論）：實作先查 `platform_app_groups` 拿到該平台已啟用的
 * app_group_id 集合，再對 **AppGroupManager.getAppGroups() 的全部群組**逐筆標上
 * `status = 集合內 ? enabled(1) : disabled(2)`（app_admin.ts:165-169，關鍵在 167 行那個三元式）。所以列數永遠等於母表總數，要看「該平台實際啟用了哪些」
 * 必須自己過濾 `status === 1`。
 *
 * ⚠️ **不存在的 platformId 不會回錯誤**（同一段實作的必然結果，2026-08-28 dev 以 platformId=999999 實測確認）：
 * 查不到任何關聯只會讓集合是空的，回傳仍是母表全集、每筆 status 都是 disabled(2)。呼叫端不能把
 * 「有回傳資料」當成 platformId 合法的證據——合法 platformId 請先用
 * aladdin_admin_platform_management_list_platform_details 查。
 *
 * 回傳 model PlatformAppGroup（app_back_office.rajah:18-27）：id / name（多語系）/ key / themes /
 * status。`status` 在 rajah 標了 @Hide（同檔 25 行，欄位本體在 26 行），但 @Hide 只代表後台表單不顯示、API 仍回傳，
 * 而且它正是本工具唯一比 list_app_groups 多出來的資訊，原樣保留。AppTheme.id 同樣是 @Hide 但保留，
 * 理由見 list_app_groups.ts 檔頭。
 *
 * 純讀取查詢，不修改任何資料，可安全重複呼叫。回傳無密鑰/PII 欄位，不需遮罩。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { STATUS_MAP } from '../const.ts';

export function registerListPlatformAppGroupsTool(server: McpServer): void {
    server.registerTool(
        'aladdin_admin_app_admin_list_platform_app_groups',
        {
            title: 'List app groups with per-platform enabled status',
            description:
                '查指定平台的 App 群組啟用狀態（rajah: AppAdmin.ListPlatformAppGroups，本方法無 @Permission）。' +
                '⚠️ 回傳的是**母表全集**（與 aladdin_admin_app_admin_list_app_groups 同一批、同樣筆數），' +
                '每筆多帶一個 status 欄位表示「這個群組在該平台是否已啟用」：1=enabled（已啟用）、' +
                '2=disabled（未啟用）。要取得「該平台實際啟用了哪些群組」請自行過濾 status===1，' +
                '不要把回傳列數當成已啟用數量。' +
                '⚠️ 傳入不存在的 platformId **不會回錯誤**，而是回母表全集且每筆 status 都是 2——' +
                '有資料不代表 platformId 合法，合法 id 請先用 ' +
                'aladdin_admin_platform_management_list_platform_details 查。' +
                '⚠️ 本方法**沒有掛任何權限節點**（同 service 的 ListAppGroups / CreateOrUpdateAppGroup 有），' +
                'platformId 完全由呼叫端指定、後端不驗證呼叫者與該平台的關聯——任何登入 admin 後台的帳號' +
                '都能查任一平台的啟用狀態（對照 platform 端同語意的 AppPlatform.ListAppGroups 是用登入身分' +
                '綁定的 context.platformId，不接受指定他人平台）。' +
                '不分頁、一次回全部。純讀取查詢，可安全重複呼叫。',
            inputSchema: {
                platformId: z.number().int().positive().describe(
                    '平台 id（必填）。從 aladdin_admin_platform_management_list_platform_details 的回傳取得，' +
                    '不要猜測或憑記憶填數字',
                ),
            },
        },
        async ({ platformId }) => {
            const r = await withAutoRelogin(() => remote.appBackOffice.appAdmin.ListPlatformAppGroups(platformId));
            if (r.failed) return asErrorResult(r);

            const rows = r.data?.rows ?? [];
            return asTextResult({
                success: true,
                platformId,
                enabledCount: rows.filter(row => row.status === STATUS_MAP.enabled).length,
                rows,
            });
        },
    );
}
