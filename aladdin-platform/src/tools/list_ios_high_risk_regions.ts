/**
 * tools/list_ios_high_risk_regions.ts — aladdin_platform_app_platform_list_ios_high_risk_regions
 *
 * rajah: AppPlatform.ListIosHighRiskRegions() (rows [IosHighRiskRegionEdit] 1)
 * （rajah/services/app_back_office.rajah:203，本方法**無 @Permission**——同組的
 * SaveIosHighRiskRegions 有掛 "PlatCapCfg.PsConfig.AppList.Ops.Link.Region"（207 行），這支查詢沒有；
 * 202 行的 `# 高危地區設置` 與 170 行的 `# @Permission "AppManagement"` 都是註解不生效。
 * service AppPlatform 定義於同檔 171-222 行，model IosHighRiskRegionEdit 在同檔 156-168 行。）
 *
 * method-category-checklist.md 第 0 節排除規則已過：非 `Placeholder*` 前綴（4 支真 Placeholder 在
 * 212/215/218/221 行）；service 無 @NoPublic；agrabah 對應實作
 * AppPlatformService.methodListIosHighRiskRegions
 * （agrabah/src/servers/app_back_office/services/app_platform.ts:531-540）確認有真實 override。
 *
 * 分類：method-category-checklist.md 第 2 節「讀取清單」——無參數、無分頁（app_platform.ts:532 的
 * loadObjects，sort 是 'sort_order ASC, id ASC'、limit 是空字串），屬「完全不分頁的全撈」。
 * 全撈安全的實際理由（2026-08-28 查證後改寫，第一版寫的「名稱值域只有 34 個所以表不會長大」
 * 這條推論**不成立**，因為值域小不代表不能重複新增）：
 * - 後端 `methodSaveIosHighRiskRegions`（app_platform.ts:582-640）對 `name` **完全不做去重**——
 *   589-595 只用 normalizeRegionName 檢查名稱合法性，606-629 的迴圈對 `id <= 0` 一律 insertObject，
 *   同一個地區名送 N 次就會產生 N 列。
 * - DB 也沒有擋：migration `agrabah/migrations/app/202608050002_create_platform_ios_region_settings.sql:14`
 *   只有 platform_id 的一般 index，**沒有任何 unique key**。
 * - 真正把列數壓在個位數的是「前端下拉去重」（abu/platform/src/pages/app/dialog/
 *   IosRegionSettingPopup.vue:33-36，每列的選項排除其它列已選名稱）加上 Save 本身是覆蓋語意
 *   （未列出的既有列會被軟刪除）。唯一寫入端就是那個後台彈窗，所以全撈實務上安全——但這是
 *   **UI 紀律保證，不是 schema 或後端保證**，呼叫端不該把「一定很少」當成不變量。

 * **驗收與已知未覆蓋情境**（誠實揭露）：2026-08-28 dev（pk-platform.alddev.com，PK 平台）實測，
 * RPC 呼叫成功、回 `rows: []`——該平台目前一筆高危地區都沒設定。因此**「有資料時的欄位對應
 * （sortOrder / name / highRiskStatus 的實際值長什麼樣）」這條路徑沒有被實測覆蓋**，檔頭關於欄位
 * 語意的敘述全部來自讀 source（rajah model 156-168 行、app_platform.ts:531-540、
 * database_types/app.ts:73-82），不是實測結論。要造資料只能呼叫 SaveIosHighRiskRegions
 * （覆蓋語意、會軟刪除未列出的既有資料），本輪沒有包那支 tool，也不在唯讀驗收裡動寫入，
 * 所以留下這個缺口而不是硬造資料。
 *
 * ⚠️ **回傳的 `highRiskStatus` 與 DB 的 `status` 是兩個不同的欄位，不要搞混**
 * （2026-08-28 讀 agrabah/src/database_types/app.ts:73-82 查證）：
 * - `status`：**軟刪除欄位**（該檔 79-80 行的註解明寫「軟刪除：deleted = 已刪除，查詢一律過濾
 *   status = enabled」）。本方法的 WHERE 就是用它過濾（app_platform.ts:532），而且
 *   **rajah model IosHighRiskRegionEdit 根本沒有這個欄位**，不會被回傳。所以你在回傳裡看不到
 *   任何已刪除的列，這是正常的。
 * - `highRiskStatus`：真正的「這個地區是不是高風險」開關（rajah 165-167 行，@Type "Toggle"），
 *   是本工具回傳的那個。enabled(1) 才代表高風險。
 *
 * 業務用途：IOS 上架包類型的下載連結會依使用者所在地區分流——非高危地區吐 `appStoreUrl`、
 * 高危地區 fallback 回一般 `url`。這不只是 rajah 145 行的註解說法，真正的分流實作在
 * agrabah/src/servers/app/services/hub.ts:762-782（765 判斷有 iosAppStoreApp 且 appStoreUrl 非空 →
 * 766 呼叫 IosRegionManager.isHighRiskRegion → 777-778 非高危才把 url 換成 appStoreUrl →
 * 780 一律清空 appStoreUrl），代理推廣包走 app_packager.ts:329-347 的同一套 fail-closed 邏輯。
 * 判定核心 agrabah/src/managers/ios_region_manager.ts:35-56 的 SQL 是
 * `status = enabled AND high_risk_status = enabled`（同檔 40），這同時佐證了「highRiskStatus =
 * enabled(1) 才代表高風險」。也就是說這份清單直接影響前台 IOS 下載頁的行為。
 *
 * 排序：`sort_order ASC, id ASC`（app_platform.ts:532），與後台拖曳排序一致；`sortOrder` 由
 * SaveIosHighRiskRegions 依傳入陣列順序重編（app_platform.ts:609 的 `record.sortOrder = index + 1`），
 * 不是呼叫端自己指定的值。
 *
 * 地區名稱是**簡體短名**（已剝除「省/市」等後綴、繁轉簡，見 region_names.ts:1-4 檔頭與 22-39 的
 * 繁簡對照表），寫入時由 app_platform.ts:590-594 強制正規化後才落庫。⚠️ 但它與
 * aladdin_platform_app_platform_list_ios_region_name_options 的選項**只在寫入當下一致**：
 * Save 校驗的是當時的 IP 庫動態名單，既存列是那一刻的歷史快照，IP 庫日後更名的話，
 * 既存列的 name 可能已經不在當前選項清單裡。
 *
 * 純讀取查詢，不修改任何資料，可安全重複呼叫。回傳無密鑰/PII 欄位，不需遮罩。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { STATUS_NAMES } from '../const.ts';

export function registerListIosHighRiskRegionsTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_app_platform_list_ios_high_risk_regions',
        {
            title: 'List iOS high-risk region settings',
            description:
                '列出當前平台的「高危地區設置」清單（rajah: AppPlatform.ListIosHighRiskRegions，本方法無 @Permission）。' +
                '每筆含 id、sortOrder（顯示順序）、name（中國省級行政區的**簡體短名**，如「广东」）、' +
                'highRiskStatus，另附 highRiskStatusName 中文對照。' +
                '⚠️ **highRiskStatus 才是「是不是高風險地區」的開關**（1=enabled 代表高風險）；' +
                'DB 另有一個同樣叫 status 的欄位是軟刪除用的，不會出現在回傳裡——所以你不會看到已刪除的列，' +
                '這是正常的，不是漏資料。' +
                '業務影響：IOS 上架包類型的下載連結會依地區分流，非高危地區吐 appStoreUrl、' +
                '高危地區 fallback 回一般的連結地址，所以這份清單直接影響前台 IOS 下載頁行為。' +
                '無參數（平台由登入身分決定）、不分頁、一次回全部，依 sortOrder 由小到大排序。' +
                'name 的合法值域見 aladdin_platform_app_platform_list_ios_region_name_options。' +
                '純讀取查詢，可安全重複呼叫。',
            inputSchema: {},
        },
        async () => {
            const r = await withAutoRelogin(() => remote.appBackOffice.appPlatform.ListIosHighRiskRegions());
            if (r.failed) return asErrorResult(r);

            const rows = r.data?.rows ?? [];
            return asTextResult({
                success: true,
                rows: rows.map(row => ({
                    ...row,
                    highRiskStatusName: STATUS_NAMES[ row.highRiskStatus as number ] ?? `(未知值 ${ row.highRiskStatus })`,
                })),
            });
        },
    );
}
