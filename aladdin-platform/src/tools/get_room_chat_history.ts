/**
 * tools/get_room_chat_history.ts — aladdin_platform_room_platform_get_chat_history
 *
 * rajah: RoomPlatform.GetChatHistory（room_back_office.rajah:253-256，@Permission "Room.RoomList.Actions"）
 *
 * 2026-08-25 讀 agrabah 實作確認（agrabah/src/servers/room_back_office/services/room_platform.ts:587-614，
 * 真查邏輯在 agrabah/src/servers/chat/services/chat_internal.ts:279-291 → chat_manager.ts:896-982 的
 * getHistory）：
 * - **不是分頁查詢，是「近期歷史快照」**：先查記憶體 LRU 快取（每房間上限 50 筆），沒命中才 fallback
 *   查 DB（`deleted_at IS NULL`，`ORDER BY id DESC LIMIT 100`）並寫回快取。rajah 定義也只有
 *   `(rows [ClientChatMessage] 1)`，沒有 page/pageSize——完整分頁歷史查詢要用同 service 的
 *   `RoomPlatform.GetChatRecords(roomId, page, pageSize)`，**這支 method 本次尚未包成 MCP tool**，
 *   目前沒有替代方案，這支只回近期快照。
 * - **回傳的 `chatRoomId` 不是輸入的 `roomId`**：`chatRoomId` 是 chat 系統內部的數字 id（`DbRoomChat`
 *   對照表產生），跟輸入參數 `roomId`（rooms 表的業務 string id）是完全不同體系的兩個值，不能互相
 *   代換——這支工具直接把它從輸出移除，避免呼叫端誤把它當成 roomId 拿去餵給其他 room 相關 tool。
 * - **已刪除訊息的邊界情況**：`DeleteMessage` 軟刪除後會廣播通知讓各節點清掉記憶體快取，但程式碼
 *   註解自承「廣播失敗時所有節點都可能短暫保留舊歷史」——理論上快取命中時，極短暫窗口內可能還看得到
 *   剛被刪除的訊息；DB fallback 路徑本身有 `deleted_at IS NULL` 過濾，不會有此問題。
 * - roomId 不存在（`DbRoomChat` 查無對應 chatRoomId）會直接報錯，不回空陣列——2026-08-25 dev 實測
 *   拿到的是 genie 通用 `ErrorCode.objectNotFound`（數字 14），不在 `AgrabahErrorCodeEnum` 反查表裡，
 *   `asErrorResult` 會顯示 errorName「(未知錯誤碼)」，這是既有設計行為（如實顯示原始碼），不是異常。
 * - `ClientChatMessage` 的 i64 欄位（`messageId`/`createdTimestamp`/`chatRoomId`，以及巢狀
 *   `showOrderPayload.orderId`/`betAmount`/`payoutAmount`，曬單訊息才會有這個巢狀物件）比照
 *   已驗證過的慣例用 `toPlainNumber` 轉換。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { toPlainNumber } from '../const.ts';

export function registerGetRoomChatHistoryTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_room_platform_get_chat_history',
        {
            title: 'Get recent chat history snapshot for a room',
            description:
                '取得指定房間的近期聊天訊息快照（rajah: RoomPlatform.GetChatHistory）。' +
                '**不是分頁查詢**，是記憶體快取的近期快照（每房間上限約 50 筆，快取沒命中時 fallback 查 DB 最多 100 筆），' +
                '沒有 page/pageSize 參數；要查更久以前或完整分頁歷史需要 RoomPlatform.GetChatRecords，' +
                '但那支 method 本次尚未包成 MCP tool，目前沒有替代方案。' +
                'roomId 不存在會直接報錯，不會回空陣列。極少數情況下（刪除通知跨節點廣播失敗）快取可能短暫仍含剛被刪除的訊息。' +
                '**回傳內容不含 chatRoomId**（chat 系統內部數字 id，跟輸入的 roomId 是不同體系的值，故意移除避免混淆）。',
            inputSchema: {
                roomId: z.string().min(1).describe('房間 id'),
            },
        },
        async ({ roomId }) => {
            const r = await withAutoRelogin(() => remote.roomBackOffice.roomPlatform.GetChatHistory(roomId));
            if (r.failed) return asErrorResult(r);

            const rows = (r.data?.rows ?? []).map(({ chatRoomId: _chatRoomId, ...row }) => ({
                ...row,
                messageId: toPlainNumber(row.messageId),
                createdTimestamp: toPlainNumber(row.createdTimestamp),
                showOrderPayload: row.showOrderPayload
                    ? {
                        ...row.showOrderPayload,
                        orderId: toPlainNumber(row.showOrderPayload.orderId),
                        betAmount: toPlainNumber(row.showOrderPayload.betAmount),
                        payoutAmount: toPlainNumber(row.showOrderPayload.payoutAmount),
                    }
                    : row.showOrderPayload,
            }));

            return asTextResult({ success: true, rows });
        },
    );
}
