/**
 * tools/list_platform_game_vendors.ts — agrabah_admin_list_platform_game_vendors
 *
 * rajah: GameVendorAdmin.ListPlatformGameVendors（game_back_office.rajah:297）
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerListPlatformGameVendorsTool(server: McpServer): void {
    server.registerTool(
        'agrabah_admin_list_platform_game_vendors',
        {
            title: "List a platform's enabled/disabled game vendors",
            description:
                '查詢指定平台底下的廠商場館清單與各自狀態（rajah: GameVendorAdmin.ListPlatformGameVendors）——' +
                '跟 agrabah_admin_list_vendor_games 不同：那支是全平台共用母表的「某廠商的遊戲清單」，這支是' +
                '「某平台看得到哪些廠商場館、各自 enabled/disabled」，是真正平台化的查詢（RPC 簽名有明確 platformId 參數）。' +
                'platformId 沒有對應的名稱查詢參數，先呼叫 agrabah_admin_list_platforms 取得合法的 platformId。' +
                '回傳的 status 是 rajah StatusEnum 數值：unknown=0 / enabled=1 / disabled=2 / frozen=3 / deleted=10。' +
                '這支只有 page，沒有 pageSize 參數（後端固定分頁大小）。' +
                '注意：後端實作是 LEFT JOIN（game_vendor_admin.ts:94-101），platformId 只出現在 JOIN 條件、不在 WHERE，' +
                '所以帶一個不存在的 platformId **不會回錯誤**——會回傳全部啟用中的廠商場館清單，每一列因為 JOIN 不到' +
                '任何對應資料，status 一律落回預設值 disabled（database_types/game.ts:206），看起來就像「這個平台存在、' +
                '但全部場館都停用」。不能用這支的成功回傳或 status 內容反推 platformId 是否真實存在，platformId 一律' +
                '要用 agrabah_admin_list_platforms 回傳的真實 id。',
            inputSchema: {
                platformId: z.number().int().describe('平台 id，來自 agrabah_admin_list_platforms 的回傳結果'),
                page: z.number().int().min(1).optional().describe('頁碼，從 1 開始，預設 1'),
            },
        },
        async ({ platformId, page }) => {
            const r = await withAutoRelogin(() => remote.gameBackOffice.gameVendorAdmin.ListPlatformGameVendors(platformId, page ?? 1));
            if (r.failed) return asErrorResult(r);
            return asTextResult({ success: true, rows: r.data?.rows ?? [], totalPage: r.data?.totalPage });
        },
    );
}
