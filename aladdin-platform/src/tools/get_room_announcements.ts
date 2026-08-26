/**
 * tools/get_room_announcements.ts — aladdin_platform_room_platform_get_room_announcement
 *
 * rajah: RoomPlatform.GetRoomAnnouncement（room_back_office.rajah:198-199，@Permission "Room.RoomList.Actions"）
 *
 * 2026-08-25 讀 agrabah 實作確認（agrabah/src/servers/room_back_office/services/room_platform.ts:249-269，
 * 真查 DB 邏輯在 agrabah/src/managers/room_manager.ts:1223-1244 的 getRoomAnnouncement）：
 * - **沒有分頁參數，一次全撈**該 roomId + 目前平台的全部公告歷史，`loadObjects` 的 limit 參數傳空字串，
 *   引擎判斷為 falsy 完全不加 SQL LIMIT（mysql_relational_database_engine.ts:320-322），沒有任何筆數上限。
 *   公告都是人工發送，實務量體通常不大，但結構上沒有保護，理論上量體很大的房間可能一次撈出很多筆。
 * - 依 `id DESC` 排序（room_manager.ts:1240），**最新一筆在最前面**。
 * - roomId 不存在、或存在但不屬於目前登入平台，會直接回錯誤（`roomNotFound`），**不是回空陣列**——
 *   `getRoomInfo` 內部有做平台歸屬檢查（room_manager.ts:283-294）。
 * - `createdAtTimestamp` 是 rajah i64 欄位。原本以為後端來源（`DbRoomAnnouncementHistories` 繼承的
 *   `WithCreateTimestamp` getter，回傳一般 JS number）就不需要轉換，但 2026-08-25 dev 站台真打實測
 *   發現回傳仍是字串（如 `"1777970431000"`）——protobuf wire 層的 int64 編碼跟伺服器端來源型別無關，
 *   client 端 decode 一律走 Long/字串表示，因此仍需要 `toPlainNumber` 轉成一般數字。
 * - `userName` 欄位實際上是 `identifier`（帳號），不是暱稱——service 層檔頭註解明寫此點
 *   （room_platform.ts:247：「回傳的 userName 欄位實際上是 identifier（帳號），非 nickname」），
 *   資料來源是 `DbRoomAnnouncementHistories.identifier`（agrabah/src/database_types/room.ts:297-306）。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { toPlainNumber } from '../const.ts';

export function registerGetRoomAnnouncementsTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_room_platform_get_room_announcement',
        {
            title: 'Get a room announcement history',
            description:
                '查詢指定房間的公告發送歷史（rajah: RoomPlatform.GetRoomAnnouncement）。' +
                '**無分頁、一次回傳全部歷史紀錄**，依發送時間新到舊排序；沒有內建筆數上限，' +
                '理論上公告量很大的房間可能一次回傳很多筆（實務上公告是人工發送，量體通常不大）。' +
                'roomId 不存在、或存在但不屬於目前登入平台，都會直接回錯誤，不會回空陣列——' +
                '空陣列代表「這個房間存在、但目前平台下沒有任何公告紀錄」。' +
                '**userName 欄位實際上是帳號（identifier），不是暱稱**（後端檔頭註解明寫此點），不要當顯示暱稱使用。' +
                '欄位值恰好是空字串時，該欄位可能整個不出現在回傳 JSON 裡（proto3 預設值不上線），缺 key 視同空字串。',
            inputSchema: {
                roomId: z.string().min(1).describe('房間 id'),
            },
        },
        async ({ roomId }) => {
            const r = await withAutoRelogin(() => remote.roomBackOffice.roomPlatform.GetRoomAnnouncement(roomId));
            if (r.failed) return asErrorResult(r);

            const list = (r.data?.list ?? []).map(row => ({ ...row, createdAtTimestamp: toPlainNumber(row.createdAtTimestamp) }));
            return asTextResult({ success: true, list });
        },
    );
}
