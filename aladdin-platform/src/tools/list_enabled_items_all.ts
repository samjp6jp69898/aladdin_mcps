/**
 * tools/list_enabled_items_all.ts — aladdin_platform_inventory_platform_list_enabled_items_all
 *
 * rajah: InventoryPlatform.ListEnabledItemsAll（inventory_back_office.rajah:439，無參數、無分頁）。
 *
 * method-category-checklist.md 第 2 節「完全不分頁的全撈」子類：agrabah 後端
 * methodListEnabledItemsAll（inventory_platform.ts:330-339）呼叫
 * InventoryManager.getAllItems(context, platformId, onlyEnabled=true)，SQL 只帶
 * `platform_id = ? AND status = ?`，沒有 LIMIT——是「本平台目前啟用中的道具」全集，
 * 語意上屬策劃維護的小型清單（供下拉選單一次載入用），不是會持續成長的 log 類表。
 *
 * **與 list_items 的關鍵差異（讀原始碼證實，非猜測）**：`getAllItems()`（inventory_manager.ts:1343-1355）
 * 只查 `DbItem` 本體表（實際欄位只有 id/platformId/category/status/backpackVisible，
 * database_types/inventory.ts:4-12），沒有像 `methodListItems`（inventory_platform.ts:273-303）
 * 那樣額外 JOIN/組裝 commonDetail/depositWithdrawDetail。name/icon 是後續呼叫
 * `assignItemsLocalizations(context, items, false)`（inventory_platform.ts:336）另外查
 * localization 表補上的，**第三參數 `includeLongDescription=false` 代表 description 完全不會
 * 被填入**（inventory_manager.ts:167-179：只 assign `ItemLocalizationFields`＝name+icon，跳過
 * `ItemLongLocalizationFields`＝description；對照 `methodListItems` 帶的是 `true`，
 * inventory_platform.ts:305）——回傳的每筆 `description` 欄位永遠是空值，不是這支 tool 的限制，
 * 是後端刻意省略長文本查詢以降低這支「全撈」method 的負擔。也**不篩選 category**、
 * **不支援分頁**，且只回傳 `status===enabled` 的道具（停用道具不會出現，需要含停用的總表或完整
 * description/detail 請改用 list_items）。
 *
 * 2026-08-25 dev 實測（pk-platform.alddev.com）：回傳 33 筆，全數 status=enabled、
 * 皆不含 commonDetail/depositWithdrawDetail，與用 list_items(status=enabled) 交叉比對
 * id 集合一致。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { formatItemRow } from './create_or_update_item.ts';

export function registerListEnabledItemsAllTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_inventory_platform_list_enabled_items_all',
        {
            title: 'List all enabled store items (no pagination, no detail)',
            description:
                '取得本平台「商城 → 道具」目前啟用中（status=enabled）的道具全集（rajah: InventoryPlatform.ListEnabledItemsAll，' +
                '無參數、不分頁，一次撈全部），常用於下拉選單需要一次載入全部道具選項的場景，停用道具不會出現在結果中。' +
                '注意：回傳的每筆只有 id/category/name/status/backpackVisible/icon，**description 永遠是空值**' +
                '（後端這支 method 呼叫 assignItemsLocalizations 時帶 includeLongDescription=false，刻意不查長文本），' +
                '也**不含 commonDetail/depositWithdrawDetail**（讀 agrabah 原始碼證實，這支底層查詢沒有組裝這兩個巢狀物件）；' +
                '若需要道具說明（description）或完整細項，請改用 ' +
                'aladdin_platform_inventory_platform_list_items。' +
                '也不支援 category 篩選——若只想要某個類別，需自行在回傳結果中過濾。',
            inputSchema: {},
        },
        async () => {
            const r = await withAutoRelogin(() => remote.inventoryBackOffice.inventoryPlatform.ListEnabledItemsAll());
            if (r.failed) return asErrorResult(r);
            // 這支不含 depositWithdrawDetail，formatItemRow 對缺少該欄位的 row 是 no-op，
            // 純粹統一與 list_items 相同的輸出格式（一致性考量，非本工具需要格式化任何欄位）。
            const rows = (r.data?.rows ?? []).map((row) => formatItemRow(row as unknown as Record<string, unknown>));
            return asTextResult({ success: true, rows });
        },
    );
}
