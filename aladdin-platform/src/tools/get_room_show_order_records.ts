/**
 * tools/get_room_show_order_records.ts — aladdin_platform_room_platform_get_show_order_records
 *
 * rajah: RoomPlatform.GetShowOrderRecords（room_back_office.rajah:275-277，@Permission "Room.RoomList.Actions"）
 *
 * 2026-08-25 讀 agrabah 實作確認（agrabah/src/servers/room_back_office/services/room_platform.ts:762-799，
 * 呼叫鏈與前一支 get_room_chat_records.ts 的 GetChatRecords 完全同構，唯一差異在最終呼叫
 * chat_internal.ts:344-362 的 GetRoomShowOrderRecords，多帶固定的
 * `messageKind=ChatMessageKindEnum.showOrder` 篩選參數，兩者最終都收斂到同一支
 * chat_manager.ts:995 的 getRoomChatRecordsWithPagination，只是這支多篩了 `message_kind = ?`）：
 * - 只回傳「曬單」類型的訊息（`messageKind = showOrder`，靠 DB 欄位 `message_kind` 篩選，不是看
 *   `showOrderPayload` 是否非空）。
 * - 分頁/`totalPage`/`pageSize` 上限/`bypassSensitiveWord`/roomId 不存在的行為，跟
 *   `get_room_chat_records.ts` 完全一致（同一套共用邏輯），細節見該檔案的檔頭說明，這裡不重複展開。
 * - `chatRoomId` 同樣故意從輸出移除（跟輸入的 roomId 是不同體系的值）。
 *
 * 2026-08-25 dev 實測記錄：4 個已知測試房間都沒有曬單類型訊息（rows 皆為空、totalPage=0），
 * 符合預期（測試聊天內容都是純文字），但因此**沒能用真實資料驗證 showOrderPayload 巢狀 i64
 * 欄位的轉換**，只驗證了空清單、不存在 roomId、pageSize 超上限三種不需要真實曬單資料的路徑。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { toPlainNumber } from '../const.ts';

const MAX_PAGE_SIZE = 100;

export function registerGetRoomShowOrderRecordsTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_room_platform_get_show_order_records',
        {
            title: 'Get paginated show-order chat messages for a room',
            description:
                '分頁查詢指定房間的「曬單」類型聊天訊息（rajah: RoomPlatform.GetShowOrderRecords）——' +
                '跟 aladdin_platform_room_platform_get_chat_records 是同一套分頁機制，差別只在這支固定只回' +
                'messageKind=曬單 的訊息。' +
                `pageSize 上限 ${ MAX_PAGE_SIZE }（工具層自行收斂，後端本身無上限）。` +
                '**totalPage 只有 page=1 的回應才是真的算出來的**，其餘頁固定回 0。' +
                'roomId 不存在會直接報錯，不回空陣列。回傳的 bypassSensitiveWord 一律是預設值，不反映實際狀況。' +
                '**回傳內容不含 chatRoomId**（chat 系統內部數字 id，跟輸入的 roomId 是不同體系的值，故意移除避免混淆）。',
            inputSchema: {
                roomId: z.string().min(1).describe('房間 id'),
                page: z.number().int().min(1).optional().describe('頁碼，從 1 開始，預設 1'),
                pageSize: z.number().int().min(1).max(MAX_PAGE_SIZE).optional().describe(`每頁筆數，1~${ MAX_PAGE_SIZE }，預設 20`),
            },
        },
        async ({ roomId, page, pageSize }) => {
            const r = await withAutoRelogin(() => remote.roomBackOffice.roomPlatform.GetShowOrderRecords(roomId, page ?? 1, pageSize ?? 20));
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
