/**
 * tools/update_customer_category_sort_order.ts — aladdin_platform_customer_platform_update_category_sort_order
 *
 * rajah: CustomerPlatform.UpdateCategorySortOrder（customer_back_office.rajah:42，無 @Permission，
 * 由 service 內其他 method 綁定的權限樹涵蓋，見前端「客服連線類型」拖曳排序）。
 *
 * 分類註記（method-category-checklist.md 第 5/6 節）：這不是一般的「批次覆寫排序值」，後端實作
 * （agrabah/.../customer_platform.ts:501-545）是**兩筆一組的交換**：呼叫端必須傳入
 * `updates=[{id:dragId, sortOrder:<targetId 目前的 sortOrder>}, {id:targetId, sortOrder:<dragId
 * 目前的 sortOrder>}]`，後端會驗證「目前 db 值」與傳入值完全對應（不對應回 invalidData），
 * 兩筆都用 optimistic lock（`WHERE ... AND sort_order = ?`）寫入。因此本 tool 不能只吃
 * 呼叫端聲稱的排序值，必須自己先讀現值（呼叫 ListDetails 掃描整個 category 直到找到兩筆
 * id，遵守 method-category-checklist.md 第 2 節 B 級「掃描到底」要求），組出正確的交換 payload，
 * 完成後 round-trip 再讀一次驗證確實交換成功。
 *
 * 2026-08-25 review 補：這是寫入型 tool，比照本 server 其他寫入 tool（見 update_game_vendor_status.ts）
 * 掛上 prod confirm 閘門——正式環境（ALADDIN_PLATFORM_IS_PROD=true）沒帶 confirm 直接拒絕執行。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { GameSortOrderUpdate } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import type { ICustomerCategoryCommon } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { CUSTOMER_CATEGORY_MAP } from '../const.ts';

const SCAN_MAX_PAGES = 20;
const SCAN_PAGE_SIZE = 200;

/** 掃描整個 category 的 ListDetails 分頁，直到找齊 dragId/targetId 兩筆現值或掃到底。 */
async function findRowsByIds(
    categoryValue: number,
    ids: [ number, number ],
): Promise<{ found: Map<number, ICustomerCategoryCommon>; scannedPages: number; totalPage: number; hitScanCap: boolean }> {
    const found = new Map<number, ICustomerCategoryCommon>();
    let page = 1;
    let totalPage = 1;
    let hitScanCap = false;
    let scannedPages = 0;

    while (page <= totalPage) {
        if (page > SCAN_MAX_PAGES) { hitScanCap = true; break; }
        const r = await withAutoRelogin(() => remote.customerBackOffice.customerPlatform.ListDetails(categoryValue, page, SCAN_PAGE_SIZE));
        if (r.failed) throw new Error(`ListDetails 掃描第 ${ page } 頁失敗：errorCode=${ r.errorCode } ${ r.message }`);
        scannedPages += 1;

        for (const row of r.data?.rows ?? []) {
            if (ids.includes(row.id as number)) found.set(row.id as number, row);
        }
        totalPage = r.data?.totalPage ?? 1;
        if (found.size === ids.length) break; // 兩筆都找到，不必掃完剩餘頁
        page += 1;
    }

    return { found, scannedPages, totalPage, hitScanCap };
}

export function registerUpdateCustomerCategorySortOrderTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_customer_platform_update_category_sort_order',
        {
            title: 'Swap sort order of two customer service category entries',
            description:
                '交換本平台某個客服連線類型（category）底下兩筆連線項目的顯示排序' +
                '（rajah: CustomerPlatform.UpdateCategorySortOrder，對應「客服連線類型」拖曳排序）。' +
                '只能一次交換兩筆（dragId/targetId），且兩筆必須屬於同一個 category——這是後端的固定行為，' +
                '不是可任意批次改排序值的 API。本 tool 會先掃描該 category 目前的清單找出兩筆現值，' +
                '自動組出正確的交換 payload 並在寫入後 round-trip 讀回驗證，呼叫端不需要自己算排序值。' +
                'dragId/targetId 用 aladdin_platform_customer_platform_list_details 回傳的 id。' +
                'prod 執行前確認：當這個 server 是正式環境（prod）時，執行本工具前必須先用 AskUserQuestion' +
                '（或功能相同的方式）明確詢問使用者是否要在正式環境執行這個操作，取得明確同意後才可以帶上 confirm 參數；' +
                '絕不能自行假設使用者同意。非 prod 環境不需要、也會忽略 confirm 欄位。',
            inputSchema: {
                category: z.enum([ 'komi', 'wbgcorp', 'dotcloud' ]).describe('客服連線類型（三方客服系統），兩筆必須屬於同一個 category'),
                dragId: z.number().int().describe('要移動的連線項目 id'),
                targetId: z.number().int().describe('要交換位置的目標連線項目 id'),
                confirm: z.string().optional().describe(
                    `正式環境（prod）專用的強制確認欄位；非 prod 環境會被忽略、不需提供。當這個 server 是正式環境時，` +
                    `必須先取得使用者明確同意，再帶上精確字串 "${ PROD_CONFIRM_TOKEN }" 才會執行，否則本工具會拒絕執行並回錯誤。`,
                ),
            },
        },
        async ({ category, dragId, targetId, confirm }) => {
            assertProdConfirmed(confirm);
            if (dragId === targetId) {
                return asTextResult({ success: false, message: 'dragId 與 targetId 不能相同，沒有可交換的對象' });
            }

            const categoryValue = CUSTOMER_CATEGORY_MAP[ category ];
            let scan;
            try {
                scan = await findRowsByIds(categoryValue, [ dragId, targetId ]);
            } catch (error) {
                return asTextResult({ success: false, message: `掃描現值失敗：${ error instanceof Error ? error.message : String(error) }` });
            }

            const dragRow = scan.found.get(dragId);
            const targetRow = scan.found.get(targetId);
            if (!dragRow || !targetRow) {
                return asTextResult({
                    success: false,
                    message: '找不到 dragId 或 targetId 對應的資料（可能 id 不存在，或不屬於指定的 category）',
                    missingDragId: !dragRow,
                    missingTargetId: !targetRow,
                    scannedPages: scan.scannedPages,
                    totalPage: scan.totalPage,
                    hitScanCap: scan.hitScanCap,
                });
            }

            const updates = [
                GameSortOrderUpdate.create({ id: dragId, sortOrder: targetRow.sortOrder as number }),
                GameSortOrderUpdate.create({ id: targetId, sortOrder: dragRow.sortOrder as number }),
            ];
            const r = await withAutoRelogin(() => remote.customerBackOffice.customerPlatform.UpdateCategorySortOrder(updates));
            if (r.failed) {
                return asErrorResult(r, { hint: '常見原因：兩筆 id 的目前排序值在掃描後又被別的操作改動（optimistic lock 沒過），或其中一筆剛好在掃描後被刪除' });
            }

            const before = { dragId, dragSortOrder: dragRow.sortOrder, targetId, targetSortOrder: targetRow.sortOrder };

            // round-trip 驗證：重新掃描確認確實交換成功。這裡的寫入 RPC 已經成功——若接下來這次
            // 掃描本身失敗（例如暫時性網路/後端錯誤），必須明確告知「寫入已成功、只是驗證掃描失敗」，
            // 不能讓例外原樣拋出：這支操作是對合（swap 兩次等於復原），呼叫端看到失敗訊息很自然會用
            // 同樣參數重試，若寫入其實已成功，重試會把剛交換好的排序又換回去，造成誤導性的靜默 revert。
            let verify;
            try {
                verify = await findRowsByIds(categoryValue, [ dragId, targetId ]);
            } catch (error) {
                return asTextResult({
                    success: true,
                    verified: null,
                    verifyError: error instanceof Error ? error.message : String(error),
                    warning: '交換寫入已成功，但事後驗證掃描失敗，無法確認最終結果。請勿用相同參數直接重試——' +
                        '這個操作交換兩次等於復原，重試很可能把剛交換好的排序又換回去。請先呼叫 ' +
                        'aladdin_platform_customer_platform_list_details 確認目前實際排序，再決定下一步。',
                    before,
                });
            }
            const dragAfter = verify.found.get(dragId);
            const targetAfter = verify.found.get(targetId);
            const swapped = dragAfter?.sortOrder === targetRow.sortOrder && targetAfter?.sortOrder === dragRow.sortOrder;

            return asTextResult({
                success: true,
                verified: swapped,
                before,
                after: { dragId, dragSortOrder: dragAfter?.sortOrder, targetId, targetSortOrder: targetAfter?.sortOrder },
            });
        },
    );
}
