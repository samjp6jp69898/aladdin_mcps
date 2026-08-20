/**
 * tools/list_platforms.ts — aladdin_admin_list_platforms
 *
 * rajah: PlatformManagement.ListPlatformDetails（admin.rajah:116）
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerListPlatformsTool(server: McpServer): void {
    server.registerTool(
        'aladdin_admin_list_platforms',
        {
            title: 'List all platforms',
            description:
                '列出全部平台（rajah: PlatformManagement.ListPlatformDetails，admin.rajah:116；刻意未綁 @Permission，' +
                '因平台清單是跨一級菜單共用的下拉來源）。用途：取得平台的 id / code，供 aladdin_admin_list_platform_game_vendors ' +
                '與 aladdin_admin_update_platform_game_vendor_status 這兩支需要 platformId 參數的 tool 使用——這兩支不接受 ' +
                'code，只吃 id，platformId 要從這裡的回傳結果查。回傳的 status 是 rajah StatusEnum 數值：' +
                'unknown=0 / enabled=1 / disabled=2 / frozen=3 / deleted=10。' +
                '這支 RPC 撈全表、與呼叫者當下的平台無關（沒有平台 scope 的概念）。',
            inputSchema: {},
        },
        async () => {
            const r = await withAutoRelogin(() => remote.admin.platformManagement.ListPlatformDetails());
            if (r.failed) return asErrorResult(r);
            return asTextResult({
                success: true,
                platforms: r.data?.platforms ?? [],
                maintenanceStatuses: r.data?.maintenanceStatuses ?? [],
            });
        },
    );
}
