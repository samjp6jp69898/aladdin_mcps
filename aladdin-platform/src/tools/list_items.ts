/**
 * tools/list_items.ts — aladdin_platform_inventory_platform_list_items
 *
 * rajah: InventoryPlatform.ListItems（inventory_back_office.rajah:436）
 *
 * 對應前端頁面：「商城」→「道具」總表（abu/platform/src/pages/uncategorized/ItemList.vue）。
 *
 * method-category-checklist.md 第 2 節分類：**B 級（高風險）**——`ListItemsSearch`
 * （inventory_common.rajah:120-128）只有 category/name/status 三個篩選欄位，沒有 id 這種
 * 能唯一鎖定單一目標的欄位（實測核對過整份 model，不是省略沒寫）。這代表本工具**不能**用來
 * 精確定位「某一筆特定道具」——同名同類別可能有多筆，交由呼叫端自行從回傳的 rows 裡辨識。
 * 若要用 id 找特定道具（例如 upsert 前讀現值），正確做法是逐頁掃描比對，見
 * create_or_update_item.ts 的 findItemById()，不要在這支 tool 之外重新發明一套。
 *
 * 後端查詢（agrabah inventory_platform.ts:210-311）：pageSize 是 `PageSizeEnum`（common.rajah:2438-2446），
 * **只接受 0/10/20/30/50/100/200 這幾個離散值，不是任意整數**——2026-08-25 dev 實測證實：
 * 帶 pageSize=1 直接回 errorCode=9（invalidData）。與裸 i32（如 upsert_game.ts 參照的
 * ListGames）不同，那種可以帶任意整數；本工具已用 zod enum 收斂輸入，避免呼叫端帶出未定義行為。
 * 有回傳 totalPage，ORDER BY i.id ASC 保證穩定分頁——不屬於「無 total 可判斷終點」的情況。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { ListItemsSearch } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { STATUS_MAP, ITEM_CATEGORY_MAP } from '../const.ts';
import { formatItemRow } from './create_or_update_item.ts';

export function registerListItemsTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_inventory_platform_list_items',
        {
            title: 'List store items (paginated, no id filter)',
            description:
                '查詢「商城 → 道具」總表，依 category/name（模糊）/status 篩選，分頁回傳（rajah: InventoryPlatform.ListItems）。' +
                '注意：搜尋條件沒有 id 欄位，無法用來精確鎖定單一道具——同名同類別可能有多筆，' +
                '需要精確找某一筆時請自行從回傳的 rows 裡用 id 欄位比對，不要假設 name+category 唯一。' +
                'pageSize 只接受 10/20/30/50/100/200 這幾個離散值（PageSizeEnum，帶其他值後端回 errorCode=9），' +
                '回傳含 totalPage，可用 page/pageSize 正常翻頁到底。' +
                '回傳的每筆道具含完整 commonDetail/depositWithdrawDetail（若該類別有對應細項）。',
            inputSchema: {
                category: z.enum(Object.keys(ITEM_CATEGORY_MAP) as [ keyof typeof ITEM_CATEGORY_MAP ]).optional()
                    .describe('依道具類別篩選，不帶表示不篩選（含 unknown/realStuff/roomMount 在內的所有類別資料都可能被列出，即使這三種無法用 create_or_update_item 建立/編輯）'),
                name: z.string().optional().describe('依道具名稱模糊搜尋（比對目前語系的 localization 值）'),
                status: z.enum([ 'enabled', 'disabled' ]).optional().describe('依啟用狀態篩選，不帶表示不篩選'),
                page: z.number().int().min(1).optional().describe('頁碼，從 1 開始，預設 1'),
                pageSize: z.union([ z.literal(10), z.literal(20), z.literal(30), z.literal(50), z.literal(100), z.literal(200) ]).optional()
                    .describe('每頁筆數，只接受 10/20/30/50/100/200（PageSizeEnum，帶其他值後端會拒絕），預設 50'),
            },
        },
        async ({ category, name, status, page, pageSize }) => {
            const search = ListItemsSearch.create({
                category: category ? ITEM_CATEGORY_MAP[ category ] : 0,
                name: name ?? '',
                status: status ? STATUS_MAP[ status ] : 0,
            });
            const r = await withAutoRelogin(() => remote.inventoryBackOffice.inventoryPlatform.ListItems(search, page ?? 1, pageSize ?? 50));
            if (r.failed) return asErrorResult(r);
            const rows = (r.data?.rows ?? []).map((row) => formatItemRow(row as unknown as Record<string, unknown>));
            return asTextResult({ success: true, rows, totalPage: r.data?.totalPage });
        },
    );
}
