/**
 * tools/list_rooms.ts — aladdin_platform_room_platform_get_room_list
 *
 * rajah: RoomPlatform.GetRoomList（room_back_office.rajah:173）
 *
 * 2026-08-25 讀 agrabah 實作確認（agrabah/src/servers/room_back_office/services/room_platform.ts:75-103，
 * 真查 DB 邏輯在 agrabah/src/managers/room_manager.ts:2458-2599 的 getBackOfficeLiveRoomList）：
 * - `search`（rajah `GetRoomListSearch`）是空 model，一個欄位都沒有；service 層收到後直接丟棄，
 *   根本沒有傳進 manager（`room_platform.ts:82` 呼叫 `getBackOfficeLiveRoomList(context, page,
 *   pageSize)`，參數就只有 page/pageSize）——這支 method 沒有任何篩選能力，純粹是「本平台全部
 *   房間」的分頁列表，對應後台「房間列表」頁面。
 * - 2026-08-25 修正：原本這裡建議「已知 roomId 要查單一房間細節改用 `RoomPlatform.GetRoomSettings`」，
 *   後來查證發現 `GetRoomSettings` 目前完全沒有後端實作（`agrabah/src/servers/room_back_office/
 *   services/room_platform.ts` 沒有 override，落回 base class 的 `GenieResult.error(notImplemented)`，
 *   見 `agrabah/src/generated/services.gen.ts:29446-29449`），呼叫必定失敗——此建議已錯誤，撤回。
 *   目前 `RoomPlatform` service 底下**沒有**任何可用的「依 roomId 查單一房間」方法；若呼叫端需要
 *   定位特定房間，只能對這支清單做有界的逐頁掃描（比對回傳的 roomId），沒有更好的替代方案。
 * - `pageSize` 雖然 rajah 型別是 `PageSizeEnum`（合法值 10/20/30/50/100/200，見
 *   common.rajah:2438-2446），但 manager 端只檢查 `pageSize > 0`（真，否則用預設值 100），
 *   沒有夾限在這個列舉範圍——這支工具仍只開放這幾個合法值，避免呼叫端傳入列舉外的數字。
 * - 排序固定 `sort_order ASC`，`totalPage` 是真的 `COUNT(*)` 算出來的，不是猜的，可放心用
 *   `page > totalPage` 判斷是否翻到底。
 * - `moduleResult` 需要額外查 `DbRoomModules` + `roomFeatureManager.batchFetch` 才能組出，
 *   不是從 rooms 主表直接帶出的欄位；`realMemberCount` 目前只算連到「本平台」的即時人數
 *   （manager 註解本身有 TODO，跨平台/系統平台的計數可能不準，原樣照後端行為呈現）。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { GetRoomListSearch } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { toPlainNumber } from '../const.ts';

const PAGE_SIZE_VALUES = [ 10, 20, 30, 50, 100, 200 ] as const;

export function registerListRoomsTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_room_platform_get_room_list',
        {
            title: 'List rooms on this platform',
            description:
                '列出本平台全部房間的分頁清單（rajah: RoomPlatform.GetRoomList）。' +
                '**沒有任何篩選欄位**——後端 search 參數是空 model 且 service 層完全沒使用它，' +
                '不支援依 roomId/title/ownerUserId 篩選。RoomPlatform 底下沒有任何「依 roomId 查單一房間」' +
                '的可用方法（GetRoomSettings 存在於 rajah 定義但後端完全未實作，呼叫必定回 notImplemented）——' +
                '若需要定位特定房間，目前只能對這支清單做有界的逐頁掃描比對 roomId，沒有更好的替代方案。' +
                '固定依 sort_order 排序，totalPage 是真實 COUNT(*) 算出來的，可用 page > totalPage 判斷是否已翻完。' +
                'moduleResult 是額外查詢組出來的巢狀結構（依房間啟用的模組而定，可能為空）；' +
                'realMemberCount 目前只計算連到本平台的即時人數，跨平台情境可能不準確（後端已知限制）。' +
                '注意：欄位值恰好是 0 或空字串時，該欄位可能整個不出現在回傳 JSON 裡（proto3 預設值不上線）——' +
                '缺 key 不代表資料異常，視同該欄位是 0/空字串。',
            inputSchema: {
                page: z.number().int().min(1).optional().describe('頁碼，從 1 開始，預設 1'),
                pageSize: z.union(PAGE_SIZE_VALUES.map(v => z.literal(v)) as [ z.ZodLiteral<number>, ...z.ZodLiteral<number>[] ])
                    .optional()
                    .describe('每頁筆數，僅接受 10/20/30/50/100/200（rajah PageSizeEnum 合法值），省略時後端預設 100'),
            },
        },
        async ({ page, pageSize }) => {
            const r = await withAutoRelogin(() => remote.roomBackOffice.roomPlatform.GetRoomList(GetRoomListSearch.create(), page ?? 1, pageSize ?? 100));
            if (r.failed) return asErrorResult(r);

            const rows = (r.data?.rows ?? []).map(row => ({
                ...row,
                roomCreatedAt: toPlainNumber(row.roomCreatedAt),
                moduleResult: row.moduleResult
                    ? {
                        ...row.moduleResult,
                        chat: row.moduleResult.chat
                            ? { ...row.moduleResult.chat, chatRoomId: toPlainNumber(row.moduleResult.chat.chatRoomId) }
                            : row.moduleResult.chat,
                    }
                    : row.moduleResult,
            }));

            return asTextResult({ success: true, rows, totalPage: r.data?.totalPage });
        },
    );
}
