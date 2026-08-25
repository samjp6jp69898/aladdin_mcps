/**
 * tools/get_room_monitor_list.ts — aladdin_platform_room_moderation_get_monitor_list
 *
 * rajah: RoomModeration.GetMonitorList（room_back_office.rajah:505-507，@Permission "Room.Monitor"）
 *
 * 2026-08-25 讀 agrabah 實作確認（agrabah/src/servers/room_back_office/services/room_moderation.ts:95-150，
 * 真查詢邏輯在 agrabah/src/managers/room_manager.ts 的 getLiveRoomIdsWithOwner（:2775-2841，anchor 用）
 * 與 getLiveRoomByModules（:2693-2770，external 用）+ getBackOfficeLiveRoomMonitorByRoomIds（:2604-2688）：
 * - `search.type` 必填，只接受 `anchor`(1) 與 `external`(3) 兩個值真的能查到資料；`all`(0)、`end`(4)
 *   在寫入前就被後端拒絕（`invalidData`）；`video`(2) 能通過參數驗證，但後端分流邏輯完全沒有實作這個
 *   分支（room_moderation.ts:113-115），呼叫會回 `notImplemented`——這是後端目前的真實狀態，不是
 *   本工具的限制，呼叫端傳 video 就是會失敗。2026-08-25 dev 實測拿到的是 genie 通用
 *   `ErrorCode.notImplemented`（數字 2），不在 `AgrabahErrorCodeEnum` 反查表裡，errorName 會顯示
 *   「(未知錯誤碼)」，同 get_room_chat_history.ts 記載過的既有設計行為，不是異常。
 * - 這是 B 級高風險清單：`search` 只有 `type` 一個範圍鍵，沒有房間名稱/roomId 之類能鎖定單一目標的
 *   欄位，會撈出「目前登入 platform 下該類型全部房間」，無其他篩選。
 * - **`pageSize` 後端沒有上限**（`>0` 才用，否則用預設值 100，沒有夾限上界）——工具層自行收斂範圍。
 * - **`totalPage` 只有 page=1 才是真的算出來的**，其餘頁固定回 0。
 * - `gameName`/`roomTemplateName` 目前後端寫死回空字串（room_moderation.ts:141-142 明寫 TODO，等遊戲/
 *   房間模板模組），不是查詢有問題，是這兩個欄位本來就還沒接。
 * - `streamData` 只有 `external` 類型會真的有內容（`_getStreamDataByType` 對照表只註冊 external），
 *   `anchor` 類型固定回空陣列，不是查詢失敗。
 * - `createdAtTimestamp` 是 i64，比照已驗證過的慣例用 `toPlainNumber` 轉換。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { RoomMonitorListSearch } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { toPlainNumber } from '../const.ts';

const MAX_PAGE_SIZE = 100;
const MONITOR_TYPE_MAP = { anchor: 1, video: 2, external: 3 } as const;

export function registerGetRoomMonitorListTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_room_moderation_get_monitor_list',
        {
            title: 'List rooms for live monitoring by type',
            description:
                '依類型列出直播監控列表（rajah: RoomModeration.GetMonitorList）。' +
                '**type=video 目前後端未實作，呼叫必定失敗（notImplemented）**，只有 anchor（主播房間）與 ' +
                'external（三方房間）真的能查到資料——這是後端現況，不是本工具限制。' +
                '**只有 type 這一個篩選條件，沒有房間名稱/roomId 篩選**，會撈出目前登入平台下該類型全部房間。' +
                `pageSize 上限 ${ MAX_PAGE_SIZE }（工具層自行收斂，後端本身無上限）。` +
                '**totalPage 只有 page=1 的回應才是真的算出來的**，其餘頁固定回 0。' +
                'gameName/roomTemplateName 目前後端固定回空字串（尚未接遊戲/房間模板模組，非查詢異常）；' +
                'streamData 只有 external 類型會有內容，anchor 類型固定回空陣列。',
            inputSchema: {
                type: z.enum([ 'anchor', 'video', 'external' ]).describe('監控類型：anchor 主播房間、external 三方房間（video 目前後端未實作）'),
                page: z.number().int().min(1).optional().describe('頁碼，從 1 開始，預設 1'),
                pageSize: z.number().int().min(1).max(MAX_PAGE_SIZE).optional().describe(`每頁筆數，1~${ MAX_PAGE_SIZE }，預設 20`),
            },
        },
        async ({ type, page, pageSize }) => {
            const search = RoomMonitorListSearch.create({ type: MONITOR_TYPE_MAP[ type ] });
            const r = await withAutoRelogin(() => remote.roomBackOffice.roomModeration.GetMonitorList(search, page ?? 1, pageSize ?? 20));
            if (r.failed) return asErrorResult(r);

            const rows = (r.data?.rows ?? []).map(row => ({ ...row, createdAtTimestamp: toPlainNumber(row.createdAtTimestamp) }));
            return asTextResult({ success: true, rows, totalPage: r.data?.totalPage });
        },
    );
}
