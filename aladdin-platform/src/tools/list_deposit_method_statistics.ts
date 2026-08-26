/**
 * tools/list_deposit_method_statistics.ts —
 * aladdin_platform_statistic_platform_list_deposit_method_statistics
 *
 * rajah: StatisticPlatform.ListDepositMethodStatistics(page i32 1, pageSize i32 2, search
 * ListDepositStatisticsSearch 3) (rows [DepositStatisticsEssential] 1, totalPage i32 2)
 * （rajah/services/statistic.rajah:2458，非 @NoPublic，
 * @Permission "PaymentDeposit.Statistics.MethodStatistics"）
 *
 * method-category-checklist.md 第 0 節排除規則已過：agrabah 對應 Service
 * （statistic_platform.ts:471 methodListDepositMethodStatistics）確認有真實實作（查
 * daily_deposit_method_statistics 表聚合），非 notImplemented。
 * 分類：第 2 節「讀取清單」——A 級偏安全：雖無單一可鎖定目標欄位，但本質是「充值方式 × 支付平台 ×
 * 幣別」組合的分組報表（`GROUP BY deposit_method_id, adapter_instance_id, currency_code`），不是拿 List
 * 冒充定位單筆的模式，組合數天然有限（受限於平台實際設定的充值方式與支付平台數量）。page/pageSize 是裸
 * i32（非 PageSizeEnum），後端未做上界 clamp，呼叫端自行決定分頁大小。
 *
 * 2026-08-26 讀 agrabah 後端原始碼查證（statistic_platform.ts:471-567）：
 * - **固定套用 `payment_system_type = normal`**：只統計一般充值，代理體系（agent）充值不計入，無法透過
 *   本工具查代理充值統計。
 * - **startCreatedAtTimestamp/endCreatedAtTimestamp 比對的是 `started_at_timestamp`（日期統計桶）**，兩者
 *   皆為選填（`searchNotEmpty` 判斷，0 或未帶即不加該條件），且都是**閉區間**（`>=` 與 `<=`），與同檔
 *   其他方法常見的「結束時間半開區間」不同，注意 `<=` 是否已含最後一天全天需視資料桶粒度自行確認。
 * - **回傳依 success_amount 由大到小排序**（固定排序，非可自訂）。
 * - **successRate 是 rateBase=10000 的整數（`Math.floor(successCount/count*10000)`）**：10000 = 100%，
 *   例如 5000 代表 50%；count=0 時直接回 0，不會除以零報錯。
 * - **successAmount 未經 RateHelper 換算**：`@Type "Currency"` 未標記在 rajah，是 DB 原始 stored 整數。
 * - 純讀取查詢，可安全重複呼叫。
 *
 * 2026-08-26 於 pk-platform.alddev.com dev 環境實測：呼叫一次成功（errorCode=0，page=1/pageSize=5，
 * 回傳 5 筆、totalPage=5，分頁與 rows 皆為真實資料）。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { ListDepositStatisticsSearch } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { toPlainNumber } from '../const.ts';

export function registerListDepositMethodStatisticsTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_statistic_platform_list_deposit_method_statistics',
        {
            title: 'List deposit statistics grouped by method/adapter/currency',
            description:
                '查詢充值通道統計列表，依「充值方式 × 支付平台 × 幣別」分組（訂單數/成功訂單數/成功率/成功金額）' +
                '（rajah: StatisticPlatform.ListDepositMethodStatistics）。' +
                '**固定只統計一般充值（payment_system_type=normal），不含代理體系充值**。' +
                'startCreatedAtTimestamp/endCreatedAtTimestamp 皆選填（0 或不帶＝不設該邊界），且都是**閉區間**' +
                '（>= 與 <=，與許多其他報表方法「結束時間半開區間」不同）。回傳固定依 successAmount 由大到小' +
                '排序，不可自訂排序。successRate 是 rateBase=10000 的整數（10000=100%，5000=50%），count=0 時' +
                '固定回 0。successAmount 是 DB 原始 stored 單位，未經 rateBase 換算。純讀取查詢，可安全重複' +
                '呼叫。',
            inputSchema: {
                page: z.number().int().min(1).describe('頁碼，從 1 開始'),
                pageSize: z.number().int().min(1).describe('每頁筆數'),
                adapterInstanceId: z.array(z.number().int()).optional().describe('支付平台 id 篩選清單，留空＝不篩選'),
                depositMethodId: z.array(z.number().int()).optional().describe('充值方式 id 篩選清單，留空＝不篩選'),
                startCreatedAtTimestamp: z.number().int().optional().describe('訂單建立時間下界（毫秒時間戳，閉區間，選填）'),
                endCreatedAtTimestamp: z.number().int().optional().describe('訂單建立時間上界（毫秒時間戳，閉區間，選填）'),
            },
        },
        async (input) => {
            const search = ListDepositStatisticsSearch.create({
                adapterInstanceId: input.adapterInstanceId ?? [],
                depositMethodId: input.depositMethodId ?? [],
                startCreatedAtTimestamp: input.startCreatedAtTimestamp ?? 0,
                endCreatedAtTimestamp: input.endCreatedAtTimestamp ?? 0,
            });

            const r = await withAutoRelogin(() =>
                remote.statistic.statisticPlatform.ListDepositMethodStatistics(input.page, input.pageSize, search),
            );
            if (r.failed) return asErrorResult(r);

            const rows = (r.data?.rows ?? []).map((row) => ({
                adapterInstanceId: row.adapterInstanceId,
                depositMethodId: row.depositMethodId,
                currencyCode: row.currencyCode,
                count: row.count,
                successCount: row.successCount,
                successRate: row.successRate,
                successAmount: toPlainNumber(row.successAmount),
            }));

            return asTextResult({ success: true, rows, totalPage: r.data?.totalPage });
        },
    );
}
