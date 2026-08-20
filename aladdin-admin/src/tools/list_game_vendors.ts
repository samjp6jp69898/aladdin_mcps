/**
 * tools/list_game_vendors.ts — aladdin_admin_list_game_vendors
 *
 * rajah: GameVendorAdmin.ListGameVendors / ListAllGameVendors
 * （game_back_office.rajah:308, 312）
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { GameVendorEssentialSearch } from '/Users/user/aladdin/abu/admin/src/generated/types.gen.js';
import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { ACTIVE_STATUS_MAP, KNOWN_ADAPTERS } from '../const.ts';

export function registerListGameVendorsTool(server: McpServer): void {
    server.registerTool(
        'aladdin_admin_list_game_vendors',
        {
            title: 'List game vendors in the admin master list',
            description:
                '查詢「三方場館母表」的場館清單（rajah: GameVendorAdmin.ListGameVendors）——全平台共用的一份清單，' +
                '與平台無關，不需要也不接受 platformId 參數。所有參數皆為選填，不帶任何參數就是列出母表全部場館。' +
                '回傳的 id 就是其他 admin tool 參數名為 gameVendorId 的值（aladdin_admin_list_vendor_games、' +
                'aladdin_admin_update_platform_game_vendor_status 都吃這個 id）。' +
                '不帶任何篩選條件（name/adapter/status/maintenanceStatus）且不帶 page 時，會改用 ListAllGameVendors ' +
                '一次拿全部（rajah: GameVendorAdmin.ListAllGameVendors，回傳沒有 totalPage），否則走 ListGameVendors 分頁查詢。' +
                '與相鄰 tool 的分工：「某個平台底下有哪些場館、各自 enabled/disabled」是 ' +
                'aladdin_admin_list_platform_game_vendors 的範圍，那支查的是平台視角、只涵蓋該平台已建立關聯的場館；' +
                '本工具查的是母表本身，包含尚未對任何平台啟用的場館。' +
                'aladdin-platform MCP server 的 aladdin_platform_list_game_vendors 是另一回事：那支列的是「已上架到' +
                '該平台的廠商」，不是母表，其回傳的 id 與本工具的 id 語意不同，也不涵蓋母表裡尚未上架的場館。' +
                '回傳的 status 是 rajah StatusEnum 數值：unknown=0 / enabled=1 / disabled=2 / frozen=3 / deleted=10；' +
                'exchangeRate 是匯率 × 10000 的整數（後端實際儲存值，不是顯示用小數）。',
            inputSchema: {
                name: z.string().optional().describe('依場館名稱篩選（模糊比對，依後端實作而定）'),
                adapter: z.string().optional().describe(
                    `依 adapter 代碼篩選。dev 環境 2026-08-18 實測已知合法值（可能隨時間增加，非窮舉）：${ KNOWN_ADAPTERS.join(', ') }`,
                ),
                status: z.enum([ 'enabled', 'disabled' ]).optional().describe('場館狀態篩選'),
                maintenanceStatus: z.enum([ 'enabled', 'disabled' ]).optional().describe('維護狀態篩選'),
                page: z.number().int().min(1).optional().describe('頁碼，從 1 開始；留空且無其他篩選條件時會改成一次拿全部'),
                pageSize: z.number().int().min(1).optional().describe('每頁筆數，預設 50'),
            },
        },
        async ({ name, adapter, status, maintenanceStatus, page, pageSize }) => {
            const hasFilter = !!name || !!adapter || !!status || !!maintenanceStatus;

            if (!hasFilter && !page) {
                const r = await withAutoRelogin(() => remote.gameBackOffice.gameVendorAdmin.ListAllGameVendors());
                if (r.failed) return asErrorResult(r);
                return asTextResult({ success: true, rows: r.data?.rows ?? [] });
            }

            const search = GameVendorEssentialSearch.create({
                name: name ?? '',
                adapter: adapter ?? '',
                status: status ? ACTIVE_STATUS_MAP[ status ] : undefined,
                maintenanceStatus: maintenanceStatus ? ACTIVE_STATUS_MAP[ maintenanceStatus ] : undefined,
            });
            const r = await withAutoRelogin(() => remote.gameBackOffice.gameVendorAdmin.ListGameVendors(search, page ?? 1, pageSize ?? 50));
            if (r.failed) return asErrorResult(r);
            return asTextResult({ success: true, rows: r.data?.rows ?? [], totalPage: r.data?.totalPage });
        },
    );
}
