/**
 * tools/create_or_update_room_mute.ts — aladdin_platform_room_moderation_create_or_update_room_mute
 *
 * rajah: RoomModeration.CreateOrUpdateRoomMute（room_back_office.rajah:518-520，
 * @Permission "Room.RoomFunctions.MuteList.CreateOrUpdate"）
 *
 * 2026-08-25 讀 agrabah 後端原始碼查證（room_manager.ts:3144-3313、
 * room_moderation.ts:358-401），經三輪獨立 review（含一次實際 encode/decode
 * round-trip 執行驗證）才收斂到目前版本，過程中的重大教訓都記在下面，避免
 * 之後改動時重蹈：
 *
 * - **【第一版被打回】不能用 userId 自動判斷新增/編輯**：同一個會員可以同時
 *   存在多筆生效中的禁言，這是正常設計、不是資料異常——後端註解明講「同一
 *   user 可能同時存在多筆禁言（All / RoomId / OwnerId...），最終權限是多筆
 *   規則的合併結果」（room_manager.ts:3428-3431 附近）；新增分支
 *   （`isNew = !params.id`，room_manager.ts:3255-3264）完全不查重直接
 *   insert；App 端房管禁言（`RoomOperate.AddMuteMember`，
 *   agrabah/src/servers/room/services/room_operate.ts:218-223）呼叫時根本
 *   不帶 id。早期草稿版本用 userId 查現有一筆就直接編輯，會把既有某個
 *   scope（例如永久禁言）誤改成另一個 scope，等同無聲解除原本的禁言。
 *   **因此新增（無 id）一律不做任何查詢、直接 insert**，編輯必須呼叫端
 *   明確帶 `id`。
 * - **【第二版被打回】`RoomMuteEdit.create()` 的欄位名要用 `statusValue`
 *   （camelCase），不是 `status_value`**：rajah 原始定義這個欄位確實寫成
 *   snake_case `status_value`，生成的 `.d.ts`（`IRoomMuteEdit`）也忠實宣告
 *   成 `status_value`，但 jasmine 產生鏈裡實際拿去 encode/decode 的 runtime
 *   JSON descriptor（`types.gen.json`）用的是 `statusValue`——`.d.ts` 跟
 *   runtime 行為在這個特定欄位上是分歧的，tsc 編譯過不代表 runtime 對。
 *   已用 `bun -e` 實際跑過 `RoomMuteEdit.create({ status_value: 'x' })` →
 *   encode → decode，確認值會被無聲丟棄（`status_value` 完全消失，不是
 *   留空字串）；反過來用 `RoomMuteEdit.fromObject({ statusValue: 'x' })`
 *   （或直接建構後手動賦值 `setting.statusValue = x`）才會正確 round-trip。
 *   本檔改用 `fromObject`，*不要*改回 `create({ status_value: ... })`，
 *   否則會回到「呼叫永遠成功但 statusValue 從未送達後端」的狀態（roomId/
 *   ownerId 兩種禁言會因為後端收到空字串而必定失敗，只有 all 剛好因為本來
 *   就要送空字串而看起來正常）。同一個 rajah 檔案裡 `RoomEntryBanEdit`
 *   （room_back_office.rajah:460）也有同名 `status_value` 欄位，未來若有
 *   人做 `CreateOrUpdateRoomEntryBan` 的 tool，會踩到同一個生成鏈 bug，
 *   要比照這裡處理。（附帶發現，非本工具範圍：abu 前端
 *   `platform/src/pages/room/moderation/popup/MuteFormDialog.vue` 與
 *   `BanFormDialog.vue` 也寫 `instance.status_value`，可能是同一個潛在
 *   bug 在正式頁面上，已回報使用者，非本 MCP 工具能修。）
 * - **【第二版被打回】要編輯既有一筆時，`id` 不能叫呼叫端從
 *   `get_mute_history` 拿**：`GetMuteHistory` 查的是 `room_mute_history`
 *   表，這是獨立的 auto-increment 主鍵（後端寫歷史時明確
 *   `delete historyDbData.id` 再 insert，room_manager.ts:3298-3300；兩表
 *   各自獨立定義，agrabah/src/database_types/room.ts:163,174），跟
 *   `room_mute`（生效中）表的 id **不是同一個號碼空間**。呼叫端要編輯的
 *   `id` 只能來自本工具自己的 readBack、或另一支查生效中列表的 tool（本
 *   MCP 尚未提供 GetMuteList 專用 tool），不可用 get_mute_history 的 id。
 * - **【第二版被打回】反查現有紀錄不能只查第一頁**：同一會員的生效中禁言
 *   理論上可無上限累積（App 端每次新增都不查重），只查 page=1/pageSize=50
 *   在超過 50 筆時會誤報「找不到」。本檔改成逐頁掃描到 `totalPage`，設
 *   `MAX_SCAN_PAGES` 上限（20 頁 × 50 筆 = 1000 筆）避免無限迴圈，觸頂時
 *   在回傳結構標記 `truncated: true`，不悄悄假裝已經掃完。
 * - **【第二版被打回】zod schema 的 `id` 邊界要跟 description 一致**：
 *   `min(1)` 會讓明確傳 `id: 0` 被參數驗證直接拒絕，但 description 說
 *   「不帶或帶 0 都代表新增」——改成允許 0（`nonnegative()`），handler 的
 *   `if (id)` 本來就把 0 當成「沒帶」處理。
 *
 * 其餘設計維持：
 * - **這是有真實副作用的禁言動作，不是唯讀查詢**：成功後會立即透過
 *   `syncChatRoomMemberSendMessagePermission` 影響該會員在聊天室的發言權限
 *   （room_moderation.ts:399-402），並寫入稽核紀錄（roomMuteAddUser /
 *   roomMuteEditUser，room_moderation.ts:373-397）。有對應的 RemoveRoomMute
 *   可以解除（本 MCP 尚未提供對應 tool），執行前務必確認目標對象正確。
 * - `status` 決定 `statusValue` 的意義（RoomMuteTypeEnum，
 *   room.rajah:377-386）：`roomId`（單場）statusValue 是目標房間 id；
 *   `ownerId`（主播）statusValue 是目標主播 userId 的字串形式；`all`
 *   （永久）不使用 statusValue，後端不會擋下亂填的值、會原樣寫進 DB 與
 *   稽核紀錄（room_manager.ts:3195），本工具在 status=all 時強制覆寫成
 *   空字串。`pass`（通過）在 rajah 列舉裡存在，但後端第一行就無條件拒絕
 *   （`if (status===Pass) return invalidData`，room_manager.ts:3145-3147），
 *   本工具不開放這個選項。
 * - 後端在寫入前有多層業務規則檢查（room_manager.ts:3150-3183），一律讓
 *   後端把關、如實回傳錯誤，不在本工具內重現：目標對象有防禁言保護
 *   （roomMuteFailedByTargetProtected）、status=roomId 但房間不存在
 *   （roomNotExist）、status=ownerId 但 statusValue 不是有效主播 userId
 *   （roomOwnerUserIdInvalid）、目標對象是房間主播本人
 *   （roomMuteFailedByTargetIsAnchor）、目標對象是房間管理員
 *   （roomMuteFailedByIsRoomManager）、userId 不存在（userNotExists）。
 * - 編輯路徑收到 `invalidData` 很可能代表樂觀鎖版本衝突（後端
 *   `UPDATE ... WHERE version = ?` 影響列數不為 1 時回 `invalidData`，
 *   room_manager.ts:3277-3294），重新呼叫本工具（會重新讀最新 version）
 *   即可，不一定是輸入格式錯誤。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { RoomMuteEdit, RoomMuteListSearch } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import type { IRoomBanListData } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

const ROOM_MUTE_TYPE_MAP = { all: 1, roomId: 2, ownerId: 3 } as const;

/** 比照 method-category-checklist.md 第 2 節 B 級掃描上限精神：20 頁 × 50 筆 = 最多掃 1000 筆，不無限重試。 */
const MAX_SCAN_PAGES = 20;
const PAGE_SIZE = 50;

