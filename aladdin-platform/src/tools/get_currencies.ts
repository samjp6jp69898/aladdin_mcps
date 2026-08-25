/**
 * tools/get_currencies.ts — aladdin_platform_currency_platform_get_currencies
 *
 * rajah: CurrencyPlatform.GetCurrencies(enabledOnly bool 1) (currencies [Currency] 1)
 * （rajah/services/core.rajah:22-23，service 定義於同檔 22-32 行，非 @NoPublic，本方法無 @Permission）。
 *
 * method-category-checklist.md 第 0 節排除規則已過：非 Placeholder、非 @NoPublic（同檔另一支
 * service Currency 才有 @NoPublic，core.rajah:1）；agrabah 對應實作
 * agrabah/src/servers/core_back_office/services/currency_platform.ts（methodGetCurrencies）
 * 確認有真實實作，非 base class 的 notImplemented，透過跨 server RPC 呼叫 core.currency.List
 * 取得資料（非直接查 DB）。
 *
 * 分類：method-category-checklist.md 第 2 節「讀取清單」——回傳不分頁的 `currencies` 陣列。幣別是
 * 全域小型列舉表（非持續成長的業務表），屬於「完全不分頁的全撈：語意上是小型列舉表可放心用」，
 * 2026-08-25 dev 實測僅 6 筆。
 *
 * 與 aladdin-admin 的 aladdin_admin_currency_admin_get_currencies 差異：這支查的是 Platform 後台視角
 * （CurrencyPlatform.GetCurrencies），對應的 aladdin_admin_currency_admin_update_currency 屬於 admin
 * 端寫入（CurrencyAdmin.UpdateCurrency）；platform 端的寫入能力只有
 * aladdin_platform_currency_platform_update_currency_status（啟停），沒有名稱/顯示位數的寫入能力。
 *
 * ⚠️ **`status` 欄位語意在兩端不同，不是同一份資料的兩種視角**（2026-08-25 讀源碼查證，非推論）：
 * 底層都委派 `Core` server 的 `_ListCurrencies`（agrabah/src/servers/core/services/currency.ts:89-126），
 * 但該函式會依呼叫端傳入的 `platformId` 重寫 `status` 欄位——`context.remote.core.currency.List` 的
 * `context.platformId` 對 admin 端固定是 0（admin 角色不綁定平台），此時 `status`=DB 原始的**全域**啟停狀態；
 * 對 platform 端則是該平台在 `platform_supported_currencies` 表的**平台級**啟停狀態（該表沒收錄的幣別，
 * 即使全域是 enabled，也會被改寫成 disabled，見 currency.ts:111-121）。也就是說本工具回傳的 `status`
 * 代表「這個幣別在**當前這個 platform** 底下是否可用」，跟 aladdin-admin 那支回傳的全域 `status` 是兩個
 * 不同層級的概念，不能互相替代判讀。
 *
 * ⚠️ **兩端的「列集合」本身也可能不同，不只是 status 欄位語意不同**（第二輪 review 對抗性檢驗發現，
 * 第一版文件遺漏）：`currency.ts:111` 在建立 platform 視角前，會先用
 * `this.currencyMap.get(0).filter(currency => currency.status === StatusEnum.enabled)` 把**全域
 * status ≠ enabled 的幣別整批濾掉**，這些幣別完全不會出現在 platform 端 GetCurrencies 的回傳裡——
 * 即使 `enabledOnly=false`。也就是說 `enabledOnly=false` 在本工具的「全部」只代表「當前平台視角下、
 * 且全域仍是 enabled 的全部」，不是真正的全部；被 admin 端全域停用的幣別，即使曾在本平台啟用過，
 * 本工具也會完全查不到（不是回傳 status=disabled，而是整列消失）。若呼叫端拿 admin 端與 platform 端
 * 兩份清單互相比對，platform 端少掉的那些不代表「幣別不存在」，可能只是全域已停用；id/code/name/
 * symbol/type/decimalPlaces/displayDigits 在兩端都出現的列上是同一份全域資料、值一致，但兩端出現的
 * 列的**集合**可能不同。
 *
 * 純讀取查詢，不修改任何資料，可安全重複呼叫。無密鑰/PII 欄位，不需遮罩。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerGetCurrenciesTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_currency_platform_get_currencies',
        {
            title: 'List global currencies (platform view)',
            description:
                '列出幣別清單（rajah: CurrencyPlatform.GetCurrencies，無 @Permission，只要登入後台即可查詢）。' +
                '不分頁、一次全撈（幣別母表是小型全域列舉表，2026-08-25 dev 實測僅 6 筆）。' +
                '⚠️ 回傳的 status 是「這個幣別在當前這個 platform 底下是否啟用」（平台級狀態，來自 ' +
                'platform_supported_currencies 表），不是全域狀態——與 aladdin-admin 的 ' +
                'aladdin_admin_currency_admin_get_currencies 回傳的全域 status 是兩個不同概念，同一顆幣別' +
                '兩邊的 status 可能不同，不能互相替代判讀。' +
                '⚠️ 本工具的清單只涵蓋「全域仍是 enabled」的幣別——被 aladdin-admin 端全域停用的幣別，' +
                '即使曾在本平台啟用過，會整列從清單消失（不是顯示成 disabled），enabledOnly=false 也一樣' +
                '查不到；若要確認某幣別是否存在，請改用 aladdin_admin_currency_admin_get_currencies。' +
                '若需要啟用/停用某幣別在當前平台底下的狀態，改用 ' +
                'aladdin_platform_currency_platform_update_currency_status。純讀取查詢，可安全重複呼叫。',
            inputSchema: {
                enabledOnly: z.boolean().optional().describe(
                    '是否只列出「平台級啟用」的幣別；省略預設為 false（列出當前平台視角下的全部，含平台級已停用者。' +
                    '注意：全域已停用的幣別無論此參數為何都不會出現在清單裡，見上方 description）',
                ),
            },
        },
        async ({ enabledOnly }) => {
            const r = await withAutoRelogin(() => remote.coreBackOffice.currencyPlatform.GetCurrencies(enabledOnly ?? false));
            if (r.failed) return asErrorResult(r);

            return asTextResult({ success: true, currencies: r.data?.currencies ?? [] });
        },
    );
}
