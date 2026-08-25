/**
 * tools/get_room_members.ts — aladdin_platform_room_platform_get_room_members
 *
 * rajah: RoomPlatform.GetRoomMembers（room_back_office.rajah:207-213，@Permission "Room.RoomList.Actions"，
 * rajah 註解「每頁固定20筆資料」）
 *
 * 2026-08-25 讀 agrabah 實作確認（agrabah/src/servers/room_back_office/services/room_platform.ts:280-296，
 * 真查詢邏輯在 agrabah/src/managers/room_manager.ts:4179-4252 的 getRoomMembersWithPagination）：
 * - 每頁筆數固定 20（`PageSizeEnum.size20`），呼叫端無法調整，只能傳 page。
 * - **`totalPage` 只有 page=1 的請求才會真的算出來**（common/database_helper.ts:204-217 只在
 *   `page === 1` 時查 COUNT），page>1 的請求一律回 `totalPage=0`——呼叫端要知道總頁數，必須以
 *   第一頁的回應為準，不要用非第一頁的 totalPage=0 誤判成「只有一頁」。
 * - 回傳的是**目前仍在房間內（未離開）的成員**，不是歷史上進過房的所有會員；查詢來源
 *   `room_members` 表在使用者離開時會被實際 DELETE（room_manager.ts:1986），不是狀態欄位。
 *   固定排除房主（`user_id <> ownerUserId`）。
 * - **排序分兩層，2026-08-25 review 發現先前描述有誤**：`room_members.id ASC`（room_manager.ts:4206）
 *   只決定分頁時哪 20 筆落在哪一頁；真正組成回傳 rows 的資料來自另一支 RPC
 *   `UserData.GetUsersInfoForRoomMember`（agrabah/src/servers/app_user_back_office/services/
 *   user_data.ts:473-521），該方法 SQL 是 `ORDER BY identifier, user_id`（:498），最終
 *   `room_manager.ts:4227-4234` 是直接迭代這支 RPC 的回傳組出 rows——**同一頁內的實際順序是依帳號
 *   （identifier）字典序，不是入房先後順序**。
 * - roomId 不存在、或存在但不屬於目前登入平台，會直接回錯誤（`roomNotFound`），不是回空清單。
 * - `status`（Muted/Normal）**只反映單場禁言**，全場禁言與主播禁言不會讓這裡顯示 Muted——
 *   這是後端刻意的業務決策（room_manager.ts:4140-4168 註解明寫「與企劃確認，只看單場禁言」），
 *   不是查詢遺漏；不要把這裡的 Normal 誤讀成「完全沒有被禁言」。
 * - **`createdAt` 語意，2026-08-25 review 發現先前寫反了**：這不是「加入房間的時間戳」，是該會員
 *   的**帳號註冊時間**（`app_users.created_at`，user_data.ts:498/516），rajah model 本身也註明
 *   「# 註冊時間」（room_back_office.rajah:130-132）。是 i64，比照 get_room_announcements.ts
 *   已驗證過的慣例用 `toPlainNumber` 轉換——但這支沒能用真實會員資料驗證過：2026-08-25 dev 站台
 *   當下 4 個已知測試房間都沒有任何在線成員（rows 皆為空），只驗證了 roomId 不存在會報錯、page
 *   參數邊界、zod schema 這些不需要真實會員資料的路徑，toPlainNumber 轉換是沿用已驗證慣例、
 *   非本次真的用非空 rows 測過。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { toPlainNumber } from '../const.ts';

export function registerGetRoomMembersTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_room_platform_get_room_members',
        {
            title: 'List current members in a room',
            description:
                '列出指定房間目前仍在房內（未離開）的成員，不含房主，固定禁言只反映單場禁言' +
                '（全場/主播禁言不會顯示在這裡）（rajah: RoomPlatform.GetRoomMembers）。' +
                '每頁固定 20 筆，呼叫端不能調整。**totalPage 只有 page=1 的回應才是真的算出來的**，' +
                '其餘頁一律回 0，要知道總頁數請以第一頁的回應為準。roomId 不存在或不屬於目前平台會直接報錯，不會回空清單。' +
                '**同一頁內的順序是依帳號字典序，不是入房先後順序**（分頁切片才用入房序，組成最終結果的另一支查詢改依帳號排序）。' +
                '**createdAt 是該會員的帳號註冊時間，不是加入這個房間的時間**，rajah model 本身也標註「註冊時間」。',
            inputSchema: {
                roomId: z.string().min(1).describe('房間 id'),
                page: z.number().int().min(1).optional().describe('頁碼，從 1 開始，預設 1'),
            },
        },
        async ({ roomId, page }) => {
            const r = await withAutoRelogin(() => remote.roomBackOffice.roomPlatform.GetRoomMembers(roomId, page ?? 1));
            if (r.failed) return asErrorResult(r);

            const rows = (r.data?.rows ?? []).map(row => ({ ...row, createdAt: toPlainNumber(row.createdAt) }));
            return asTextResult({ success: true, rows, totalPage: r.data?.totalPage });
        },
    );
}
