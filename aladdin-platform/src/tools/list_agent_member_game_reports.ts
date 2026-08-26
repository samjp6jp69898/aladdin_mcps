/**
 * tools/list_agent_member_game_reports.ts — aladdin_platform_agent_platform_get_agent_member_game_reports
 *
 * rajah: AgentPlatform.GetAgentMemberGameReports（agent_back_office.rajah:367，
 * `@Permission "VentureAgent.Overview.Detail.MemberGameReport"`）。
 *
 * 分類依據 method-category-checklist.md 第 2 節「讀取清單」——回傳 `rows`+`totalPage`，
 * `AgentMemberGameReportSearchParams`（agent_common.rajah:1602-1622）以 agentId/accountName
 * 皆可鎖定單一目標，屬 A 級。8 個搜尋欄位在 rajah 與生成型別完全對齊，無落差。
 *
 * 回傳的 AgentMemberGameReportRow（agent_common.rajah:1638-1661）含 `lastLoginIp`（第 5 欄），
 * 比照 list_agent_report_details.ts 的處理方式，預設遮罩中間兩段，
 * revealLastLoginIp=true 才回傳完整值。userAccountName 為帳號字串，非真實姓名。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { AgentMemberGameReportSearchParams } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { deepFixLongs, maskIp } from '../const.ts';

export function registerListAgentMemberGameReportsTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_agent_platform_get_agent_member_game_reports',
        {
            title: "List one agent team's per-member game report rows",
            description:
                '分頁查詢某代理團隊會員的遊戲報表，一列一會員（rajah: ' +
                'AgentPlatform.GetAgentMemberGameReports，agent_back_office.rajah:367，需權限節點 ' +
                'VentureAgent.Overview.Detail.MemberGameReport）。agentId 必填，accountName 可精確鎖定單一會員。' +
                'brandId=0 或省略為全部品牌。isVentureAgent：0=全部(預設)/1=是/2=否。' +
                'relationType 是 VentureAgentStatTypeEnum：0=全部/1=直屬/2=團隊。' +
                'registerFrom 是 AgentMemberRegisterSourceEnum：0=全部(預設)/1=官方註冊/2=合營代理/' +
                '3=邀請好友/4=其他/5=上級合營代理代為註冊。' +
                '每列 gameTypeStats 是該會員各遊戲類型（GameDisplayTagEnum）的投注彙總陣列；' +
                'summary 是本次查詢條件下的整體彙總（memberWinLoseAmount/rebateAmount/' +
                'activityBonusAmount/memberActualProfitAmount）。' +
                'lastLoginIp 預設遮罩中間兩段（如 1.2.3.4 → 1.*.*.4），revealLastLoginIp=true 才回傳完整值——' +
                '不在既有 SensitiveFieldEnum 保護範圍內，屬本 tool 自行加上的保護（同 method-category-checklist.md ' +
                '第 8 節「一般 PII」判定，比照 list_agent_report_details.ts 的處理方式）。userAccountName 為帳號' +
                '字串，非真實姓名，不需額外遮罩。⚠️ ip 遮罩只認 4 段式 IPv4，非此格式（含 IPv6）原樣回傳、不遮罩。' +
                '⚠️ 分頁陷阱：totalPage 存在但無 totalRow；pageSize 只接受 10/20/30/50/100/200 ' +
                '這幾個離散值（PageSizeEnum，帶其他值後端回 errorCode=9）。' +
                '2026-08-26 dev 實測：agentId 不存在回 errorCode=2702 agentAgentNotFound；' +
                'statisticsDateStart/End 省略可正常查詢，不受 GetReports/GetReportDetails 的跨月限制。',
            inputSchema: {
                agentId: z.number().int().describe('代理 UID，必填'),
                accountName: z.string().optional().describe('用戶帳號，精確比對'),
                brandId: z.number().int().optional().describe('遊戲品牌 ID，0 或省略為全部'),
                statisticsDateStart: z.number().int().optional().describe('統計日期區間開始（epoch ms）'),
                statisticsDateEnd: z.number().int().optional().describe('統計日期區間結束（epoch ms）'),
                isVentureAgent: z.number().int().optional().describe('是否為代理：0=全部(預設)/1=是/2=否'),
                relationType: z.number().int().optional().describe('上級代理關係：0=全部/1=直屬/2=團隊'),
                registerFrom: z.number().int().optional().describe('註冊來源，AgentMemberRegisterSourceEnum'),
                page: z.number().int().min(1).default(1).describe('頁碼，從 1 開始'),
                pageSize: z.union([ z.literal(10), z.literal(20), z.literal(30), z.literal(50), z.literal(100), z.literal(200) ])
                    .default(50).describe('每頁筆數，PageSizeEnum 固定選項，僅接受 10/20/30/50/100/200'),
                revealLastLoginIp: z.boolean().default(false).describe('true 才回傳完整 lastLoginIp，預設遮罩'),
            },
        },
        async (input) => {
            const { page, pageSize, revealLastLoginIp, ...searchFields } = input;
            const searchParams = AgentMemberGameReportSearchParams.create(searchFields);
            const r = await withAutoRelogin(() => remote.agentBackOffice.agentPlatform.GetAgentMemberGameReports(searchParams, page, pageSize));
            if (r.failed) return asErrorResult(r);
            const rows = (r.data?.rows ?? []).map((row) => ({
                ...row,
                lastLoginIp: revealLastLoginIp ? row.lastLoginIp : maskIp(row.lastLoginIp),
            }));
            return asTextResult(deepFixLongs({
                success: true,
                summary: r.data?.summary,
                totalPage: r.data?.totalPage,
                rows,
            }));
        },
    );
}
