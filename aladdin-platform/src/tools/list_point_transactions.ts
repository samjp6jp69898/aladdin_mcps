/**
 * tools/list_point_transactions.ts — aladdin_platform_point_platform_list_point_transactions
 *
 * rajah: PointPlatform.ListPointTransactions（point_back_office.rajah:231，
 * 需要 @Permission "Store.Point.Transactions"）
 *
 * 分類（method-category-checklist.md 第 2 節「讀取清單」）：A 級——search 內有 identifier
 * （會員帳號）可鎖定單一目標，另有 orderId 精準/模糊比對，非「只有範圍鍵 + 分頁」的 B 級高風險情境。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { ListPointTransactionSearch } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { POINT_TRANSACTION_CATEGORY_KEYS, POINT_TRANSACTION_CATEGORY_MAP, deepFixLongs } from '../const.ts';

export function registerListPointTransactionsTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_point_platform_list_point_transactions',
        {
            title: 'List point transaction records',
            description:
                '分頁查詢本平台會員的積分交易紀錄（rajah: PointPlatform.ListPointTransactions，' +
                '需要權限節點 Store.Point.Transactions）。2026-08-25 讀原始碼查證' +
                '（agrabah/src/servers/point_back_office/services/point_platform.ts:101-178）：identifier ' +
                '查無此會員時直接回傳空陣列（不是錯誤）；orderId 是 LIKE 模糊比對（前後皆可截斷）；' +
                'startCreatedAtTimestamp/endCreatedAtTimestamp 是交易發生時間區間，' +
                'startExpiredAtTimestamp/endExpiredAtTimestamp 是該筆積分的到期時間區間，兩組獨立、不要混用；' +
                '毫秒 epoch，0 或不帶代表不篩該條件。回傳的 quantity 為正代表增加、負代表扣除，' +
                'beforeQuantity/afterQuantity 是該會員當下累計積分的變動前後值。',
            inputSchema: {
                identifier: z.string().optional().describe('會員帳號，精準比對；查無此會員時回空陣列而非錯誤'),
                category: z.enum(POINT_TRANSACTION_CATEGORY_KEYS).optional().describe(
                    '變動類型篩選：turnover=流水打碼/checkIn=簽到/exchangeProduct=積分兌換/expired=到期扣除/' +
                    'manualAdd=後台手動上分/manualDeduct=後台手動下分/roulette=抽獎消耗',
                ),
                orderId: z.string().optional().describe('訂單號，LIKE 模糊比對'),
                startCreatedAtTimestamp: z.number().int().optional().describe('變動時間區間起（毫秒 epoch）'),
                endCreatedAtTimestamp: z.number().int().optional().describe('變動時間區間迄（毫秒 epoch）'),
                startExpiredAtTimestamp: z.number().int().optional().describe('積分到期時間區間起（毫秒 epoch）'),
                endExpiredAtTimestamp: z.number().int().optional().describe('積分到期時間區間迄（毫秒 epoch）'),
                page: z.number().int().min(1).default(1).describe('頁碼，從 1 開始'),
                pageSize: z.number().int().min(1).default(50).describe('每頁筆數'),
            },
        },
        async ({ identifier, category, orderId, startCreatedAtTimestamp, endCreatedAtTimestamp, startExpiredAtTimestamp, endExpiredAtTimestamp, page, pageSize }) => {
            const search = ListPointTransactionSearch.create({
                identifier: identifier ?? '',
                category: category ? POINT_TRANSACTION_CATEGORY_MAP[ category ] : 0,
                orderId: orderId ?? '',
                startCreatedAtTimestamp: startCreatedAtTimestamp ?? 0,
                endCreatedAtTimestamp: endCreatedAtTimestamp ?? 0,
                startExpiredAtTimestamp: startExpiredAtTimestamp ?? 0,
                endExpiredAtTimestamp: endExpiredAtTimestamp ?? 0,
            });
            const r = await withAutoRelogin(() => remote.pointBackOffice.pointPlatform.ListPointTransactions(search, page, pageSize));
            if (r.failed) return asErrorResult(r);
            return asTextResult({ success: true, rows: deepFixLongs(r.data?.rows ?? []), totalPage: r.data?.totalPage, totalRow: r.data?.totalRow });
        },
    );
}
