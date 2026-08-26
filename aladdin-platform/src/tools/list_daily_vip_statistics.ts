/**
 * tools/list_daily_vip_statistics.ts —
 * aladdin_platform_statistic_platform_list_daily_vip_statistics
 *
 * rajah: StatisticPlatform.ListDailyVipStatistics(@Validate search ListDailyVipStatisticsSearch 1)
 * (rows [DailyVipStatisticsRow] 1)（rajah/services/statistic.rajah:2438，非 @NoPublic，
 * @Permission "DataSum.DateDataAnalysis.View"）
 *
 * method-category-checklist.md 第 0 節排除規則已過：agrabah 對應 Service
 * （statistic_platform.ts:467 methodListDailyVipStatistics，委派
 * reports/daily_vip_statistics_report.ts:list）確認有真實實作（純讀表，不做聚合），非 notImplemented。
 * 分類：第 2 節「讀取清單」——**無分頁、無日期區間上限**，資料來源
 * `daily_vip_statistics`（刷新 job 定期整日重算覆寫的彙總表，一天 × 一個 VIP 等級一列）。
 * 與同檔多數其他 List 方法不同，**這支後端完全沒有 92 天回溯上限的檢查**，呼叫端可以查任意長的
 * 日期區間；雖然表結構是「日 × VIP 等級」的小型彙總（不是逐筆明細，成長速度有限），但區間拉很長
 * （例如查數年）理論上仍可能回傳大量列，工具層未加額外裁切，呼叫端應自行把查詢範圍控制在合理區間
 * （如週/月級別），不建議一次查超長區間。
 *
 * 2026-08-26 讀 agrabah 後端原始碼查證（daily_vip_statistics_report.ts）：
 * - **currencyCode 未帶或空字串時取平台預設幣別**（`context.defaultCurrencyCode`），不是「不篩選幣別」。
 * - **每位會員單日只歸屬一個 VIP 等級**（該會員當日最後的等級），回傳列同時涵蓋當天出現過的全部等級，
 *   前端／呼叫端要自行決定顯示/隱藏哪些等級；**跨等級加總去重人數不能直接把 depositUserCount 等分母
 *   欄位相加**（rajah model 註解：人均值分母需由呼叫端把同一天各等級人數相加取得——本工具的
 *   depositUserCount 只是該等級當日去重人數，不是全平台去重人數）。
 * - profit = bet − win（平台盈虧視角，正值代表平台賺）。
 * - endTimestamp 為半開區間（不含本身）。
 * - 純讀取查詢，可安全重複呼叫。
 *
 * 2026-08-26 於 pk-platform.alddev.com dev 環境實測：呼叫一次成功（errorCode=0，查最近 14 天，回傳 11
 * 筆真實資料）；未逐一覆蓋跨等級人數加總等衍生計算情境。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { ListDailyVipStatisticsSearch } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { toPlainNumber } from '../const.ts';

export function registerListDailyVipStatisticsTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_statistic_platform_list_daily_vip_statistics',
        {
            title: 'List daily VIP-level statistics (deposit/withdraw/bet aggregates)',
            description:
                '查詢日期數據分析 - VIP 等級視圖，回傳「每天 × 每個 VIP 等級」一列的存提/投注統計（rajah: ' +
                'StatisticPlatform.ListDailyVipStatistics）。**無分頁，且後端沒有日期區間上限檢查**——與同檔' +
                '多數其他方法不同，可查任意長區間；資料表是刷新 job 每日重算的彙總表（成長有限），但區間拉很長' +
                '理論上仍可能回傳大量列，建議把查詢範圍控制在週/月級別，不要一次查超長區間（如數年）。' +
                'currencyCode 未帶或空字串時取平台預設幣別，不是「不篩選幣別」。每位會員單日只歸屬一個 VIP 等級，' +
                '回傳列涵蓋當天出現過的全部等級；**跨等級加總去重人數不可直接把各列的 depositUserCount 相加' +
                '得到全平台人數**（每列的人數是該等級當日去重人數，不是全平台去重）。profit = bet − win' +
                '（平台盈虧視角，正值代表平台賺）。endTimestamp 為半開區間（不含本身）。純讀取查詢，可安全' +
                '重複呼叫。',
            inputSchema: {
                startTimestamp: z.number().int().describe('起始時間（毫秒時間戳，必填）'),
                endTimestamp: z.number().int().describe('結束時間（毫秒時間戳，必填，半開區間，不含本身）'),
                currencyCode: z.string().optional().describe('幣別代碼；未帶或空字串時取平台預設幣別'),
            },
        },
        async (input) => {
            const search = ListDailyVipStatisticsSearch.create({
                startTimestamp: input.startTimestamp,
                endTimestamp: input.endTimestamp,
                currencyCode: input.currencyCode ?? '',
            });

            const r = await withAutoRelogin(() => remote.statistic.statisticPlatform.ListDailyVipStatistics(search));
            if (r.failed) return asErrorResult(r);

            const rows = (r.data?.rows ?? []).map((row) => ({
                startedAtTimestamp: toPlainNumber(row.startedAtTimestamp),
                vipLevel: row.vipLevel,
                depositAmount: toPlainNumber(row.depositAmount),
                depositCount: row.depositCount,
                withdrawAmount: toPlainNumber(row.withdrawAmount),
                withdrawCount: row.withdrawCount,
                withdrawFee: toPlainNumber(row.withdrawFee),
                bet: toPlainNumber(row.bet),
                validBet: toPlainNumber(row.validBet),
                win: toPlainNumber(row.win),
                profit: toPlainNumber(row.profit),
                betCount: row.betCount,
                depositUserCount: row.depositUserCount,
            }));

            return asTextResult({ success: true, rows });
        },
    );
}
