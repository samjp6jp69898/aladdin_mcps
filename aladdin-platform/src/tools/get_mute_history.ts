/**
 * tools/get_mute_history.ts — aladdin_platform_room_moderation_get_mute_history
 *
 * rajah: RoomModeration.GetMuteHistory（room_back_office.rajah:517，
 * @Permission "Room.RoomFunctions.MuteList.GetMuteHistory"）
 *
 * 2026-08-25 讀 agrabah 後端原始碼查證（room_moderation.ts:275-342）：
 * - 跟同 service 的 GetMuteList（room_back_office.rajah:514）共用同一套
 *   分頁/篩選邏輯（`_getRoomBanPageData`/`_buildRoomBanWhereClause`，
 *   room_moderation.ts:191-298），差別只在查詢目標表：GetMuteList 查
 *   `room_mute`（目前生效中的禁言），GetMuteHistory 查 `room_mute_history`
 *   （含已解除的歷史紀錄，多一個 action 欄位，語意見下方說明）。**兩者不是
 *   同一批資料**，要查目前生效中的禁言請改用 GetMuteList（本 MCP 尚未提供）。
 * - **`roomId` 欄位不是一律空字串**：寫入時（room_manager.ts:3204-3209）
 *   只有 status=RoomId（單場禁言）才會把 dbData.roomId 設成真實房號，其餘
 *   status（All/OwnerId/Pass）一律是空字串；`_mapRoomBanHistoryRows`
 *   （room_moderation.ts:256-262）直接用 `RoomBanListData.fromObject(row)`
 *   把歷史表的 room_id 欄位原樣帶出，不會清空也不會另外補值——所以單場
 *   禁言的歷史紀錄 `roomId` 會是真實房號，其他類型才是空字串，跟 GetMuteList
 *   的呈現規則一致（只是 GetMuteList 額外用 isRoomIdStatus 判斷重新賦值一次，
 *   等效但寫法不同）。
 * - **`action` 欄位（@Hide，StatusEnum）語意**：由後端寫入，`enabled(1)`
 *   代表這筆禁言被建立或編輯（新增與編輯共用同一段寫入邏輯，
 *   room_manager.ts:3300），`disabled(2)` 代表被移除（room_manager.ts:3332
 *   附近的 removeRoomMute），不是嚴格對應「新增/刪除」兩種操作。
 * - `RoomMuteListSearch` 全部 6 個欄位（room_back_office.rajah:359-370）
 *   後端都有用上：`userId`/`ownerUserId` 精確比對，`identifier`/
 *   `operatorIdentifierOrId` 模糊比對（LIKE），`createdStartAtTimestamp`/
 *   `createdEndAtTimestamp` 對應到 `created_at` 區間；`platformId` 由呼叫
 *   端登入平台自動帶入，不開放呼叫端指定。
 * - `pageSize` 是 `PageSizeEnum`（封閉列舉，合法值僅 10/20/30/50/100/200，
 *   後端只處理「未帶值」的 fallback，room_moderation.ts:287 沒有另外做
 *   clamp——所以「上限 200」是列舉本身的合法值域，不是伺服器強制夾住任意
 *   輸入），回傳含 `totalPage`，屬於 method-category-checklist.md 第 2 節
 *   「讀取清單 A 級」
 *   （有 userId/identifier 可鎖定單一目標，非只有範圍鍵的高風險 B 級）。
 * - `identifier`（會員帳號）為明碼查詢/回傳，非 doctrine 定義的高風險 PII
 *   （不含真實姓名、銀行帳戶），但仍建議不寫入未加密持久化 log。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { RoomMuteListSearch } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerGetMuteHistoryTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_room_moderation_get_mute_history',
        {
            title: 'Get room mute history (including lifted mutes)',
            description:
                '查詢直播禁言的歷史紀錄（rajah: RoomModeration.GetMuteHistory，需要權限節點 ' +
                'Room.RoomFunctions.MuteList.GetMuteHistory）——查的是歷史表，含已經被解除的禁言，' +
                '不是目前生效中的禁言清單（目前生效中的清單是 GetMuteList，本 MCP 尚未提供對應 tool）。' +
                '回傳的 roomId 欄位只有 status=2（單場，見下方 RoomMuteTypeEnum）的紀錄會是真實房號，' +
                '其餘 status 一律是空字串，不代表資料異常。status 是禁用類型（RoomMuteTypeEnum：' +
                '0=通過/1=永久/2=單場/3=主播）。action 欄位是後端內部標記（1=enabled 代表這筆被建立或' +
                '編輯、2=disabled 代表被移除），不是嚴格對應「新增/刪除」，原樣回傳供參考。' +
                '篩選條件皆為 optional，可任意組合；identifier/operatorIdentifierOrId 為模糊比對，' +
                'userId/ownerUserId 為精確比對，時間區間對應建立時間（createdAtTimestamp）。' +
                'platformId 由連線本身判定，不需要、也不接受呼叫端指定。回傳含會員帳號（identifier），' +
                '避免寫入未加密的持久化 log。',
            inputSchema: {
                identifier: z.string().optional().describe('會員帳號，模糊比對'),
                userId: z.number().int().min(1).optional().describe('會員 userId，精確比對；後端用 truthy 判斷是否套用此條件，0 等同未帶（不會篩選出 userId=0）'),
                ownerUserId: z.number().int().min(1).optional().describe('主播 userId，精確比對；後端用 truthy 判斷是否套用此條件，0 等同未帶（不會篩選出 ownerUserId=0）'),
                operatorIdentifierOrId: z.string().optional().describe('操作者（後台管理員帳號或前端 APP 管理員 userId），模糊比對'),
                createdStartAtTimestamp: z.number().int().optional().describe('建立時間區間起（毫秒 timestamp）'),
                createdEndAtTimestamp: z.number().int().optional().describe('建立時間區間迄（毫秒 timestamp）'),
                page: z.number().int().min(1).optional().describe('頁碼，從 1 開始，預設 1'),
                pageSize: z.union([ z.literal(10), z.literal(20), z.literal(30), z.literal(50), z.literal(100), z.literal(200) ])
                    .optional().describe('每頁筆數，rajah PageSizeEnum 合法值僅 10/20/30/50/100/200（非任意整數），預設 50'),
            },
        },
        async ({ identifier, userId, ownerUserId, operatorIdentifierOrId, createdStartAtTimestamp, createdEndAtTimestamp, page, pageSize }) => {
            const search = RoomMuteListSearch.create({
                identifier: identifier ?? '',
                userId: userId ?? 0,
                ownerUserId: ownerUserId ?? 0,
                operatorIdentifierOrId: operatorIdentifierOrId ?? '',
                createdStartAtTimestamp: createdStartAtTimestamp ?? 0,
                createdEndAtTimestamp: createdEndAtTimestamp ?? 0,
            });

            const r = await withAutoRelogin(() => remote.roomBackOffice.roomModeration.GetMuteHistory(search, page ?? 1, pageSize ?? 50));
            if (r.failed) return asErrorResult(r);

            return asTextResult({ success: true, rows: r.data?.rows ?? [], totalPage: r.data?.totalPage });
        },
    );
}
