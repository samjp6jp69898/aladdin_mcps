/**
 * tools/list_deposit_daily_report.ts —
 * aladdin_platform_statistic_platform_list_deposit_daily_report
 *
 * rajah: StatisticPlatform.ListDepositDailyReport(page i32 1, pageSize i32 2, @Validate search
 * ListDepositDailyReportSearch 3) (rows [DepositDailyReportEssential] 1, totalPage i32 2)
 * （rajah/services/statistic.rajah:2464，非 @NoPublic，
 * @Permission "Finance.DepositReport.DepositDailyReport"）
 *
 * method-category-checklist.md 第 0 節排除規則已過：agrabah 對應 Service
 * （statistic_platform.ts:583 methodListDepositDailyReport）確認有真實實作（三方/公司入款表 UNION
 * 人工充值表，依日期分組），非 notImplemented。
 * 分類：第 2 節「讀取清單」——每列 = 一天（日期聯集三方/公司入款表與人工充值表 distinct 而得），依日期
 * 天然分頁，非「拿 List 冒充定位單筆」的高風險模式；日期區間為呼叫端自訂，後端無回溯上限檢查，區間拉很長
 * 理論上會有較多列，但仍是「日彙總」粒度而非逐筆明細，成長可控。
 *
 * 2026-08-26 讀 agrabah 後端原始碼查證（statistic_platform.ts:583-727）：
 * - **currencyCode 未帶或空字串時取平台預設幣別**（不是「不篩選幣別」），多幣別平台需顯式帶幣別才能看到
 *   非預設幣別的資料。
 * - **startCreatedAtTimestamp/endCreatedAtTimestamp 皆選填、皆為閉區間**（`>=` 與 `<=`）——注意 rajah 標記
 *   `@Type "DateRange:End"`（abu 前端慣例常是半開區間），但後端實作是 `<=`（閉區間），呼叫端不要假設結束
 *   時間不含當天。
 * - **固定只統計一般充值（payment_system_type=normal），代理體系充值不計入**。
 * - **onlineSuccessAmount/offlineSuccessAmount 是到帳金額**（= wallet_amount − fee，不含優惠贈送部分）。
 * - **manualSuccessAmount 可能為負值**：人工充值統計取 `transaction_amount` 當日累計，若當日該分類同時有
 *   上分與下分操作會相抵，可能呈負值，不是資料錯誤。
 * - **onlineSuccessRate/offlineSuccessRate/manualSuccessRate 的分母是 totalSuccessCount（三者相加）**，不是
 *   各自獨立算against 其他基準；rateBase=10000（10000=100%）；totalSuccessCount=0 時三者固定回 0。
 * - amount 系列欄位（rajah 標記 `@Type "Currency"`）已由後端存的是 stored 值，呼叫端如需人類可讀金額仍需
 *   自行依幣別 decimalPlaces+2 換算（本工具不做該換算，僅轉 Long → number）。
 * - 回傳固定依 startedAtTimestamp 由新到舊排序，不可自訂排序。
 * - 純讀取查詢，可安全重複呼叫。
 *
 * 2026-08-26 於 pk-platform.alddev.com dev 環境實測：呼叫一次成功（errorCode=0，page=1/pageSize=5，
 * 回傳 5 筆、totalPage=15，皆為真實資料）。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { ListDepositDailyReportSearch } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { toPlainNumber } from '../const.ts';

export function registerListDepositDailyReportTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_statistic_platform_list_deposit_daily_report',
        {
            title: 'List daily deposit report (online/offline/manual breakdown)',
            description:
                '查詢充值報表（每日一列，由新到舊，依「三方入款/公司入款/人工充值」拆分成功筆數與金額）' +
                '（rajah: StatisticPlatform.ListDepositDailyReport）。' +
                'currencyCode 未帶或空字串時取平台預設幣別，多幣別平台需顯式帶幣別。' +
                'startCreatedAtTimestamp/endCreatedAtTimestamp 皆選填、皆為**閉區間**（>= 與 <=，注意結束時間' +
                '含當天，不是半開區間）。**固定只統計一般充值，不含代理體系充值**。onlineSuccessAmount/' +
                'offlineSuccessAmount 是到帳金額（= 錢包入帳金額 − 手續費，不含優惠贈送）；manualSuccessAmount' +
                '（人工充值）**可能為負值**（當日若同時有上分與下分操作會相抵）。三個 xxxSuccessRate 的分母是' +
                'totalSuccessCount（三者相加後的總數），不是各自獨立基準，rateBase=10000（10000=100%），' +
                'totalSuccessCount=0 時固定回 0。金額欄位是 DB 原始 stored 單位，未經 rateBase 換算。回傳固定' +
                '依日期新到舊排序。純讀取查詢，可安全重複呼叫。',
            inputSchema: {
                page: z.number().int().min(1).describe('頁碼，從 1 開始'),
                pageSize: z.number().int().min(1).describe('每頁筆數'),
                startCreatedAtTimestamp: z.number().int().optional().describe('起始日期（毫秒時間戳，閉區間，選填）'),
                endCreatedAtTimestamp: z.number().int().optional().describe('結束日期（毫秒時間戳，閉區間、含當天，選填）'),
                currencyCode: z.string().optional().describe('幣別代碼；未帶或空字串時取平台預設幣別'),
            },
        },
        async (input) => {
            const search = ListDepositDailyReportSearch.create({
                startCreatedAtTimestamp: input.startCreatedAtTimestamp ?? 0,
                endCreatedAtTimestamp: input.endCreatedAtTimestamp ?? 0,
                currencyCode: input.currencyCode ?? '',
            });

            const r = await withAutoRelogin(() =>
                remote.statistic.statisticPlatform.ListDepositDailyReport(input.page, input.pageSize, search),
            );
            if (r.failed) return asErrorResult(r);

            const rows = (r.data?.rows ?? []).map((row) => ({
                startedAtTimestamp: toPlainNumber(row.startedAtTimestamp),
                totalSuccessCount: row.totalSuccessCount,
                onlineSuccessCount: row.onlineSuccessCount,
                onlineSuccessAmount: toPlainNumber(row.onlineSuccessAmount),
                onlineSuccessRate: row.onlineSuccessRate,
                offlineSuccessCount: row.offlineSuccessCount,
                offlineSuccessAmount: toPlainNumber(row.offlineSuccessAmount),
                offlineSuccessRate: row.offlineSuccessRate,
                manualSuccessCount: row.manualSuccessCount,
                manualSuccessAmount: toPlainNumber(row.manualSuccessAmount),
                manualSuccessRate: row.manualSuccessRate,
            }));

            return asTextResult({ success: true, rows, totalPage: r.data?.totalPage });
        },
    );
}
