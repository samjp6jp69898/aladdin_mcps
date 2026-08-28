/**
 * tools/get_live_categories.ts — aladdin_platform_live_platform_get_live_categories
 *
 * rajah: LivePlatform.GetLiveCategories() (rows [LiveCategoryEdit] 1)
 * （rajah/services/live_back_office.rajah:72；LiveCategoryEdit 定義於同檔 24-40 行；
 * client 路徑 remote.liveBackOffice.livePlatform）。
 *
 * method-category-checklist.md 第 0 節排除規則已過：非 Placeholder、service 無 `@NoPublic`、
 * agrabah 對應實作是真實 override（agrabah/src/servers/live_back_office/services/
 * live_platform.ts:207-229，methodGetLiveCategories），非 base class 的 notImplemented；實作是
 * `loadObjects(DbLiveCategory, 'platform_id = ?', [context.platformId], '', '')` 再補多語名稱。
 * 權限現況見 get_live_tabs.ts 檔頭（`Live*` 整族權限節點在 rajah 全被註解掉），不重複。
 *
 * 分類：method-category-checklist.md 第 2 節「讀取清單」——回傳 `rows` 陣列、**完全不分頁**。
 * 依該節「完全不分頁的全撈」判準，`live_categories` 是每平台各自的直播分類設定表（後台手動維護
 * 的分類，非會持續成長的歷史／log 類資料），全撈是安全的；2026-08-28 dev（PK）實測 2 筆。
 * 無任何輸入參數，不存在 B 級「只有範圍鍵＋分頁」的定位查找風險。
 *
 * ⚠️ **與 `GetLiveTabs` 的兩個結構性差異**（讀 source 確認，容易被當成同一套處理而出錯）：
 * 1. **沒有排序**：`loadObjects` 的 order by 參數是空字串（:210），不像 tabs 有 `position ASC`；
 *    回傳順序由 DB 決定、不保證穩定。`LiveCategoryEdit` 本身也沒有 position/sortOrder 欄位。
 * 2. **四個圖片欄位是單一字串不是多語陣列**：`icon`/`background`/`squareImage`/`bannerImage`
 *    都是 `string`（rajah :28-35，四個欄位各自帶 `@Type "File:Image"`），只有 `name` 是
 *    `[LocalizationString]` 多語陣列。tabs 那邊的 `icon` 則是多語陣列——兩者不同，不能沿用同一套
 *    讀寫假設。
 *
 * ⚠️ 本 method 與 `GetLiveTabs` 一樣**完全不過濾 status**（:210 的條件只有 `platform_id = ?`），
 * 被設成 disabled/deleted 的分類仍會出現在清單裡。
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerGetLiveCategoriesTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_live_platform_get_live_categories',
        {
            title: 'Get this platform\'s live-stream categories',
            description:
                '查詢當前平台的直播分類清單（rajah: LivePlatform.GetLiveCategories），對應後台' +
                '「直播管理 > 直播分類」。不帶任何參數，一次回傳全部（每平台各自的小型分類設定表，' +
                '非會持續成長的歷史類資料，全撈是安全的）。' +
                '回傳每筆含：id（供 aladdin_platform_live_platform_create_or_update_live_category ' +
                '修改、aladdin_platform_live_platform_update_live_category_status 啟停時定位用）、' +
                'name（分類名稱多語系陣列 [{code, value}]）、icon／background／squareImage／' +
                'bannerImage（四個圖片路徑，**單一字串不是多語陣列**，與直播頁籤的 icon 不同）、' +
                'status（完整 StatusEnum：0=unknown／1=enabled／2=disabled／3=frozen／10=deleted）。' +
                '⚠️ **沒有排序**：後端查詢沒有指定 order by，回傳順序由 DB 決定、不保證穩定；' +
                'LiveCategoryEdit 也沒有排序欄位可用。' +
                '⚠️ **不過濾 status**：被停用甚至被設成 deleted 的分類都會出現在清單裡。' +
                '⚠️ LivePlatform 底下 8 支 method 一個生效的 @Permission 都沒有，後端不做權限檢查；' +
                '反過來前端「直播管理」菜單掛的是權限樹上不存在的節點，只有 isSuper 角色看得到' +
                '（詳見 aladdin_platform_live_platform_get_live_tabs 的說明）。' +
                '純讀取查詢，不修改任何資料，可安全重複呼叫。',
            inputSchema: {},
        },
        async () => {
            const r = await withAutoRelogin(() => remote.liveBackOffice.livePlatform.GetLiveCategories());
            if (r.failed) return asErrorResult(r);

            return asTextResult({ success: true, rows: r.data?.rows ?? [] });
        },
    );
}
