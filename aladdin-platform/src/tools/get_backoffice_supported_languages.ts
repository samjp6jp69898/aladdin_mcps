/**
 * tools/get_backoffice_supported_languages.ts — aladdin_platform_platform_get_backoffice_supported_languages
 *
 * rajah: Platform.GetBackofficeSupportedLanguages() (rows [PlatformBackofficeLanguage] 1)
 * （rajah/services/platform.rajah:100，service Platform 定義於同檔 80 行，非 @NoPublic，本方法無
 * @Permission、無任何輸入參數。model PlatformBackofficeLanguage：core.rajah:267-276，
 * id（@Hide）/status（ActiveStatusEnum）/isDefault（bool）/languageCode（string）。）
 *
 * ⚠️ 跟同檔 GetSupportedLanguages/ListPlatformSupportedLanguages 是完全不同的概念，不要混淆：
 * - GetSupportedLanguages/ListPlatformSupportedLanguages 管的是「本平台前台（app）支援哪些語言」。
 * - 本工具管的是「這個平台**後台**（管理員登入的 admin/platform 頁面本身）可切換的介面語言鎖」
 *   （後台「系統管理 > 設定 > 語言管理」頁面），資料來源是不同的後端 method
 *   （`CorePlatform.GetPlatformBackofficeLanguages`）與不同的 rajah model
 *   （`PlatformBackofficeLanguage`，非 `PlatformSupportedLanguagesEssential`）。
 * - 對應的寫入方法是 `Platform.ToggleBackofficeLanguageStatus`（platform.rajah:101-102，
 *   @Permission "AdminManagement.Setting.PlatformLang"），已包成
 *   aladdin_platform_platform_toggle_backoffice_language_status（同批次後續 commit）。
 *
 * ⚠️ 本工具不回傳 `id`（該欄位 @Hide，API 仍會回傳值，只是表單不顯示）：讀 platform.rajah 確認對應的
 * 寫入方法 `ToggleBackofficeLanguageStatus(languageCode, newStatus)` 與同 service 另一支
 * `SetBackofficeDefaultLanguage(languageCode)` 皆以 `languageCode` 為定位鍵，不吃 `id`，呼叫端不需要
 * `id` 也能操作，因此選擇省略（判斷依據同 get_activity_tabs.ts 對 @Hide 欄位的取捨方式：欄位是否為
 * 下游寫入方法的定位鍵——那邊保留 id 是因為對應寫入方法真的吃 id，本例判斷依據相同、結論相反）。
 *
 * method-category-checklist.md 第 0 節排除規則已過：非 Placeholder、非 @NoPublic；agrabah 對應實作
 * agrabah/src/servers/platform/services/platform.ts:353-358（methodGetBackofficeSupportedLanguages）
 * 確認有真實實作，代理呼叫 `CoreBackOffice.CorePlatform.GetPlatformBackofficeLanguages(platformId)`。
 *
 * 分類：method-category-checklist.md 第 2 節「讀取清單」——無參數、不分頁全撈（後台介面語言鎖屬小型
 * 列舉規模，無 B 級分頁風險）。`status` 是 `ActiveStatusEnum`（enabled=1/disabled=2），跟本 server 其餘
 * 多數欄位用的 `StatusEnum`（unknown=0/enabled=1/disabled=2/frozen=3/deleted=10）數值上 enabled/disabled
 * 相同但列舉定義不同（const.ts 的 ACTIVE_STATUS_MAP 對應此欄位，非 STATUS_MAP）。
 *
 * 純讀取查詢，不修改任何資料，可安全重複呼叫。無密鑰/PII 欄位，不需遮罩。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { ACTIVE_STATUS_MAP } from '../const.ts';

/** 數字 → 對照表 key 的字串；查不到已知 key 時原樣回傳數字，不讓未知值消失。同本 server 其餘檔案
 * （get_customer_config_restrict.ts、get_otp_sms_settings.ts、get_message_board_setting.ts 等）
 * 各自定義的同名 generic helper，維持一致寫法與 null/undefined 語意，不另外集中到 const.ts。 */
function describeEnum<T extends Record<string, number>>(map: T, value: number | null | undefined): string | number {
    if (value === null || value === undefined) return value as never;
    const hit = Object.entries(map).find(([ , v ]) => v === value);
    return hit ? hit[ 0 ] : value;
}

export function registerGetBackofficeSupportedLanguagesTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_platform_get_backoffice_supported_languages',
        {
            title: 'Get backoffice interface language lock settings',
            description:
                '取得當前平台「後台介面語言鎖」設定（rajah: Platform.GetBackofficeSupportedLanguages，' +
                '無 @Permission，只要登入後台即可查詢）。⚠️ 管的是後台管理頁面本身可切換的介面語言，不是' +
                'app 前台支援的語言（那是 aladdin_platform_platform_get_supported_languages / ' +
                'aladdin_platform_platform_list_platform_supported_languages 的範圍，兩者資料來源與 model ' +
                '完全不同，不可混淆）。無輸入參數，不分頁全撈。回傳每筆的 status 是 ActiveStatusEnum' +
                '（enabled/disabled，跟本 server 多數欄位用的 StatusEnum 是不同列舉，僅 enabled/disabled ' +
                '數值剛好相同）、isDefault 標示是否為預設後台語言。純讀取查詢，可安全重複呼叫。',
            inputSchema: {},
        },
        async () => {
            const r = await withAutoRelogin(() => remote.platform.main.GetBackofficeSupportedLanguages());
            if (r.failed) return asErrorResult(r);

            return asTextResult({
                success: true,
                rows: (r.data?.rows ?? []).map(row => ({
                    languageCode: row.languageCode,
                    status: describeEnum(ACTIVE_STATUS_MAP, row.status as number),
                    isDefault: row.isDefault,
                })),
            });
        },
    );
}
