/**
 * tools/get_live_tabs.ts — aladdin_platform_live_platform_get_live_tabs
 *
 * rajah: LivePlatform.GetLiveTabs() (rows [LiveTabEdit] 1)
 * （rajah/services/live_back_office.rajah:65；service 定義於同檔 63-90 行，group 為
 * LiveBackOffice，client 路徑 remote.liveBackOffice.livePlatform）。
 *
 * method-category-checklist.md 第 0 節排除規則已過：
 * - 非 Placeholder（本檔真正的 Placeholder 方法 `PlaceholderLiveTab`/`PlaceholderLiveCategory`
 *   連同它們的 `@Permission` 一起被整段註解掉，見 live_back_office.rajah:83-89，不會生成）。
 * - service 沒有 `@NoPublic`。
 * - agrabah 對應實作確認為**真實 override**、非 base class 的 notImplemented：
 *   agrabah/src/servers/live_back_office/services/live_platform.ts:49-82（methodGetLiveTabs），
 *   實作是 `loadObjects(DbLiveTab, 'platform_id = ?', [context.platformId], 'position ASC')`
 *   再補上多語名稱／圖示（LocalizationManager）與版位 layout（SectionLayoutManager）。
 *
 * ⚠️ **LivePlatform 底下 8 支 method 一個生效的 `@Permission` 都沒有**，但成因分兩種
 * （2026-08-28 逐行核對 live_back_office.rajah:62-89）：
 * - 7 條 `@Permission` 是**被 `#` 註解掉的**——service 級一條（:62）與 6 支 method 各一條
 *   （:64/:66/:68/:71/:73/:75/:78，`Live.Tab`／`Live.Tab.Edit`／`Live.Category`／
 *   `Live.Category.Edit`／`Live.Lives`）。`#` 在 rajah 是註解，不是屬性。
 * - `GetUploadImageToken`（:81）則是**從頭到尾沒有宣告過** `@Permission`，不是被註解掉。
 * 兩支承接菜單節點的 Placeholder（`Live.LiveTab`／`Live.LiveCategory`，:83-89）也整段被註解，
 * 因此 `Live*` 這一整族權限節點在權限樹上根本不存在，也就無法指派給任何角色。
 * 實際後果（已回 source 核對，非推論）：
 * - **後端不做任何權限檢查**，任何能登入 platform 後台的帳號打得到這 8 支 RPC。
 * - **前端反而全部關著**：`abu/platform/src/menu.ts:389-391` 的「直播管理」菜單掛在
 *   `Live`／`Live.LiveTab`／`Live.LiveCategory` 這三個不存在的節點上，而
 *   `abu/common/api/role.ts:64` 的 `hasPermission()` 是 `isSuper || 節點集合.has(name)`——
 *   所以只有 isSuper 角色看得到這個菜單，一般角色連菜單都進不去、也無從被授權。
 * 對呼叫端的意義：不要以為「沒有權限就不會被呼叫到」；也要知道用這支 tool 做的事，
 * 一般後台角色在 UI 上是做不到的。
 *
 * 分類：method-category-checklist.md 第 2 節「讀取清單」——回傳 `rows` 陣列、**完全不分頁**。
 * 依該節「完全不分頁的全撈」判準，`live_tabs` 是每平台各自的直播頁籤設定表（後台手動新增
 * 的版位設定，非會持續成長的歷史／log 類資料），全撈是安全的；2026-08-28 dev（PK）實測 5 筆。
 * 無任何輸入參數，因此不存在 B 級「只有範圍鍵＋分頁」的定位查找風險。
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerGetLiveTabsTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_live_platform_get_live_tabs',
        {
            title: 'Get this platform\'s live-stream tabs',
            description:
                '查詢當前平台的直播頁籤（Live Tab）清單（rajah: LivePlatform.GetLiveTabs），對應後台' +
                '「直播管理」底下的直播頁籤設定。不帶任何參數，一次回傳全部、依 position 由小到大' +
                '排序（此為每平台各自的小型版位設定表，非會持續成長的歷史類資料，全撈是安全的）。' +
                '回傳每筆含：id（供 aladdin_platform_live_platform_create_or_update_live_tab 修改、' +
                'aladdin_platform_live_platform_update_live_tab_status 啟停時定位用）、position' +
                '（排序，數字越小越前面）、name（頁籤名稱多語系陣列 [{code, value}]，不保證涵蓋' +
                '全部語系）、icon（頁籤圖示，同樣是多語系陣列，value 是圖片 URL）、layout' +
                '（版位配置 {normalRows, repeatedRows}，兩者都是 SectionLayoutRowEnum 陣列，' +
                '0=two 兩欄、1=banner 橫幅、2=oneBigTwoSmall 一大兩小）、status（型別是完整的 ' +
                'StatusEnum：0=unknown／1=enabled／2=disabled／3=frozen／10=deleted，' +
                '不是只有啟用/停用兩個值；2026-08-28 dev 實測 5 筆只出現過 1 與 2，但結構上' +
                '其餘值都可能出現，且本 method 不會過濾掉 deleted 的資料）。⚠️ name／icon／layout 這三個欄位在「該筆完全沒設定任何語系／版位」時' +
                '會整個從 JSON 消失（不是回空陣列），2026-08-28 dev 實測 5 筆中有 2 筆沒有 name/icon、' +
                '4 筆的 layout 是空物件 {}；讀取端要容忍欄位不存在。' +
                '⚠️ LivePlatform 底下 8 支 method 一個生效的 @Permission 都沒有（7 條被 # 註解掉、' +
                'GetUploadImageToken 則從未宣告過），等於後端完全不做權限檢查，只要能登入 ' +
                'platform 後台就能呼叫；反過來前端「直播管理」菜單掛的是 Live／Live.LiveTab／' +
                'Live.LiveCategory 這三個在權限樹上不存在的節點，只有 isSuper 角色看得到，' +
                '一般角色連菜單都進不去。' +
                '純讀取查詢，不修改任何資料，可安全重複呼叫。',
            inputSchema: {},
        },
        async () => {
            const r = await withAutoRelogin(() => remote.liveBackOffice.livePlatform.GetLiveTabs());
            if (r.failed) return asErrorResult(r);

            return asTextResult({ success: true, rows: r.data?.rows ?? [] });
        },
    );
}
