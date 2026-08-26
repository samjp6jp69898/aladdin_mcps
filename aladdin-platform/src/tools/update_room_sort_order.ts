/**
 * tools/update_room_sort_order.ts — aladdin_platform_room_platform_update_room_sort_order
 *
 * rajah: RoomPlatform.UpdateRoomSortOrder（room_back_office.rajah:179，
 * @Permission "Room.RoomList"）
 *
 * 2026-08-25 讀 agrabah 後端原始碼查證（room_manager.ts:1068-1173，
 * RoomManager.updateRoomSortOrder）：
 * - **這不是「交換兩筆資料」，是拖曳排序的「插入式搬移」**：後端先查
 *   fromId/toId 目前的 sort_order，把 toId 端（含）到 fromId 原位置前一格
 *   （不含 fromId 端）之間的整段區間內、同一個 platformId 下的所有房間的
 *   sort_order 整批 ±1 位移，再把 fromId 的 sort_order 設成 toId 原本的值
 *   （room_manager.ts:1118-1122 的 rangeStart/rangeEnd 推導）。也就是說呼叫
 *   一次可能連帶影響 fromId/toId 之外、排在它們中間的其他房間，不是只動
 *   這兩筆。此位移邏輯假設區間內 sort_order 彼此不重複才能保持相對順序；
 *   後端註解明講「sort_order 只要不重複就能正常做動」（room_manager.ts:1069），
 *   目前 dev 環境房間預設值普遍是 1000（見下），大量重複值時插入語意會退化，
 *   不保證中間房間的顯示順序一定符合直覺。
 * - **不能靠「把 fromId/toId 對調再呼叫一次」還原**：只有當兩者在目前排序
 *   上緊鄰時，用同一組（不對調）參數再呼叫一次才能還原；一般情況下沒有
 *   辦法只靠這支 API 反推出正確的還原呼叫，需要呼叫前自行記錄受影響區間
 *   內每筆房間的 (roomId, sortOrder) 快照才能精確復原。
 * - fromId === toId 在任何查詢/鎖定之前就直接視為 no-op、回傳成功、不觸發
 *   任何 SQL（room_manager.ts:1070-1072）——即使這個 id 根本不存在，只要
 *   fromId/toId 字串相同，一樣回成功，不會走到下面的 idNotExists 檢查。
 * - fromId/toId 不同時，必須都存在於呼叫端目前登入平台（source_platform_id）
 *   底下的 `rooms` 資料表，缺一即回 idNotExists；同平台下對同一張表的並發
 *   呼叫有 1 秒鎖，搶不到鎖回 exceedRequestLimit（非重試友善，短時間內對
 *   同平台連續呼叫可能因搶鎖失敗而報錯，非本工具邏輯錯誤）。
 * - 後端註解「目前因為 rooms 的 sort_order 都固定寫 1000，所以排序事實上
 *   無法做動」——多數房間預設 sort_order 皆為 1000，若 fromId/toId 剛好都還
 *   是預設值，這次呼叫等同無實質變化（把 1000 改成 1000）。
 * - **讀回（GetRoomList）跟寫入（UpdateRoomSortOrder）的平台範圍不是同一個
 *   概念**：寫入以 `rooms.source_platform_id` 過濾（room_manager.ts:1087），
 *   讀回改用的 `GetRoomList` 卻是 join `platform_room_data.platform_id`
 *   （room_manager.ts:2473-2475,2492-2494，「房間啟用給哪些平台」的多對多
 *   對應表，建房時與 source_platform_id 是各自獨立寫入，見 room_manager.ts
 *   :862-888）。兩個集合不保證一致：可能出現「房間排得到序但讀回清單看不到」
 *   或反過來的情況，不是查詢失敗，見下方 describeCurrentOrder 的說明。
 *
 * 沒有可以查詢單一房間 sort_order 的 method（GetRoomSettings 目前是
 * agrabah 未實作的 notImplemented stub：agrabah/src/generated/services.gen.ts
 * :29446-29450 落回 base class 的 notImplemented，room_platform.ts 全檔無
 * methodGetRoomSettings override），因此本工具寫入後改用
 * RoomPlatform.GetRoomList（不帶篩選、依 sort_order 升冪排序，一次最多
 * 100 筆）讀回目前清單，摘出 fromId/toId 目前所在順位供呼叫端核對，不是
 * 完整逐筆快照。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { GetRoomListSearch } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

/** 讀回目前房間順序（依 sort_order 升冪），標出 fromId/toId 目前排在第幾位，供呼叫端核對搬移結果。 */
async function describeCurrentOrder(fromId: string, toId: string) {
    const listR = await withAutoRelogin(() => remote.roomBackOffice.roomPlatform.GetRoomList(GetRoomListSearch.create({}), 1, 0));
    if (listR.failed) {
        return { note: '寫入後讀回房間清單失敗，無法核對目前順序', errorCode: listR.errorCode, message: listR.message };
    }

    const rows = listR.data?.rows ?? [];
    const roomIds = rows.map((r) => r.roomId);
    const fromIdPosition = roomIds.indexOf(fromId);
    const toIdPosition = roomIds.indexOf(toId);

    const notes: string[] = [];
    if (roomIds.length >= 100) {
        notes.push('本平台第一頁房間數已達 100（單頁上限），若 fromId/toId 不在此列表內，可能只是排在更後面，不代表搬移失敗');
    }
    if (fromIdPosition === -1 || toIdPosition === -1) {
        notes.push(
            '-1 代表 fromId 或 toId 不在這份清單內：可能是排在後面（見上一則 note，僅適用清單已滿 100 筆時），' +
            '也可能是因為 UpdateRoomSortOrder 用 rooms.source_platform_id 判斷房間歸屬、而這份清單改用' +
            'platform_room_data 這張「房間啟用給哪些平台」的關聯表過濾，兩者不保證是同一個集合——房間排序' +
            '寫入成功不代表它一定會出現在這份清單裡，-1 不代表操作失敗。',
        );
    }

    return {
        totalRoomsInFirstPage: roomIds.length,
        fromIdPosition,
        toIdPosition,
        notes: notes.length > 0 ? notes : undefined,
    };
}

export function registerUpdateRoomSortOrderTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_room_platform_update_room_sort_order',
        {
            title: 'Move a room to another room\'s position in the sort order',
            description:
                '把房間列表（後台「房間管理」的房間列表頁拖曳排序）裡的 fromId 搬移到 toId 目前的位置' +
                '（rajah: RoomPlatform.UpdateRoomSortOrder，需要權限節點 Room.RoomList）。' +
                '重要：這不是把 fromId 與 toId 兩筆資料互換，是插入式搬移——後端會把 toId 端到 fromId 原位置' +
                '前一格之間的其他房間順位整批位移一格，只有 fromId 最終落在 toId 原本的位置。此邏輯假設區間內' +
                'sort_order 彼此不重複才能保持相對順序；房間預設建立時 sort_order 皆為 1000，若目標平台從未' +
                '手動調整過排序、大量房間仍是同一個值，插入語意會退化，結果不一定符合直覺，且此時 fromId/toId' +
                '若剛好都還是預設值，呼叫等同沒有實質效果。' +
                '不可假設「把 fromId/toId 對調再呼叫一次」能還原——一般情況下這樣做完全無法回到原狀，只有兩者' +
                '目前緊鄰時，用同一組（不對調）參數再呼叫一次才能還原；不確定時，呼叫前建議自行呼叫一次現有的' +
                '房間清單查詢方式記下受影響房間目前的順序，本工具不提供自動還原。' +
                'fromId === toId 在任何存在性檢查之前就直接視為無動作、回傳成功——即使這個 id 根本不存在也一樣' +
                '回成功，不會出現 idNotExists。fromId/toId 不同時，兩者都必須是目前登入平台底下真實存在的房間' +
                'id，缺一即回 idNotExists 錯誤，不會有任何寫入。同平台短時間內連續呼叫可能因為後端 1 秒搶鎖' +
                '失敗回 exceedRequestLimit，不代表操作本身有誤，可稍後再試一次（不要自動連續重試）。' +
                '目前沒有可查詢單一房間 sort_order 的 API，本工具寫入後會改用 GetRoomList（依 sort_order 升冪、' +
                '第一頁最多 100 筆）讀回，回報 fromId/toId 目前所在順位供核對；但 GetRoomList 判斷房間歸屬的' +
                '依據（房間是否啟用給本平台）跟 UpdateRoomSortOrder 本身（房間是否由本平台建立）不是同一個' +
                '條件，兩者集合不保證一致——讀回結果查不到目標 id（顯示 -1）不代表搬移失敗，也不代表清單一定' +
                '要滿 100 筆才會發生，詳見回傳的 notes。' +
                'prod 執行前確認（H38 同構機制）：當這個 server 是正式環境（prod）時，執行本工具前必須先用 ' +
                'AskUserQuestion（或功能相同的方式）明確詢問使用者是否要在正式環境執行這個操作，取得明確同意後' +
                '才可以帶上 confirm 參數；絕不能自行假設使用者同意。非 prod 環境不需要、也會忽略 confirm 欄位。',
            inputSchema: {
                fromId: z.string().min(1).describe('要被搬移的房間 id'),
                toId: z.string().min(1).describe('搬移目標位置的房間 id（搬移後 fromId 會落在這個房間原本的位置）'),
                confirm: z.string().optional().describe(
                    `正式環境（prod）專用的強制確認欄位；非 prod 環境會被忽略、不需提供。當這個 server 是正式環境時，` +
                    `必須先取得使用者明確同意，再帶上精確字串 "${ PROD_CONFIRM_TOKEN }" 才會執行，否則本工具會拒絕執行並回錯誤。`,
                ),
            },
        },
        async ({ fromId, toId, confirm }) => {
            assertProdConfirmed(confirm);

            const r = await withAutoRelogin(() => remote.roomBackOffice.roomPlatform.UpdateRoomSortOrder(fromId, toId));
            if (r.failed) return asErrorResult(r);

            const readBack = await describeCurrentOrder(fromId, toId);
            return asTextResult({
                success: true,
                message: fromId === toId ? 'fromId 與 toId 相同，視為無動作' : '搬移成功',
                readBack,
            });
        },
    );
}
