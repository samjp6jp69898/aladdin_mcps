/**
 * tools/get_supported_languages.ts — aladdin_platform_platform_get_supported_languages
 *
 * rajah: Platform.GetSupportedLanguages() (defaultLanguageCode string 1, languages [string] 2)
 * （rajah/services/platform.rajah:81，service Platform 定義於同檔 80 行，非 @NoPublic，
 * 本方法無 @Permission、無任何輸入參數）。
 *
 * method-category-checklist.md 第 0 節排除規則已過：非 Placeholder、非 @NoPublic；agrabah 對應實作
 * agrabah/src/servers/platform/services/platform.ts:274（methodGetSupportedLanguages）確認有真實
 * 實作，非 base class 的 notImplemented，內部透過跨 server RPC 呼叫
 * context.remote.core.main.GetPlatformSupportedLanguages(context.platformId) 取得資料。
 *
 * 分類：method-category-checklist.md 第 1 節「讀取單筆」的極簡版——無輸入參數，直接回傳當前平台
 * （依登入 token 綁定的 platformId）的語言設定，不涉及 id 查找、無跨租戶風險。
 *
 * 與同檔 ListPlatformSupportedLanguages 的差異（agrabah 原始碼註解 platform.ts:394 明載）：
 * 本方法只回傳語言代碼陣列（defaultLanguageCode + languages），ListPlatformSupportedLanguages
 * 額外回傳更詳細的 platformLanguages 物件（含 id/status），適用於管理頁面；兩者不是同一支
 * method 的別名，各自對應不同的 rajah method，未合併命名。
 *
 * 純讀取查詢，不修改任何資料，可安全重複呼叫。無密鑰/PII 欄位，不需遮罩。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerGetSupportedLanguagesTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_platform_get_supported_languages',
        {
            title: 'Get current platform supported languages',
            description:
                '取得當前平台（依登入 token 綁定的 platformId）支援的語言設定（rajah: Platform.GetSupportedLanguages，' +
                '無 @Permission，只要登入後台即可查詢）。無輸入參數。回傳 defaultLanguageCode（預設語言代碼）與 ' +
                'languages（支援的語言代碼陣列）。若需要更詳細的語言物件（含 id/status，適用於管理頁面編輯），' +
                '改用 aladdin_platform_platform_list_platform_supported_languages。純讀取查詢，可安全重複呼叫。',
            inputSchema: {},
        },
        async () => {
            const r = await withAutoRelogin(() => remote.platform.main.GetSupportedLanguages());
            if (r.failed) return asErrorResult(r);

            return asTextResult({
                success: true,
                defaultLanguageCode: r.data?.defaultLanguageCode,
                languages: r.data?.languages ?? [],
            });
        },
    );
}
