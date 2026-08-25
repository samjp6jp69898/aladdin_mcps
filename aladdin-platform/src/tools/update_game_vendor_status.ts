/**
 * tools/update_game_vendor_status.ts — aladdin_platform_game_vendor_platform_update_game_vendor_status
 *
 * rajah: GameVendorPlatform.UpdateGameVendorStatus(id i32 1, newStatus StatusEnum 2)
 * （game_back_office.rajah:1078，需要 @Permission "GameVendor.Vendor.Status.VendorToggle"）——
 * 這支跟 aladdin-admin 端同名的 GameVendorAdmin.UpdateGameVendorStatus（game_back_office.rajah:322，
 * 簽名是 `id, status`）是完全不同的兩支 method，不可混淆：admin 端改的是全平台共用母表
 * `game_vendors` 本身的狀態（連鎖影響所有平台）；本工具改的是「這個場館在**當前這個平台**底下」的
 * 上下架狀態（`platform_game_vendors.status`，以 `game_vendor_id + platform_id` 定位），
 * 範圍只限本平台，不影響其他平台或母表本身。
 *
 * 2026-08-24 讀 agrabah 後端原始碼查證
 * （agrabah/src/servers/game_back_office/services/game_vendor_platform.ts:840-860，
 * methodUpdateGameVendorStatus）：
 * - 底層呼叫 common/database_helper.ts 的 updateStatus()：
 *   `UPDATE platform_game_vendors SET status=? WHERE game_vendor_id=? AND platform_id=?`。
 *   影響列數為 0 時回 errorCode=14（objectNotFound）——涵蓋 id 不存在、或 id 存在但不屬於
 *   當前平台（`platform_game_vendors` 沒有這個 game_vendor_id+platformId 的組合列）兩種情況，
 *   兩者回傳同一個錯誤碼，前端無法從 errorCode 分辨是哪一種。newStatus 帶到非法列舉值
 *   （StatusEnum 沒有的數字，或 StatusEnum.last=255）回 errorCode=9（invalidData）。
 * - 成功後背景觸發 audit log（記錄 gameVendorEnable/gameVendorDisable action）、
 *   `RefreshGameCache` message 廣播、`clearAppGameCache` 清前台快取，皆非同步（`.then()`），
 *   RPC 回應不等待這些完成。
 * - **結構性風險評估，已於 2026-08-25 dev 實測澄清**：`updateStatus()` 內部用的是
 *   `UPDATE ... SET status = ?`，MySQL 預設（未開啟 `CLIENT_FOUND_ROWS` 連線旗標時，且
 *   agrabah 的 mysql2 連線池 `mysql.createPool(connectionString)` 未帶此旗標，見
 *   agrabah/src/engines/relational_database/mysql/mysql_relational_database_engine.ts:402）
 *   `affectedRows` 理論上採「實際改變值的列數」而非「符合 WHERE 條件的列數」語意——原本
 *   擔心 newStatus 剛好等於資料庫現有值時 MySQL 會回報 affectedRows=0、被上層誤判成
 *   errorCode=14（objectNotFound）。2026-08-25 對 pk-platform.alddev.com 直接呼叫
 *   `UpdateGameVendorStatus(id, newStatus)`（newStatus 帶與現值相同的值）**實測結果是
 *   errorCode=0 成功，並非預期的 objectNotFound**——這個理論風險在實際資料上沒有重現
 *   （合理推測：`platform_game_vendors` 大概率有 `updated_at ON UPDATE CURRENT_TIMESTAMP`
 *   之類欄位，即使 status 值沒變，該列仍被 MySQL 判定為「changed」而使 affectedRows>0；
 *   未逐欄反查 schema 佐證這個推測，如實記錄為推測而非斷言，但「同值呼叫不會被誤判成
 *   objectNotFound」這件事本身已是實測結論，不是推測）。
 *   **本工具仍保留「先讀現值，相同則不呼叫後端」的短路邏輯**：雖然已知不會誤判成
 *   objectNotFound，短路仍有獨立價值（省一次不必要的寫入 RPC、且回應訊息更精準地說明
 *   「已是目標狀態」而非泛用的「更新成功」），不是為了規避錯誤而存在，予以保留。
 * - `GameVendorPlatform` 沒有帶 status 的單筆查詢 method（`GetGameVendorForEdit` 回傳的
 *   `PlatformGameVendorEdit` 未核對是否含 status 欄位，這裡不假設），寫入前後改用
 *   `ListAllGameVendors`（不分頁、一次回傳當前平台全部場館的 `PlatformGameVendorEssential[]`，
 *   game_back_office.rajah:1056；只包含 `admin_status=enabled` 即已被 admin 端啟用給本平台的
 *   場館，語意與 list_game_vendors.ts 相同）比對 id 讀現值/讀回驗證——當前平台場館數量屬小型
 *   列舉規模，全撈可放心用，不套第 2 節 B 級分頁掃描規則。
 *
 * **2026-08-25 已通過 dev 實測**（對 pk-platform.alddev.com 直接呼叫底層 rajah method，
 * 涵蓋：不存在的 id → errorCode=14；非法列舉值 254 → errorCode=9；newStatus 與現值相同
 * → errorCode=0 成功（見上方風險段落，理論風險未重現）；round-trip 切換至相反狀態 → 讀回
 * 驗證變更生效 → 切回原值 → 讀回驗證已復原，全程無殘留髒資料）。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { STATUS_MAP, STATUS_KEYS } from '../const.ts';

export function registerUpdateGameVendorStatusTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_game_vendor_platform_update_game_vendor_status',
        {
            title: "Update a game vendor's status under the current platform",
            description:
                '把某個廠商場館「在當前這個平台底下」的上下架狀態改成指定值（rajah: ' +
                'GameVendorPlatform.UpdateGameVendorStatus，需要權限節點 GameVendor.Vendor.Status.VendorToggle）。' +
                '注意跟 aladdin-admin 的 aladdin_admin_game_vendor_admin_update_game_vendor_status 的差異：那支改的是' +
                '全平台共用母表 game_vendors 本身的狀態（會連鎖影響所有平台），本工具只改這個場館在**當前平台**的' +
                '上下架狀態，不影響其他平台、也不影響母表本身。id 從 aladdin_platform_game_vendor_platform_list_game_vendors ' +
                '取得（該工具回傳的清單本身就已限定在當前平台）。' +
                'status 合法值（rajah StatusEnum）：unknown/enabled/disabled/frozen/deleted，一般上架/下架只會用到 ' +
                'enabled/disabled，其餘值語意不在本工具範圍內描述。' +
                'id 不存在、或存在但不屬於當前平台（未被 admin 端啟用給本平台）時，兩種情況都回同一個 errorCode=14' +
                '（objectNotFound，2026-08-25 dev 實測對不存在的 id 確認過），本工具無法從錯誤碼分辨是哪一種，只能' +
                '如實回報「找不到」。newStatus 帶非法列舉值時回 errorCode=9（invalidData，dev 實測確認過）。' +
                '目標狀態剛好等於現有狀態時直接呼叫後端也會成功（errorCode=0，2026-08-25 dev 實測確認，不會被誤判成' +
                '「找不到」）——本工具仍先讀現值、相同則不呼叫後端直接短路，純粹是省一次不必要的寫入 RPC，並非規避' +
                '任何已知錯誤。' +
                '這支 RPC 沒有帶 status 的單筆查詢方法，寫入前後皆改用' +
                'aladdin_platform_game_vendor_platform_list_game_vendors 背後的 ListAllGameVendors（不分頁、一次拿全部）' +
                '讀現值與讀回驗證。' +
                'prod 執行前確認：當這個 server 是正式環境（prod）時，執行本工具前必須先用 AskUserQuestion' +
                '（或功能相同的方式）明確詢問使用者是否要在正式環境執行這個操作，取得明確同意後才可以帶上 confirm 參數；' +
                '絕不能自行假設使用者同意。非 prod 環境不需要、也會忽略 confirm 欄位。' +
                '**2026-08-25 已通過 dev 實測**（對 pk-platform.alddev.com 直接呼叫底層 rajah method 驗證過上述各項' +
                '錯誤碼行為，並完成 round-trip 切換 + 復原，未留殘留資料）。',
            inputSchema: {
                id: z.number().int().describe(
                    '廠商場館 id（即 game_vendor_id），來自 aladdin_platform_game_vendor_platform_list_game_vendors 的回傳結果 ' +
                    '（該清單已限定在當前平台，回傳的 id 保證屬於本平台）',
                ),
                status: z.enum(STATUS_KEYS).describe('目標狀態：unknown/enabled/disabled/frozen/deleted，一般上架/下架場館用 enabled/disabled'),
                confirm: z.string().optional().describe(
                    `正式環境（prod）專用的強制確認欄位；非 prod 環境會被忽略、不需提供。當這個 server 是正式環境時，` +
                    `必須先取得使用者明確同意，再帶上精確字串 "${ PROD_CONFIRM_TOKEN }" 才會執行，否則本工具會拒絕執行並回錯誤。`,
                ),
            },
        },
        async ({ id, status, confirm }) => {
            assertProdConfirmed(confirm);
            const targetStatus = STATUS_MAP[ status ];

            // 先讀現值：(a) 供讀回驗證比對基準，(b) 目標狀態與現值相同時直接短路不呼叫後端——
            // 2026-08-25 dev 實測確認同值呼叫其實會成功（非 objectNotFound，見檔頭註解），
            // 短路純粹是省一次不必要的寫入 RPC，非規避已知錯誤。
            const listBefore = await withAutoRelogin(() => remote.gameBackOffice.gameVendorPlatform.ListAllGameVendors());
            if (listBefore.failed) return asErrorResult(listBefore);
            const before = listBefore.data?.rows?.find((row) => row.id === id);
            if (!before) {
                return asTextResult({
                    success: false,
                    message: `id=${ id } 沒有出現在當前平台的場館清單裡（可能不存在，或存在但未被 admin 端啟用給本平台）`,
                    rows: listBefore.data?.rows,
                });
            }
            if (before.status === targetStatus) {
                return asTextResult({
                    success: true,
                    message: '目標狀態與現值相同，未呼叫後端 RPC',
                    readBack: before,
                });
            }

            const r = await withAutoRelogin(() => remote.gameBackOffice.gameVendorPlatform.UpdateGameVendorStatus(id, targetStatus));
            if (r.failed) return asErrorResult(r);

            const listAfter = await withAutoRelogin(() => remote.gameBackOffice.gameVendorPlatform.ListAllGameVendors());
            const matched = listAfter.success
                ? listAfter.data?.rows?.find((row) => row.id === id)
                : undefined;

            return asTextResult({
                success: true,
                message: '更新成功',
                readBack: matched ?? (listAfter.success ? { note: '讀回清單中沒找到這個 id，非預期，請人工確認', rows: listAfter.data?.rows } : null),
            });
        },
    );
}
