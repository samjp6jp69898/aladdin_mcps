/**
 * tools/list_app_groups.ts — aladdin_platform_app_platform_list_app_groups
 *
 * rajah: AppPlatform.ListAppGroups() (rows [PlatformAppGroup] 1)
 * （rajah/services/app_back_office.rajah:173，service AppPlatform 定義於同檔 171-222 行）。
 * @Permission "PlatCapCfg.PsConfig.AppList"（app_back_office.rajah:172）。
 *
 * method-category-checklist.md 第 0 節排除規則已過：方法名非 `Placeholder*` 前綴（本 service 尾段
 * 212/215/218/221 行另有 4 支真正的 Placeholder：PlaceholderAppListAdd / PlaceholderAppListOpsLink /
 * PlaceholderAppListOpsVer / PlaceholderAppListOpsEdit，本方法不在其中）；service AppPlatform 無
 * @NoPublic；agrabah 對應實作 AppPlatformService.methodListAppGroups
 * （agrabah/src/servers/app_back_office/services/app_platform.ts:103-120）確認有真實 override，
 * 非 base class 的 notImplemented。
 *
 * 分類：method-category-checklist.md 第 2 節「讀取清單」——回傳不分頁的 `rows` 陣列，簽名與實作都
 * 沒有分頁參數。屬於該節「完全不分頁的全撈」：底層 AppGroupManager.getAppGroups 對 app_groups 與
 * app_themes 各做一次無 condition 無 limit 的全表 load（app_group_manager.ts:26、45），兩張都是全域
 * 小型列舉表；platform 端還先被當前平台的啟用關聯過濾（app_platform.ts:104-111），筆數只會更少
 * （2026-08-28 dev PK 平台實測 1 筆）。
 *
 * ⚠️ **與 admin 端同名 method 是完全不同的東西，不要互相替代判讀**（2026-08-28 讀源碼查證）：
 * - 本方法（platform 端）先查 `platform_app_groups WHERE platform_id = context.platformId` 取得
 *   **當前登入平台**已啟用的 app_group_id，再用這批 id 去撈群組（app_platform.ts:104-117），
 *   所以回傳的**只有已啟用的那些**，沒有 platformId 參數（平台由登入身分決定，不可指定他人平台）。
 * - admin 端的 `aladdin_admin_app_admin_list_platform_app_groups` 吃 platformId 參數，回的是
 *   **母表全集**再逐筆標上 status（enabled/disabled），列數永遠等於母表總數。
 * - admin 端還有 `aladdin_admin_app_admin_list_app_groups`（純母表全集、無平台概念）。
 *
 * ⚠️ **回傳型別雖然是 PlatformAppGroup（含 status 欄位），但本方法不會填 status**
 * （app_platform.ts:117 直接把 AppGroupManager 回傳的 `AppGroup[]` 指派給 `response.rows`，
 * 沒有經過 admin 端那段 `PlatformAppGroup.create(...) + 設定 status` 的加工，
 * 對照 app_admin.ts:165-169，關鍵是 167 行那個把 status 設成 enabled/disabled 的三元式）。所以 status 會是 protobuf 預設值 0（unknown）或整個欄位缺漏，
 * **不能拿來判斷啟用狀態**——這份清單本身就已經只含已啟用的群組。
 *
 * 純讀取查詢，不修改任何資料，可安全重複呼叫。回傳無密鑰/PII 欄位，不需遮罩。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerListAppGroupsTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_app_platform_list_app_groups',
        {
            title: 'List app groups enabled for the current platform',
            description:
                '列出**當前登入平台已啟用**的 App 群組（rajah: AppPlatform.ListAppGroups，' +
                '@Permission "PlatCapCfg.PsConfig.AppList"）。每筆含 id、key、多語系名稱 name，' +
                '以及該群組底下的 themes（App 主題）陣列——group 的 id 與 theme 的 id 就是 ' +
                'aladdin_platform_app_platform_create_or_update_app 要填的 appGroupId / appThemeId 合法值來源。' +
                '無參數：平台由登入身分決定，不能指定別的平台。不分頁、一次回全部。' +
                '⚠️ 回傳結構雖有 status 欄位，但本方法**不會填它**（值會是 0 或缺漏），不要拿來判斷啟用狀態——' +
                '這份清單本身就只含已啟用的群組。若要看「母表全集有哪些群組、各自在某平台啟用與否」，' +
                '那是 admin 後台的能力（aladdin-admin server 的 ' +
                'aladdin_admin_app_admin_list_platform_app_groups），本 server 沒有。' +
                '純讀取查詢，可安全重複呼叫。',
            inputSchema: {},
        },
        async () => {
            const r = await withAutoRelogin(() => remote.appBackOffice.appPlatform.ListAppGroups());
            if (r.failed) return asErrorResult(r);

            return asTextResult({ success: true, rows: r.data?.rows ?? [] });
        },
    );
}
