/**
 * tools/set_backoffice_default_language.ts — aladdin_platform_platform_set_backoffice_default_language
 *
 * rajah: Platform.SetBackofficeDefaultLanguage(languageCode string 1)
 * （rajah/services/platform.rajah:103-104，@Permission "AdminManagement.Setting.PlatformLang"）。
 *
 * 跟 aladdin_platform_platform_get_backoffice_supported_languages / 同檔
 * aladdin_platform_platform_toggle_backoffice_language_status 是同一批「後台介面語言鎖」資料，管的
 * 是後台管理頁面本身可切換的語言，不是 app 前台支援語言（見 get_backoffice_supported_languages.ts
 * 檔頭的完整區分說明）。
 *
 * method-category-checklist.md 第 0 節排除規則已過：非 Placeholder、非 @NoPublic；agrabah 對應實作
 * agrabah/src/servers/platform/services/platform.ts:378-382（methodSetBackofficeDefaultLanguage）
 * 確認有真實實作，代理呼叫
 * `CoreBackOffice.CorePlatform.SetBackofficeDefaultLanguage(platformId, languageCode)`。
 *
 * 分類：介於 method-category-checklist.md 第 6 節「狀態轉換」（`isDefault` 本質是單選狀態，設定新
 * 預設等同把舊預設狀態改掉）與純寫入之間，但更精確地說是「指定當前這批資料中唯一一筆為預設」的
 * 語意，不吃 status 參數。
 *
 * 2026-08-26 讀 agrabah 後端原始碼查證（core_platform.ts:339-388，該檔案內建完整業務規則註解，已
 * 逐條核對程式碼與註解一致）：
 * - **目標語言必須是 enabled 狀態**：若目標語言目前是 disabled，一律拒絕（`requestNotValid`，須先用
 *   aladdin_platform_platform_toggle_backoffice_language_status 啟用該語言，才能設為預設）。
 * - **交易內原子切換**：先清除該平台舊的 `is_default=1`，再把新目標設為 `is_default=1`，確保任何時刻
 *   都剛好一筆預設語言，不會出現 0 筆或多筆預設的中間態。
 * - `languageCode` 對這個平台不存在時回 `idNotExists`。
 * - 檢查與寫入之間同樣用 `globalLock`（key 依 platformId，跟 ToggleBackofficeLanguageStatus 共用同一把
 *   鎖）包住，鎖搶不到回 `exceedRequestLimit`（非驗證錯誤，可稍後重試）。
 * - **不可逆的連帶效果（讀碼推論，2026-08-26 未實測驗證）**：設定新預設語言後，`ToggleBackofficeLanguageStatus`
 *   會拒絕停用這個新預設語言（見同目錄 toggle 工具檔頭說明），也就是說呼叫本工具會改變「下次呼叫 toggle
 *   工具時哪個語言碼不能被停用」這個約束對象；本工具本身沒有額外的破壞性，純粹是切換一個旗標。
 *
 * 對同一語言重複呼叫（該語言已經是預設）2026-08-26 未實測，讀碼推論會照常執行 clear+set（先清除自己的
 * is_default=1 再重新設回 1），理論上是無害的 no-op，但如實記錄為推論而非斷言。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerSetBackofficeDefaultLanguageTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_platform_set_backoffice_default_language',
        {
            title: 'Set the default backoffice interface language',
            description:
                '把當前平台「後台介面語言鎖」裡的某個語言設為預設語言（rajah: Platform.SetBackofficeDefaultLanguage，' +
                '需要權限節點 AdminManagement.Setting.PlatformLang）。languageCode 建議先用 ' +
                'aladdin_platform_platform_get_backoffice_supported_languages 查詢。' +
                '⚠️ 目標語言必須目前是 enabled 狀態，否則拒絕（requestNotValid，errorCode=7）——若目標語言是' +
                'disabled，需先呼叫 aladdin_platform_platform_toggle_backoffice_language_status 啟用它。' +
                'languageCode 對本平台不存在時回 idNotExists（errorCode=11）。' +
                '成功後舊預設語言會被自動取消預設（交易內原子切換，任何時刻都剛好一筆預設語言）；設為新' +
                '預設後，該語言在被停用前必須先透過本工具把預設轉移給其他語言（呼叫 ' +
                'aladdin_platform_platform_toggle_backoffice_language_status 停用目前的預設語言會被拒絕）。' +
                '後端用全域鎖包住檢查與寫入，短時間內對同一平台連續呼叫可能因搶鎖失敗回 exceedRequestLimit' +
                '（errorCode=23），不代表操作本身有誤，可稍後再試一次。' +
                'prod 執行前確認：當這個 server 是正式環境（prod）時，執行本工具前必須先用 AskUserQuestion' +
                '（或功能相同的方式）明確詢問使用者是否要在正式環境執行這個操作，取得明確同意後才可以帶上' +
                'confirm 參數；絕不能自行假設使用者同意。非 prod 環境不需要、也會忽略 confirm 欄位。',
            inputSchema: {
                languageCode: z.string().min(1).describe(
                    '要設為預設的語言代碼，必須目前是 enabled 狀態，來自 ' +
                    'aladdin_platform_platform_get_backoffice_supported_languages 的回傳結果',
                ),
                confirm: z.string().optional().describe(
                    `正式環境（prod）專用的強制確認欄位；非 prod 環境會被忽略、不需提供。當這個 server 是正式環境時，` +
                    `必須先取得使用者明確同意，再帶上精確字串 "${ PROD_CONFIRM_TOKEN }" 才會執行，否則本工具會拒絕執行並回錯誤。`,
                ),
            },
        },
        async ({ languageCode, confirm }) => {
            assertProdConfirmed(confirm);
            const r = await withAutoRelogin(() => remote.platform.main.SetBackofficeDefaultLanguage(languageCode));
            if (r.failed) return asErrorResult(r);

            return asTextResult({ success: true, defaultLanguageCode: languageCode });
        },
    );
}
