/**
 * tools/update_game_tag_sort_order.ts — aladdin_platform_game_vendor_platform_update_game_tag_sort_order
 *
 * rajah: GameVendorPlatform.UpdateGameTagSortOrder(tagType GameTagTypeEnum 1, orders [GameSortOrderUpdate] 2)
 * （game_back_office.rajah:1119，@Permission "GameVendor"）——批次更新同一 tagType 底下多個標籤的排序值。
 * `GameSortOrderUpdate`（common.rajah:2167-2170）欄位是 `id`/`sortOrder`，這裡的 `id` 語意上其實是
 * `tag`（標籤編號），跟 `UpdateGameTagStatus` 的 `tag` 參數是同一個值，只是這個共用 model 沿用泛用的
 * `id` 命名，不是內部流水號。
 *
 * 2026-08-25 讀 agrabah 後端原始碼查證
 * （agrabah/src/servers/game_back_office/services/game_vendor_platform.ts:1536-1561，
 * methodUpdateGameTagSortOrder）：
 * - 在同一個 transaction 內逐筆對 `orders` 陣列跑 `UPDATE platform_game_tags SET sort_order=? ` +
 *   `WHERE platform_id=? AND tag_type=? AND tag=?`。
 * - **關鍵風險**：迴圈裡**只檢查 `updateResult.failed`（SQL 層錯誤），完全沒檢查 `updateResult.data`
 *   （affectedRows）是否為 0**——如果 `orders` 裡某筆的 `id`（tag 編號）不存在於當前平台/tagType，
 *   那筆 UPDATE 會静默比對不到任何列、回傳 `affectedRows=0`，但因為沒有檢查這個值，迴圈直接視為成功
 *   繼續下一筆，**整支 RPC 最終回傳成功，即使批次裡有部分項目根本沒有真的寫入**。這是本工具必須自行
 *   彌補的缺口：呼叫端如果只看 RPC 的 errorCode，會誤以為全部項目都排序成功。
 * - 因為整段包在同一個 `doTransaction` 內，真正的 SQL 錯誤（非「查無此列」）會讓整批 rollback；只有
 *   「查無此列」這種 affectedRows=0 的情況不會被攔下，其餘項目仍會照常寫入，是部分成功、部分靜默
 *   no-op 的混合結果，不是全有全無。
 * - `tagType` 同 `UpdateGameTagStatus`，涵蓋 vendorFee/appDisplay/rebate/frontendGroup 四種
 *   （game_back_office.rajah:43-52）。
 *
 * **本工具的彌補設計**：呼叫底層 RPC 後，對有對應查詢 RPC 的 3 種 tagType（appDisplay/rebate/
 * frontendGroup，用法同 `update_game_tag_status.ts` 的 `findTagStatus` 分流邏輯）重新查詢一次現值，
 * 逐筆比對 `orders` 裡呼叫端要求的 `sortOrder` 是否真的等於讀回的實際值，回傳 `applied`/`mismatched`
 * 兩個陣列讓呼叫端明確知道哪些項目沒有真的生效（多半代表該 tag 不存在於當前平台/tagType 組合）。
 * `vendorFee` 沒有對應查詢 RPC（沿用 `update_game_tag_status.ts` 已查證的結論），無法逐筆核實，
 * 回傳 `verified: false` 並附註原因。
 *
 * **2026-08-25 已通過 dev 實測**（tool 掛進 tools/index.ts 之後，對 pk-platform.alddev.com 用真正的
 * MCP stdio Client 打 tools/call，涵蓋 zod schema 驗證與 registerTool handler 本身；用
 * tagType=appDisplay、tag=1（電子分類，原始 sortOrder=1）測試）：
 * - 全部項目皆為既有 tag（只改 tag=1 一筆）→ `{success:true, applied:[{id:1,sortOrder:999}], mismatched:[]}`。
 * - orders 混入一個不存在的 tag（999999）→ 底層 RPC 仍回傳成功，但本工具的讀回比對正確抓出：
 *   `applied:[{id:1,sortOrder:1}]`（真的存在的那筆生效）、`mismatched:[{id:999999,requestedSortOrder:12345}]`
 *   （不存在的那筆被靜默忽略，未反映在 mismatched 對應的 actualSortOrder 是 undefined）——**直接證實
 *   了檔頭描述的靜默 no-op 風險真實存在**，且本工具的讀回比對機制確實能偵測到。
 * - 測完重新查詢確認 tag=1 的 sortOrder 已復原為原始值 1，無殘留髒資料。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import {
    PlatformGameDisplayTagSearch,
    GameFrontendGroupTagSearch,
    GameSortOrderUpdate,
} from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

const TAG_TYPE_KEYS = [ 'vendorFee', 'appDisplay', 'rebate', 'frontendGroup' ] as const;
const TAG_TYPE_MAP: Record<(typeof TAG_TYPE_KEYS)[number], number> = {
    vendorFee: 1,
    appDisplay: 2,
    rebate: 3,
    frontendGroup: 4,
};

/** 依 tagType 分流查詢全部標籤（含 sortOrder）；vendorFee 沒有對應查詢 RPC，回傳 null。 */
async function listTagsByType(tagType: (typeof TAG_TYPE_KEYS)[number]) {
    if (tagType === 'appDisplay') {
        const r = await withAutoRelogin(() => remote.gameBackOffice.gameVendorPlatform.ListAllGameDisplayTags(PlatformGameDisplayTagSearch.create({}), 0, 0));
        if (r.failed) return { failedResult: r, rows: null } as const;
        return { failedResult: undefined, rows: r.data?.tags ?? [] } as const;
    }
    if (tagType === 'rebate') {
        const r = await withAutoRelogin(() => remote.gameBackOffice.gameVendorPlatform.ListAllGameRebateTags(0, 0));
        if (r.failed) return { failedResult: r, rows: null } as const;
        return { failedResult: undefined, rows: r.data?.tags ?? [] } as const;
    }
    if (tagType === 'frontendGroup') {
        const r = await withAutoRelogin(() => remote.gameBackOffice.gameVendorPlatform.ListAllGameFrontendGroupTags(GameFrontendGroupTagSearch.create({}), 0, 0));
        if (r.failed) return { failedResult: r, rows: null } as const;
        return { failedResult: undefined, rows: r.data?.tags ?? [] } as const;
    }
    return { failedResult: undefined, rows: null } as const; // vendorFee：無對應查詢 RPC
}

export function registerUpdateGameTagSortOrderTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_game_vendor_platform_update_game_tag_sort_order',
        {
            title: 'Batch-update game tags\' sort order',
            description:
                '批次更新同一 tagType 底下多個標籤的排序值（rajah: GameVendorPlatform.UpdateGameTagSortOrder，' +
                '需要權限節點 GameVendor）。tagType 合法值：vendorFee/appDisplay/rebate/frontendGroup。' +
                '**重要風險**：後端逐筆處理 orders 陣列時只檢查 SQL 層錯誤，沒有檢查 affectedRows——如果某筆的 ' +
                'tag 編號不存在於當前平台/tagType 組合，那筆會靜默 no-op（不報錯，也不會真的寫入），但整支 RPC ' +
                '仍回傳成功，不能只看 errorCode 判斷全部項目都生效。' +
                '本工具寫入後，對 appDisplay/rebate/frontendGroup 這 3 種有對應查詢 RPC 的 tagType 會自動重新' +
                '查詢一次現值，逐筆比對 orders 裡要求的 sortOrder 是否真的生效，回傳 applied（成功生效的項目）' +
                '與 mismatched（要求的值跟讀回的實際值不一致，通常代表該 tag 不存在）兩個陣列。' +
                '**vendorFee 沒有對應查詢 RPC**（同 aladdin_platform_game_vendor_platform_update_game_tag_status ' +
                '已查證的缺口），無法逐筆核實，回傳 verified:false 並附註原因，只能確認底層 RPC 本身回傳成功。' +
                'orders 陣列的 id 欄位實際上是 tag 編號（沿用共用 model 的泛用命名），不是內部流水號。' +
                'prod 執行前確認：當這個 server 是正式環境（prod）時，執行本工具前必須先用 AskUserQuestion' +
                '（或功能相同的方式）明確詢問使用者是否要在正式環境執行這個操作，取得明確同意後才可以帶上 confirm 參數；' +
                '絕不能自行假設使用者同意。非 prod 環境不需要、也會忽略 confirm 欄位。' +
                '**2026-08-25 已通過 dev 實測**（真正 MCP stdio Client 打 tools/call，用 appDisplay tag=1 測試，' +
                '涵蓋全部項目皆存在的成功情境、混入不存在 tag 編號時被本工具的讀回比對正確抓出 mismatched，' +
                '測完復原受測資料）。',
            inputSchema: {
                tagType: z.enum(TAG_TYPE_KEYS).describe('標籤類型：vendorFee/appDisplay/rebate/frontendGroup'),
                orders: z.array(z.object({
                    id: z.number().int().describe('標籤編號（tag），不是內部流水號'),
                    sortOrder: z.number().int().describe('目標排序值'),
                })).min(1).describe('要更新的標籤排序清單，至少一筆'),
                confirm: z.string().optional().describe(
                    `正式環境（prod）專用的強制確認欄位；非 prod 環境會被忽略、不需提供。當這個 server 是正式環境時，` +
                    `必須先取得使用者明確同意，再帶上精確字串 "${ PROD_CONFIRM_TOKEN }" 才會執行，否則本工具會拒絕執行並回錯誤。`,
                ),
            },
        },
        async ({ tagType, orders, confirm }) => {
            assertProdConfirmed(confirm);

            const rpcOrders = orders.map((o) => GameSortOrderUpdate.create({ id: o.id, sortOrder: o.sortOrder }));
            const r = await withAutoRelogin(() => remote.gameBackOffice.gameVendorPlatform.UpdateGameTagSortOrder(TAG_TYPE_MAP[ tagType ], rpcOrders));
            if (r.failed) return asErrorResult(r);

            const after = await listTagsByType(tagType);
            if (after.failedResult) {
                return asTextResult({
                    success: true,
                    message: '底層 RPC 回傳成功，但寫入後讀回驗證時發生錯誤，無法確認是否全部項目真的生效',
                    verified: false,
                    readBackError: { errorCode: after.failedResult.errorCode, message: after.failedResult.message },
                });
            }
            if (after.rows === null) {
                return asTextResult({
                    success: true,
                    message: '底層 RPC 回傳成功；tagType=vendorFee 沒有對應的查詢 RPC，無法逐筆核實是否全部項目真的生效',
                    verified: false,
                });
            }

            const actualByTag = new Map(after.rows.map((row) => [ row.tag, row.sortOrder ]));
            const applied: Array<{ id: number; sortOrder: number }> = [];
            const mismatched: Array<{ id: number; requestedSortOrder: number; actualSortOrder: number | null | undefined }> = [];
            for (const o of orders) {
                const actual = actualByTag.get(o.id);
                if (actual === o.sortOrder) {
                    applied.push({ id: o.id, sortOrder: o.sortOrder });
                } else {
                    mismatched.push({ id: o.id, requestedSortOrder: o.sortOrder, actualSortOrder: actual });
                }
            }

            return asTextResult({
                success: true,
                message: mismatched.length === 0 ? '全部項目已生效' : `${ mismatched.length } 筆項目未生效（tag 可能不存在於當前平台/tagType 組合），詳見 mismatched`,
                verified: true,
                applied,
                mismatched,
            });
        },
    );
}
