/**
 * tools/list_agent_reports.ts — aladdin_platform_agent_platform_get_reports
 *
 * rajah: AgentPlatform.GetReports（agent_back_office.rajah:337，`@Permission "VentureAgent.Overview"`）
 *
 * 分類依據 method-category-checklist.md 第 2 節「讀取清單」——回傳 `rows`+`totalPage`，且
 * `SearchAgentReportsParams` 有 `agentId`/`agentName` 可鎖定單一目標，屬 A 級（相對安全）。
 *
 * ⚠️ 結構性落差（2026-08-26 讀源碼發現）：rajah `SearchAgentReportsParams` 目前定義
 * （agent_back_office.rajah:16-91）有 22 個欄位，但 abu/platform 目前已產生的
 * `types.gen.d.ts`（ISearchAgentReportsParams）只有前 16 個欄位，缺少
 * `netProfitAmountOperator`/`netProfitAmount`/`monthTotalWinLoseAmountOperator`/
 * `monthTotalWinLoseAmount`/`newDirectValidMemberCountOperator`/`newDirectValidMemberCount`
 * 這 6 個較新欄位——代表 abu/platform 尚未針對這幾個新欄位重跑 `rajah generate`。
 * 本 tool 只暴露目前生成端真的支援的 16 個欄位，缺的 6 個等 abu/platform 重新生成後再補。
 *
 * PII 處理（method-category-checklist.md 第 8 節）：回傳 model VentureAgentReport 含
 * `realName`（代理真實姓名），不在既有 SensitiveFieldEnum 遮罩機制保護範圍內，本 tool 預設
 * 遮罩為「姓氏＋末字，中間用 * 補」，`revealRealName=true` 才回傳完整值。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { SearchAgentReportsParams } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { deepFixLongs } from '../const.ts';

function maskRealName(name: string | null | undefined): string | null | undefined {
    if (!name) return name;
    if (name.length <= 2) return `${ name[0] }*`;
    return `${ name[0] }${ '*'.repeat(name.length - 2) }${ name[name.length - 1] }`;
}

export function registerListAgentReportsTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_agent_platform_get_reports',
        {
            title: 'List agent (VentureAgent) overview reports',
            description:
                '分頁查詢代理數據報表（rajah: AgentPlatform.GetReports，agent_back_office.rajah:337，' +
                '需權限節點 VentureAgent.Overview）。所有搜尋欄位皆選填，全部留空即列出當前平台全部代理，' +
                '帶 agentId/agentName 可精確鎖定單一代理。' +
                '⚠️ 已知落差：rajah 定義比目前 abu/platform 生成的 client 多 6 個較新欄位' +
                '（淨利潤/負盈利/新增直屬有效人數三組比較條件），本 tool 尚未支援這 6 個，需等前端重新 ' +
                '`rajah generate` 後再補。' +
                '各 xxxOperator 欄位是 VentureNumberCompareOperatorEnum：0=不限（忽略對應數值欄位）/1=大於/2=小於。' +
                'commissionRate 為 ×10000 整數百分比（如需篩 5% 帶 500，即 0.05 × 10000）。' +
                'realName 預設遮罩顯示（僅首尾字），revealRealName=true 才回傳完整姓名——此欄位不在既有' +
                'SensitiveFieldEnum 遮罩機制保護範圍內，屬本 tool 自行加上的保護。' +
                '⚠️ 分頁陷阱：回傳沒有 totalRow，只有 totalPage；pageSize 只接受 10/20/30/50/100/200 ' +
                '這幾個離散值（PageSizeEnum，帶其他值後端回 errorCode=9）。' +
                '⚠️ 2026-08-26 dev 實測發現：statisticsDateStart/statisticsDateEnd 若省略，後端回業務錯誤 ' +
                'errorCode=2778 agentReportCrossMonthNotAllowed（Statistics date range must be within the same month）——' +
                '這兩個欄位實質上是必填的，且區間不可跨月，呼叫端應一律帶入同一個月內的起訖時間戳。',
            inputSchema: {
                agentId: z.number().int().optional().describe('代理 UID，精確比對'),
                agentName: z.string().optional().describe('代理帳號，精確比對'),
                parentId: z.number().int().optional().describe('上級代理 UID，精確比對'),
                parentAgentName: z.string().optional().describe('上級代理帳號，精確比對'),
                commissionPlanId: z.number().int().optional().describe('佣金方案 ID（需先從其他管道取得合法值）'),
                statisticsDateStart: z.number().int().optional().describe('統計日期區間開始（epoch ms）'),
                statisticsDateEnd: z.number().int().optional().describe('統計日期區間結束（epoch ms）'),
                registerTimeStart: z.number().int().optional().describe('註冊時間區間開始（epoch ms）'),
                registerTimeEnd: z.number().int().optional().describe('註冊時間區間結束（epoch ms）'),
                parentAgentType: z.number().int().optional().describe('上級代理類型：0=不限/1=全民代理/2=合營代理/5=無上級'),
                estimatedCommissionAmountOperator: z.number().int().optional().describe('預估獲得傭金比較方式：0=不限/1=大於/2=小於'),
                estimatedCommissionAmount: z.number().int().optional().describe('預估獲得傭金，×10000 整數，搭配上一欄使用'),
                lastMonthBalanceAmountOperator: z.number().int().optional().describe('上月結餘比較方式：0=不限/1=大於/2=小於'),
                lastMonthBalanceAmount: z.number().int().optional().describe('上月結餘，×10000 整數，搭配上一欄使用'),
                commissionRateOperator: z.number().int().optional().describe('分紅比例比較方式：0=不限/1=大於/2=小於'),
                commissionRate: z.number().int().optional().describe('分紅比例，×10000 整數百分比，搭配上一欄使用'),
                page: z.number().int().min(1).default(1).describe('頁碼，從 1 開始'),
                pageSize: z.union([ z.literal(10), z.literal(20), z.literal(30), z.literal(50), z.literal(100), z.literal(200) ])
                    .default(50).describe('每頁筆數，PageSizeEnum 固定選項，僅接受 10/20/30/50/100/200'),
                revealRealName: z.boolean().default(false).describe('true 才回傳完整 realName，預設遮罩'),
            },
        },
        async (input) => {
            const { page, pageSize, revealRealName, ...searchFields } = input;
            const searchParams = SearchAgentReportsParams.create(searchFields);
            const r = await withAutoRelogin(() => remote.agentBackOffice.agentPlatform.GetReports(searchParams, page, pageSize));
            if (r.failed) return asErrorResult(r);
            const rows = (r.data?.rows ?? []).map((row) => ({
                ...row,
                realName: revealRealName ? row.realName : maskRealName(row.realName),
            }));
            return asTextResult(deepFixLongs({
                success: true,
                totalAgentCount: r.data?.totalAgentCount,
                yesterdayNewAgentCount: r.data?.yesterdayNewAgentCount,
                totalRebate: r.data?.totalRebate,
                totalPage: r.data?.totalPage,
                rows,
            }));
        },
    );
}
