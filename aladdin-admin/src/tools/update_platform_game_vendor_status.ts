/**
 * tools/update_platform_game_vendor_status.ts — aladdin_admin_update_platform_game_vendor_status
 *
 * rajah: GameVendorAdmin.UpdatePlatformGameVendorStatus（game_back_office.rajah:305，
 * 需要 @Permission "PlatformManagementAdmin.PlatformList.Vendor.Status"）
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { STATUS_MAP, STATUS_KEYS } from '../const.ts';

export function registerUpdatePlatformGameVendorStatusTool(server: McpServer): void {
    server.registerTool(
        'aladdin_admin_update_platform_game_vendor_status',
        {
            title: "Update a game vendor's status under a specific platform",
            description:
                '把某個廠商場館在某個平台底下的狀態改成指定值（rajah: GameVendorAdmin.UpdatePlatformGameVendorStatus，' +
                '需要權限節點 PlatformManagementAdmin.PlatformList.Vendor.Status）。這是幫平台「啟用」場館的入口——' +
                'aladdin_admin_create_game_vendor 新建立的場館預設不會出現在任何 platform 的清單裡，要靠這支把 status ' +
                '設成 enabled 才會出現在該 platform（見 aladdin_admin_list_platform_game_vendors / ' +
                'aladdin-platform 的 aladdin_platform_list_game_vendors）。' +
                'platformId 從 aladdin_admin_list_platforms 取得，gameVendorId 從 aladdin_admin_list_game_vendors ' +
                '（母表全部場館，含尚未對任何平台啟用的）或 aladdin_admin_create_game_vendor 的讀回結果取得。' +
                'status 合法值（rajah StatusEnum）：unknown/enabled/disabled/frozen/deleted，一般啟用/停用只會用到 ' +
                'enabled/disabled，其餘值語意不在本工具範圍內描述。' +
                '這支 RPC 沒有單筆查詢方法，寫入成功後本工具會用 aladdin_admin_list_platform_game_vendors 的第一頁' +
                '讀回驗證，若目標場館不在第一頁會如實回報、不代表寫入失敗。' +
                '重要限制（2026-08-19 讀 agrabah 後端原始碼查證）：gameVendorId 有驗證存在性' +
                '（game_vendor_admin.ts:120-124，不存在時回 errorCode=9 invalidData，不會寫入）；但 platformId ' +
                '完全沒有驗證是否真實存在於平台表——後端邏輯是先 UPDATE 一筆 platform_game_vendors，若沒有列被' +
                '更新到就直接 INSERT 一筆新的（game_vendor_admin.ts:126-139），且 platform_id 欄位在 DB 沒有外鍵' +
                '約束（migrations/game/202501071023_create_platform_game_vendors.sql）。也就是說帶一個不存在、但落在' +
                'SMALLINT UNSIGNED 合法範圍（0–65535）內的 platformId，這支 RPC 會**靜默成功**、在 DB 裡真的寫入一筆' +
                '綁定不存在平台的孤兒列，不會有任何錯誤提示。反過來，若 platformId 超出 0–65535 範圍（例如遠大於現有' +
                '平台 id 的整數），DB 型別檢查會擋下並回 errorCode=12（unknownDatabaseError，' +
                'mysql_relational_database_engine.ts 的通用資料庫錯誤分支）——這只是數值溢位的副作用，' +
                '**不是**「platformId 不存在」的正式偵測機制，errorCode=12 也可能是其他未特判的 DB 錯誤，不能倒推' +
                '成任何特定原因。因此 platformId 一律只能用 aladdin_admin_list_platforms 回傳的真實 id，' +
                '不要嘗試用「呼叫看看有沒有報錯」來驗證 platformId 是否存在。' +
                'prod 執行前確認（H36）：當這個 server 是正式環境（prod）時，執行本工具前必須先用 AskUserQuestion' +
                '（或功能相同的方式）明確詢問使用者是否要在正式環境執行這個操作，取得明確同意後才可以帶上 confirm 參數；' +
                '絕不能自行假設使用者同意。非 prod 環境（dev/pre/evi）不需要、也會忽略 confirm 欄位。',
            inputSchema: {
                platformId: z.number().int().describe('平台 id，來自 aladdin_admin_list_platforms 的回傳結果'),
                gameVendorId: z.number().int().describe('廠商場館 id，來自 aladdin_admin_create_game_vendor 或 aladdin_admin_list_platform_game_vendors 的回傳結果'),
                status: z.enum(STATUS_KEYS).describe('目標狀態：unknown/enabled/disabled/frozen/deleted，一般啟用/停用場館用 enabled/disabled'),
                confirm: z.string().optional().describe(
                    `正式環境（prod）專用的強制確認欄位；非 prod 環境會被忽略、不需提供。當這個 server 是正式環境時，` +
                    `必須先取得使用者明確同意，再帶上精確字串 "${ PROD_CONFIRM_TOKEN }" 才會執行，否則本工具會拒絕執行並回錯誤。`,
                ),
            },
        },
        async ({ platformId, gameVendorId, status, confirm }) => {
            assertProdConfirmed(confirm);
            const r = await withAutoRelogin(() => remote.gameBackOffice.gameVendorAdmin.UpdatePlatformGameVendorStatus(platformId, gameVendorId, STATUS_MAP[ status ]));
            if (r.failed) return asErrorResult(r);

            // 沒有單筆查詢 method，讀回用同一支 ListPlatformGameVendors 掃第一頁比對 gameVendorId。
            const listResult = await withAutoRelogin(() => remote.gameBackOffice.gameVendorAdmin.ListPlatformGameVendors(platformId, 1));
            const matched = listResult.success
                ? listResult.data?.rows?.find((row) => row.id === gameVendorId)
                : undefined;

            return asTextResult({
                success: true,
                message: '更新成功',
                readBack: matched ?? (listResult.success ? { note: '第一頁沒找到，可能分頁較後面，非失敗', rows: listResult.data?.rows } : null),
            });
        },
    );
}
