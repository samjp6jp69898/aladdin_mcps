/**
 * tools/update_game_vendor_status.ts — aladdin_admin_game_vendor_admin_update_game_vendor_status
 *
 * rajah: GameVendorAdmin.UpdateGameVendorStatus（game_back_office.rajah:322，
 * 需要 @Permission "GameVendor.Vendor.Status.Edit"）——操作對象是全平台共用母表
 * `game_vendors` 本身的狀態，不是 GameVendorAdmin.UpdatePlatformGameVendorStatus
 * （見 update_platform_game_vendor_status.ts）那種「場館在某個平台底下」的關聯狀態，
 * 兩者是同一 service 內同名概念但完全不同的兩支 method，不可混淆。
 *
 * 2026-08-24 讀 agrabah 後端原始碼查證（game_vendor_admin.ts:346-371）：
 * - 底層呼叫 common/database_helper.ts 的 updateStatus()：UPDATE game_vendors 影響列數
 *   為 0（id 不存在）時回 errorCode=14（objectNotFound）；status 帶到非法列舉值
 *   （StatusEnum 沒有的數字，或 StatusEnum.last=255）回 errorCode=9（invalidData）。
 * - **真實副作用（容易被名字誤導成單純狀態切換）**：只要 status !== enabled（包含
 *   disabled/frozen/deleted），同一個 transaction 內會連帶把該場館在**全部平台**的
 *   `platform_game_vendors.admin_status` 一併改成同一個值——也就是說停用一個場館的
 *   母表狀態，會連鎖影響它在每一個平台底下的狀態，不是只改母表這一筆。改回 enabled
 *   不會逆向連鎖恢復各平台原本的 admin_status（只有 status !== enabled 分支才會寫
 *   platform_game_vendors，enabled 分支完全不碰這張表），這是不對稱行為。
 * - `GameVendorAdmin.GetGameVendorForEdit(id)` 回傳的 `GameVendorEdit` model **沒有
 *   status 欄位**（game_back_office.rajah:178-214），無法用它做寫入後的 round-trip
 *   驗證；改用 `ListAllGameVendors()`（不分頁、一次回傳全部場館的 `GameVendorEssential[]`，
 *   game_back_office.rajah:312）比對 id 讀回目前狀態——母表場館數量是小型列舉規模，
 *   全撈可放心用，不套第 2 節 B 級分頁掃描規則。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { STATUS_MAP, STATUS_KEYS } from '../const.ts';

export function registerUpdateGameVendorStatusTool(server: McpServer): void {
    server.registerTool(
        'aladdin_admin_game_vendor_admin_update_game_vendor_status',
        {
            title: "Update a game vendor's master-table status",
            description:
                '把某個廠商場館在全平台共用母表（game_vendors）裡的狀態改成指定值（rajah: ' +
                'GameVendorAdmin.UpdateGameVendorStatus，需要權限節點 GameVendor.Vendor.Status.Edit）。' +
                '注意跟 aladdin_admin_game_vendor_admin_update_platform_game_vendor_status 的差異：那支改的是' +
                '「場館在某一個特定平台底下」的關聯狀態，本工具改的是場館本身在母表的狀態，範圍是全平台共用、' +
                '不帶 platformId 參數。id 從 aladdin_admin_game_vendor_admin_list_game_vendors 取得。' +
                'status 合法值（rajah StatusEnum）：unknown/enabled/disabled/frozen/deleted，一般啟用/停用只會用到 ' +
                'enabled/disabled，其餘值語意不在本工具範圍內描述。' +
                '重要副作用（2026-08-24 讀 agrabah 後端原始碼查證，game_vendor_admin.ts:346-371）：只要目標 status ' +
                '不是 enabled（包含 disabled/frozen/deleted），後端會在同一個 transaction 內連鎖把這個場館在**全部平台**的 ' +
                'platform_game_vendors.admin_status 一併改成同一個值——也就是停用母表狀態會連帶影響它在每個平台底下的狀態，' +
                '不是只改母表這一筆；且這個連鎖是不對稱的，改回 enabled 不會逆向恢復各平台原本各自的 admin_status（enabled ' +
                '分支完全不碰 platform_game_vendors 這張表）。執行前務必確認這個場館目前有沒有平台正在使用，避免非預期停掉別平台的顯示。' +
                'id 不存在時回 errorCode=14（objectNotFound），不會寫入；status 帶非法列舉值時回 errorCode=9（invalidData）。' +
                '這支 RPC 沒有帶 status 的單筆查詢方法（GetGameVendorForEdit 回傳的 GameVendorEdit 沒有 status 欄位），' +
                '寫入成功後本工具改用 aladdin_admin_game_vendor_admin_list_game_vendors 背後的 ListAllGameVendors' +
                '（不分頁、一次回傳全部場館）讀回驗證。' +
                'prod 執行前確認（H36）：當這個 server 是正式環境（prod）時，執行本工具前必須先用 AskUserQuestion' +
                '（或功能相同的方式）明確詢問使用者是否要在正式環境執行這個操作，取得明確同意後才可以帶上 confirm 參數；' +
                '絕不能自行假設使用者同意。非 prod 環境（dev/pre/evi）不需要、也會忽略 confirm 欄位。',
            inputSchema: {
                id: z.number().int().describe('廠商場館 id（母表 game_vendors 的內部流水號），來自 aladdin_admin_game_vendor_admin_list_game_vendors 的回傳結果'),
                status: z.enum(STATUS_KEYS).describe('目標狀態：unknown/enabled/disabled/frozen/deleted，一般啟用/停用場館用 enabled/disabled；帶非 enabled 值會連鎖影響此場館在全部平台的狀態，見 description 副作用說明'),
                confirm: z.string().optional().describe(
                    `正式環境（prod）專用的強制確認欄位；非 prod 環境會被忽略、不需提供。當這個 server 是正式環境時，` +
                    `必須先取得使用者明確同意，再帶上精確字串 "${ PROD_CONFIRM_TOKEN }" 才會執行，否則本工具會拒絕執行並回錯誤。`,
                ),
            },
        },
        async ({ id, status, confirm }) => {
            assertProdConfirmed(confirm);
            const r = await withAutoRelogin(() => remote.gameBackOffice.gameVendorAdmin.UpdateGameVendorStatus(id, STATUS_MAP[ status ]));
            if (r.failed) return asErrorResult(r);

            // GetGameVendorForEdit 沒有 status 欄位，改用不分頁的 ListAllGameVendors 讀回全部場館比對 id。
            const listResult = await withAutoRelogin(() => remote.gameBackOffice.gameVendorAdmin.ListAllGameVendors());
            const matched = listResult.success
                ? listResult.data?.rows?.find((row) => row.id === id)
                : undefined;

            return asTextResult({
                success: true,
                message: '更新成功',
                readBack: matched ?? (listResult.success ? { note: '讀回清單中沒找到這個 id，非預期，請人工確認', rows: listResult.data?.rows } : null),
            });
        },
    );
}
