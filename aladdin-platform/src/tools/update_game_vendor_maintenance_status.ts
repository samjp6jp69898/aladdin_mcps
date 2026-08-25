/**
 * tools/update_game_vendor_maintenance_status.ts — aladdin_platform_game_vendor_platform_update_game_vendor_maintenance_status
 *
 * rajah: GameVendorPlatform.UpdateGameVendorMaintenanceStatus(id i32 1, newStatus StatusEnum 2)
 * （game_back_office.rajah:1081，需要 @Permission "GameVendor.Vendor.Maintain.Toggle"）——
 * 跟同 service 的 `UpdateGameVendorStatus`（見 update_game_vendor_status.ts）是姊妹方法，改的
 * 都是「這個場館在**當前這個平台**底下」的欄位（`platform_game_vendors`，以
 * `game_vendor_id + platform_id` 定位），差別只在改的欄位——這支改 `maintenance_status`
 * （維護狀態），那支改 `status`（上下架狀態），彼此獨立、互不影響。
 *
 * 2026-08-25 讀 agrabah 後端原始碼查證
 * （agrabah/src/servers/game_back_office/services/game_vendor_platform.ts:874-894，
 * methodUpdateGameVendorMaintenanceStatus）：
 * - **與姊妹方法 UpdateGameVendorStatus 的關鍵行為差異**：這支底層直接呼叫
 *   `context.relationalDatabase.update('UPDATE platform_game_vendors SET maintenance_status = ? ' +
 *   'WHERE platform_id = ? AND game_vendor_id = ?', ...)`，**沒有**像姊妹方法的
 *   `updateStatus()` helper 那樣檢查 affectedRows 是否為 0 並回 objectNotFound——
 *   `relationalDatabase.update()` 本身只在 SQL 執行出錯時才回 failed，affectedRows=0
 *   （即 WHERE 條件沒有任何列符合，例如 id 不存在）仍視為成功。
 *   **2026-08-25 dev 實測證實**：對 pk-platform.alddev.com 呼叫
 *   `UpdateGameVendorMaintenanceStatus(id=999999999, newStatus=1)`（不存在的 id）
 *   回傳 **errorCode=0（成功）**，不是預期中的 objectNotFound——這是一個真實的
 *   「假成功」風險：呼叫端如果只看 errorCode 判斷成功與否，會誤以為改成功了，
 *   實際上後端什麼都沒改。**本工具因此不能依賴後端錯誤碼判斷 id 是否存在**，
 *   必須在呼叫前先用 `ListAllGameVendors` 讀現值確認 id 真的出現在當前平台的場館清單裡，
 *   找不到就直接在 tool 層回報「找不到」，不呼叫後端。
 * - newStatus 帶非法列舉值（如 254）**會**被拒絕，回 errorCode=9（invalidData，
 *   2026-08-25 dev 實測確認）——這一點跟姊妹方法行為一致（推測是 rajah 框架層在進入
 *   method body 前就做了 enum decode 驗證，不是這支方法自己檢查的）。
 * - 目標狀態剛好等於現有值時呼叫也會成功（errorCode=0，dev 實測確認），不會被誤判成
 *   任何錯誤，本工具比照姊妹方法先讀現值、相同則短路不呼叫後端，理由同樣是省一次不必要的
 *   寫入 RPC，不是規避已知錯誤。
 * - 成功後背景觸發 `clearAppGameCache`、audit log（`gameVendorMaintenanceEnable`/
 *   `gameVendorMaintenanceDisable` action）、`RefreshGameCache` message 廣播，皆非同步
 *   （`.then()`），RPC 回應不等待這些完成。
 * - 註解提及「體育維護狀態輪詢機制」，代表 maintenance_status 除了後台顯示用途外，
 *   還會被其他前台/體育輪詢機制讀取，實際影響範圍可能超出後台畫面本身，但本工具只負責
 *   忠實呼叫這支 RPC，不評估下游影響。
 * - `GameVendorPlatform` 沒有帶 maintenanceStatus 的單筆查詢 method，寫入前後皆改用
 *   `ListAllGameVendors`（不分頁、一次拿當前平台全部場館的 `PlatformGameVendorEssential[]`，
 *   已含 `maintenanceStatus` 欄位，game_back_office.rajah:396）比對 id 讀現值/讀回驗證，
 *   做法與姊妹方法完全相同。
 *
 * **2026-08-25 已通過 dev 實測**（對 pk-platform.alddev.com 直接呼叫底層 rajah method，
 * 涵蓋：不存在的 id → errorCode=0「假成功」已驗證並在 tool 層以讀清單防呆；非法列舉值 254
 * → errorCode=9；newStatus 與現值相同 → errorCode=0；round-trip 切換至相反狀態 → 讀回驗證
 * 變更生效 → 切回原值 → 讀回驗證已復原，全程無殘留髒資料）。
 *
 * **2026-08-25 補測**：改用真正的 MCP stdio Client（`@modelcontextprotocol/sdk` 的 Client +
 * StdioClientTransport，走 `tools/call`，涵蓋 zod schema 驗證與 `registerTool` handler 本身，
 * 不繞過 MCP 工具層）對 worktree 內 `bun src/stdio.ts` 重新驗證：確認 tool 出現在 `tools/list`、
 * 不存在 id 的防呆訊息、round-trip 切換 enabled/disabled 並復原，行為與直接呼叫底層 rajah method
 * 的結果一致；額外驗證 `status: "unknown"`（合法列舉值 0）可正確寫入。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { STATUS_MAP, STATUS_KEYS } from '../const.ts';

export function registerUpdateGameVendorMaintenanceStatusTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_game_vendor_platform_update_game_vendor_maintenance_status',
        {
            title: "Update a game vendor's maintenance status under the current platform",
            description:
                '把某個廠商場館「在當前這個平台底下」的維護狀態改成指定值（rajah: ' +
                'GameVendorPlatform.UpdateGameVendorMaintenanceStatus，需要權限節點 GameVendor.Vendor.Maintain.Toggle）。' +
                '跟 aladdin_platform_game_vendor_platform_update_game_vendor_status 是姊妹工具，範圍同樣限定在當前平台，' +
                '差別只在改的欄位：那支改上下架狀態（status），本工具改維護狀態（maintenanceStatus），彼此獨立。' +
                'id 從 aladdin_platform_game_vendor_platform_list_game_vendors 取得（該工具回傳的清單本身就已限定在' +
                '當前平台）。status 合法值（rajah StatusEnum）：unknown/enabled/disabled/frozen/deleted，一般開啟/' +
                '進入維護只會用到 enabled/disabled，其餘值語意不在本工具範圍內描述。' +
                '**重要風險（2026-08-25 dev 實測確認）**：id 不存在時後端不會回錯誤，會回 errorCode=0「成功」但' +
                '實際上什麼都沒改（底層 UPDATE 語句沒有檢查 affectedRows）——本工具已在呼叫前用讀清單的方式檢查 id ' +
                '是否真的存在於當前平台，不存在會直接回報找不到、不會誤報成功，但這代表若未來繞過本工具直接呼叫底層 ' +
                'RPC，需自行注意這個陷阱。newStatus 帶非法列舉值時會被拒絕，回 errorCode=9（invalidData，dev 實測確認）。' +
                '目標狀態剛好等於現有狀態時直接呼叫後端也會成功（errorCode=0），本工具仍先讀現值、相同則不呼叫後端' +
                '直接短路，純粹是省一次不必要的寫入 RPC。' +
                '這支 RPC 沒有帶 maintenanceStatus 的單筆查詢方法，寫入前後皆改用 ' +
                'aladdin_platform_game_vendor_platform_list_game_vendors 背後的 ListAllGameVendors（不分頁、一次拿全部）' +
                '讀現值與讀回驗證。' +
                'prod 執行前確認：當這個 server 是正式環境（prod）時，執行本工具前必須先用 AskUserQuestion' +
                '（或功能相同的方式）明確詢問使用者是否要在正式環境執行這個操作，取得明確同意後才可以帶上 confirm 參數；' +
                '絕不能自行假設使用者同意。非 prod 環境不需要、也會忽略 confirm 欄位。' +
                '**2026-08-25 已通過 dev 實測**（對 pk-platform.alddev.com 直接呼叫底層 rajah method 驗證過上述各項' +
                '錯誤碼行為，並完成 round-trip 切換 + 復原，未留殘留資料；並另外透過真正的 MCP stdio Client 打 ' +
                'tools/call 重新驗證過同一組情境，行為一致）。',
            inputSchema: {
                id: z.number().int().describe(
                    '廠商場館 id（即 game_vendor_id），來自 aladdin_platform_game_vendor_platform_list_game_vendors 的回傳結果 ' +
                    '（該清單已限定在當前平台，回傳的 id 保證屬於本平台）',
                ),
                status: z.enum(STATUS_KEYS).describe('目標維護狀態：unknown/enabled/disabled/frozen/deleted，一般開啟/結束維護用 enabled/disabled'),
                confirm: z.string().optional().describe(
                    `正式環境（prod）專用的強制確認欄位；非 prod 環境會被忽略、不需提供。當這個 server 是正式環境時，` +
                    `必須先取得使用者明確同意，再帶上精確字串 "${ PROD_CONFIRM_TOKEN }" 才會執行，否則本工具會拒絕執行並回錯誤。`,
                ),
            },
        },
        async ({ id, status, confirm }) => {
            assertProdConfirmed(confirm);
            const targetStatus = STATUS_MAP[ status ];

            // 先讀現值：(a) 供讀回驗證比對基準，(b) 確認 id 真的存在於當前平台——後端對不存在的
            // id 會靜默回「成功」（2026-08-25 dev 實測，見檔頭註解），不能靠後端錯誤碼判斷，
            // 必須在 tool 層自行檢查，(c) 目標狀態與現值相同時直接短路不呼叫後端。
            const listBefore = await withAutoRelogin(() => remote.gameBackOffice.gameVendorPlatform.ListAllGameVendors());
            if (listBefore.failed) return asErrorResult(listBefore);
            const before = listBefore.data?.rows?.find((row) => row.id === id);
            if (!before) {
                return asTextResult({
                    success: false,
                    message: `id=${ id } 沒有出現在當前平台的場館清單裡（可能不存在，或存在但未被 admin 端啟用給本平台）；` +
                        '注意：後端對不存在的 id 呼叫此 RPC 不會回錯誤，本工具已在呼叫前主動檢查，避免誤報成功',
                    rows: listBefore.data?.rows,
                });
            }
            if (before.maintenanceStatus === targetStatus) {
                return asTextResult({
                    success: true,
                    message: '目標維護狀態與現值相同，未呼叫後端 RPC',
                    readBack: before,
                });
            }

            const r = await withAutoRelogin(() => remote.gameBackOffice.gameVendorPlatform.UpdateGameVendorMaintenanceStatus(id, targetStatus));
            if (r.failed) return asErrorResult(r);

            const listAfter = await withAutoRelogin(() => remote.gameBackOffice.gameVendorPlatform.ListAllGameVendors());
            const matched = !listAfter.failed
                ? listAfter.data?.rows?.find((row) => row.id === id)
                : undefined;

            return asTextResult({
                success: true,
                message: '更新成功',
                readBack: matched ?? (!listAfter.failed ? { note: '讀回清單中沒找到這個 id，非預期，請人工確認', rows: listAfter.data?.rows } : null),
            });
        },
    );
}
