/**
 * tools/get_muted_room_members.ts — aladdin_platform_room_platform_get_muted_members_by_user_ids
 *
 * rajah: RoomPlatform.GetMutedMembersByUserIds（room_back_office.rajah:215-220，
 * @Permission "Room.RoomList.Actions"）
 *
 * 2026-08-25 讀 agrabah 實作確認（agrabah/src/servers/room_back_office/services/room_platform.ts:228-238，
 * 直接複用 agrabah/src/managers/room_manager.ts:4143-4168 的 getUsersMutedOnlyByRoom——與
 * get_room_members.ts 的 status 欄位算法是同一支底層函式）：
 * - 只回傳**單場禁言**的 userId 子集，全場禁言/主播禁言不算（同 get_room_members.ts 的 status 語意）。
 * - `userIds` 陣列**沒有長度上限**（後端沒做批次或截斷）；空陣列會被 service 層直接拒絕
 *   （`ErrorCode.requestNotValid`），不會進資料庫查詢。
 * - **`roomId` 完全不驗證是否存在**——它只是拿去當 SQL 比對值查詢，查無符合就回空陣列，
 *   不像 GetRoomMembers 那樣會先呼叫 getRoomInfo 檢查房間是否存在或屬於目前平台
 *   （GetRoomList 的 search 是空 model、根本不吃 roomId，不是同類對照組）。呼叫端傳一個不存在
 *   的 roomId 不會得到任何錯誤提示，只會靜默拿到空陣列。
 * - 回傳的 `mutedUserIds` 是輸入 `userIds` 的子集（只列被禁言的），不是輸入陣列的逐一對應標記；
 *   `room_platform.ts:235` 用 `Array.from(Set)` 組出，**輸入重複的 userId 在輸出只會出現一次**。
 * - **空陣列有三種成因，這支工具無法區分**：(1) 查了但沒人被禁言、(2) roomId 不存在、
 *   (3) DB 查詢本身失敗（`getUsersMutedOnlyByRoom` 查詢失敗時只 log error，仍回空 Set 讓外層
 *   當成功處理，room_manager.ts:4161-4165）——拿到空陣列不能排除是查詢本身出錯。
 * - zod 的 `min(1)` 已在 MCP 層先擋掉空陣列，呼叫端實際只會看到 schema 驗證錯誤，後端
 *   `ErrorCode.requestNotValid` 這條路徑透過本 tool 打不到。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerGetMutedRoomMembersTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_room_platform_get_muted_members_by_user_ids',
        {
            title: 'Check which of the given userIds are single-room muted in a room',
            description:
                '從一批 userId 裡篩出「在指定房間被單場禁言」的子集（rajah: RoomPlatform.GetMutedMembersByUserIds）。' +
                '**只看單場禁言，不含全場禁言/主播禁言**——全場或主播禁言的使用者不會出現在回傳裡，不代表他們沒被禁言。' +
                '**roomId 完全不驗證是否存在**：傳一個不存在的 roomId 不會報錯，只會靜默拿到空陣列。' +
                'userIds 沒有長度上限，但不能是空陣列。' +
                '回傳的 mutedUserIds 是輸入 userIds 的子集且會去重，只列出被禁言的那些，不是逐一對應輸入順序的標記陣列。' +
                '**拿到空陣列不代表一定沒人被禁言**：roomId 不存在、或後端查詢本身失敗，都會同樣回空陣列，三種情況這支工具都無法區分。',
            inputSchema: {
                roomId: z.string().min(1).describe('房間 id'),
                userIds: z.array(z.number().int()).min(1).describe('要檢查的會員 userId 清單，至少 1 筆'),
            },
        },
        async ({ roomId, userIds }) => {
            const r = await withAutoRelogin(() => remote.roomBackOffice.roomPlatform.GetMutedMembersByUserIds(roomId, userIds));
            if (r.failed) return asErrorResult(r);

            return asTextResult({ success: true, mutedUserIds: r.data?.mutedUserIds ?? [] });
        },
    );
}
