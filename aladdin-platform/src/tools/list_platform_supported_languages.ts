/**
 * tools/list_platform_supported_languages.ts — aladdin_platform_platform_list_platform_supported_languages
 *
 * rajah: Platform.ListPlatformSupportedLanguages() (supportLanguages [string] 1, platformLanguages [PlatformSupportedLanguagesEssential] 2)
 * （rajah/services/platform.rajah:98，service Platform 定義於同檔 80 行，非 @NoPublic，本方法無
 * @Permission、無任何輸入參數。）
 *
 * 與同檔 GetSupportedLanguages 的差異（agrabah 原始碼註解 platform.ts:394 明載）：GetSupportedLanguages
 * 只回傳語言代碼陣列（defaultLanguageCode + languages，已由
 * aladdin_platform_platform_get_supported_languages 包裝）；本工具額外回傳更詳細的
 * `platformLanguages` 物件（含 id/status），適用於管理頁面編輯——是
 * aladdin_platform_platform_create_or_update_support_language 的讀現值搭配查詢工具。
 *
 * method-category-checklist.md 第 0 節排除規則已過：非 Placeholder、非 @NoPublic；agrabah 對應實作
 * agrabah/src/servers/platform/services/platform.ts:396-411（methodListPlatformSupportedLanguages）
 * 確認有真實實作，非 base class 的 notImplemented。
 *
 * 2026-08-26 讀 agrabah 後端原始碼查證（platform.ts:396-411）：
 * - `supportLanguages` 來自 `CoreBackOffice.Setting.GetSupportedLanguages()`，查詢全域表
 *   `supported_languages`（`SELECT code FROM supported_languages`，setting.ts:27），這是系統
 *   全域支援的語言代碼母表（不分平台），排序後回傳。這個清單就是
 *   aladdin_platform_platform_create_or_update_support_language 新增分支（id<=0）時 languageCode
 *   參數的合法值來源（該工具內部用 `count(supported_languages WHERE code=?)` 驗證，同一張表）。
 * - `platformLanguages` 來自 `CoreBackOffice.CorePlatform.GetPlatformSupportedLanguages(platformId)`，
 *   是「這個平台目前已啟用/停用哪些語言」的清單（`PlatformSupportedLanguagesEssential[]`：
 *   id/languageCode/status），這是同一支 create_or_update tool 更新分支（id>0）的讀現值來源。
 *
 * 分類：method-category-checklist.md 第 2 節「讀取清單」——`platformLanguages`/`supportLanguages`
 * 皆為不分頁全撈（全域語言母表與單一平台的語言設定皆屬小型列舉規模，無 B 級分頁風險）。
 *
 * ⚠️ `platformLanguages[].status` 是 rajah StatusEnum 原始數字，本工具已轉成可讀字串（enabled/disabled/
 * frozen/deleted/unknown，用 const.ts 既有 STATUS_MAP 反查）——2026-08-26 dev 實測時第一版直接透傳數字，
 * 造成呼叫端（測試腳本）誤把數字 1 當成非 'enabled' 字串比較，串接
 * aladdin_platform_platform_create_or_update_support_language 時傳錯 status 導致 pk-platform 的 en-US
 * 語言設定被誤改為 disabled，已即時發現並用同一支 upsert 工具復原、確認無殘留，順手修正本工具直接
 * 回傳數字的問題，避免未來呼叫端重蹈覆轍。
 *
 * 純讀取查詢，不修改任何資料，可安全重複呼叫。無密鑰/PII 欄位，不需遮罩。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { STATUS_MAP } from '../const.ts';

function describeStatus(value: number | null | undefined): string | number {
    const found = (Object.keys(STATUS_MAP) as (keyof typeof STATUS_MAP)[]).find(key => STATUS_MAP[ key ] === value);
    return found ?? value ?? 'unknown';
}

export function registerListPlatformSupportedLanguagesTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_platform_list_platform_supported_languages',
        {
            title: 'List platform supported languages (with id/status detail)',
            description:
                '查詢語言支援設定的完整明細（rajah: Platform.ListPlatformSupportedLanguages，無 @Permission，' +
                '只要登入後台即可查詢）。無輸入參數，不分頁全撈。回傳兩個陣列：' +
                'supportLanguages 是系統全域支援的語言代碼母表（不分平台，來自 supported_languages 表）——' +
                '這就是 aladdin_platform_platform_create_or_update_support_language 新增一筆語言設定時，' +
                'languageCode 參數必須落在的合法值範圍；' +
                'platformLanguages 是當前這個平台已設定過的語言明細（id/languageCode/status），是' +
                '呼叫 create_or_update 工具前要先讀的現值，也是取得 id 以便更新既有設定的唯一來源。' +
                '純讀取查詢，可安全重複呼叫。',
            inputSchema: {},
        },
        async () => {
            const r = await withAutoRelogin(() => remote.platform.main.ListPlatformSupportedLanguages());
            if (r.failed) return asErrorResult(r);

            return asTextResult({
                success: true,
                supportLanguages: r.data?.supportLanguages ?? [],
                platformLanguages: (r.data?.platformLanguages ?? []).map(row => ({
                    id: row.id,
                    languageCode: row.languageCode,
                    status: describeStatus(row.status as number),
                })),
            });
        },
    );
}
