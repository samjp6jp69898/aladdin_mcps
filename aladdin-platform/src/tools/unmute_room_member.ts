/**
 * tools/unmute_room_member.ts — aladdin_platform_room_platform_unmute_room_member
 *
 * rajah: RoomPlatform.UnmuteRoomMember（room_back_office.rajah:247-251，@Permission "Room.RoomList.Actions"，
 * rajah 註解「解除會員禁言(只能解除房間禁言, 無法解除全站禁言與主播禁言)」）
 *
 * 2026-08-25 讀 agrabah 實作確認（agrabah/src/servers/room_back_office/services/room_platform.ts:414-433，
 * 真查解除邏輯在 agrabah/src/managers/room_manager.ts:4254-4276 的 unmuteRoomMember，逐筆呼叫
 * removeRoomMute，room_manager.ts:3315-3381）：
 * - 只解除 `mute_room_member.ts` 寫入的**單場禁言**（`RoomMuteTypeEnum.RoomId`），rajah 註解與程式行為
 *   一致確認：無法解除全站禁言或主播禁言（那兩種要用 RoomModeration 的方法，不屬於本 tool）。
 * - **2026-08-25 review 補充的陷阱組合**：對一個「其實是被全站禁言或主播禁言、而不是單場禁言」的人
 *   呼叫本 tool，會（因為查不到 `status=RoomId` 的紀錄）**靜默回成功**，但對方實際上仍然不能發言——
 *   `success: true` 不代表對方已經恢復發言能力，呼叫端不能只看回應就當作解除生效。
 * - **對沒有被禁言的人呼叫是冪等的、會靜默成功**（查無禁言紀錄就直接回成功，不報錯）——但即使實際
 *   上沒有任何紀錄被刪除，後端仍會照樣寫一筆 audit log 宣稱「已解除禁言」，操作紀錄跟實際狀態變更
 *   不完全對應，這是後端既有行為。
 * - roomId/userId 不存在時同樣靜默成功（不做存在性檢查，只是查表查不到而已）。
 * - 解除後會同步聊天室即時發言權限快取（`syncChatRoomMemberSendMessagePermission`），這點跟
 *   `mute_room_member.ts` 檔頭記載的「Mute 沒有同步」不對稱，Unmute 這端有做同步。
 *
 * 2026-08-25 dev 實測驗證：對一個查證後判定不存在的 userId 呼叫，確認靜默回成功（無報錯）；
 * 因為找不到能安全測試「真的有解除到東西」的成功案例（見 mute_room_member.ts 檔頭的實測記錄），
 * 只驗證了冪等/靜默成功這條路徑，沒能驗證「真的解除某個已存在禁言」的完整效果。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerUnmuteRoomMemberTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_room_platform_unmute_room_member',
        {
            title: 'Unmute a room member (single-room mute only)',
            description:
                '解除指定會員在這個房間的單場禁言（rajah: RoomPlatform.UnmuteRoomMember）。' +
                '只能解除單場禁言，**無法解除全站禁言或主播禁言**（rajah 官方註解與後端行為皆確認此限制）。' +
                '**對被全站/主播禁言的人呼叫會靜默回成功，但對方仍然不能發言**——success 不代表對方恢復發言能力，' +
                '這是最容易誤判的陷阱，呼叫前建議先確認對方是哪一種禁言類型。' +
                '對沒被禁言的人呼叫同樣是冪等的、會靜默成功（不報錯），roomId/userId 不存在同樣靜默成功——' +
                '但即使實際上沒有任何紀錄被刪除，仍會寫一筆「已解除禁言」的 audit log，操作紀錄不保證代表真的有狀態變更。',
            inputSchema: {
                roomId: z.string().min(1).describe('房間 id'),
                userId: z.number().int().positive().describe('要解除禁言的會員 userId'),
            },
        },
        async ({ roomId, userId }) => {
            const r = await withAutoRelogin(() => remote.roomBackOffice.roomPlatform.UnmuteRoomMember(roomId, userId));
            if (r.failed) return asErrorResult(r);

            return asTextResult({ success: true });
        },
    );
}
