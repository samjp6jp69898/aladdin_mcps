/**
 * tools/get_room_gift_statistic_summary.ts — aladdin_platform_room_gift_platform_get_room_gift_statistic_summary
 *
 * rajah: RoomGiftPlatform.GetRoomGiftStatisticSummary() (totalGiftPrice [CurrencyLink] 1,
 * anchorTotalIncome [CurrencyLink] 2, platformTotalIncome [CurrencyLink] 3, lastCalculatedAt i64 4)
 * （rajah/services/room_gift_back_office.rajah:256，非 @NoPublic）
 *
 * method-category-checklist.md 第 0 節排除規則已過：agrabah 對應 Service
 * （room_gift_platform.ts:methodGetRoomGiftStatisticSummary，呼叫
 * RoomGiftManager.getRoomGiftStatistics）確認有真實實作。分類：第 1 節簡化版
 * （無參數、單例統計摘要）。
 *
 * 業務語意：後台「送禮管理」頁面頂部的統計摘要卡片（禮物總金額、主播總收入、平台總收入、
 * 最後統計時間）。2026-08-25 讀 agrabah 後端原始碼查證（room_gift_manager.ts:417-424）：
 * 三個 CurrencyLink[] 欄位是後端用 `RateHelper.storedToNormal()` 算好的顯示值（非
 * stored 整數），本工具原樣透傳，不做額外換算。`lastCalculatedAt` 為 i64，經 protobufjs
 * decode 可能是 Long 物件，已用 `toPlainNumber()` 轉換。
 *
 * 純讀取查詢，不修改任何資料，可安全重複呼叫。無密鑰/PII 欄位，不需遮罩。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { toPlainNumber } from '../const.ts';

export function registerGetRoomGiftStatisticSummaryTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_room_gift_platform_get_room_gift_statistic_summary',
        {
            title: 'Get overall room gift statistics summary',
            description:
                '讀取本平台直播間送禮的整體統計摘要（rajah: RoomGiftPlatform.GetRoomGiftStatisticSummary，' +
                '無參數）——禮物總金額、主播總收入、平台總收入（皆為 CurrencyLink[] 多幣別陣列，' +
                'value 是後端已算好的顯示值，非 stored 整數，不需額外換算）、最後統計時間。' +
                '這是純讀取查詢，可安全重複呼叫。',
            inputSchema: {},
        },
        async () => {
            const r = await withAutoRelogin(() => remote.roomBackOffice.roomGiftPlatform.GetRoomGiftStatisticSummary());
            if (r.failed) return asErrorResult(r);

            return asTextResult({
                success: true,
                totalGiftPrice: r.data?.totalGiftPrice ?? [],
                anchorTotalIncome: r.data?.anchorTotalIncome ?? [],
                platformTotalIncome: r.data?.platformTotalIncome ?? [],
                lastCalculatedAt: toPlainNumber(r.data?.lastCalculatedAt),
            });
        },
    );
}
