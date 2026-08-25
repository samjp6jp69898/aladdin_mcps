/**
 * tools/get_room_names.ts — aladdin_platform_room_platform_get_room_name_list
 *
 * rajah: RoomPlatform.GetRoomNameList（room_back_office.rajah:184，@Permission "Room.RoomNameList"）
 *
 * 2026-08-25 讀 agrabah 實作確認（agrabah/src/servers/room_back_office/services/room_platform.ts:116-147，
 * 真查 DB 邏輯在 agrabah/src/managers/room_manager.ts:371-411 的 getRoomNameMapByRoomIds）：
 * - 這是批次依 id 查詢，屬 method-category-checklist.md 第 2 節「Batch 開頭查詢」的同類陷阱：
 *   **不保證回傳陣列與輸入 roomIds 同長度**。查不到的 roomId（不存在，或存在但不屬於目前登入
 *   平台——SQL 有 INNER JOIN platform_room_data 限定 platformId）會被整筆靜默過濾掉，不是回傳
 *   空 title、也不會讓整支呼叫報錯。呼叫端必須用回傳每筆的 `roomId` 欄位自行比對，不能用 index
 *   對應輸入的 roomIds 陣列。
 * - 輸入陣列上限 100 筆（`RoomPlatformService.ROOM_NAME_LIST_MAX_IDS`，room_platform.ts:53），
 *   超過會直接短路拒絕（不查 DB），回錯誤碼 `roomGetRoomNameListRoomIdsLimitExceeded`（2235）——
 *   但這支 tool 的 zod schema 已用 `max(100)` 在 MCP 層先擋掉超量輸入，正常情況下呼叫端看到的
 *   會是 schema 驗證錯誤，不會真的觀察到後端這個 2235；同理 `min(1)` 也擋掉了空陣列，後端
 *   「空陣列直接回成功空結果」（room_platform.ts:121-124）這條路徑透過本 tool 打不到。
 * - 2026-08-25 dev 實測發現：`room_manager.ts:382` 的 `Array.from(new Set(roomIds))` 去重只影響
 *   內部 DB 查詢效率，**不影響回傳陣列**——service 層最終仍是對「原始（未去重）」的 roomIds 做
 *   `.filter().map()`（room_platform.ts:138-143），所以輸入重複的 roomId，回傳陣列裡一樣會重複
 *   出現對應筆數，不會被合併成一筆。呼叫端若不想要重複結果，自己在呼叫前後處理去重。
 * - title 來源是 `rooms.room_name`。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

const MAX_ROOM_IDS = 100;

export function registerGetRoomNamesTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_room_platform_get_room_name_list',
        {
            title: 'Batch get room titles by roomId',
            description:
                '依 roomId 批次查詢房間標題（rajah: RoomPlatform.GetRoomNameList）。一次最多 100 個 roomId，' +
                '超過會直接被拒絕（不查 DB）。**查不到的 roomId 會被靜默省略，不會出現在回傳陣列裡**' +
                '（不存在、或存在但不屬於目前登入平台都會被過濾掉，兩種情況呼叫端都無法區分），' +
                '不保證回傳筆數等於輸入筆數，也不能用 index 對應輸入陣列——請用回傳每筆的 roomId 欄位比對，' +
                '呼叫端若需要知道「這個 roomId 到底存不存在」可看回傳的 missingRoomIds（本工具自行比對算出，' +
                '若輸入本身有重複的不存在 id，missingRoomIds 也會依次數重複列出，不會去重）。' +
                '**輸入重複的 roomId 不會被去重**：後端內部去重只為了查 DB 效率，回傳陣列仍會依輸入重複次數重複出現對應筆數（2026-08-25 dev 實測驗證）。' +
                'title 為空字串時該欄位可能整個不出現在回傳 JSON 裡（proto3 預設值不上線，同 aladdin_platform_room_platform_get_room_list 的已知限制），缺 key 視同空字串。',
            inputSchema: {
                roomIds: z.array(z.string()).min(1).max(MAX_ROOM_IDS).describe(`要查詢的房間 id 清單，1~${ MAX_ROOM_IDS } 筆`),
            },
        },
        async ({ roomIds }) => {
            const r = await withAutoRelogin(() => remote.roomBackOffice.roomPlatform.GetRoomNameList(roomIds));
            if (r.failed) return asErrorResult(r);

            const roomNameData = r.data?.roomNameData ?? [];
            const foundIds = new Set(roomNameData.map(row => row.roomId));
            const missingRoomIds = roomIds.filter(id => !foundIds.has(id));

            return asTextResult({ success: true, roomNameData, missingRoomIds });
        },
    );
}
