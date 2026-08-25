/**
 * tools/get_item_names_by_id.ts — aladdin_platform_inventory_platform_get_item_names_by_id
 *
 * rajah: InventoryPlatform.GetItemNamesById（inventory_back_office.rajah:441）。
 *
 * method-category-checklist.md 第 2 節「Batch 開頭的查詢類」相關警語：agrabah 實作
 * （inventory_platform.ts:1341-1354）用 `ids.map(id => ItemName.create({ id }))` 逐一
 * 建構回傳列，**保證回傳陣列與輸入 ids 同長度、同順序**（不是先查再過濾，是先用輸入
 * id 建骨架再補 name），與該節警語描述的「不保證同長度同順序」的一般情況不同——這是
 * 讀這支特定 method 的實作才能確認的例外，不是通用假設。
 *
 * **name 是空陣列不等於 id 不存在**（2026-08-25 fable5 reviewer-b 指出，讀
 * localization_manager.ts:16-48/418-451 複驗證實）：空 name 至少有三種成因——
 * (1) 這個 id 根本不是有效道具、(2) 道具存在但沒有設定任何語言的名稱、
 * (3) 名稱只設在 default platform（platform_id=0），這支呼叫
 * `assignLocalizationsByObjects` 時沒有帶 fallback 參數（inventory_platform.ts:1345-1347），
 * 不會查 default platform 的值。只有第一種才是「id 不存在」，本 tool 不能當存在性檢查用，
 * 需要確認某個 id 是否真的是有效道具，請改用 list_items 帶 id 比對。
 * id 不存在時查詢**不會報錯**（2026-08-25 dev 實測證實），該筆也不會被過濾掉。
 *
 * 附註（兩位獨立 fable5 reviewer 皆發現）：agrabah `methodGetItemNamesById` 上方的
 * docblock 註解寫「回傳順序不保證與 ids 相同」、「掛 @Permission "Store.Item.View"」，
 * 兩者皆與現行實作/rajah 定義不符（順序實際保證；全 rajah/services 沒有
 * `Store.Item.View` 這個權限節點）——這是後端既有的過時註解，本檔以讀到的實際實作/
 * rajah 定義為準，不沿用那兩句話。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerGetItemNamesByIdTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_inventory_platform_get_item_names_by_id',
        {
            title: 'Batch get item names by id',
            description:
                '依道具 id 陣列批次查詢道具名稱（rajah: InventoryPlatform.GetItemNamesById）。' +
                '回傳陣列與輸入 ids 同長度、同順序（讀 agrabah 原始碼證實，這支是先用輸入 id 建骨架列再補 name，' +
                '不是查到才回傳），呼叫端可放心用 index 對應輸入的 ids。' +
                '**name 是空陣列不代表這個 id 不存在**——道具存在但沒設定任何語言名稱、或名稱只設在 ' +
                'default platform（本工具不會 fallback 查）都會讓 name 是空陣列；只有查詢本身失敗才會報錯，' +
                'id 不存在不會報錯也不會被過濾掉。需要確認 id 是否為有效道具，請改用 list_items 帶 id 比對，' +
                '不要用本工具的空 name 當存在性檢查。',
            inputSchema: {
                ids: z.array(z.number().int()).min(1).max(200).describe('要查詢的道具 id 陣列，最多 200 個（後端單一 IN 查詢無長度上限，此處自律設一個保守上限）'),
            },
        },
        async ({ ids }) => {
            const r = await withAutoRelogin(() => remote.inventoryBackOffice.inventoryPlatform.GetItemNamesById(ids));
            if (r.failed) return asErrorResult(r);
            return asTextResult({ success: true, rows: r.data?.rows ?? [] });
        },
    );
}
