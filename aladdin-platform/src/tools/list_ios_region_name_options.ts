/**
 * tools/list_ios_region_name_options.ts — aladdin_platform_app_platform_list_ios_region_name_options
 *
 * rajah: AppPlatform.ListIosRegionNameOptions() (names [string] 1)
 * （rajah/services/app_back_office.rajah:205，本方法**無 @Permission**；204 行是說明註解。
 * service AppPlatform 定義於同檔 171-222 行。）
 *
 * method-category-checklist.md 第 0 節排除規則已過：非 `Placeholder*` 前綴（4 支真 Placeholder 在
 * 212/215/218/221 行）；service 無 @NoPublic；agrabah 對應實作
 * AppPlatformService.methodListIosRegionNameOptions
 * （agrabah/src/servers/app_back_office/services/app_platform.ts:555-567）確認有真實 override。
 *
 * 分類：method-category-checklist.md 第 2 節「讀取清單」——無參數、無分頁、回傳一個字串陣列。
 * 屬「完全不分頁的全撈」，而且值域天生封閉（中國省級行政區，內建名單 34 筆，見
 * agrabah/src/servers/app_back_office/helpers/region_names.ts:9-17 的 CANONICAL_REGION_NAME_LIST），
 * 不是會成長的業務表。⚠️ 這裡的 34 筆是**內建 fallback 名單**的筆數（region_names.ts:9-17），
 * 走 IP 庫那條路徑時筆數不必然等於 34——sortRegionNamesForDisplay 明確處理了「內建名單以外的
 * 新名稱」（region_names.ts:83-92），代表 IP 庫可能回傳名單外的值。
 *
 * **這支存在的理由**：它是 `name` 欄位**正規化後的目標值域**。rajah model IosHighRiskRegionEdit 的
 * `name` 只標了 `@Rules "Required;MaxLength(20)"`（app_back_office.rajah:162-164），schema 上看不出
 * 值域限制，但後端 SaveIosHighRiskRegions 會用 `normalizeRegionName` 檢查，正規化後對不上直接回
 * `appRegionNotFound`（app_platform.ts:589-595）——填任意字串一定失敗。
 *
 * ⚠️ **但「可接受的輸入」比這份清單更寬，不要把它當成逐字全等的白名單**（2026-08-28 讀
 * agrabah/src/servers/app_back_office/helpers/region_names.ts 查證）：`normalizeRegionName`
 * （同檔 62-78）在比對前會先**剝除行政區後綴**（同檔 42-49 的 REGION_NAME_SUFFIXES，含
 * 省/市/自治区/特别行政区與其繁體）並做**繁轉簡映射**（同檔 22-39 的 REGION_NAME_VARIANTS，
 * 如 廣東→广东、臺灣/台灣→台湾），所以「广东省」「廣東」「廣東省」都會通過，並一律以「广东」
 * 落庫（app_platform.ts:594）。另外同檔 52 的 REGION_NAME_PATTERN 只允許中文與英文字母。
 * 也就是說：可接受輸入 ⊋ 本清單。要避免歧義，仍建議直接送本清單回傳的值。
 *
 * ⚠️ **資料來源有兩層，回傳內容可能因後端狀態而不同**（2026-08-28 讀 app_platform.ts:555-567 與
 * helpers/china_region_names_cache.ts 查證，非推論）：
 * 1. 首選是 IP 庫實際存在的地區名（來源 `Location.ListChinaRegionNames`，經 Redis 快取、TTL 一小時，
 *    過期由下一次讀取 lazy 重載）。
 * 2. 取不到或回空（location 服務異常 / mmdb provider 回空）時，**靜默 fallback 回內建的
 *    CANONICAL_REGION_NAME_LIST**（app_platform.ts:557-563）。⚠️ 連 log 都不一定有：
 *    warning 只在 `loadChinaRegionNames` **失敗**的分支才印（app_platform.ts:558-560），
 *    **回空陣列**（例如 mmdb provider）那條 fallback 完全不 log。
 * 回傳本身沒有任何欄位標示這次走的是哪一層，呼叫端無法從結果判斷 location 是否正常——這是既有設計，
 * 不是本工具漏做。
 *
 * 顯示順序依內建名單的陣列順序（region_names.ts:10-16：4 個直轄市 → 22 個省 → 5 個自治區 →
 * 台湾、香港、澳门）；IP 庫若出現名單外的新名稱，排序鍵取 Number.MAX_SAFE_INTEGER 被排到最後、
 * 同序以 localeCompare 決勝（region_names.ts:83-92，由 app_platform.ts:565 呼叫）。
 * 注意 fallback 路徑不經過這個排序函式，因為內建名單本身就已經是該順序。
 *
 * 純讀取查詢，不修改任何資料，可安全重複呼叫。回傳無密鑰/PII 欄位。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerListIosRegionNameOptionsTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_app_platform_list_ios_region_name_options',
        {
            title: 'List legal region names for iOS high-risk region settings',
            description:
                '列出「高危地區設置」的地區名稱合法值域（rajah: AppPlatform.ListIosRegionNameOptions，' +
                '本方法無 @Permission）。回傳一個字串陣列，內容是中國省級行政區的**簡體短名**' +
                '（已剝除「省/市」等後綴，如「广东」「内蒙古」）。' +
'**這是 aladdin_platform_app_platform_list_ios_high_risk_regions 的 name 欄位正規化後的目標值域**——' +
                'rajah schema 上只標了 MaxLength(20) 看不出值域，後端寫入時會先正規化再對照，' +
                '對不上回 appRegionNotFound，所以不能填任意字串。' +
                '⚠️ 但**可接受的輸入比這份清單更寬**：後端會先剝除「省/市/自治区/特别行政区」等後綴並繁轉簡，' +
                '所以「广东省」「廣東」也會通過、並一律被存成「广东」；另外只允許中文與英文字母。' +
                '要避免歧義，建議直接送本清單回傳的值。' +
                '⚠️ 資料來源有兩層：首選是 IP 庫實際存在的地區名（Redis 快取，TTL 一小時），' +
                '取不到或回空時會**靜默 fallback 回後端內建的固定名單**，回傳裡沒有任何欄位能區分這次走的是哪一層' +
                '（而且只有「失敗」那條分支會在後端留 warning log，「回空」那條連 log 都沒有）。' +
                '無參數、不分頁、一次回全部，順序是 4 個直轄市 → 22 個省 → 5 個自治區 → 台湾、香港、澳门；' +
                'IP 庫回傳的名單外新名稱會被排在最後。' +
                '純讀取查詢，可安全重複呼叫。',
            inputSchema: {},
        },
        async () => {
            const r = await withAutoRelogin(() => remote.appBackOffice.appPlatform.ListIosRegionNameOptions());
            if (r.failed) return asErrorResult(r);

            const names = r.data?.names ?? [];
            return asTextResult({ success: true, count: names.length, names });
        },
    );
}
