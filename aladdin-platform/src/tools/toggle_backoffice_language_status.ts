/**
 * tools/toggle_backoffice_language_status.ts — aladdin_platform_platform_toggle_backoffice_language_status
 *
 * rajah: Platform.ToggleBackofficeLanguageStatus(languageCode string 1, newStatus ActiveStatusEnum 2)
 * （rajah/services/platform.rajah:101-102，@Permission "AdminManagement.Setting.PlatformLang"）。
 *
 * 對應查詢工具是 aladdin_platform_platform_get_backoffice_supported_languages（同一批資料，管的是
 * 後台管理頁面本身可切換的介面語言鎖，不是 app 前台支援語言，見該工具檔頭註解的區分說明）。
 *
 * method-category-checklist.md 第 0 節排除規則已過：非 Placeholder、非 @NoPublic；agrabah 對應實作
 * agrabah/src/servers/platform/services/platform.ts:366-370（methodToggleBackofficeLanguageStatus）
 * 確認有真實實作，代理呼叫
 * `CoreBackOffice.CorePlatform.ToggleBackofficeLanguageStatus(platformId, languageCode, newStatus)`。
 *
 * 分類：method-category-checklist.md 第 6 節「狀態轉換」——`Toggle*` 但實際帶明確目標狀態
 * （`newStatus`），不是無參數 bit-flip。
 *
 * 2026-08-26 讀 agrabah 後端原始碼查證（core_platform.ts:268-331，該檔案內建完整業務規則註解，
 * 已逐條核對程式碼與註解一致）：
 * - **停用（newStatus=disabled）有兩條硬性限制**：(1) 目標語言若是當前平台的預設後台語言，一律拒絕
 *   （`requestNotValid`，須先用 `SetBackofficeDefaultLanguage`——本輪未包裝——切換預設語言後才能停用
 *   舊預設）；(2) 停用後若會導致該平台啟用語言數變成 0，一律拒絕（`requestNotValid`，至少保留一個
 *   啟用語言）。
 * - **啟用（newStatus=enabled）沒有特殊限制**。
 * - `languageCode` 對這個平台不存在（`platform_backoffice_languages` 查無 `platform_id+language_code`
 *   組合）回 `idNotExists`。
 * - `newStatus` 非法列舉值（`ActiveStatusEnum` 沒有的數字）回 `requestNotValid`——跟上面「停用預設/停用
 *   到全滅」共用同一個錯誤碼，呼叫端無法單從 errorCode 分辨是哪一種，需自行比對輸入是否為
 *   enabled/disabled 合法值來排除非法列舉值這個可能性。
 * - 檢查與寫入之間用 `globalLock`（key 依 platformId）包住，避免併發請求繞過「至少保留一個啟用語言」
 *   的檢查；鎖等待逾時回 `exceedRequestLimit`。
 * - 同值呼叫（newStatus 等於現值）：程式碼沒有「相同則短路」的特殊處理，會照常執行
 *   `updateObject`，2026-08-26 dev 未實測是否算「停用到全滅」（例如對已是 disabled 的語言再次呼叫
 *   disabled，是否會被算進「這次停用會不會導致 0 個啟用」的計算——讀程式碼看是用
 *   `language_code != languageCode` 排除自己再算 enabled 數，理論上同值呼叫不受這條限制影響，
 *   但未實打驗證，如實記錄為推論而非斷言）。
 *
 * 本工具不做「先讀現值再判斷是否呼叫」的短路優化——後端本身已用明確的業務規則（預設語言/最後一個
 * 啟用語言）擋下危險操作，不需要工具層額外防呆；呼叫前建議先用
 * aladdin_platform_platform_get_backoffice_supported_languages 確認目標語言目前狀態與 isDefault。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { ACTIVE_STATUS_MAP } from '../const.ts';

export function registerToggleBackofficeLanguageStatusTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_platform_toggle_backoffice_language_status',
        {
            title: 'Enable or disable a backoffice interface language',
            description:
                '啟用或停用當前平台「後台介面語言鎖」裡的某個語言（rajah: Platform.ToggleBackofficeLanguageStatus，' +
                '需要權限節點 AdminManagement.Setting.PlatformLang）。languageCode 建議先用 ' +
                'aladdin_platform_platform_get_backoffice_supported_languages 查詢，確認目標語言存在、目前狀態' +
                '與是否為預設語言。' +
                '⚠️ 停用（newStatus=disabled）有兩條硬性限制，違反皆回 errorCode=7（requestNotValid）：' +
                '(1) 不可停用目前的預設語言（isDefault=true 的那筆），需先切換預設語言（本工具無此能力）；' +
                '(2) 不可停用到讓該平台啟用語言數變成 0（至少保留一個啟用語言）。' +
                '啟用（newStatus=enabled）沒有特殊限制。languageCode 對本平台不存在時回 idNotExists（errorCode=11）。' +
                '後端用全域鎖包住檢查與寫入，短時間內對同一平台連續呼叫可能因搶鎖失敗回 exceedRequestLimit' +
                '（errorCode=23），不代表操作本身有誤，可稍後再試一次。' +
                'prod 執行前確認：當這個 server 是正式環境（prod）時，執行本工具前必須先用 AskUserQuestion' +
                '（或功能相同的方式）明確詢問使用者是否要在正式環境執行這個操作，取得明確同意後才可以帶上' +
                'confirm 參數；絕不能自行假設使用者同意。非 prod 環境不需要、也會忽略 confirm 欄位。',
            inputSchema: {
                languageCode: z.string().min(1).describe(
                    '目標語言代碼，來自 aladdin_platform_platform_get_backoffice_supported_languages 的回傳結果',
                ),
                newStatus: z.enum([ 'enabled', 'disabled' ]).describe('目標狀態'),
                confirm: z.string().optional().describe(
                    `正式環境（prod）專用的強制確認欄位；非 prod 環境會被忽略、不需提供。當這個 server 是正式環境時，` +
                    `必須先取得使用者明確同意，再帶上精確字串 "${ PROD_CONFIRM_TOKEN }" 才會執行，否則本工具會拒絕執行並回錯誤。`,
                ),
            },
        },
        async ({ languageCode, newStatus, confirm }) => {
            assertProdConfirmed(confirm);
            const r = await withAutoRelogin(() => remote.platform.main.ToggleBackofficeLanguageStatus(languageCode, ACTIVE_STATUS_MAP[ newStatus ]));
            if (r.failed) return asErrorResult(r);

            return asTextResult({ success: true, languageCode, status: newStatus });
        },
    );
}
