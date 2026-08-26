/**
 * tools/list_app_user_total_points.ts — aladdin_platform_point_platform_list_app_user_total_points
 *
 * rajah: PointPlatform.ListAppUserTotalPoints（point_back_office.rajah:236，
 * 需要 @Permission "Store.Point.Adjustment"）
 *
 * 分類（method-category-checklist.md 第 2 節「讀取清單」）：A 級——search 內 identifier 可鎖定單一會員。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { ListAppUserTotalPointSearch } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { deepFixLongs } from '../const.ts';

export function registerListAppUserTotalPointsTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_point_platform_list_app_user_total_points',
        {
            title: "List app users' total point balances",
            description:
                '分頁查詢本平台會員目前的積分餘額（rajah: PointPlatform.ListAppUserTotalPoints，' +
                '需要權限節點 Store.Point.Adjustment）。2026-08-25 讀原始碼查證' +
                '（agrabah/src/servers/point_back_office/services/point_platform.ts:192-286）：quantity 是' +
                '「累計取得量 - 已使用量」的即時聚合值（不含已過期或已刪除紀錄之外的細節，僅回目前可用總額）；' +
                '若帶 identifier 且該會員存在但完全沒有積分紀錄，第一頁會回傳一筆 quantity=0 的資料（不是空陣列）；' +
                'identifier 查無此會員時回空陣列。本工具純讀取；手動加/扣會員積分的寫入類 method' +
                '（ManualAddPoint/ManualDeductPoint/BatchManualAddPoint/BatchManualDeductPoint/' +
                'ManualDeductAllPoint）涉及影響其他會員帳戶餘額的操作，本 MCP 未提供對應 tool。',
            inputSchema: {
                identifier: z.string().optional().describe('會員帳號，精準比對；不帶則列出全部會員'),
                page: z.number().int().min(1).default(1).describe('頁碼，從 1 開始'),
                pageSize: z.number().int().min(1).default(50).describe('每頁筆數'),
            },
        },
        async ({ identifier, page, pageSize }) => {
            const search = ListAppUserTotalPointSearch.create({ identifier: identifier ?? '' });
            const r = await withAutoRelogin(() => remote.pointBackOffice.pointPlatform.ListAppUserTotalPoints(search, page, pageSize));
            if (r.failed) return asErrorResult(r);
            return asTextResult({ success: true, rows: deepFixLongs(r.data?.rows ?? []), totalPage: r.data?.totalPage });
        },
    );
}
