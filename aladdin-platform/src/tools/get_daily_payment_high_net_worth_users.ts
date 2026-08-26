/**
 * tools/get_daily_payment_high_net_worth_users.ts —
 * aladdin_platform_statistic_platform_get_daily_payment_high_net_worth_users
 *
 * rajah: StatisticPlatform.GetDailyPaymentHighNetWorthUsers(startedAtTimestamp i64 1,
 * currencyCode string 2, minimumAmount i64 3, maximumAmount i64 4) (userIdList [i32] 1)
 * （rajah/services/statistic.rajah:2414，非 @NoPublic，**無 @Permission**——service 本身也沒有
 * service 級 @Permission，這支不會出現在前端權限樹，後端也未見對應的 access control 檢查，
 * 任何有效登入的操作者皆可呼叫）
 *
 * method-category-checklist.md 第 0 節排除規則已過：agrabah 對應 Service
 * （statistic_platform.ts:164 methodGetDailyPaymentHighNetWorthUsers）確認有真實實作，非
 * notImplemented，與同檔 GetDailyPaymentHighNetWorthStatistics 共用同一個
 * buildConditionAndParameters()，篩選條件完全一致，只是回傳 userId 清單而非聚合統計。
 * 分類：第 2 節「讀取清單」——**完全不分頁的全撈**（`SELECT user_id ... WHERE ...` 無 LIMIT）。
 * 語意上是「指定一天符合高淨值門檻的會員」快照查詢，範圍已被
 * platformId+currencyCode+startedAtTimestamp+金額門檻天然收斂，不是會持續成長的歷史/log 表，
 * 可放心視為安全（見同檔 statistics 版本檔頭關於篩選語意的完整說明）。
 *
 * 篩選條件與單位規則與 aladdin_platform_statistic_platform_get_daily_payment_high_net_worth_statistics
 * 完全一致（同一個 buildConditionAndParameters）：
 * - startedAtTimestamp 精確等值比對（該表日期切點），非區間。
 * - minimumAmount 恆生效；maximumAmount 只有 > 0 才生效（右開區間）。
 * - 這兩個輸入金額參數同樣未經 RateHelper 換算，是 DB 原始 stored 單位。
 *
 * 純讀取查詢，可安全重複呼叫。
 *
 * 2026-08-26 於 pk-platform.alddev.com dev 環境實測：呼叫一次成功（errorCode=0，回傳空清單，屬合法結果
 * 非錯誤，與同一批同條件的 GetDailyPaymentHighNetWorthStatistics 結果一致）；本次只驗證正常呼叫路徑。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerGetDailyPaymentHighNetWorthUsersTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_statistic_platform_get_daily_payment_high_net_worth_users',
        {
            title: 'Get user id list matching daily high-net-worth deposit criteria',
            description:
                '查詢指定「單一天」符合高淨值充值門檻的會員 userId 清單（rajah: ' +
                'StatisticPlatform.GetDailyPaymentHighNetWorthUsers）。與 ' +
                'aladdin_platform_statistic_platform_get_daily_payment_high_net_worth_statistics ' +
                '共用完全相同的篩選條件（同一段後端邏輯），差別只在這支回傳明細 userId 清單、那支回傳聚合統計。' +
                '**startedAtTimestamp 是精確等值比對，不是區間**：需傳入該平台時區「當日 00:00」的毫秒時間戳，' +
                '傳入非該表日期切點的值只會查到空清單，不會報錯。' +
                'minimumAmount 恆生效（充值 >= minimumAmount，不設下限傳 0）；maximumAmount 只有 > 0 才生效' +
                '（充值 < maximumAmount，右開區間，不設上限傳 0）。這兩個金額參數是 DB 原始 stored 單位，未經 ' +
                'rateBase 換算。**此方法完全不分頁、一次全撈**，但範圍已被單日+幣別+金額門檻天然收斂，正常情境下' +
                '結果集不大；**無 @Permission 節點，任何有效登入的操作者皆可呼叫**。純讀取查詢，可安全重複呼叫。',
            inputSchema: {
                startedAtTimestamp: z.number().int().describe('查詢日期（該平台時區當日 00:00 的毫秒時間戳，精確等值比對，非區間）'),
                currencyCode: z.string().min(1).describe('幣別代碼，如 "USD"（必填，只查該幣別）'),
                minimumAmount: z.number().int().describe('充值下限（恆生效，DB 原始單位，非顯示金額；不設下限傳 0）'),
                maximumAmount: z.number().int().describe('充值上限（僅 > 0 時生效，右開區間，DB 原始單位；不設上限傳 0）'),
            },
        },
        async (input) => {
            const r = await withAutoRelogin(() =>
                remote.statistic.statisticPlatform.GetDailyPaymentHighNetWorthUsers(
                    input.startedAtTimestamp,
                    input.currencyCode,
                    input.minimumAmount,
                    input.maximumAmount,
                ),
            );
            if (r.failed) return asErrorResult(r);

            return asTextResult({ success: true, userIdList: r.data?.userIdList ?? [] });
        },
    );
}
