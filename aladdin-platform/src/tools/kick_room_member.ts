/**
 * tools/kick_room_member.ts — aladdin_platform_room_platform_kick_room_member
 *
 * rajah: RoomPlatform.KickRoomMember（room_back_office.rajah:222-225，@Permission "Room.RoomList.Actions"）
 *
 * 2026-08-25 讀 agrabah 實作確認（agrabah/src/servers/room_back_office/services/room_platform.ts:448-478，
 * 真正踢人邏輯在非同步 job consumer：agrabah/src/servers/room_back_office/index.ts:78-121
 * 的 onLeaveRoomJob → agrabah/src/managers/room_manager.ts:1900-2126 的 leaveRoom）：
 * - **只是單純踢出，不會禁止對方之後再加入同一房間**——完全不寫 `DbRoomEntryBan`。被踢的人可以
 *   立刻重新加入同一房間，沒有冷卻時間、沒有黑名單。真正的持久化禁入要用另一支
 *   `RoomPlatform.BanRoomMember`（不同 method，本工具不涵蓋）。
 * - 這支 RPC 只是把一個 job 送進 RabbitMQ 就回成功，**不等待真正踢人完成**，也**不驗證
 *   roomId/userId 是否存在**。真正執行時（`leaveRoom`）若對方根本不在該房間（沒有成員紀錄、
 *   或目前實際所在房間跟傳入的 roomId 不同），會**成功但不做破壞性寫入**（room_manager.ts:1970-1982，
 *   只清一下該使用者的快取），但仍會無條件推播一次 `LeaveRoomNotification`
 *   （room_back_office/index.ts:113-119）——不是完全靜默無事發生。
 *   ——呼叫端拿到的成功回應**不代表真的踢到人**，只代表 job 送出成功。
 * - 2026-08-25 review 修正：「用不存在的 userId 測試安全」的真正依據不是 `leaveRoom` 的無破壞路徑
 *   （那只適用「真實使用者、但不在這個房間」的情境），而是 job consumer 一開始就會呼叫
 *   `GetAppUserInfo` 驗證 userId 是不是真實存在的帳號（room_back_office/index.ts:93-97），
 *   不存在直接中止、連 `leaveRoom` 都不會執行——結論一樣安全，只是機制引用要對。
 * - 沒有頻率限制，重複呼叫對「已不在房間」的情況是冪等的（不會疊加傷害）。
 * - 沒有撤銷 API，因為沒有需要撤銷的持久化狀態——被踢者自己重新走一般加入房間流程即可恢復。
 * - **對真實在線使用者的實際影響比字面上的「踢出」輕**：2026-08-25 review 用 lago 前端程式碼
 *   （common/api/room.ts、Room.vue、SportDetail.vue、useLeaveRoomNotification.ts）逐一確認，
 *   現版前端對 `LeaveRoomNotification` 的 `kickByPlatform` 原因**完全不處理**（只處理
 *   `closeRoom`），呼叫端不會被強制移出畫面、不會斷線——只有 server 端的房間成員資格、
 *   聊天室/禮物頻道訂閱被移除（殭屍狀態，畫面停留原地但背景功能可能失效）。這是既有前端行為，
 *   不是本工具保證，之後前端若補上處理邏輯，實際影響會變得更接近字面的「踢出」。
 *   2026-08-25 dev 測試刻意只用一個不存在的 userId 驗證（見下方實測記錄），沒有對任何真實
 *   在線帳號呼叫過。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerKickRoomMemberTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_room_platform_kick_room_member',
        {
            title: 'Kick a member out of a room (not a ban)',
            description:
                '把指定會員踢出房間（rajah: RoomPlatform.KickRoomMember）。**只是單純踢出，不會禁止對方' +
                '之後再加入同一房間**（沒有黑名單/冷卻時間）；要永久禁入請改用 BanRoomMember（另一支 tool，本工具不涵蓋）。' +
                '這支 RPC 只是送一個非同步 job，**不等待真正踢人完成、也不驗證 roomId/userId 是否存在**——' +
                '成功回應只代表 job 送出成功，不代表真的踢到人；對方若根本不在該房間不會有破壞性影響，' +
                '但仍會收到一次離房通知。**對真實在線使用者的實際影響比字面「踢出」輕**：現版前端對這個' +
                '踢出原因沒有 UI 反應，畫面不會被強制移出，只有伺服器端的房間成員資格與聊天/禮物頻道' +
                '訂閱會失效（背景功能可能失效但畫面停留原地）。沒有持久化影響、無需撤銷。',
            inputSchema: {
                roomId: z.string().min(1).describe('房間 id'),
                userId: z.number().int().positive().describe('要踢出的會員 userId'),
            },
        },
        async ({ roomId, userId }) => {
            const r = await withAutoRelogin(() => remote.roomBackOffice.roomPlatform.KickRoomMember(roomId, userId));
            if (r.failed) return asErrorResult(r);

            return asTextResult({
                success: true,
                note: '成功回應只代表踢出 job 已送出，不保證對方真的在該房間內被踢掉；此 RPC 不回傳可驗證的結果。',
            });
        },
    );
}
