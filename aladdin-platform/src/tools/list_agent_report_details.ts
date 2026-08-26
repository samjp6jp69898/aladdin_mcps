/**
 * tools/list_agent_report_details.ts — aladdin_platform_agent_platform_get_report_details
 *
 * rajah: AgentPlatform.GetReportDetails（agent_back_office.rajah:344，服務層級
 * `@Permission "VentureAgent"`，method 本身無額外 @Permission；`VentureAgent.Overview.Detail`
 * 系列是另外掛在 Placeholder method 上的權限樹顯示節點，不影響這支 method 能否被呼叫）。
 *
 * 分類依據 method-category-checklist.md 第 2 節「讀取清單」——回傳 `rows`+`totalPage`，且
 * `SearchAgentReportDetailsParams` 有 `agentId`/`agentName` 可鎖定單一目標，屬 A 級。
 * 13 個搜尋欄位在 rajah 與目前 abu/platform 生成的 client 完全對齊，無落差（與同 service 的
 * GetReports 不同，那支有已知的生成落差，見 list_agent_reports.ts 檔頭註解）。
 *
 * 回傳的 VentureAgentReportDetail（agent_common.rajah:1375-1436）不含 realName，但含
 * `lastLoginIp`（最後登入 IP，第 7 欄）——同屬 method-category-checklist.md 第 8 節「一般 PII」，
 * 不在既有 SensitiveFieldEnum 保護範圍內，本 tool 比照 list_agent_reports.ts 的 realName 處理方式，
 * 預設遮罩中間兩段（如 1.2.3.4 → 1.*.*.4），`revealLastLoginIp=true` 才回傳完整值。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { SearchAgentReportDetailsParams } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { deepFixLongs } from '../const.ts';

function maskIp(ip: string | null | undefined): string | null | undefined {
    if (!ip) return ip;
    const parts = ip.split('.');
    if (parts.length !== 4) return ip; // 非典型 IPv4 格式（如 IPv6/空字串以外的異常值）原樣保留，不硬套遮罩
    return `${ parts[0] }.*.*.${ parts[3] }`;
}

export function registerListAgentReportDetailsTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_agent_platform_get_report_details',
        {
            title: 'List agent report detail rows (direct/team members under an agent)',
            description:
                '分頁查詢代理報表詳細數據——某代理直屬或團隊成員的個別統計列（rajah: ' +
                'AgentPlatform.GetReportDetails，agent_back_office.rajah:344）。所有搜尋欄位選填，' +
                '帶 agentId/agentName 可精確鎖定單一代理，搭配 relationType 決定看該代理的「直屬」' +
                '（direct=1）還是「團隊」（team=2，含間接下線）成員，all=0 為不限。' +
                'isVentureAgent：0=不限/1=是合營代理/2=不是。registerFrom 是 ' +
                'AgentModeForSearchAgentMemberEnum：0=不限/1=全民代理/2=合營代理/5=無上級。' +
                '回傳除逐列 rows 外還有 summary（該次查詢條件下的彙總數據）與頂層 agentId/agentName' +
                '（回顯查詢目標，非清單裡每一列各自的代理）。' +
                '⚠️ 分頁陷阱：回傳沒有 totalRow，只有 totalPage；pageSize 只接受 10/20/30/50/100/200 ' +
                '這幾個離散值（PageSizeEnum，帶其他值後端回 errorCode=9）。' +
                '⚠️ 2026-08-26 dev 實測：與同 service 的 GetReports 一樣，statisticsDateStart/statisticsDateEnd ' +
                '省略會回業務錯誤 errorCode=2778 agentReportCrossMonthNotAllowed（Statistics date range must be ' +
                'within the same month），這兩個欄位實質上是必填的，且區間不可跨月。' +
                '⚠️ 2026-08-26 dev 實測：agentId/agentName 比對的是「已在 AgentPlatform 系統註冊為代理帳號」的' +
                '身分，不是任意會員 id——用某代理報表列（rows）裡 isAgent=true 的 userId 當 agentId 查詢會回' +
                'errorCode=2702 agentAgentNotFound，該 userId 需先確認是否真的是已註冊代理。' +
                'lastLoginIp 預設遮罩中間兩段（如 1.2.3.4 → 1.*.*.4），revealLastLoginIp=true 才回傳完整值。',
            inputSchema: {
                agentId: z.number().int().optional().describe('代理 UID，精確比對'),
                agentName: z.string().optional().describe('代理帳號，精確比對'),
                parentId: z.number().int().optional().describe('上級代理 UID，精確比對'),
                parentAgentName: z.string().optional().describe('上級代理帳號，精確比對'),
                relationType: z.number().int().optional().describe('關係類型：0=不限/1=直屬(direct)/2=團隊(team)'),
                statisticsDateStart: z.number().int().optional().describe('統計日期區間開始（epoch ms）'),
                statisticsDateEnd: z.number().int().optional().describe('統計日期區間結束（epoch ms）'),
                memberJoinTimeStart: z.number().int().optional().describe('會員加入代理時間區間開始（epoch ms）'),
                memberJoinTimeEnd: z.number().int().optional().describe('會員加入代理時間區間結束（epoch ms）'),
                registerTimeStart: z.number().int().optional().describe('會員註冊時間區間開始（epoch ms）'),
                registerTimeEnd: z.number().int().optional().describe('會員註冊時間區間結束（epoch ms）'),
                isVentureAgent: z.number().int().optional().describe('是否為合營代理：0=不限/1=是/2=否'),
                registerFrom: z.number().int().optional().describe('註冊來源/關係類型：0=不限/1=全民代理/2=合營代理/5=無上級'),
                page: z.number().int().min(1).default(1).describe('頁碼，從 1 開始'),
                pageSize: z.union([ z.literal(10), z.literal(20), z.literal(30), z.literal(50), z.literal(100), z.literal(200) ])
                    .default(50).describe('每頁筆數，PageSizeEnum 固定選項，僅接受 10/20/30/50/100/200'),
                revealLastLoginIp: z.boolean().default(false).describe('true 才回傳完整 lastLoginIp，預設遮罩'),
            },
        },
        async (input) => {
            const { page, pageSize, revealLastLoginIp, ...searchFields } = input;
            const searchParams = SearchAgentReportDetailsParams.create(searchFields);
            const r = await withAutoRelogin(() => remote.agentBackOffice.agentPlatform.GetReportDetails(searchParams, page, pageSize));
            if (r.failed) return asErrorResult(r);
            const rows = (r.data?.rows ?? []).map((row) => ({
                ...row,
                lastLoginIp: revealLastLoginIp ? row.lastLoginIp : maskIp(row.lastLoginIp),
            }));
            return asTextResult(deepFixLongs({
                success: true,
                agentId: r.data?.agentId,
                agentName: r.data?.agentName,
                summary: r.data?.summary,
                totalPage: r.data?.totalPage,
                rows,
            }));
        },
    );
}
