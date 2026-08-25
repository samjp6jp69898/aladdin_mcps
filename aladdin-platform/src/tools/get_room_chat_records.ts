/**
 * tools/get_room_chat_records.ts — aladdin_platform_room_platform_get_chat_records
 *
 * rajah: RoomPlatform.GetChatRecords（room_back_office.rajah:271-273，@Permission "Room.RoomList.Actions"）
 *
 * 2026-08-25 讀 agrabah 實作確認（agrabah/src/servers/room_back_office/services/room_platform.ts:711-748，
 * 真查詢邏輯在 agrabah/src/managers/chat_manager.ts:995-1097 的 getRoomChatRecordsWithPagination，
 * 前一輪 get_room_chat_history.ts 用的 GetChatHistory 是同一張表的另一套讀法——這支才是完整分頁歷史）：
 * - **不是快照，是真的分頁查詢**（`DbChatRoomMessage`，`chat_room_id = ? AND deleted_at IS NULL`，
 *   `ORDER BY id DESC`），不吃 LRU 快取，每次都直查 DB。
 * - **`pageSize` 是裸 i32，後端沒有上限**（只擋 `<= 0`，跟曾經出過包的 `GameVendorAdmin.ListGames`
 *   同一種模式）——這支工具在 zod 層自行收斂到合理範圍，避免呼叫端傳入過大值一次查太多。上限取
 *   `100`，依循 `common.rajah` `PageSizeEnum` 的慣例合法值（10/20/30/50/100/200，伺服器端強制上限
 *   200），不是憑空選的數字。
 * - **`totalPage` 只有 page=1 才會真的算出來**（`common/database_helper.ts` 的 `getPageData` 只在
 *   `page === 1` 時查 COUNT），其餘頁固定回 0——同 get_room_members.ts 已驗證過的坑，agrabah 原始碼
 *   自己也在鄰近註解點名這是「分頁 RPC 正確呼叫模式」要注意的已知坑。
 * - roomId 不存在（`DbRoomChat` 查無對應）會直接報錯，不回空陣列。
 * - **這支的 `bypassSensitiveWord` 一律是預設值（false/未設）**，不像 `GetChatHistory` 那邊真的會設定
 *   這個欄位反映實際狀況——這支底層 `getRoomChatRecordsWithPagination` 完全沒有幫這個欄位賦值，
 *   呼叫端不要依賴這支回傳的 `bypassSensitiveWord` 判斷任何事。
 * - **回傳內容跟 get_room_chat_history.ts 一樣故意移除 `chatRoomId`**（跟輸入的 roomId 是不同體系的值，
 *   保留只會誤導呼叫端錯誤代換）。`messageId`/`createdTimestamp`/`showOrderPayload.{orderId,betAmount,
 *   payoutAmount}` 皆為 i64，已用 `toPlainNumber` 轉換。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { toPlainNumber } from '../const.ts';

const MAX_PAGE_SIZE = 100;

export function registerGetRoomChatRecordsTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_room_platform_get_chat_records',
        {
            title: 'Get paginated chat history for a room',
            description:
                '分頁查詢指定房間的完整聊天訊息歷史（rajah: RoomPlatform.GetChatRecords），直查 DB，不是快取快照——' +
                '要查近期即時快照改用 get_room_chat_history（那支無分頁但不用等 DB）；只想查曬單類型訊息' +
                '改用 aladdin_platform_room_platform_get_show_order_records（同一套分頁機制，固定篩 messageKind）。' +
                `pageSize 上限 ${ MAX_PAGE_SIZE }（工具層自行收斂，後端本身無上限）。` +
                '**totalPage 只有 page=1 的回應才是真的算出來的**，其餘頁固定回 0，要知道總頁數請以第一頁為準。' +
                'roomId 不存在會直接報錯，不回空陣列。這支回傳的 bypassSensitiveWord 一律是預設值，不反映實際狀況，不要依賴它判斷任何事。' +
                '**回傳內容不含 chatRoomId**（chat 系統內部數字 id，跟輸入的 roomId 是不同體系的值，故意移除避免混淆）。',
            inputSchema: {
                roomId: z.string().min(1).describe('房間 id'),
                page: z.number().int().min(1).optional().describe('頁碼，從 1 開始，預設 1'),
                pageSize: z.number().int().min(1).max(MAX_PAGE_SIZE).optional().describe(`每頁筆數，1~${ MAX_PAGE_SIZE }，預設 20`),
            },
        },
        async ({ roomId, page, pageSize }) => {
            const r = await withAutoRelogin(() => remote.roomBackOffice.roomPlatform.GetChatRecords(roomId, page ?? 1, pageSize ?? 20));
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

            return asTextResult({ success: true, rows, totalPage: r.data?.totalPage });
        },
    );
}
