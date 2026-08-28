/**
 * tools/list_app_groups.ts — aladdin_admin_app_admin_list_app_groups
 *
 * rajah: AppAdmin.ListAppGroups() (rows [AppGroup] 1)
 * （rajah/services/app_back_office.rajah:32，service AppAdmin 定義於同檔 29-41 行）。
 * @Permission "AppManagementAdmin"（app_back_office.rajah:31）。
 *
 * method-category-checklist.md 第 0 節排除規則已過：方法名非 `Placeholder*` 前綴（本 rajah 檔的
 * Placeholder 全集中在 service AppPlatform 尾段：PlaceholderAppListAdd / PlaceholderAppListOpsLink /
 * PlaceholderAppListOpsVer / PlaceholderAppListOpsEdit，AppAdmin 底下一支都沒有）；service AppAdmin
 * 無 @NoPublic；agrabah 對應實作 AppAdminService.methodListAppGroups
 * （agrabah/src/servers/app_back_office/services/app_admin.ts:34-42）確認有真實 override，
 * 非 base class 的 notImplemented。
 *
 * 分類：method-category-checklist.md 第 2 節「讀取清單」——回傳不分頁的 `rows` 陣列，**簽名與實作
 * 都沒有任何分頁參數**：AppGroupManager.getAppGroups 對 DbAppGroup 下的是無 condition、無 limit 的
 * loadObjects（agrabah/src/servers/app_back_office/managers/app_group_manager.ts:26），接著又對
 * DbAppTheme 做**第二次無條件全表 load**（同檔 45 行，同樣無 condition 無 limit），撈回來才在記憶體
 * 用 appGroupMap.has() 過濾（同檔 53-56）——也就是一次呼叫其實是兩張表各全撈一次。屬於該節
 * 「完全不分頁的全撈」情形：app_groups 是全域小型列舉表（App 主題分組，由 admin 手動維護、非隨業務
 * 成長的歷史/log 表；app_themes 同理，唯一寫入者是 AppAdmin.CreateOrUpdateAppGroup），
 * 2026-08-28 dev（ALADDIN_ADMIN_API_URL=admin.alddev.com，admin 全域身分無平台 scope）實測
 * 6 筆 app group、每筆各 1 個 theme，可放心一次全撈。
 *
 * 回傳結構（rajah model AppGroup，app_back_office.rajah:1-8）：
 * - `id` / `key` / `name`（多語系陣列 [LocalizationString]）
 * - `themes`：該群組底下的 AppTheme 陣列。**AppTheme.id 在 rajah 標了 @Hide**
 *   （app_back_office.rajah:12），但 @Hide 只代表後台表單不顯示、API 仍會回傳；這裡原樣保留，
 *   因為 AppPlatform.CreateOrUpdateApp 的 `appThemeId` 參數就是要填這個 id，遮掉會讓呼叫端無法使用。
 *
 * 跨 server 對照：platform 端有同名的 AppPlatform.ListAppGroups（另一支 tool
 * aladdin_platform_app_platform_list_app_groups），回傳 model 是 PlatformAppGroup 而非 AppGroup，
 * 且**只列出該平台已被啟用的群組**（實作用 platform_app_groups 表過濾，app_platform.ts:103-120）。
 * 本工具是 admin 視角的**母表全集**，兩者不能互相替代判讀。若要看「某平台啟用了哪些群組」，
 * 用 aladdin_admin_app_admin_list_platform_app_groups（帶 platformId，回傳含平台級 status）。
 *
 * 純讀取查詢，不修改任何資料，可安全重複呼叫。回傳無密鑰/PII 欄位，不需遮罩。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerListAppGroupsTool(server: McpServer): void {
    server.registerTool(
        'aladdin_admin_app_admin_list_app_groups',
        {
            title: 'List app groups (admin master table)',
            description:
                '列出 App 群組母表全集（rajah: AppAdmin.ListAppGroups，@Permission "AppManagementAdmin"）。' +
                '每筆含 id、key、多語系名稱 name，以及該群組底下的 themes（App 主題）陣列；' +
                'theme 的 id 就是 platform 端 App 設定要填的 appThemeId。' +
                '無參數、不分頁、一次回全部（app_groups 是全域小型列舉表，非隨業務成長的表）。' +
                '⚠️ 這是 admin 視角的**母表全集**，不代表任何單一平台可用的群組——' +
                '要看某個平台實際啟用了哪些群組，改用 aladdin_admin_app_admin_list_platform_app_groups' +
                '（帶 platformId，回傳含平台級 status）。' +
                '純讀取查詢，可安全重複呼叫。',
            inputSchema: {},
        },
        async () => {
            const r = await withAutoRelogin(() => remote.appBackOffice.appAdmin.ListAppGroups());
            if (r.failed) return asErrorResult(r);

            return asTextResult({ success: true, rows: r.data?.rows ?? [] });
        },
    );
}
