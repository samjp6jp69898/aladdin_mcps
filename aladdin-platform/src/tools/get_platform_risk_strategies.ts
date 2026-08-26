/**
 * tools/get_platform_risk_strategies.ts — aladdin_platform_risk_platform_get_platform_risk_strategies
 *
 * rajah: RiskPlatform.GetPlatformRiskStrategies（risk.rajah:60，無 @Permission、無分頁——
 * 設計為前端下拉選單/篩選器的 Select option 來源，見同檔 risk_platform.ts:55-66 註解）
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerGetPlatformRiskStrategiesTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_risk_platform_get_platform_risk_strategies',
        {
            title: "Get all of the current platform's risk strategies (no pagination)",
            description:
                '無參數、不分頁一次取回當前平台（登入身分綁定的 platformId）**全部**風控策略（rajah: ' +
                'RiskPlatform.GetPlatformRiskStrategies，risk.rajah:60）。設計用途是前端下拉選單/篩選器的 select option 來源' +
                '（例如提現訂單列表的「出款標籤」篩選欄），底層是管理員手動維護的小型清單，不是會員產生的資料，不會無限成長，' +
                '可安全全撈；與 aladdin_platform_risk_platform_list_platform_risk_strategies 的差別是那支有分頁、這支沒有。' +
                '回傳的 PlatformRiskStrategyEssential 欄位同分頁版：含 status/riskLevel，不含 riskStrategyCode。' +
                'status 是 rajah StatusEnum 數值（unknown=0/enabled=1/disabled=2/frozen=3/deleted=10，一般只會出現 enabled/disabled）；' +
                'category 是 RiskStrategyCategoryEnum 數值：capital=1 資金類/behavior=2 行為類/identityRisk=3 風險身份類/' +
                'promotion=4 優惠類/systemAbnormal=5 系統異常類。' +
                '這支 method 在 rajah 沒有掛 @Permission（設計上僅供已能進入該頁面的操作者使用），存取控制交由前端頁面的其他權限節點把關。',
            inputSchema: {},
        },
        async () => {
            const r = await withAutoRelogin(() => remote.risk.riskPlatform.GetPlatformRiskStrategies());
            if (r.failed) return asErrorResult(r);
            return asTextResult({ success: true, rows: r.data?.rows ?? [] });
        },
    );
}
