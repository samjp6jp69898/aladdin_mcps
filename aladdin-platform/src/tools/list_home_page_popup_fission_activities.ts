/**
 * tools/list_home_page_popup_fission_activities.ts — aladdin_platform_ad_home_page_pop_up_platform_get_fission_activity_options
 *
 * rajah: AdHomePagePopUpPlatform.GetFissionActivityOptions() (rows [AdFissionActivityOption] 1)
 * （advertisement_back_office.rajah:116-117，method 自己獨立掛 @Permission "Advertisement.HomePagePopUp"，
 * 跟 GetConfigs 共用同一個權限節點字串，各自獨立掛在 method 上，不是靠 service 級 @Permission "Advertisement" 繼承）
 *
 * 用途：`aladdin_platform_ad_home_page_pop_up_platform_create_config`/`..._edit_config` 的
 * `forward.fission` 欄位吃的就是這裡回傳的 `key`（裂變活動 key），本 tool 補上這兩支工具檔頭
 * 提到「本 server 目前未包裝該查詢 tool」的缺口。
 *
 * 2026-08-25 讀 agrabah 後端原始碼查證（非空殼，真的讀資料）：
 * `ad_home_page_pop_up.ts:164-170` methodGetFissionActivityOptions → `cache_manager.ts:727-768`
 * `getFissionActivityOptions`：
 * - 讀本平台 settings 的 `fission.activity.list`（透過 `@NoPublic` 的 `Platform.GetFissionActivityListSetting`
 *   RPC，非直接查表），解析 JSON 後把每個 key 轉成 `{key, name}`；`name` 缺漏時直接用 `key` 當顯示名（fallback）。
 * - **平台未配置這個 setting 時回空陣列，不報錯**（`objectNotFound` 被特別處理成空清單，`cache_manager.ts:734-738`）；
 *   設定值為空字串/空白同樣回空陣列（:744-748）；JSON 解析失敗或內容不是物件（陣列/字串/數字/null）回
 *   `errorCode=invalidData`（:749-759）——這三種情況都不是「工具或呼叫方式錯誤」，是平台端設定資料狀態本身的差異。
 * - **per-platform in-process LRU 快取**（`cache_manager.ts:711-714`，TTL 5 分鐘，上限 100 筆），意即剛在
 *   platform 後台改了 `fission.activity.list` 設定，5 分鐘內查這支可能還是舊值——沒有主動失效機制。
 * - `sign`/`privateKey` 這類裂變活動的敏感欄位不會出現在回傳（只回 key/name 顯示用欄位），符合原始碼註解
 *   「只回顯示用欄位」的說明。
 * - 三種廣告類型（首頁彈窗/浮窗/輪播）共用同一份底層讀取邏輯與同一份 per-platform 快取，各自 service 各自一支
 *   同名 rajah method 包裝，本 tool 只包裝 `AdHomePagePopUpPlatform` 這一支（首頁彈窗用）。
 *
 * 2026-08-25 dev（pk-platform.alddev.com）實測：用真正的 `@modelcontextprotocol/sdk`
 * `StdioClientTransport` + `tools/call`（非直打 remote.gen.ts）驗證，見 handler 呼叫處與 README。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerListHomePagePopupFissionActivitiesTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_ad_home_page_pop_up_platform_get_fission_activity_options',
        {
            title: 'List fission activity options for home page popup forward target',
            description:
                '列出本平台可用的裂變活動選項（rajah: AdHomePagePopUpPlatform.GetFissionActivityOptions，無參數）。' +
                '回傳的 `key` 就是 `aladdin_platform_ad_home_page_pop_up_platform_create_config`/`..._edit_config` ' +
                '的 `forward.fission` 欄位要帶的值；`name` 是顯示用名稱，缺漏時後端會直接用 `key` 頂替。' +
                '本平台若未配置裂變活動設定（fission.activity.list），回傳空陣列，不是錯誤——不代表這個 forward ' +
                '類型不可用，只是目前沒有可選的活動。**5 分鐘 per-platform 快取**，剛在後台改過設定時查到的可能是舊值。',
            inputSchema: {},
        },
        async () => {
            const r = await withAutoRelogin(() => remote.advertisementBackOffice.adHomePagePopUpPlatform.GetFissionActivityOptions());
            if (r.failed) return asErrorResult(r);
            return asTextResult({ success: true, rows: r.data?.rows ?? [] });
        },
    );
}
