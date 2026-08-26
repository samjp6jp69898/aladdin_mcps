/**
 * tools/get_agent_report_statistics.ts — aladdin_platform_agent_platform_get_report_statistics
 *
 * rajah: AgentPlatform.GetReportStatistics（agent_back_office.rajah:346，服務層級
 * `@Permission "VentureAgent"`，method 本身無額外 @Permission）。
 *
 * 分類依據 method-category-checklist.md 第 1 節「讀取單筆」——複合 key（agentId +
 * startTimestamp/endTimestamp）換回單一 VentureAgentReportStatistics model，非清單。
 * 回傳僅 agentId/agentName + 各項計數/金額統計，無 PII（無 realName 等欄位）。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { deepFixLongs } from '../const.ts';

export function registerGetAgentReportStatisticsTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_agent_platform_get_report_statistics',
        {
            title: "Get one agent's report statistics for a time range",
            description:
                '取得單一代理在指定時間區間的報表統計數據（rajah: AgentPlatform.GetReportStatistics，' +
                'agent_back_office.rajah:346）。三個參數皆必填：agentId（代理 UID，需先從 ' +
                'aladdin_platform_agent_platform_get_reports 取得合法值）、startTimestamp/endTimestamp' +
                '（epoch ms）。回傳直屬（direct）與團隊（team，含間接下線）兩套口徑的計數/金額統計。' +
                '無 realName 等 PII 欄位，只有 agentId/agentName 與純數字統計，不需額外遮罩。' +
                '2026-08-26 dev 實測：agentId 不存在（如已下線/從未存在）時 rajah 回傳 errorCode=11 ' +
                '"Agent not found"，本 tool 直接以錯誤結果回傳，呼叫端無需另外檢查 agentName 是否為空字串。',
            inputSchema: {
                agentId: z.number().int().describe('代理 UID，必填'),
                startTimestamp: z.number().int().describe('統計區間開始（epoch ms），必填'),
                endTimestamp: z.number().int().describe('統計區間結束（epoch ms），必填'),
            },
        },
        async ({ agentId, startTimestamp, endTimestamp }) => {
            const r = await withAutoRelogin(() => remote.agentBackOffice.agentPlatform.GetReportStatistics(agentId, startTimestamp, endTimestamp));
            if (r.failed) return asErrorResult(r);
            return asTextResult(deepFixLongs({ success: true, statistic: r.data?.statistic }));
        },
    );
}
