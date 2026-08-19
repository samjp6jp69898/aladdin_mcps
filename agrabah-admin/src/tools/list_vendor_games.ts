/**
 * tools/list_vendor_games.ts — agrabah_admin_list_vendor_games
 *
 * rajah: GameVendorAdmin.ListGames（game_back_office.rajah:300）
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerListVendorGamesTool(server: McpServer): void {
    server.registerTool(
        'agrabah_admin_list_vendor_games',
        {
            title: "List a game vendor's games (admin master list)",
            description:
                '查詢某個廠商在「廠商遊戲母表」裡的遊戲清單（rajah: GameVendorAdmin.ListGames）——這是全平台共用的' +
                '母表視角，不是某個 platform 的上架清單（platform 的上架清單見 agrabah-platform 的 ' +
                'agrabah_platform_list_vendor_games）。本工具操作的是全平台共用母表，查詢條件只有 gameVendorId，' +
                '結果與平台無關，不需要也不接受 platformId 參數。回傳的 gameId 可以直接帶進 agrabah_admin_edit_game 編輯。' +
                '沒有 name/gameId 篩選參數，只有分頁；要找特定遊戲得自己在回傳結果裡比對 gameId。',
            inputSchema: {
                gameVendorId: z.number().int().describe('廠商場館 id，來自 agrabah_admin_create_game_vendor 的讀回結果，或 agrabah-platform 的 agrabah_platform_list_game_vendors'),
                page: z.number().int().min(1).optional().describe('頁碼，從 1 開始，預設 1'),
                pageSize: z.number().int().min(1).optional().describe('每頁筆數，預設 50'),
            },
        },
        async ({ gameVendorId, page, pageSize }) => {
            const r = await withAutoRelogin(() => remote.gameBackOffice.gameVendorAdmin.ListGames(gameVendorId, page ?? 1, pageSize ?? 50));
            if (r.failed) return asErrorResult(r);
            return asTextResult({ success: true, rows: r.data?.rows ?? [], totalPage: r.data?.totalPage });
        },
    );
}
