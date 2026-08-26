/**
 * tools/create_or_update_support_language.ts — aladdin_platform_platform_create_or_update_support_language
 *
 * rajah: Platform.CreateOrUpdateSupportLanguage(id i32 1, languageCode string 2, status StatusEnum 3)
 * （rajah/services/platform.rajah:95-96，@Permission "AdminManagement.Setting.Language.Status.Toggle"）。
 *
 * method-category-checklist.md 第 0 節排除規則已過：非 Placeholder、非 @NoPublic；agrabah 對應實作
 * agrabah/src/servers/platform/services/platform.ts:337-345（methodCreateOrUpdateSupportLanguage）
 * 確認有真實實作，內部代理呼叫
 * `CoreBackOffice.CorePlatform.CreateOrUpdatePlatformSupportLanguage(platformId, id, languageCode, status)`
 * （agrabah/src/servers/core_back_office/services/core_platform.ts:83-136）。
 *
 * 分類：method-category-checklist.md 第 4 節「Upsert/CreateOrUpdate」，但 ⚠️ **這支不是通用的部分欄位
 * 合併模式，是兩個分支各自只認一部分參數的特殊結構**，2026-08-26 讀 agrabah 後端原始碼查證
 * （core_platform.ts:83-136）逐條記錄如下，這是本工具存在的核心理由（呼叫端很容易誤判成「三個欄位
 * 都會照傳入值生效」）：
 *
 * - **`id > 0`（更新既有設定）**：只有 `status` 真的會被寫入（`dbPlatformSupportedLanguage.status = status`）。
 *   **傳入的 `languageCode` 參數在這個分支完全被忽略、不會拿來比對或更新** —— 程式碼只用 `id` 定位既有
 *   row，`languageCode` 這個入參自始至終沒被讀取。id 對應到的語言若剛好是這個平台目前的
 *   `defaultLanguageCode`，一律拒絕（`requestNotValid`）——預設語言的狀態不可被這支方法改變。
 *   id 不存在（`platform_supported_languages` 查無此列）回 `idNotExists`。
 * - **`id <= 0`（新增一筆平台語言設定）**：`languageCode` 必須存在於全域母表 `supported_languages`
 *   （即 aladdin_platform_platform_list_platform_supported_languages 回傳的 `supportLanguages`），
 *   查無則回 `invalidData`；若通過檢查，**新增的 row 狀態一律寫死是 `enabled`，傳入的 `status` 參數在
 *   這個分支完全被忽略**，不論呼叫端帶什麼值都一樣強制 enabled。此分支未檢查是否已存在同
 *   languageCode 的既有 row，重複新增同一 languageCode 兩次會產生兩筆重複資料（未見去重檢查）。
 * - 兩分支皆在成功後 publish `PlatformLanguageChanged` message（非同步 `.then()`），無回傳 id
 *   （新增分支的新 id 需另外呼叫 list 工具讀回取得）。
 *
 * 因為兩分支各自忽略一個參數且行為差異很大，本工具不做「先讀現值只覆蓋要改欄位」這種通用 upsert
 * 合併（那套假設不適用這支——沒有欄位是可合併的，只有兩條互斥分支），改為：呼叫端必須先呼叫
 * aladdin_platform_platform_list_platform_supported_languages 取得 `supportLanguages`（合法
 * languageCode 清單）與 `platformLanguages`（既有 id 清單，用來判斷是否已存在對應設定），tool
 * description 完整揭露兩分支各自的參數生效範圍，避免呼叫端誤填被忽略的欄位以為它有作用。
 *
 * 純狀態轉換 + 新增寫入，無多語系欄位，無需 round-trip 合併保留其餘欄位（新增分支狀態固定
 * enabled、更新分支只動 status，天生沒有「不小心覆蓋掉其他欄位」的風險）。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { STATUS_MAP, STATUS_KEYS } from '../const.ts';

export function registerCreateOrUpdateSupportLanguageTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_platform_create_or_update_support_language',
        {
            title: 'Create or update a platform language support setting',
            description:
                '新增或修改當前平台的語言支援設定（rajah: Platform.CreateOrUpdateSupportLanguage，需要權限節點 ' +
                'AdminManagement.Setting.Language.Status.Toggle）。⚠️ 這不是通用的欄位合併 upsert，是兩條互斥' +
                '分支、各自只認一部分參數，誤填會被靜默忽略：' +
                '【更新，id>0】只有 status 會被寫入，languageCode 參數在這個分支完全被忽略（不會拿來比對或' +
                '更新既有 row 的語言代碼）；id 對應的語言若是本平台目前的預設語言，一律拒絕（不可改變預設' +
                '語言的狀態，errorCode=7，2026-08-26 dev 實測確認）；id 不存在回錯誤（errorName 可能顯示' +
                '「(未知錯誤碼)」，因為底層錯誤碼落在 genie 框架層通用碼、不在 AgrabahErrorCodeEnum 反查表' +
                '涵蓋範圍，這不代表沒有錯誤，仍以 success=false 為準）。' +
                '【新增，id<=0 或省略】languageCode 必須是系統全域支援的語言代碼（合法值來自 ' +
                'aladdin_platform_platform_list_platform_supported_languages 回傳的 supportLanguages），' +
                '不合法回 errorCode=9（2026-08-26 dev 實測確認）；status 參數在這個分支完全被忽略，新增的' +
                '設定一律強制是 enabled，不論傳入什麼' +
                'status 值都一樣；此分支不檢查是否已存在同 languageCode 的既有設定，重複新增同一語言代碼會' +
                '產生重複資料，呼叫前請先用 aladdin_platform_platform_list_platform_supported_languages 的 ' +
                'platformLanguages 確認是否已存在，已存在應改用更新分支（帶上該筆的 id）而非重複新增。' +
                '新增分支無回傳 id，需另外呼叫 aladdin_platform_platform_list_platform_supported_languages ' +
                '讀回取得新 id。' +
                'prod 執行前確認：當這個 server 是正式環境（prod）時，執行本工具前必須先用 AskUserQuestion' +
                '（或功能相同的方式）明確詢問使用者是否要在正式環境執行這個操作，取得明確同意後才可以帶上' +
                'confirm 參數；絕不能自行假設使用者同意。非 prod 環境不需要、也會忽略 confirm 欄位。',
            inputSchema: {
                id: z.number().int().default(0).describe(
                    '0 或省略代表新增一筆新的語言支援設定；大於 0 代表更新該 id 既有的設定（id 來自 ' +
                    'aladdin_platform_platform_list_platform_supported_languages 的 platformLanguages）',
                ),
                languageCode: z.string().min(1).describe(
                    '語言代碼。⚠️ 只有 id<=0（新增）時才會生效，且必須是 ' +
                    'aladdin_platform_platform_list_platform_supported_languages 回傳的 supportLanguages 之一；' +
                    'id>0（更新）時這個欄位會被完全忽略，仍須帶一個非空字串（zod 必填，實際不會被使用）',
                ),
                status: z.enum(STATUS_KEYS).describe(
                    '目標狀態。⚠️ 只有 id>0（更新）時才會生效；id<=0（新增）時這個欄位會被完全忽略，' +
                    '新增的設定一律強制 enabled',
                ),
                confirm: z.string().optional().describe(
                    `正式環境（prod）專用的強制確認欄位；非 prod 環境會被忽略、不需提供。當這個 server 是正式環境時，` +
                    `必須先取得使用者明確同意，再帶上精確字串 "${ PROD_CONFIRM_TOKEN }" 才會執行，否則本工具會拒絕執行並回錯誤。`,
                ),
            },
        },
        async ({ id, languageCode, status, confirm }) => {
            assertProdConfirmed(confirm);
            const r = await withAutoRelogin(() => remote.platform.main.CreateOrUpdateSupportLanguage(id, languageCode, STATUS_MAP[ status ]));
            if (r.failed) return asErrorResult(r);

            return asTextResult({
                success: true,
                mode: id > 0 ? 'update' : 'create',
                note: id > 0
                    ? 'languageCode 參數已被忽略（更新分支只動 status）'
                    : 'status 參數已被忽略（新增分支一律強制 enabled）；新 id 請另外呼叫 list 工具讀回',
            });
        },
    );
}
