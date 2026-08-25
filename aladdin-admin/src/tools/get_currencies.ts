/**
 * tools/get_currencies.ts — aladdin_admin_currency_admin_get_currencies
 *
 * rajah: CurrencyAdmin.GetCurrencies(enabledOnly bool 1) (currencies [Currency] 1)
 * （rajah/services/core.rajah:9-10，service 定義於同檔 9-20 行，非 @NoPublic，本方法無 @Permission）。
 *
 * method-category-checklist.md 第 0 節排除規則已過：非 Placeholder、非 @NoPublic（同檔另一支
 * service Currency 才有 @NoPublic，core.rajah:1）；agrabah 對應實作
 * agrabah/src/servers/core_back_office/services/currency_admin.ts（methodGetCurrencies）確認有
 * 真實實作，非 base class 的 notImplemented，透過跨 server RPC 呼叫 core.currency.List 取得資料
 * （非直接查 DB，見該檔案頭註解）。
 *
 * 分類：method-category-checklist.md 第 2 節「讀取清單」——回傳不分頁的 `currencies` 陣列。幣別是
 * 全域小型列舉表（非持續成長的業務表），屬於「完全不分頁的全撈：語意上是小型列舉表可放心用」，
 * 2026-08-25 dev 實測僅 6 筆。
 *
 * 補上這支標準查詢入口的原因：`aladdin_admin_currency_admin_update_currency` 需要一個可公開引用、
 * 真實存在的 GetCurrencies tool 讓呼叫端取得 id（先前 create_platform.ts 只把這支 RPC當內部驗證用，
 * 沒有對外開放成獨立 tool，2026-08-25 review 發現 update_currency 的 description 引用了一個不存在
 * 的 tool 名稱，此檔補上讓引用成立）。
 *
 * 純讀取查詢，不修改任何資料，可安全重複呼叫。無密鑰/PII 欄位，不需遮罩。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerGetCurrenciesTool(server: McpServer): void {
    server.registerTool(
        'aladdin_admin_currency_admin_get_currencies',
        {
            title: 'List global currencies (admin view)',
            description:
                '列出全域幣別清單（rajah: CurrencyAdmin.GetCurrencies，無 @Permission，只要登入後台即可查詢）。' +
                '不分頁、一次全撈（幣別是小型全域列舉表，2026-08-25 dev 實測僅 6 筆）。' +
                '回傳的 id 供 aladdin_admin_currency_admin_update_currency 使用；code 供 ' +
                'aladdin_admin_platform_management_create_platform 的 defaultCurrencyCode 欄位驗證使用。' +
                '純讀取查詢，可安全重複呼叫。',
            inputSchema: {
                enabledOnly: z.boolean().optional().describe('是否只列出已啟用的幣別；省略預設為 false（列出全部，含已停用）'),
            },
        },
        async ({ enabledOnly }) => {
            const r = await withAutoRelogin(() => remote.coreBackOffice.currencyAdmin.GetCurrencies(enabledOnly ?? false));
            if (r.failed) return asErrorResult(r);

            return asTextResult({ success: true, currencies: r.data?.currencies ?? [] });
        },
    );
}
