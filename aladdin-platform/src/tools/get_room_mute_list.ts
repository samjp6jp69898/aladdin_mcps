/**
 * tools/get_room_mute_list.ts — aladdin_platform_room_moderation_get_mute_list
 *
 * rajah: RoomModeration.GetMuteList（room_back_office.rajah:513-514，@Permission "Room.RoomFunctions.MuteList"）
 *
 * 2026-08-25 讀 agrabah 實作確認（agrabah/src/servers/room_back_office/services/room_moderation.ts:309-321，
 * 共用 helper `_getRoomBanPageData`（:275-298）+ `_buildRoomBanWhereClause`（:191-228）+
 * `_mapRoomBanListRows`（:236-249），查 `room_mute` 現行表）：
 * - **查全部禁言類型**（全站/單場/主播混在一起），`RoomMuteListSearch` 沒有能篩選類型的欄位，
 *   `status` 只出現在回傳資料整理（判斷是否為單場禁言）而不是 where 條件——想只看某一種類型，
 *   要靠回傳的 `status` 欄位自行前端過濾。
 * - `search` 六個欄位全部真的拿去當篩選條件：`userId`/`ownerUserId` 精確比對、`identifier`/
 *   `operatorIdentifierOrId` LIKE 模糊比對、`createdStartAtTimestamp`/`createdEndAtTimestamp`
 *   雖然欄位名叫「建立時間」，**實際比對的是 `updated_at`**（更新時間），不是真正的建立時間——
 *   rajah 欄位命名跟後端實際語意不一致，這是後端既有落差，不是本工具寫錯。
 * - `roomId` 只有 `status` 是單場禁言（RoomMuteTypeEnum.RoomId=2）時才會被填入真正的房間 id，
 *   其他類型（全站=1/主播=3）這個欄位是空字串，不代表「沒有房間」。
 * - **`pageSize` 型別是 `PageSizeEnum`，jasmine 生成的 handler 層（services.gen.ts:30138）真的有做
 *   enum 成員驗證**（`request.pageSize === 0 || PageSizeEnum.hasOwnProperty(request.pageSize)`，
 *   非法值直接回 `invalidData`，在進到 `methodGetMuteList` 之前就擋下）——2026-08-25 review 修正：
 *   先前誤判「後端完全沒有夾限」，只讀了 manager 層（`pageSize = pageSize || DefaultPageSize`，那層
 *   確實沒有上限檢查）卻漏看生成層的驗證，同一個誤判當時也錯誤地寫進了 list_rooms.ts（需另外修正）。
 *   工具層仍用 zod 收斂到合法值集合，行為不變，只是文件描述改正。
 * - **`totalPage` 只有 page=1 的回應才是真的算出來的**（`getPageData` 只在 `page === 1` 時查
 *   COUNT，agrabah/src/common/database_helper.ts:204-217），其餘頁固定回 0。
 * - `createdAtTimestamp` 是 i64，實際上是後端把 `updatedAtTimestamp` 覆寫進這個欄位（見上），比照
 *   已驗證過的慣例用 `toPlainNumber` 轉換。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { RoomMuteListSearch } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { toPlainNumber } from '../const.ts';

const PAGE_SIZE_VALUES = [ 10, 20, 30, 50, 100, 200 ] as const;

export function registerGetRoomMuteListTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_room_moderation_get_mute_list',
        {
            title: 'List currently-active room mutes (all types)',
            description:
                '查詢目前生效中的禁言名單（rajah: RoomModeration.GetMuteList），**涵蓋全站/單場/主播三種禁言類型混在一起**，' +
                '無法用參數篩選類型，要看回傳的 status 欄位自行判斷（1=永久/全站/2=單場/3=主播）。' +
                'roomId 欄位只有單場禁言（status=2）才會有值，其他類型是空字串。' +
                'createdStartAtTimestamp/createdEndAtTimestamp 雖然名字叫建立時間，**實際比對的是最後更新時間**，這是後端既有語意落差。' +
                'identifier/operatorIdentifierOrId 是模糊比對（LIKE），userId/ownerUserId 是精確比對。' +
                `pageSize 僅接受 ${ PAGE_SIZE_VALUES.join('/') }（後端也會用同一組合法值驗證，非法值直接拒絕）。` +
                '**totalPage 只有 page=1 的回應才是真的算出來的**，其餘頁固定回 0。',
            inputSchema: {
                userId: z.number().int().optional().describe('依會員 userId 精確篩選'),
                identifier: z.string().optional().describe('依會員帳號模糊篩選'),
                ownerUserId: z.number().int().optional().describe('依主播 userId 精確篩選'),
                operatorIdentifierOrId: z.string().optional().describe('依操作人帳號/id 模糊篩選'),
                createdStartAtTimestamp: z.number().int().optional().describe('更新時間區間起（ms epoch，欄位名叫建立時間但實際比對更新時間）'),
                createdEndAtTimestamp: z.number().int().optional().describe('更新時間區間迄（ms epoch）'),
                page: z.number().int().min(1).optional().describe('頁碼，從 1 開始，預設 1'),
                pageSize: z.union(PAGE_SIZE_VALUES.map(v => z.literal(v)) as [ z.ZodLiteral<number>, ...z.ZodLiteral<number>[] ])
                    .optional()
                    .describe(`每頁筆數，僅接受 ${ PAGE_SIZE_VALUES.join('/') }，省略時後端預設 100`),
            },
        },
        async ({ userId, identifier, ownerUserId, operatorIdentifierOrId, createdStartAtTimestamp, createdEndAtTimestamp, page, pageSize }) => {
            const search = RoomMuteListSearch.create({
                userId: userId ?? 0,
                identifier: identifier ?? '',
                ownerUserId: ownerUserId ?? 0,
                operatorIdentifierOrId: operatorIdentifierOrId ?? '',
                createdStartAtTimestamp: createdStartAtTimestamp ?? 0,
                createdEndAtTimestamp: createdEndAtTimestamp ?? 0,
            });
            const r = await withAutoRelogin(() => remote.roomBackOffice.roomModeration.GetMuteList(search, page ?? 1, pageSize ?? 100));
            if (r.failed) return asErrorResult(r);

            const rows = (r.data?.rows ?? []).map(row => ({ ...row, createdAtTimestamp: toPlainNumber(row.createdAtTimestamp) }));
            return asTextResult({ success: true, rows, totalPage: r.data?.totalPage });
        },
    );
}
