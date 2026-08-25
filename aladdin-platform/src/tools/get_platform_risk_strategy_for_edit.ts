/**
 * tools/get_platform_risk_strategy_for_edit.ts — aladdin_platform_risk_platform_get_platform_risk_strategy_for_edit
 *
 * rajah: RiskPlatform.GetPlatformRiskStrategyForEdit（risk.rajah:62，需要 @Permission "Risk"）
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerGetPlatformRiskStrategyForEditTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_risk_platform_get_platform_risk_strategy_for_edit',
        {
            title: 'Get one risk strategy for editing (platform view, current platform only)',
            description:
                '平台後台視角依 id 讀取一筆風控策略的完整編輯資料（rajah: RiskPlatform.GetPlatformRiskStrategyForEdit，risk.rajah:62）。' +
                'id 從 aladdin_platform_risk_platform_list_platform_risk_strategies 或 ' +
                'aladdin_platform_risk_platform_get_platform_risk_strategies 的回傳結果取得。' +
                '與 aladdin-admin 端超管版本（RiskAdmin.GetPlatformRiskStrategyForEdit）的關鍵差異：本工具查詢條件是 ' +
                '`id = ? AND platform_id = ?`（2026-08-25 讀 agrabah risk_platform.ts:93 查證），有正確做平台隔離——' +
                '用別平台的 id 查會回查無此筆，不像 admin 端那支只吃 id、任意平台皆可讀。' +
                '查不到對應 id（含 id 存在但屬於別平台的情況）時回傳業務錯誤 errorCode=11（genie ErrorCode.idNotExists，' +
                '不在 AgrabahErrorCodeEnum，errorName 會顯示「(未知錯誤碼)」，非本工具 bug），非例外。' +
                '回傳的 PlatformRiskStrategyEdit（risk.rajah:117-129）比清單版多帶 riskStrategyCurrencyConditions' +
                '（每個幣別各一份策略觸發門檻條件的 JSON，實際結構依 riskStrategyCode 對應到 RiskStrategyConditionModels ' +
                '這個 @Union 底下對應的子 model，例如 withdrawQuickly 策略對應 WithdrawQuickly model，見 risk.rajah:212-256），' +
                '不含 status（本工具無法判斷單筆啟用/停用，需另外用 list/get 清單版查）。' +
                'riskStrategyCode 在這個 model 標 `@Readonly`（risk.rajah:120，非 admin 版的 @NoEdit，但語意相同：不可透過此介面編輯）。',
            inputSchema: {
                id: z.number().int().describe('風控策略 id，從 list_platform_risk_strategies 或 get_platform_risk_strategies 的回傳結果取得'),
            },
        },
        async ({ id }) => {
            const r = await withAutoRelogin(() => remote.risk.riskPlatform.GetPlatformRiskStrategyForEdit(id));
            if (r.failed) return asErrorResult(r);
            return asTextResult({
                success: true,
                platformRiskStrategyEdit: r.data?.platformRiskStrategyEdit ?? null,
            });
        },
    );
}
