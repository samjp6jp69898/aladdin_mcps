/**
 * tools/update_platform_game_vendor_status.ts — agrabah_admin_update_platform_game_vendor_status
 *
 * rajah: GameVendorAdmin.UpdatePlatformGameVendorStatus（game_back_office.rajah:305，
 * 需要 @Permission "PlatformManagementAdmin.PlatformList.Vendor.Status"）
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult } from '../mcp_result.ts';
import { STATUS_MAP, STATUS_KEYS } from '../const.ts';

export function registerUpdatePlatformGameVendorStatusTool(server: McpServer): void {
    server.registerTool(
        'agrabah_admin_update_platform_game_vendor_status',
        {
            title: "Update a game vendor's status under a specific platform",
            description:
                '把某個廠商場館在某個平台底下的狀態改成指定值（rajah: GameVendorAdmin.UpdatePlatformGameVendorStatus，' +
                '需要權限節點 PlatformManagementAdmin.PlatformList.Vendor.Status）。這是幫平台「啟用」場館的入口——' +
                'agrabah_admin_create_game_vendor 新建立的場館預設不會出現在任何 platform 的清單裡，要靠這支把 status ' +
                '設成 enabled 才會出現在該 platform（見 agrabah_admin_list_platform_game_vendors / ' +
                'agrabah-platform 的 agrabah_platform_list_game_vendors）。' +
                'platformId 從 agrabah_admin_list_platforms 取得，gameVendorId 從 agrabah_admin_create_game_vendor ' +
                '或 agrabah_admin_list_platform_game_vendors 的回傳結果取得。' +
                'status 合法值（rajah StatusEnum）：unknown/enabled/disabled/frozen/deleted，一般啟用/停用只會用到 ' +
                'enabled/disabled，其餘值語意不在本工具範圍內描述。' +
                '這支 RPC 沒有單筆查詢方法，寫入成功後本工具會用 agrabah_admin_list_platform_game_vendors 的第一頁' +
                '讀回驗證，若目標場館不在第一頁會如實回報、不代表寫入失敗。',
            inputSchema: {
                platformId: z.number().int().describe('平台 id，來自 agrabah_admin_list_platforms 的回傳結果'),
                gameVendorId: z.number().int().describe('廠商場館 id，來自 agrabah_admin_create_game_vendor 或 agrabah_admin_list_platform_game_vendors 的回傳結果'),
                status: z.enum(STATUS_KEYS).describe('目標狀態：unknown/enabled/disabled/frozen/deleted，一般啟用/停用場館用 enabled/disabled'),
            },
        },
        async ({ platformId, gameVendorId, status }) => {
            const r = await withAutoRelogin(() => remote.gameBackOffice.gameVendorAdmin.UpdatePlatformGameVendorStatus(platformId, gameVendorId, STATUS_MAP[ status ]));
            if (r.failed) return asTextResult({ success: false, errorCode: r.errorCode, message: r.message });

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
