/**
 * tools/list_deposit_withdraw_daily_report.ts —
 * aladdin_platform_statistic_platform_list_deposit_withdraw_daily_report
 *
 * rajah: StatisticPlatform.ListDepositWithdrawDailyReport(page i32 1, pageSize i32 2, @Validate
 * search ListDepositWithdrawReportSearch 3) (rows [DepositWithdrawDailyReportEssential] 1,
 * totalPage i32 2)（rajah/services/statistic.rajah:2469，非 @NoPublic，
 * @Permission "Finance.DepositReport.WithdrawDailyReport"）
 *
 * method-category-checklist.md 第 0 節排除規則已過：agrabah 對應 Service
 * （statistic_platform.ts:753 methodListDepositWithdrawDailyReport）確認有真實實作（讀預彙總表
 * daily_deposit_withdraw_summary_statistics，由 DailyDepositWithdrawSummaryRebuildJob 每日凌晨重算），
 * 非 notImplemented。
 * 分類：第 2 節「讀取清單」——每列 = 一天，依日期分頁，非「拿 List 冒充定位單筆」的高風險模式；資料完全
 * 來自預彙總表，本 method 只做 filter/分頁/二次計算，若數據異常應查 Job log
 * （DailyDepositWithdrawSummaryRebuildJob）而非本工具。
 *
 * 2026-08-26 讀 agrabah 後端原始碼查證（statistic_platform.ts:753-849，class 檔頭註解
 * statistic_platform.ts:730-751 對本方法的詳細規則說明）：
 * - **currencyCode 未帶或空字串時取平台預設幣別**，多幣別平台需顯式帶幣別。
 * - **startCreatedAtTimestamp/endCreatedAtTimestamp 皆選填、皆為閉區間**（`>=` 與 `<=`），儘管 rajah 標記
 *   `@Type "DateRange:End"`，結束時間仍含當天。
 * - **充值「成功」口徑含人工充值**：depositSuccessCount = 三方/公司入款成功 + 人工充值筆數；
 *   depositTotalCount 額外加上失敗筆數；depositSuccessAmount 同樣併入人工充值金額。**提現側沒有這個併入
 *   邏輯**（withdrawSuccessCount 只算 withdraw_success_count），充值與提現兩側口徑不對稱，比較兩側數字時
 *   要留意。
 * - **depositSuccessUserCount 直接取預彙總表的 `deposit_combined_success_user_count`**（Job 端已合併三方/
 *   公司/人工三種來源去重），本工具不重算。
 * - **depositSuccessRate/withdrawSuccessRate 分母各自是 depositTotalCount/withdrawTotalCount**（不像同檔
 *   ListDepositDailyReport 三個 rate 共用同一個分母），rateBase=10000（10000=100%），分母為 0 時固定回 0。
 * - **depositAveragePerUser/withdrawAveragePerUser** = 成功金額 ÷ 成功人數（無條件捨去），成功人數為 0 時
 *   固定回 0，不會除以零報錯。
 * - **updatedAtTimestamp 是該列彙總表 row 的 updated_at**（不是查詢當下時間），反映 Job 最後一次重算這個
 *   日期的時間。
 * - 金額欄位（rajah 標記 `@Type "Currency"`）是 DB 原始 stored 整數，本工具只轉 Long → number，不做
 *   rateBase 顯示換算。
 * - 回傳固定依 startedAtTimestamp 由新到舊排序。
 * - 純讀取查詢，可安全重複呼叫。
 *
 * 2026-08-26 於 pk-platform.alddev.com dev 環境實測：呼叫一次成功（errorCode=0，page=1/pageSize=5，
 * 回傳 5 筆、totalPage=23），並實際核對過一筆真實 row 的欄位組成（depositTotalCount/depositSuccessRate/
 * withdrawSuccessRate 等）與檔頭描述的計算邏輯一致。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { ListDepositWithdrawReportSearch } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { toPlainNumber } from '../const.ts';

export function registerListDepositWithdrawDailyReportTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_statistic_platform_list_deposit_withdraw_daily_report',
        {
            title: 'List daily deposit/withdraw combined report',
            description:
                '查詢充提報表（每日一列，由新到舊，並列展示充值/提現的成功/失敗筆數、金額、人數、成功率、' +
                '人均金額）（rajah: StatisticPlatform.ListDepositWithdrawDailyReport）。資料完全來自預彙總表' +
                '（Job 每日凌晨重算），若數據異常請查 Job log，不是本工具的查詢邏輯問題。' +
                'currencyCode 未帶或空字串時取平台預設幣別。startCreatedAtTimestamp/endCreatedAtTimestamp 皆' +
                '選填、皆為**閉區間**（含當天）。' +
                '**充值「成功」口徑含人工充值**（depositSuccessCount/depositTotalCount/depositSuccessAmount ' +
                '皆併入人工充值），**提現側沒有這個併入邏輯**，兩側口徑不對稱，比較時要留意。' +
                'depositSuccessUserCount 是後端 Job 已合併三方/公司/人工三種來源去重後的人數。' +
                'depositSuccessRate/withdrawSuccessRate 分母各自是自己的 totalCount（不共用分母），' +
                'rateBase=10000（10000=100%），分母為 0 時固定回 0。xxxAveragePerUser = 成功金額 ÷ 成功人數' +
                '（無條件捨去，人數 0 時回 0）。updatedAtTimestamp 是該日彙總資料最後一次被 Job 重算的時間，' +
                '非查詢當下時間。金額欄位是 DB 原始 stored 單位，未經 rateBase 換算。純讀取查詢，可安全重複' +
                '呼叫。',
            inputSchema: {
                page: z.number().int().min(1).describe('頁碼，從 1 開始'),
                pageSize: z.number().int().min(1).describe('每頁筆數'),
                startCreatedAtTimestamp: z.number().int().optional().describe('起始日期（毫秒時間戳，閉區間，選填）'),
                endCreatedAtTimestamp: z.number().int().optional().describe('結束日期（毫秒時間戳，閉區間、含當天，選填）'),
                currencyCode: z.string().optional().describe('幣別代碼；未帶或空字串時取平台預設幣別'),
            },
        },
        async (input) => {
            const search = ListDepositWithdrawReportSearch.create({
                startCreatedAtTimestamp: input.startCreatedAtTimestamp ?? 0,
                endCreatedAtTimestamp: input.endCreatedAtTimestamp ?? 0,
                currencyCode: input.currencyCode ?? '',
            });

            const r = await withAutoRelogin(() =>
                remote.statistic.statisticPlatform.ListDepositWithdrawDailyReport(input.page, input.pageSize, search),
            );
            if (r.failed) return asErrorResult(r);

            const rows = (r.data?.rows ?? []).map((row) => ({
                startedAtTimestamp: toPlainNumber(row.startedAtTimestamp),
                depositTotalCount: row.depositTotalCount,
                depositSuccessCount: row.depositSuccessCount,
                depositSuccessAmount: toPlainNumber(row.depositSuccessAmount),
                depositSuccessUserCount: row.depositSuccessUserCount,
                depositSuccessRate: row.depositSuccessRate,
                depositAveragePerUser: toPlainNumber(row.depositAveragePerUser),
                depositFailedCount: row.depositFailedCount,
                depositFailedAmount: toPlainNumber(row.depositFailedAmount),
                depositFailedUserCount: row.depositFailedUserCount,
                withdrawTotalCount: row.withdrawTotalCount,
                withdrawSuccessCount: row.withdrawSuccessCount,
                withdrawSuccessAmount: toPlainNumber(row.withdrawSuccessAmount),
                withdrawSuccessUserCount: row.withdrawSuccessUserCount,
                withdrawSuccessRate: row.withdrawSuccessRate,
                withdrawAveragePerUser: toPlainNumber(row.withdrawAveragePerUser),
                withdrawFailedCount: row.withdrawFailedCount,
                withdrawFailedAmount: toPlainNumber(row.withdrawFailedAmount),
                withdrawFailedUserCount: row.withdrawFailedUserCount,
                updatedAtTimestamp: toPlainNumber(row.updatedAtTimestamp),
            }));

            return asTextResult({ success: true, rows, totalPage: r.data?.totalPage });
        },
    );
}
