/**
 * tools/get_daily_payment_high_net_worth_statistics.ts —
 * aladdin_platform_statistic_platform_get_daily_payment_high_net_worth_statistics
 *
 * rajah: StatisticPlatform.GetDailyPaymentHighNetWorthStatistics(startedAtTimestamp i64 1,
 * currencyCode string 2, minimumAmount i64 3, maximumAmount i64 4) (statistics
 * DailyUserPaymentHighNetWorthStatistics 1)（rajah/services/statistic.rajah:2413，非 @NoPublic，
 * @Permission "ReportAnalysis.RPlayerReport"）
 *
 * method-category-checklist.md 第 0 節排除規則已過：agrabah 對應 Service
 * （statistic_platform.ts:188 methodGetDailyPaymentHighNetWorthStatistics）確認有真實實作
 * （查 daily_user_payment_statistics 表聚合 COUNT/SUM），非 notImplemented。
 * 分類：第 1 節「讀取單筆」（回傳單一 struct，非陣列）——但本方法不是 id 查找，是依
 * platformId+currencyCode+startedAtTimestamp+金額門檻做聚合統計，無「id 不存在」情境；
 * 該日該幣別無資料時 COUNT/SUM 回 0/NULL，工具層以 0 呈現。
 *
 * 2026-08-26 讀 agrabah 後端原始碼查證（statistic_platform.ts:138-147
 * buildConditionAndParameters）：
 * - **startedAtTimestamp 是精確等值匹配（`started_at_timestamp = ?`），不是區間**——查的是
 *   「該日」單一天的資料（daily_user_payment_statistics 每日一列），呼叫端須自行對齊該表的
 *   日期切點（該平台時區的當日 00:00 timestamp），傳入非切點值只會查到空結果，不會報錯。
 * - **minimumAmount 恆生效**（`deposit_amount >= ?`，未做 >0 判斷），必填傳 0 才代表「不設下限」。
 * - **maximumAmount 只有 > 0 時才生效**（`deposit_amount < maximumAmount`，右開區間）；傳 0 或負數
 *   等同「不設上限」。
 * - **金額單位未經 RateHelper 換算**：rajah 的 depositAmount/withdrawAmount/deltaAmount 與
 *   minimumAmount/maximumAmount 皆未標記 `@Type "Currency"`，是 `daily_user_payment_statistics`
 *   表的原始 stored 整數（由充值/提現 job 直接累加寫入，見
 *   agrabah/src/servers/statistic/jobs/payment_handlers/daily_user_payment.ts），本工具原樣透傳，
 *   不做除以 rateBase 的顯示換算；若要轉成人類可讀金額，需呼叫端自行依該幣別
 *   decimalPlaces+2 換算。
 * - deltaAmount = depositAmount − withdrawAmount，由後端算好回傳，非本工具計算。
 * - 純讀取查詢，可安全重複呼叫。
 *
 * 2026-08-26 於 pk-platform.alddev.com dev 環境實測：呼叫一次成功（errorCode=0，該平台當日 USD 無符合
 * 資料，回傳 totalUsers=0 的合法空結果，非錯誤）；本次只驗證正常呼叫路徑，未逐一覆蓋
 * minimumAmount/maximumAmount 邊界情境。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { toPlainNumber } from '../const.ts';

export function registerGetDailyPaymentHighNetWorthStatisticsTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_statistic_platform_get_daily_payment_high_net_worth_statistics',
        {
            title: 'Get daily high-net-worth deposit/withdraw statistics summary',
            description:
                '查詢指定「單一天」符合高淨值門檻的會員存提統計摘要（總人數/充值總額/提款總額/充提差額）' +
                '（rajah: StatisticPlatform.GetDailyPaymentHighNetWorthStatistics）。用於後台「R 玩家報表」儀表板。' +
                '**startedAtTimestamp 是精確等值比對，不是區間**：需傳入該平台時區「當日 00:00」的毫秒時間戳，' +
                '傳入非該表日期切點的值只會查到空結果（totalUsers=0），不會報錯。' +
                'minimumAmount 恆生效（充值 >= minimumAmount），不設下限請傳 0；maximumAmount 只有 > 0 時才生效' +
                '（充值 < maximumAmount，右開區間），不設上限請傳 0。' +
                '**金額單位是 DB 原始 stored 整數，未經 rateBase 換算**：depositAmount/withdrawAmount/deltaAmount ' +
                '與輸入的 minimumAmount/maximumAmount 皆為同一原始單位，不是顯示金額，若需要人類可讀金額請自行' +
                '依該幣別 decimalPlaces+2 換算。deltaAmount = depositAmount − withdrawAmount（後端算好回傳）。' +
                '這是純讀取查詢，可安全重複呼叫。',
            inputSchema: {
                startedAtTimestamp: z.number().int().describe('查詢日期（該平台時區當日 00:00 的毫秒時間戳，精確等值比對，非區間）'),
                currencyCode: z.string().min(1).describe('幣別代碼，如 "USD"（必填，只查該幣別）'),
                minimumAmount: z.number().int().describe('充值下限（恆生效，DB 原始單位，非顯示金額；不設下限傳 0）'),
                maximumAmount: z.number().int().describe('充值上限（僅 > 0 時生效，右開區間，DB 原始單位；不設上限傳 0）'),
            },
        },
        async (input) => {
            const r = await withAutoRelogin(() =>
                remote.statistic.statisticPlatform.GetDailyPaymentHighNetWorthStatistics(
                    input.startedAtTimestamp,
                    input.currencyCode,
                    input.minimumAmount,
                    input.maximumAmount,
                ),
            );
            if (r.failed) return asErrorResult(r);

            const s = r.data?.statistics;
            return asTextResult({
                success: true,
                statistics: s
                    ? {
                          totalUsers: s.totalUsers,
                          currencyCode: s.currencyCode,
                          depositAmount: toPlainNumber(s.depositAmount),
                          withdrawAmount: toPlainNumber(s.withdrawAmount),
                          deltaAmount: toPlainNumber(s.deltaAmount),
                      }
                    : undefined,
            });
        },
    );
}
