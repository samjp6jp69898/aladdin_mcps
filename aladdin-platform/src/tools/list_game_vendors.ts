/**
 * tools/list_game_vendors.ts — aladdin_platform_game_vendor_platform_list_game_vendors
 *
 * rajah: GameVendorPlatform.ListGameVendors / ListAllGameVendors
 * （game_back_office.rajah:1039, 1043）——命名以語意較泛的 ListGameVendors 為準，
 * ListAllGameVendors 是它「無篩選條件」的內部最佳化分支。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { PlatformGameVendorEssentialSearch } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { ACTIVE_STATUS_MAP } from '../const.ts';

export function registerListGameVendorsTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_game_vendor_platform_list_game_vendors',
        {
            title: 'List game vendors on this platform',
            description:
                '在 agrabah platform 後台查詢已上架的三方遊戲廠商清單（不是 admin 端那種帶 adapter/匯率的技術視角，' +
                '只有名稱/圖標/狀態/排序）。不帶任何篩選條件（name/status/maintenanceStatus）且不帶 page 時，' +
                '會改用 ListAllGameVendors 一次拿全部（rajah: GameVendorPlatform.ListAllGameVendors），' +
                '否則走 ListGameVendors 分頁查詢。回傳的 id 就是 aladdin_platform_game_vendor_platform_list_games 要用的 gameVendorId。' +
                '注意：透過 aladdin-admin 剛建立的場館不會自動出現在這裡——場館要先被 admin 端啟用給特定 platform' +
                '（GameVendorAdmin.UpdatePlatformGameVendorStatus，本 MCP 未提供這支 tool）才查得到，實測驗證過此限制。',
            inputSchema: {
                name: z.string().optional().describe('依廠商名稱篩選（模糊比對，依後端實作而定）'),
                status: z.enum([ 'enabled', 'disabled' ]).optional().describe('廠商狀態篩選'),
                maintenanceStatus: z.enum([ 'enabled', 'disabled' ]).optional().describe('維護狀態篩選'),
                page: z.number().int().min(1).optional().describe('頁碼，從 1 開始；留空且無其他篩選條件時會改成一次拿全部'),
                pageSize: z.number().int().min(1).optional().describe('每頁筆數，預設 50'),
            },
        },
        async ({ name, status, maintenanceStatus, page, pageSize }) => {
            const hasFilter = !!name || !!status || !!maintenanceStatus;

            if (!hasFilter && !page) {
                const r = await withAutoRelogin(() => remote.gameBackOffice.gameVendorPlatform.ListAllGameVendors());
                if (r.failed) return asErrorResult(r);
                return asTextResult({ success: true, rows: r.data?.rows ?? [] });
            }

            const search = PlatformGameVendorEssentialSearch.create({
                name: name ?? '',
                status: status ? ACTIVE_STATUS_MAP[ status ] : undefined,
                maintenanceStatus: maintenanceStatus ? ACTIVE_STATUS_MAP[ maintenanceStatus ] : undefined,
            });
            const r = await withAutoRelogin(() => remote.gameBackOffice.gameVendorPlatform.ListGameVendors(search, page ?? 1, pageSize ?? 50));
            if (r.failed) return asErrorResult(r);
            return asTextResult({ success: true, rows: r.data?.rows ?? [], totalPage: r.data?.totalPage });
        },
    );
}
