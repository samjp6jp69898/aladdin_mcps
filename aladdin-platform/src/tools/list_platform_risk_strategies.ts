/**
 * tools/list_platform_risk_strategies.ts — aladdin_platform_risk_platform_list_platform_risk_strategies
 *
 * rajah: RiskPlatform.ListPlatformRiskStrategies（risk.rajah:58，需要 @Permission "Risk.RiskStrategy.WithdrawTag"）
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerListPlatformRiskStrategiesTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_risk_platform_list_platform_risk_strategies',
        {
            title: "List the current platform's risk strategies",
            description:
                '分頁查詢當前平台（登入身分綁定的 platformId，非參數帶入）的所有風控策略（rajah: ' +
                'RiskPlatform.ListPlatformRiskStrategies，risk.rajah:58；不分狀態篩選，啟用與停用的策略都會列出）。' +
                '與 aladdin-admin 端的 RiskAdmin.ListPlatformRiskStrategies 不是同一支 API：那支是超管跨平台版本（吃 platformId 參數、' +
                '每頁固定 100 筆、無 pageSize），本工具是平台後台視角，鎖定當前登入身分的平台、pageSize 可自訂——兩者回傳的 model 也不同' +
                '（本工具回傳 PlatformRiskStrategyEssential，含 status/riskLevel，但不含 riskStrategyCode；admin 版回傳' +
                'PlatformRiskStrategyEssentialForAdmin，含 riskStrategyCode，但不含 status/riskLevel）。' +
                '此 method 沒有 search 參數，無法用名稱/代碼篩選，只能翻頁後在呼叫端過濾。' +
                '⚠️ 分頁陷阱（與 admin 版同一個 getPageData 實作，同樣適用）：totalPage 只有 page=1 時後端才會真的計算，' +
                'page>1 時固定回 0，不能用它判斷「是否還有下一頁」，翻頁到底要改用 rows.length < pageSize。' +
                '回傳的 category 是 rajah RiskStrategyCategoryEnum 數值：capital=1 資金類 / behavior=2 行為類 / identityRisk=3 風險身份類 / ' +
                'promotion=4 優惠類 / systemAbnormal=5 系統異常類；riskLevel 是 RiskLevelEnum 數值；status 是 StatusEnum 數值 ' +
                '（unknown=0/enabled=1/disabled=2/frozen=3/deleted=10，一般只會出現 enabled/disabled）。',
            inputSchema: {
                page: z.number().int().min(1).default(1).describe('頁碼，從 1 開始'),
                pageSize: z.number().int().min(1).default(50).describe('每頁筆數'),
            },
        },
        async ({ page, pageSize }) => {
            const r = await withAutoRelogin(() => remote.risk.riskPlatform.ListPlatformRiskStrategies(page, pageSize));
            if (r.failed) return asErrorResult(r);
            return asTextResult({
                success: true,
                rows: r.data?.rows ?? [],
                totalPage: r.data?.totalPage,
            });
        },
    );
}
