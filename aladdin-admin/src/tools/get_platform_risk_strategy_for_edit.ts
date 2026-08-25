/**
 * tools/get_platform_risk_strategy_for_edit.ts — aladdin_admin_risk_admin_get_platform_risk_strategy_for_edit
 *
 * rajah: RiskAdmin.GetPlatformRiskStrategyForEdit（risk.rajah:44）
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerGetPlatformRiskStrategyForEditTool(server: McpServer): void {
    server.registerTool(
        'aladdin_admin_risk_admin_get_platform_risk_strategy_for_edit',
        {
            title: 'Get one risk strategy for editing (super-admin view)',
            description:
                '超管視角依 id 讀取一筆風控策略的完整編輯資料（rajah: RiskAdmin.GetPlatformRiskStrategyForEdit，risk.rajah:44）。' +
                'id 從 aladdin_admin_risk_admin_list_platform_risk_strategies 的回傳結果取得。' +
                '⚠️ 這支查詢只吃 id，不吃 platformId、不做跨平台隔離檢查——任何合法登入的超管都能用任意 id 讀到任何平台的策略，' +
                '這是超管視角刻意的設計（跨平台管理），不是本工具的疏漏。' +
                '查不到對應 id 時回傳業務錯誤（非拋例外），tool 會如實回報失敗，不會靜默回空物件——' +
                '2026-08-25 dev 站台實測：errorCode=11（genie ErrorCode.idNotExists，屬於通用業務錯誤碼命名空間，' +
                '不在 AgrabahErrorCodeEnum 裡，因此 errorName 會顯示「(未知錯誤碼)」，這是已知的既有共用錯誤映射限制，不是本工具的 bug）。' +
                '回傳的 PlatformRiskStrategyEditForAdmin 比清單版（PlatformRiskStrategyEssentialForAdmin，已含 riskStrategyCode）多帶 riskLevel 欄位；riskStrategyCode 一經建立即不可編輯' +
                '（rajah @NoEdit），僅供顯示用途，不要讓 agent 誤以為可以透過 create_or_update 改掉這個欄位。',
            inputSchema: {
                id: z.number().int().describe('風控策略 id，從 list_platform_risk_strategies 的回傳結果取得'),
            },
        },
        async ({ id }) => {
            const r = await withAutoRelogin(() => remote.risk.riskAdmin.GetPlatformRiskStrategyForEdit(id));
            if (r.failed) return asErrorResult(r);
            return asTextResult({
                success: true,
                platformRiskStrategyEditForAdmin: r.data?.platformRiskStrategyEditForAdmin ?? null,
            });
        },
    );
}
