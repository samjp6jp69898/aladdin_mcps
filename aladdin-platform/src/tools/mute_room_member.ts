/**
 * tools/mute_room_member.ts — aladdin_platform_room_platform_mute_room_member
 *
 * rajah: RoomPlatform.MuteRoomMember（room_back_office.rajah:243-246，@Permission "Room.RoomList.Actions"）
 *
 * 2026-08-25 讀 agrabah 實作確認（agrabah/src/servers/room_back_office/services/room_platform.ts:373-400，
 * 真查寫入邏輯在 agrabah/src/managers/room_manager.ts:3144-3313 的 createOrUpdateRoomMute）：
 * - 只是**單場禁言**（`RoomMuteTypeEnum.RoomId`），不影響其他房間、不是全站禁言、也不是主播禁言。
 *   **注意**：agrabah 原始碼裡 `room_platform.ts:360-368` 的 JSDoc 寫「全場禁言」，跟實際傳入的
 *   `RoomMuteTypeEnum.RoomId`（單場）矛盾——這是後端原始碼本身的文件錯誤，本 tool 依實際程式行為
 *   （單場）記錄，不是依那段錯誤的 JSDoc。
 * - **被禁言的人仍能留在房間看直播，只是不能發言**，不像 Kick/Ban 會讓對方離開房間。
 * - **永久禁言，沒有到期時間**（`room_mute` 表結構無 expiry 欄位），要解除必須另外呼叫
 *   `UnmuteRoomMember`（另一支 tool）。
 * - **已知後端落差（2026-08-25 查證發現，非本工具引入）**：`createOrUpdateRoomMute` 寫入後**沒有**
 *   呼叫 `syncChatRoomMemberSendMessagePermission` 同步聊天室即時發言權限快取（對照 Unmute 那端
 *   `removeRoomMute` 有呼叫這個同步）。這代表禁言寫入 DB 後，Chat Server 端「能否發言」的即時判斷
 *   是否會立刻生效，本次查證未找到觸發點，可能有延遲或需要等其他事件觸發同步——呼叫端不要假設
 *   呼叫成功就代表對方立刻被擋下發言。
 * - 呼叫前會驗證 roomId/userId 是否真實存在，不存在會直接報錯（不會落庫、不會寫 audit）。
 * - **除了存在性，後端還有三種業務拒絕情境**（2026-08-25 review 補查，room_manager.ts:3159-3187）：
 *   對方是防禁言特權帳號（`roomMuteFailedByTargetProtected`）、對方是這個房間的房主本人
 *   （`roomMuteFailedByTargetIsAnchor`）、對方是這個房間的管理員（`roomMuteFailedByIsRoomManager`）——
 *   這三種都會在寫入前被明確拒絕，回傳對應錯誤碼，不會誤禁言到不該禁的對象。
 * - **重複對同一人呼叫會報錯**（`room_mute` 表有唯一鍵，第二次寫入撞鍵回 `duplicatedData`），
 *   不是冪等更新——重複禁言前建議先用 get_muted_room_members 確認現況。
 *
 * 2026-08-25 dev 實測記錄：用已知測試房間的 ownerUserId（235992，list_rooms 回傳的真實值）呼叫
 * 卻拿到 `userNotExists`（errorCode 204）——沒能找到一個能通過存在性檢查、適合安全測試的真實
 * userId（錯誤碼可能來自 `GetAppUserPrivileges` 或後續的 `GetUserDetailsWithIds` 比對，
 * room_manager.ts:3154/3240，兩處都可能觸發同一個錯誤碼，未逐一排查是哪一步擋下），因此**沒能
 * 驗證成功禁言的完整 round-trip**（呼叫成功 → get_muted_room_members 看到 → unmute 解除 → 再查看不到），
 * 只驗證了「不存在的 userId 會在寫入前被擋下」這條錯誤路徑。`unmute_room_member.ts` 那端的
 * 冪等/靜默成功路徑已用同一個（判定為不存在的）userId 驗證過。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerMuteRoomMemberTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_room_platform_mute_room_member',
        {
            title: 'Mute a room member (single room, permanent until unmuted)',
            description:
                '把指定會員在這個房間單場禁言（rajah: RoomPlatform.MuteRoomMember）。' +
                '**只擋這個房間的發言，對方仍能留在房間看直播**，不像 Kick/Ban 會讓對方離開房間。' +
                '永久生效直到明確呼叫 UnmuteRoomMember 解除，沒有到期時間。' +
                'roomId/userId 不存在會直接報錯，不會有任何寫入；也會擋下三種業務不合法對象' +
                '（防禁言特權帳號、房主本人、房間管理員），各自回傳明確錯誤碼。' +
                '**對已經被禁言的人重複呼叫會報錯**（唯一鍵衝突），不是冪等操作，' +
                '呼叫前建議先用 get_muted_room_members 確認現況。' +
                '**已知後端落差**：寫入禁言紀錄後，聊天室伺服器端的即時發言權限快取不保證立刻同步更新——' +
                '呼叫成功不代表對方立刻被擋下發言，這是後端既有行為，不是本工具的 bug。' +
                '（開發備註：dev 測試沒能找到可安全測試成功路徑的真實 userId，只驗證了錯誤路徑，見檔頭）',
            inputSchema: {
                roomId: z.string().min(1).describe('房間 id'),
                userId: z.number().int().positive().describe('要禁言的會員 userId'),
            },
        },
        async ({ roomId, userId }) => {
            const r = await withAutoRelogin(() => remote.roomBackOffice.roomPlatform.MuteRoomMember(roomId, userId));
            if (r.failed) return asErrorResult(r);

            return asTextResult({ success: true });
        },
    );
}
