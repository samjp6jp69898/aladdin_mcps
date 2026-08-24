/**
 * tools/update_vendor_game_status.ts — aladdin_admin_game_vendor_admin_update_game_vendor_game_status
 *
 * rajah: GameVendorAdmin.UpdateGameVendorGameStatus（game_back_office.rajah:333，
 * 需要 @Permission "GameVendor.Game.Ops.Toggle"）
 *
 * 分類（method-category-checklist.md 第 6 節「狀態轉換」）：UpdateXxxStatus(id, status)，
 * status 是明確目標狀態參數，不是無參數 bit-flip，工具層不做「先查現況再反轉」。
 *
 * 2026-08-24 讀 agrabah 後端原始碼查證（非憑猜測）：
 * - agrabah/src/servers/game_back_office/services/game_vendor_admin.ts:427-436
 *   methodUpdateGameVendorGameStatus 直接呼叫共用 helper updateStatus()（真的有 override，
 *   不是落回 base class 的 notImplemented）。
 * - agrabah/src/common/database_helper.ts:25-50 updateStatus()：純粹 `UPDATE ... SET status=?
 *   WHERE id=? [AND platform_id=?]`，**沒有**檢查現有 status 是否等於目標值、也沒有任何
 *   類似「狀態非法轉換」或「已經是這個狀態」的檢查——同一個 id 重複呼叫、或設成跟現在一樣的
 *   status，都會照樣回傳成功，不是不冪等的危險操作。affectedRows === 0 時回
 *   errorCode=objectNotFound（id 不存在），這是唯一的錯誤來源。
 * - game_vendor_games 是全平台共用母表（同 list_vendor_games.ts / upsert_game.ts 已查證的結論），
 *   admin context 的 platformId 恆為 0，因此 helper 內的 platform_id 過濾分支不會生效，
 *   純粹以 id 定位單一列。
 *
 * 讀回驗證：GetGameVendorGameForEdit 回傳的 GameEdit model **沒有 status 欄位**
 * （game_back_office.rajah:250-274），無法用來確認狀態；只有 ListGames 回傳的
 * GameEssential 有 status（game_back_office.rajah:217-242）。id 已由呼叫端直接提供，
 * 不需要靠 List 定位目標（不是 method-category-checklist 第 2 節 B 級「用 List 找目標」
 * 的情境），讀回純粹是「順手確認剛剛真的生效」，比照 update_platform_game_vendor_status.ts
 * 的既有作法：只查 ListGames 第一頁，找不到就如實回報「非失敗」，不做逐頁全掃。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { STATUS_MAP, STATUS_KEYS } from '../const.ts';

export function registerUpdateVendorGameStatusTool(server: McpServer): void {
    server.registerTool(
        'aladdin_admin_game_vendor_admin_update_game_vendor_game_status',
        {
            title: "Update a vendor game's enable/disable status (admin master data)",
            description:
                '把「廠商遊戲母表」（game_vendor_games，全平台共用，非某個 platform 的上架設定）裡指定一筆遊戲的' +
                '狀態改成指定值（rajah: GameVendorAdmin.UpdateGameVendorGameStatus，需要權限節點 ' +
                'GameVendor.Game.Ops.Toggle）。本工具操作的是全平台共用母表，與平台無關，不需要也不接受 ' +
                'platformId 參數；若要控制某個 platform 前台是否顯示這款遊戲，是另一件事，本工具做不到。' +
                'id 是這筆遊戲在母表的內部流水號（不是 gameId 那個廠商系統的原始代碼字串），來源二選一：' +
                'aladdin_admin_game_vendor_admin_list_games 回傳 rows[].id，或 ' +
                'aladdin_admin_game_vendor_admin_create_or_update_game_vendor_game 讀回結果的 game.id。' +
                'gameVendorId 只用來做寫入後的讀回驗證（呼叫 ListGames 查第一頁比對），來源同 id。' +
                '狀態值（rajah StatusEnum）：unknown/enabled/disabled/frozen/deleted，一般啟用/停用只會用到 ' +
                'enabled/disabled，其餘值語意不在本工具範圍內描述。' +
                '2026-08-24 讀 agrabah 後端原始碼查證：這支操作是單純的 `UPDATE ... SET status=? WHERE id=?`，' +
                '沒有檢查現有狀態是否等於目標值，也沒有任何「已經是這個狀態」的拒絕邏輯——重複呼叫、或設成跟現在' +
                '一樣的狀態，都會照樣成功，可放心重試，不是不冪等的危險操作。id 不存在時會回 errorCode 對應' +
                'objectNotFound（找不到該筆遊戲），不會寫入。' +
                '寫入成功後，本工具會用 ListGames 查該廠商第一頁比對 id 讀回目前狀態；若目標遊戲不在第一頁' +
                '（廠商遊戲數多時常見，例如 PP電子-XO 有 518 款）會如實標註「第一頁沒找到，非失敗」，不代表寫入失敗——' +
                'RPC 本身回傳成功即代表該筆已依 affected-rows 檢查確實更新，讀回只是輔助確認，不是判斷成敗的依據。' +
                'prod 執行前確認（H36）：當這個 server 是正式環境（prod）時，執行本工具前必須先用 AskUserQuestion' +
                '（或功能相同的方式）明確詢問使用者是否要在正式環境執行這個操作，取得明確同意後才可以帶上 confirm 參數；' +
                '絕不能自行假設使用者同意。非 prod 環境（dev/pre/evi）不需要、也會忽略 confirm 欄位。',
            inputSchema: {
                id: z.number().int().describe('這筆廠商遊戲在母表的內部流水號 id（不是 gameId 字串），來自 aladdin_admin_game_vendor_admin_list_games 的 rows[].id，或 aladdin_admin_game_vendor_admin_create_or_update_game_vendor_game 讀回結果的 game.id'),
                gameVendorId: z.number().int().describe('這筆遊戲所屬的廠商場館 id，僅用於寫入後呼叫 ListGames 做讀回驗證，來源同 id 參數（同一次查詢結果）'),
                status: z.enum(STATUS_KEYS).describe('目標狀態：unknown/enabled/disabled/frozen/deleted，一般啟用/停用遊戲用 enabled/disabled'),
                confirm: z.string().optional().describe(
                    `正式環境（prod）專用的強制確認欄位；非 prod 環境會被忽略、不需提供。當這個 server 是正式環境時，` +
                    `必須先取得使用者明確同意，再帶上精確字串 "${ PROD_CONFIRM_TOKEN }" 才會執行，否則本工具會拒絕執行並回錯誤。`,
                ),
            },
        },
        async ({ id, gameVendorId, status, confirm }) => {
            assertProdConfirmed(confirm);
            const r = await withAutoRelogin(() => remote.gameBackOffice.gameVendorAdmin.UpdateGameVendorGameStatus(id, STATUS_MAP[ status ]));
            if (r.failed) return asErrorResult(r);

            // 沒有帶 status 的單筆查詢 method（GetGameVendorGameForEdit 的 GameEdit 沒有 status 欄位），
            // 只能用 ListGames 讀回；比照 update_platform_game_vendor_status.ts 的作法，只查第一頁。
            const listResult = await withAutoRelogin(() => remote.gameBackOffice.gameVendorAdmin.ListGames(gameVendorId, 1, 50));
            const matched = listResult.success
                ? listResult.data?.rows?.find((row) => row.id === id)
                : undefined;

            return asTextResult({
                success: true,
                message: '更新成功',
                readBack: matched ?? (listResult.success ? { note: '第一頁沒找到，可能分頁較後面，非失敗' } : null),
            });
        },
    );
}
