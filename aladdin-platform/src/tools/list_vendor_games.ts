/**
 * tools/list_vendor_games.ts — aladdin_platform_list_vendor_games
 *
 * rajah: GameVendorPlatform.ListGames（game_back_office.rajah:1041）
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { PlatformGameVendorGameEssentialSearch } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { ACTIVE_STATUS_MAP } from '../const.ts';

export function registerListVendorGamesTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_list_vendor_games',
        {
            title: "List a game vendor's games on this platform",
            description:
                '查詢某個三方遊戲廠商在本平台已上架的遊戲清單（rajah: GameVendorPlatform.ListGames）。' +
                'gameVendorId 用 aladdin_platform_list_game_vendors 回傳的 id。' +
                '注意：這是本平台已上架的遊戲，不是廠商在三方系統裡的完整遊戲庫——若某遊戲廠商已經串接但這裡查不到，' +
                '代表該遊戲在「廠商遊戲母表」（由廠商同步 job 自動帶入）已存在、但本平台尚未呼叫過 ' +
                'aladdin_platform_onboard_vendor_game 上架，不代表廠商完全沒有這款遊戲。' +
                '本 POC 只開放 gameVendorId/name/status 三個篩選條件（displayTag/frontendGroupTag/rebateTag/badgeId ' +
                '等下拉篩選欄位需要另外查對應清單，尚未實作，如需要請回報）。',
            inputSchema: {
                gameVendorId: z.number().int().describe('遊戲廠商 id，來自 aladdin_platform_list_game_vendors'),
                name: z.string().optional().describe('依遊戲名稱篩選'),
                status: z.enum([ 'enabled', 'disabled' ]).optional().describe('上架狀態篩選'),
                page: z.number().int().min(1).optional().describe('頁碼，從 1 開始，預設 1'),
                pageSize: z.number().int().min(1).optional().describe('每頁筆數，預設 50'),
            },
        },
        async ({ gameVendorId, name, status, page, pageSize }) => {
            const search = PlatformGameVendorGameEssentialSearch.create({
                gameVendorId,
                name: name ?? '',
                status: status ? ACTIVE_STATUS_MAP[ status ] : undefined,
            });
            const r = await withAutoRelogin(() => remote.gameBackOffice.gameVendorPlatform.ListGames(search, page ?? 1, pageSize ?? 50));
            if (r.failed) return asErrorResult(r);
            return asTextResult({ success: true, rows: r.data?.rows ?? [], totalPage: r.data?.totalPage });
        },
    );
}
