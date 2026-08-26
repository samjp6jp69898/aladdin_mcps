/**
 * tools/get_platform_code.ts — aladdin_platform_platform_get_platform_code
 *
 * rajah: Platform.GetPlatformCode() (code string 1)
 * （rajah/services/platform.rajah:83-84，service Platform 定義於同檔 80 行，非 @NoPublic，
 * 本方法無 @Permission、無任何輸入參數。rajah 原始碼註解：「取得目前平台的 platform code
 * （由 Gate 依 Host 判定後蓋進 request header，此處直接讀 context）」。）
 *
 * method-category-checklist.md 第 0 節排除規則已過：非 Placeholder、非 @NoPublic；agrabah 對應實作
 * agrabah/src/servers/platform/services/platform.ts:1243（methodGetPlatformCode）確認有真實實作，
 * 非 base class 的 notImplemented——直接回傳 `response.code = context.platformCode`，不呼叫任何下游
 * RPC，platformCode 是 Gate 依請求的 Host header 判定後灌進 context 的既有值。
 *
 * 分類：method-category-checklist.md 第 1 節「讀取單筆」的極簡版——無輸入參數，直接回傳當前這次
 * 呼叫（依登入 token/Host 綁定）所屬平台的 code，不涉及呼叫端傳入 id 查找、無跨租戶風險。
 *
 * 純讀取查詢，不修改任何資料，可安全重複呼叫。無密鑰/PII 欄位，不需遮罩。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerGetPlatformCodeTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_platform_get_platform_code',
        {
            title: 'Get current platform code',
            description:
                '取得當前這次呼叫所屬平台的 platform code（rajah: Platform.GetPlatformCode，' +
                '無 @Permission，只要登入後台即可查詢）。無輸入參數。code 由 Gate 依請求的 Host 判定，' +
                '不是查資料庫取得，反映的是本次連線登入所屬的平台，不是任意可指定的查詢目標。' +
                '純讀取查詢，可安全重複呼叫。',
            inputSchema: {},
        },
        async () => {
            const r = await withAutoRelogin(() => remote.platform.main.GetPlatformCode());
            if (r.failed) return asErrorResult(r);

            return asTextResult({ success: true, code: r.data?.code });
        },
    );
}