async function listActiveMutesForUser(userId: number) {
    const search = RoomMuteListSearch.create({ userId });
    const rows: IRoomBanListData[] = [];
    let page = 1;
    let totalPage = 1;

    while (page <= totalPage && page <= MAX_SCAN_PAGES) {
        const listR = await withAutoRelogin(() => remote.roomBackOffice.roomModeration.GetMuteList(search, page, PAGE_SIZE));
        if (listR.failed) return { failed: true as const, result: listR };
        rows.push(...(listR.data?.rows ?? []));
        totalPage = listR.data?.totalPage ?? 1;
        page += 1;
    }

    return { failed: false as const, rows, truncated: page <= totalPage };
}

export function registerCreateOrUpdateRoomMuteTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_room_moderation_create_or_update_room_mute',
        {
            title: 'Mute a room member, or edit one specific existing mute record',
            description:
                '對某個會員新增一筆禁言，或編輯一筆已存在的禁言紀錄（rajah: RoomModeration.CreateOrUpdateRoomMute，' +
                '需要權限節點 Room.RoomFunctions.MuteList.CreateOrUpdate）。**這是有真實副作用的動作，會立即影響' +
                '該會員在聊天室的發言權限，並寫入稽核紀錄**，不是查詢類工具。' +
                '不帶 id（或帶 0）＝新增一筆新的禁言，本工具不會做任何查詢就直接送出——同一個會員本來就可以' +
                '同時存在多筆生效中的禁言（例如同時被主播 A 單場禁言、又被平台永久禁言），這是正常設計，' +
                '新增前不需要、也不應該先查有沒有其他既有紀錄；但也請不要對同一個目標重複呼叫新增' +
                '（例如逾時後盲目重試），後端不會擋重複，會疊加出多筆語意相同的紀錄，且本 MCP 目前沒有' +
                '解除禁言的 tool 可以清掉——不確定上一次呼叫是否成功時，先看本工具或其他查詢方式的結果再決定。' +
                '要編輯某一筆既有紀錄，必須明確帶上該筆的 id——**只能用本工具自己 readBack 回傳的 id**（該欄位' +
                '在 rajah 定義標 @Hide，後台表單/列表頁通常不顯示，只能從本工具的回應取得），不可以用 ' +
                'aladdin_platform_room_moderation_get_mute_history 回傳的 id：' +
                '那支查的是完全獨立的歷史表，id 是不同的號碼空間，兩者對不上。本工具會自動反查該筆目前的版本號' +
                '（樂觀鎖用，呼叫端不需要自己追蹤），找不到該 id（不存在、已被移除、或不屬於這個 userId）會' +
                '直接回錯，不會憑空編輯錯的紀錄；若該會員生效中禁言超過 1000 筆（掃描上限），會在錯誤訊息中' +
                '明確標示「已達掃描上限」而不是誤報成不存在。' +
                'status=roomId（單場）時 statusValue 要帶目標房間 id；status=ownerId（主播）時 statusValue ' +
                '要帶目標主播 userId 的字串形式；status=all（永久）時，不管你帶什麼 statusValue 都會被本工具' +
                '忽略、強制送空字串（後端不會擋下亂填的值、會原樣存進資料庫，所以由本工具主動清空避免留下垃圾' +
                '資料）。不支援 pass（通過）——後端一律拒絕這個狀態，若要解除禁言請用 RemoveRoomMute（本 MCP ' +
                '尚未提供）。後端在寫入前有多層業務規則檢查，失敗時如實回傳錯誤，不會、也不應該在本工具內重現' +
                '這些判斷：目標對象有防禁言保護、房間不存在、主播 userId 不合法、目標是房間主播本人、目標是' +
                '房間管理員、userId 不存在等。編輯時收到 invalidData 很可能是版本衝突（有人同時改了這筆），' +
                '重新呼叫本工具即可（會重新讀最新版本號），不一定是輸入格式錯誤。' +
                '完成後會自動讀回該會員目前全部生效中的禁言紀錄一併回傳（可能不只一筆，見上述說明；若超過 ' +
                '1000 筆會標記 truncated）。' +
                'prod 執行前確認（H38 同構機制）：當這個 server 是正式環境（prod）時，執行本工具前必須先用 ' +
                'AskUserQuestion（或功能相同的方式）明確詢問使用者是否要在正式環境執行這個操作，取得明確同意後' +
                '才可以帶上 confirm 參數；絕不能自行假設使用者同意。非 prod 環境不需要、也會忽略 confirm 欄位。',
            inputSchema: {
                id: z.number().int().nonnegative().max(2147483647).optional().describe('要編輯的既有禁言紀錄 id（來自本工具的 readBack，不可用 get_mute_history 的 id）；不帶或帶 0 代表新增一筆新的'),
                userId: z.number().int().min(1).max(2147483647).describe('禁言對象的會員 userId（i32 範圍，超過會被 protobuf 無聲截斷成錯的數字，故加此上限直接擋下）'),
                status: z.enum([ 'all', 'roomId', 'ownerId' ]).describe(
                    '禁言類型：all=永久、roomId=單場（限定某房間）、ownerId=限定某主播的房間；不支援 pass（後端一律拒絕）',
                ),
                statusValue: z.string().describe(
                    'status=roomId 時帶目標房間 id；status=ownerId 時帶目標主播 userId 的字串形式；' +
                    'status=all 時任何值都會被本工具忽略、強制送空字串',
                ),
                confirm: z.string().optional().describe(
                    `正式環境（prod）專用的強制確認欄位；非 prod 環境會被忽略、不需提供。當這個 server 是正式環境時，` +
                    `必須先取得使用者明確同意，再帶上精確字串 "${ PROD_CONFIRM_TOKEN }" 才會執行，否則本工具會拒絕執行並回錯誤。`,
                ),
            },
        },
        async ({ id, userId, status, statusValue, confirm }) => {
            assertProdConfirmed(confirm);

            let targetId = 0;
            let targetVersion = 0;

            if (id) {
                const existing = await listActiveMutesForUser(userId);
                if (existing.failed) return asErrorResult(existing.result);
                const matched = existing.rows.find((row) => row.id === id);
                if (!matched) {
                    return asTextResult({
                        success: false,
                        message: existing.truncated
                            ? `該會員生效中禁言已達掃描上限（${ MAX_SCAN_PAGES * PAGE_SIZE } 筆），沒有在已掃描範圍內找到 id=${ id }，無法判斷是真的不存在還是排在更後面，拒絕執行`
                            : `找不到 id=${ id }、userId=${ userId } 的生效中禁言紀錄（可能已被移除、id 打錯、或不屬於這個 userId，注意不可用 get_mute_history 回傳的 id），拒絕執行避免編輯錯紀錄`,
                    });
                }
                targetId = matched.id ?? 0;
                targetVersion = matched.version ?? 0;
            }

            // 注意：RoomMuteEdit 這個 model 的第 4 個欄位 rajah 原始定義是 snake_case
            // `status_value`，生成的 .d.ts 也忠實宣告成這個名字，但實測發現 runtime 的
            // protobuf JSON descriptor 用的是 camelCase `statusValue`——用 `.create({
            // status_value: ... })` 這個值會被無聲丟棄（不是留空字串，是完全不存在），
            // 必須改用 `fromObject` 搭配 camelCase key 才會正確送達後端。詳見檔頭的
            // 「第二版被打回」說明，這裡不要改回 create({ status_value })。
            const setting = RoomMuteEdit.fromObject({
                id: targetId,
                userId,
                status: ROOM_MUTE_TYPE_MAP[ status ],
                statusValue: status === 'all' ? '' : statusValue,
                version: targetVersion,
            });

            const r = await withAutoRelogin(() => remote.roomBackOffice.roomModeration.CreateOrUpdateRoomMute(setting));
            if (r.failed) return asErrorResult(r);

            const readBack = await listActiveMutesForUser(userId);
            return asTextResult({
                success: true,
                message: id ? '編輯禁言成功' : '新增禁言成功',
                readBack: readBack.failed
                    ? { note: '寫入後讀回失敗', errorCode: readBack.result.errorCode }
                    : {
                        note: readBack.truncated
                            ? `這是該會員目前生效中的禁言紀錄，已達掃描上限（${ MAX_SCAN_PAGES * PAGE_SIZE } 筆），可能還有更多未列出`
                            : '這是該會員目前全部生效中的禁言紀錄，可能不只一筆',
                        rows: readBack.rows,
                    },
            });
        },
    );
}
