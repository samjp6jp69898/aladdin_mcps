/**
 * tools/update_item_status.ts — aladdin_platform_inventory_platform_update_item_status
 *
 * rajah: InventoryPlatform.UpdateItemStatus（inventory_back_office.rajah:445）。
 *
 * agrabah 後端實作（inventory_platform.ts:381-414）：
 * - newStatus 只接受 StatusEnum.enabled/disabled，其他值（含 unknown/frozen/deleted）
 *   一律回 ErrorCode.invalidData（2026-08-25 dev 實測證實）——跟 update_game_vendor_status.ts
 *   那種「StatusEnum 全部五值皆合法」不同，這支後端明確只認 enabled/disabled 兩態。
 * - 先讀現值（`SELECT category, status FROM item WHERE platform_id=? AND id=?`），**目標狀態與
 *   現值相同時直接回 `AgrabahErrorCodeEnum.needRefresh` 錯誤**（inventory_platform.ts:395-397）
 *   ——這跟 update_game_vendor_status.ts 記載的「同值呼叫其實會成功」不同，這支後端明確地把
 *   同值視為錯誤情境。本工具因此**必須**先讀現值短路，不是「有更好但非必要」，不短路會讓呼叫端
 *   收到一個容易誤判成失敗的 needRefresh 錯誤。
 * - **id 不存在時後端會拋例外、被兜底轉成 errorCode=unknown(1)，不是結構化的 objectNotFound**
 *   （2026-08-25 fable5 reviewer-a/reviewer-b 各自獨立指出、複驗證實）：`queryOne`
 *   （mysql_relational_database_engine.ts:66-74）查無資料時回傳 `ServiceResult.fromData(null)`，
 *   所以 `getItemStatusResult.data` 是 **null**，緊接著 `tempItem.status`（inventory_platform.ts:395）
 *   對 null 取屬性會直接拋 TypeError，執行流到不了 updateStatus()；這個例外沒有被 service 層
 *   捕捉，一路上拋到 `Server.handleRpc` 的兜底 catch（agrabah/src/common/server.ts:223-228：
 *   `catch (error) { return GenieResponse.fromObject({ errorCode: ErrorCode.unknown }) }`），
 *   最終呼叫端收到的是 **errorCode=1（unknown）**，不是 14（objectNotFound）。本工具靠
 *   **先呼叫 findItemById 短路**完全避開這條路徑（id 不存在時 tool 自己在呼叫後端前就回結構化
 *   錯誤，見下方 handler），所以呼叫端正常不會踩到這個未捕捉例外；但如果 findItemById 找到後、
 *   呼叫後端前這筆道具被別人刪除（TOCTOU 窗口，機率低），後端仍會回這個泛用的 unknown(1)，
 *   屬已知但未消除的邊界風險，如實記錄於此。
 * - 沒有帶 status 的單筆查詢 method，讀現值/讀回驗證改用 create_or_update_item.ts 的
 *   findItemById()（逐頁掃描比對 id），不重新發明一套。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { STATUS_MAP } from '../const.ts';
import { findItemById, formatItemRow } from './create_or_update_item.ts';

const statusToggle = z.enum([ 'enabled', 'disabled' ]);

export function registerUpdateItemStatusTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_inventory_platform_update_item_status',
        {
            title: 'Enable or disable a store item',
            description:
                '切換「商城 → 道具」的啟用/停用狀態（rajah: InventoryPlatform.UpdateItemStatus）。' +
                '只接受 enabled/disabled 兩種目標狀態（後端明確拒絕其他值，2026-08-25 dev 實測確認）。' +
                '會先讀現值：id 不存在直接回錯誤；目標狀態與現值相同時**不呼叫後端**、直接回「已是目標狀態」——' +
                '這不是可有可無的最佳化，後端對「目標狀態與現值相同」這個情境本身就會回 needRefresh 錯誤' +
                '（2026-08-25 dev 實測證實），短路是避免呼叫端收到這個容易誤判的錯誤碼；短路判斷基於呼叫當下讀到的' +
                '快照，若在讀值與實際寫入之間有其他人併發修改了這筆道具的狀態，仍可能收到 needRefresh 錯誤，' +
                '不是完全消除、只是大幅降低發生機率。' +
                '完成後自動讀回驗證（逐頁掃描比對 id，同 create_or_update_item 的機制）。' +
                'prod 執行前確認：正式環境需先用 AskUserQuestion 取得使用者明確同意才可帶 confirm 參數。',
            inputSchema: {
                itemId: z.number().int().positive().describe('道具 id'),
                newStatus: statusToggle.describe('目標狀態：enabled 或 disabled'),
                confirm: z.string().optional().describe(
                    `正式環境（prod）專用的強制確認欄位；非 prod 環境會被忽略。當這個 server 是正式環境時，` +
                    `必須先取得使用者明確同意，再帶上精確字串 "${ PROD_CONFIRM_TOKEN }" 才會執行。`,
                ),
            },
        },
        async ({ itemId, newStatus, confirm }) => {
            assertProdConfirmed(confirm);
            const targetStatus = STATUS_MAP[ newStatus ];

            const before = await findItemById(itemId);
            if (before.listR?.failed) return asErrorResult(before.listR);
            if (!before.matchedRow) {
                return asTextResult({
                    success: false,
                    message: `找不到 id=${ itemId } 的道具（已掃描 ${ before.scannedPages } 頁${ before.hitScanCap ? '，已觸及掃描上限' : '' }）`,
                });
            }
            if ((before.matchedRow as { status: number }).status === targetStatus) {
                return asTextResult({
                    success: true,
                    message: '目標狀態與現值相同，未呼叫後端 RPC',
                    item: formatItemRow(before.matchedRow as Record<string, unknown>),
                });
            }

            const r = await withAutoRelogin(() => remote.inventoryBackOffice.inventoryPlatform.UpdateItemStatus(itemId, targetStatus));
            if (r.failed) return asErrorResult(r);

            const after = await findItemById(itemId);
            if (after.listR?.failed) {
                return asTextResult({
                    success: true,
                    message: `狀態已更新，但讀回驗證失敗（errorCode=${ after.listR.errorCode } ${ after.listR.message }），無法確認寫入結果`,
                    item: null,
                });
            }
            return asTextResult({
                success: true,
                message: '狀態已更新',
                item: after.matchedRow ? formatItemRow(after.matchedRow as Record<string, unknown>) : null,
            });
        },
    );
}
