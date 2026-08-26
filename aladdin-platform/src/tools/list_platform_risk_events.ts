/**
 * tools/list_platform_risk_events.ts — aladdin_platform_risk_platform_list_platform_risk_events
 *
 * rajah: RiskPlatform.ListPlatformRiskEvents（risk.rajah:72，需要 @Permission "Risk.RiskTag"）
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { ListPlatformRiskEventsSearch } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerListPlatformRiskEventsTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_risk_platform_list_platform_risk_events',
        {
            title: 'List risk-strategy hit events (withdraw-tag log)',
            description:
                '分頁查詢當前平台的風控事件（策略命中紀錄，對應後台「風控 → 出款標籤日誌」頁；rajah: ' +
                'RiskPlatform.ListPlatformRiskEvents，risk.rajah:72）。每筆代表一次策略觸發，含觸發時間、觸發的訂單、' +
                '命中的策略標籤與風險等級。' +
                '所有搜尋條件皆選填：userId/platformRiskStrategyId 為精確比對，identifier（使用者帳號）為 LIKE 模糊比對；' +
                '⚠️ 數字型搜尋欄位（userId/platformRiskStrategyId/riskLevel）帶 0 等同不篩選（後端 searchNotEmpty 預設把 0 視為' +
                '「未提供」，2026-08-25 讀 agrabah common/database_helper.ts:349-359 查證），這些欄位本來就沒有合法的 0 值可篩選，' +
                '不影響實際使用。' +
                'platformRiskStrategyId 用 aladdin_platform_risk_platform_list_platform_risk_strategies 或 ' +
                'get_platform_risk_strategies 查；riskLevel 是 rajah RiskLevelEnum 數值。' +
                '⚠️ 分頁陷阱（與同 server 內其他 List 系列 tool 共用同一個 getPageData 實作）：totalPage 只有 page=1 時後端才會真的' +
                '計算，page>1 時固定回 0，不能用它判斷「是否還有下一頁」，翻頁到底要改用 rows.length < pageSize。' +
                '回傳的 triggerType 是 rajah TriggerTypeEnum 數值：withdraw=1（發起提現）/ deposit=2（發起充值）；' +
                'category 是 RiskStrategyCategoryEnum 數值（capital=1/behavior=2/identityRisk=3/promotion=4/systemAbnormal=5）；' +
                '策略停用後既有的歷史命中紀錄不會被刪除，本工具仍查得到。',
            inputSchema: {
                page: z.number().int().min(1).default(1).describe('頁碼，從 1 開始'),
                pageSize: z.number().int().min(1).default(50).describe('每頁筆數'),
                userId: z.number().int().optional().describe('依觸發會員的使用者 id 篩選（精確比對）'),
                identifier: z.string().optional().describe('依使用者帳號篩選（LIKE 模糊比對）'),
                platformRiskStrategyId: z.number().int().optional().describe(
                    '依命中的風控策略 id 篩選（精確比對），id 用 list_platform_risk_strategies 或 get_platform_risk_strategies 查',
                ),
                startCreatedAtTimestamp: z.number().int().optional().describe('事件時間區間起點，毫秒 epoch'),
                endCreatedAtTimestamp: z.number().int().optional().describe('事件時間區間終點，毫秒 epoch'),
                riskLevel: z.number().int().optional().describe('依風險等級篩選（rajah RiskLevelEnum 數值，精確比對）'),
            },
        },
        async ({ page, pageSize, userId, identifier, platformRiskStrategyId, startCreatedAtTimestamp, endCreatedAtTimestamp, riskLevel }) => {
            const search = ListPlatformRiskEventsSearch.create({
                userId: userId ?? 0,
                identifier: identifier ?? '',
                platformRiskStrategyId: platformRiskStrategyId ?? 0,
                startCreatedAtTimestamp: startCreatedAtTimestamp ?? 0,
                endCreatedAtTimestamp: endCreatedAtTimestamp ?? 0,
                riskLevel: riskLevel ?? 0,
            });
            const r = await withAutoRelogin(() => remote.risk.riskPlatform.ListPlatformRiskEvents(page, pageSize, search));
            if (r.failed) return asErrorResult(r);
            return asTextResult({
                success: true,
                rows: r.data?.rows ?? [],
                totalPage: r.data?.totalPage,
            });
        },
    );
}
