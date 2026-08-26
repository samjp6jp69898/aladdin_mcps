/**
 * tools/get_timezone.ts — aladdin_platform_platform_get_timezone
 *
 * rajah: Platform.GetTimezone() (timezone s32 1)
 * （rajah/services/platform.rajah:82，service Platform 定義於同檔 80 行，非 @NoPublic，
 * 本方法無 @Permission、無任何輸入參數。同 service 第 81 行 GetSupportedLanguages 已由
 * aladdin_platform_platform_get_supported_languages 包裝，本檔為姊妹 tool，同一套查證結論。）
 *
 * method-category-checklist.md 第 0 節排除規則已過：非 Placeholder、非 @NoPublic；agrabah 對應實作
 * agrabah/src/servers/platform/services/platform.ts:1223（methodGetTimezone）確認有真實實作，非
 * base class 的 notImplemented，內部透過跨 server RPC 呼叫
 * context.remote.core.main.GetPlatformDetailById(context.platformId) 讀平台詳情、取其中的
 * timezone 欄位回傳。
 *
 * 分類：method-category-checklist.md 第 1 節「讀取單筆」的極簡版——無輸入參數，直接回傳當前平台
 * （依登入 token 綁定的 platformId）的時區設定，不涉及呼叫端傳入 id 查找、無跨租戶風險。
 *
 * timezone 語意：s32，agrabah 內部直接透傳 core 端 platform 詳情的 timezone 欄位，rajah 無額外的
 * 單位/偏移量說明；2026-08-26 dev 實測（pk-platform，位於 UTC+8）回傳 28800，等於 8*3600，與
 * 「UTC 偏移秒數」的假設吻合，但這是單一平台的實測歸納，非讀到明文定義，本工具原樣透傳不做轉換，
 * description 如實只稱其為「整數」不斷言單位。
 *
 * 純讀取查詢，不修改任何資料，可安全重複呼叫。無密鑰/PII 欄位，不需遮罩。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerGetTimezoneTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_platform_get_timezone',
        {
            title: 'Get current platform timezone',
            description:
                '取得當前平台（依登入 token 綁定的 platformId）的時區設定（rajah: Platform.GetTimezone，' +
                '無 @Permission，只要登入後台即可查詢）。無輸入參數。回傳 timezone（整數，原樣透傳後端' +
                'platform 詳情裡的 timezone 欄位，未找到額外單位說明，不做任何轉換）。純讀取查詢，可安全重複呼叫。',
            inputSchema: {},
        },
        async () => {
            const r = await withAutoRelogin(() => remote.platform.main.GetTimezone());
            if (r.failed) return asErrorResult(r);

            return asTextResult({ success: true, timezone: r.data?.timezone });
        },
    );
}
