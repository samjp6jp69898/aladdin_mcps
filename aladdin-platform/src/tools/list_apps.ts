/**
 * tools/list_apps.ts — aladdin_platform_app_platform_list_apps
 *
 * rajah: AppPlatform.ListApps() (rows [PlatformAppEdit] 1)
 * （rajah/services/app_back_office.rajah:174，service AppPlatform 定義於同檔 171-222 行）。
 * **本方法沒有 @Permission**（同 service 的 ListAppGroups / CreateOrUpdateApp 有掛（@Permission 分別在 172 / 175 行，
 * method 本體在 173 / 176 行）
 * "PlatCapCfg.PsConfig.AppList"，這支沒有），只要登入 platform 後台即可呼叫。
 *
 * method-category-checklist.md 第 0 節排除規則已過：方法名非 `Placeholder*` 前綴（本 service 的
 * 4 支真 Placeholder 在 212/215/218/221 行）；service AppPlatform 無 @NoPublic；agrabah 對應實作
 * AppPlatformService.methodListApps（agrabah/src/servers/app_back_office/services/app_platform.ts:128-145）
 * 確認有真實 override，非 base class 的 notImplemented。
 *
 * 分類：method-category-checklist.md 第 2 節「讀取清單」——回傳不分頁的 `rows`，簽名與實作都沒有
 * 分頁參數（app_platform.ts:129 的 loadObjects 條件只有 `platform_id = ?`，order 與 limit 兩個字串
 * 參數皆空）。屬於「完全不分頁的全撈」：platform_apps 是後台手動維護的設定表（唯一寫入者是
 * AppPlatform.CreateOrUpdateApp），一個平台通常只有個位數 App，不是會持續成長的歷史/log 表。
 * 2026-08-28 dev PK 平台實測 3 筆（id 5 / 10 / 11）。
 *
 * ⚠️ **平台由登入身分決定，沒有 platformId 參數**（app_platform.ts:129 用的是 `context.platformId`），
 * 查不到別的平台的 App。這也表示回傳的 id 只能餵回本 server 的 app 相關 tool。
 *
 * **回傳的 id 是「appId 這個參數」的唯一合法來源**：本 rajah 檔沒有任何「用業務鍵查單一 App」的
 * method（沒有 GetAppForEdit 之類），以下 5 支 rajah method 的 appId／platformAppId 都只能從這裡拿——
 * ListAppVersions(180) / ListDownloadLinks(189) / CreateOrUpdateDownloadLink(194) /
 * UpdateDownloadLinkStatus(200) 的 `appId`，以及 CreateOrUpdateAppVersion(182) 的 `platformAppId`。
 *
 * ⚠️ **填錯 appId 的後端行為不一致，不是一律回 objectNotFound**（2026-08-28 逐支讀 app_platform.ts
 * 查證）：共用的 `checkAppIdBelongsToPlatform`（app_platform.ts:56-64）只被 3 支呼叫——
 * CreateOrUpdateAppVersion(:285)、ListDownloadLinks(:363)、CreateOrUpdateDownloadLink(:395)，
 * 這 3 支填錯會回 objectNotFound；ListAppVersions(:256-271) 沒有呼叫它，改用 WHERE
 * `platform_id = ? AND platform_app_id = ?` 過濾，**填錯 appId 回的是空 rows 不是錯誤**；
 * UpdateDownloadLinkStatus(:506-523) 也沒有呼叫它，是靠 loadObject 三鍵條件（:508）找不到才回
 * objectNotFound。跨租戶安全性 5 支都成立，但呼叫端不能假設「有回應就代表 appId 合法」。
 *
 * 回傳 model PlatformAppEdit（app_back_office.rajah:44-55）：id（@Hide，仍會回傳且是上述 appId 來源）、
 * name / logo / banner 三個多語系欄位（logo/banner 標了 @Type "File:Image"，值是各語系各自的
 * **相對路徑字串**如 `/static/app/1mh0rfiwkmsh4fpj1pjsbbq87`，不是完整 URL 也不是 base64）、
 * appGroupId、appThemeId。**多語系欄位是稀疏的**：2026-08-28 dev 實測 3 筆裡，有一筆的 banner 只有
 * zh-CN 一個語系且值為空字串、另外兩筆整個 banner 欄位缺漏，呼叫端不能假設每個欄位都齊三語。
 *
 * ⚠️ **「banner 整個 key 缺席」是本工具序列化方式造成的，不是後端沒回這個欄位**（2026-08-28 實測
 * 證實，非推論）：本工具把後端回的原始 Message 實例直接交給 JSON.stringify，會走
 * `Message.prototype.toJSON` → `Type.toObject(msg, util.toJSONOptions)`，該選項不含 arrays/defaults，
 * **長度 0 的 repeated 欄位整個被丟掉**。實測比對同一筆 row：`hasOwnProperty('banner')` 恆為 true、
 * 值是 `[]`，但 `JSON.stringify(row)` 沒有 banner、`JSON.stringify({ ...row })` 有 `banner: []`。
 * 也就是說「key 不存在」與「陣列為空」在本工具的輸出裡無法區分，兩者都表現成 key 缺席。
 * 對照組：aladdin_platform_app_platform_list_download_links 用 spread 展開，空陣列會保留成 `[]`，
 * 行為與本工具相反。**已知落差、本輪未修**：要讓兩支一致，本工具（以及同樣回傳原始 Message 的
 * aladdin_platform_app_platform_list_app_groups、aladdin-admin 的兩支 app tool）都要改成先重建成
 * 純物件再輸出；那會改變已通過審查的回傳形狀，留給後續決定。**這是 Edit 用的 model，不是顯示用的**，
 * 依 method-category-checklist.md 第 1 節「*ForEdit 系列欄位通常比顯示版多」的提醒逐欄檢查過：
 * 6 個欄位全部是後台設定值，沒有內部欄位、沒有密鑰、沒有 PII，不需遮罩（第 8 節不適用）。
 *
 * 純讀取查詢，不修改任何資料，可安全重複呼叫。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerListAppsTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_app_platform_list_apps',
        {
            title: 'List apps of the current platform',
            description:
                '列出當前登入平台的全部 App（rajah: AppPlatform.ListApps，本方法無 @Permission，' +
                '登入後台即可呼叫）。每筆含 id、多語系名稱 name、多語系 logo / banner 圖片**相對路徑**' +
                '（如 /static/app/xxx，不是完整 URL、不是 base64）、' +
                'appGroupId、appThemeId。' +
                '**這裡回傳的 id 是其他 App 類 tool 的 appId 唯一合法來源**——本 server 底下任何需要 ' +
                'appId（或 appVersion 的 platformAppId）參數的 App 類 tool，一律先呼叫本 tool 取得合法值，' +
                '不要猜測或憑記憶填數字（全庫沒有任何「用業務鍵查單一 App」的 RPC，這是唯一入口）。' +
                '⚠️ 多語系欄位是稀疏的：某些 App 的 banner 可能整個欄位缺漏或只有部分語系，不要假設每欄都齊三語。' +
                '無參數：平台由登入身分決定，查不到別的平台的 App。不分頁、一次回全部。' +
                'appGroupId / appThemeId 的合法值來源是 aladdin_platform_app_platform_list_app_groups。' +
                '純讀取查詢，可安全重複呼叫。',
            inputSchema: {},
        },
        async () => {
            const r = await withAutoRelogin(() => remote.appBackOffice.appPlatform.ListApps());
            if (r.failed) return asErrorResult(r);

            return asTextResult({ success: true, rows: r.data?.rows ?? [] });
        },
    );
}
