/**
 * tools/list_agent_bet_records.ts — aladdin_platform_agent_platform_get_agent_bet_records
 *
 * rajah: AgentPlatform.GetAgentBetRecords（agent_back_office.rajah:360，
 * `@Permission "VentureAgent.Overview.Detail.BetRecord"`）。
 *
 * 分類依據 method-category-checklist.md 第 2 節「讀取清單」——回傳 `rows`+`totalPage`，
 * `AgentBetRecordSearchParams`（agent_common.rajah:1510-1534）以 agentId/accountName/userId
 * 皆可鎖定單一目標，屬 A 級。10 個搜尋欄位在 rajah 與生成型別完全對齊，無落差。
 *
 * 回傳的 AgentBetRecordRow（agent_common.rajah:1538-1565）只有 userAccountName（帳號，非
 * realName）與注單/金額欄位，無 PII 需要遮罩（method-category-checklist.md 第 8 節）。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { AgentBetRecordSearchParams } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { deepFixLongs, GAME_DISPLAY_TAG_MAP } from '../const.ts';

export function registerListAgentBetRecordsTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_agent_platform_get_agent_bet_records',
        {
            title: "List one agent team's bet records",
            description:
                '分頁查詢某代理團隊會員的投注紀錄，一列一筆注單（rajah: AgentPlatform.GetAgentBetRecords，' +
                'agent_back_office.rajah:360，需權限節點 VentureAgent.Overview.Detail.BetRecord）。' +
                'agentId 必填，可搭配 accountName/userId 精確鎖定單一會員。' +
                `displayTag 是 GameDisplayTagEnum（-1=全部，其餘見 ${ JSON.stringify(GAME_DISPLAY_TAG_MAP) }）；` +
                'brandId=0 或省略為全部品牌。isVentureAgent：0=全部(預設)/1=是/2=否。' +
                'relationType 是 VentureAgentStatTypeEnum：0=全部/1=直屬/2=團隊。' +
                'registerFrom 是 AgentMemberRegisterSourceEnum：0=全部(預設)/1=官方註冊/2=合營代理/' +
                '3=邀請好友/4=其他/5=上級合營代理代為註冊。' +
                '⚠️ 2026-08-26 review 讀 agrabah/src/managers/agent_report_manager.ts:2193 原始碼註解' +
                '「本頁合計（ListGameRecords 未提供全量 sum）」確認：totalBetAmount/totalValidBetAmount/' +
                'totalWinAmount/totalMemberWinLoseAmount 是**當頁**合計，不是整個查詢條件下的全量加總，' +
                '換頁數字會變，不能當作「這個代理團隊總投注額」使用。' +
                'userAccountName 為帳號字串，非真實姓名，未發現需要遮罩的 PII。' +
                '⚠️ 分頁陷阱：totalPage 存在但無 totalRow；pageSize 只接受 10/20/30/50/100/200 ' +
                '這幾個離散值（PageSizeEnum，帶其他值後端回 errorCode=9）。' +
                '2026-08-26 dev 實測：agentId 不存在回 errorCode=2702 agentAgentNotFound（與 ' +
                'GetAgentGameReports 一致，但與 GetReportStatistics 的 errorCode=11 不同——同 service ' +
                '不同 method 對「代理不存在」用不同錯誤碼，呼叫端不能假設一致）；statisticsDateStart/End ' +
                '省略可正常查詢，不受 GetReports/GetReportDetails 的跨月限制。',
            inputSchema: {
                agentId: z.number().int().describe('代理 UID，必填'),
                accountName: z.string().optional().describe('用戶帳號，精確比對'),
                userId: z.number().int().optional().describe('用戶 ID，精確比對'),
                displayTag: z.number().int().optional().describe('遊戲類型，GameDisplayTagEnum，-1=全部'),
                brandId: z.number().int().optional().describe('遊戲品牌 ID，0 或省略為全部'),
                statisticsDateStart: z.number().int().optional().describe('統計日期區間開始（epoch ms）'),
                statisticsDateEnd: z.number().int().optional().describe('統計日期區間結束（epoch ms）'),
                isVentureAgent: z.number().int().optional().describe('是否為代理：0=全部(預設)/1=是/2=否'),
                relationType: z.number().int().optional().describe('上級代理關係：0=全部/1=直屬/2=團隊'),
                registerFrom: z.number().int().optional().describe('註冊來源，AgentMemberRegisterSourceEnum'),
                page: z.number().int().min(1).default(1).describe('頁碼，從 1 開始'),
                pageSize: z.union([ z.literal(10), z.literal(20), z.literal(30), z.literal(50), z.literal(100), z.literal(200) ])
                    .default(50).describe('每頁筆數，PageSizeEnum 固定選項，僅接受 10/20/30/50/100/200'),
            },
        },
        async (input) => {
            const { page, pageSize, ...searchFields } = input;
            const searchParams = AgentBetRecordSearchParams.create(searchFields);
            const r = await withAutoRelogin(() => remote.agentBackOffice.agentPlatform.GetAgentBetRecords(searchParams, page, pageSize));
            if (r.failed) return asErrorResult(r);
            return asTextResult(deepFixLongs({
                success: true,
                totalBetAmount: r.data?.totalBetAmount,
                totalValidBetAmount: r.data?.totalValidBetAmount,
                totalWinAmount: r.data?.totalWinAmount,
                totalMemberWinLoseAmount: r.data?.totalMemberWinLoseAmount,
                totalPage: r.data?.totalPage,
                rows: r.data?.rows ?? [],
            }));
        },
    );
}
