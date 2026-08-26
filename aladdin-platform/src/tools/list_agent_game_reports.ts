/**
 * tools/list_agent_game_reports.ts — aladdin_platform_agent_platform_get_agent_game_reports
 *
 * rajah: AgentPlatform.GetAgentGameReports（agent_back_office.rajah:358，
 * `@Permission "VentureAgent.Overview.Detail.GameReport"`）。
 *
 * 分類依據 method-category-checklist.md 第 2 節「讀取清單」——回傳 `rows`+`totalPage`，
 * `AgentGameReportSearchParams`（agent_common.rajah:1679-1691）以 `agentId` 為主鍵，屬 A 級。
 * 5 個搜尋欄位在 rajah 與生成型別完全對齊，無落差。
 *
 * 回傳的 AgentGameReportRow/AgentGameReportSummary（agent_common.rajah:1694-1738）只有
 * 遊戲品牌統計數字，無 PII 欄位。
 *
 * 2026-08-26 dev 實測：agentId 不存在回 errorCode=2702 agentAgentNotFound（與同 service
 * GetReportStatistics 的 errorCode=11 不同）；statisticsDateStart/End 省略可正常查詢，不受
 * 同 service GetReports/GetReportDetails 的跨月限制。
 *
 * ⚠️ 2026-08-26 review 發現的真實 bug（已修正）：`displayTag` 是裸 proto3 `int32`（無 presence
 * 追蹤，agrabah/src/generated/types_trim.gen.proto:15645），省略時解碼為 `0` 而非 `-1`；後端
 * agrabah/src/managers/agent_report_manager.ts:2389 用 `searchParams.displayTag ?? -1`（`??`
 * 不攔截 `0`），:266 用 `filters.displayTag !== -1 && displayTag !== filters.displayTag` 過濾——
 * 兩者相加，省略 displayTag 實際上會被當成「只要 displayTag===0（slot 之外的未分類值）」篩選，
 * 幾乎篩光所有品牌，不是原本設計語意的「全部」。zod schema 已加 `.default(-1)` 修正此陷阱。
 * 另外 statisticsDateStart/End 省略時後端預設抓「最近 7 天」（_resolveReportDateRange，
 * agent_report_manager.ts:2046-2050），不是「全部歷史」，description 已補充。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { AgentGameReportSearchParams } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { deepFixLongs, GAME_DISPLAY_TAG_MAP } from '../const.ts';

export function registerListAgentGameReportsTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_agent_platform_get_agent_game_reports',
        {
            title: "List one agent's per-brand game report rows",
            description:
                '分頁查詢某代理團隊會員的遊戲報表——每列一個遊戲品牌的統計（rajah: ' +
                'AgentPlatform.GetAgentGameReports，agent_back_office.rajah:358，需權限節點 ' +
                'VentureAgent.Overview.Detail.GameReport）。agentId 必填。' +
                `displayTag 是 GameDisplayTagEnum（不帶時預設 -1=全部，其餘見 ${ JSON.stringify(GAME_DISPLAY_TAG_MAP) }）；` +
                '⚠️ 此欄位是裸 proto3 int32 沒有 presence 追蹤，省略若未預設 -1 會被後端解成 0 造成幾乎篩光' +
                '所有品牌（2026-08-26 review 發現的真實陷阱，見檔頭註解），本 tool 已用 zod default(-1) 防呆。' +
                'brandId=0 或省略為全部品牌，需先從其他管道取得合法值。' +
                '⚠️ statisticsDateStart/End 省略時後端預設只抓最近 7 天，不是全部歷史，需要更長區間務必明確帶入。' +
                '回傳除逐列 rows（各品牌統計）外還有 summary（跨品牌彙總）。無 PII 欄位。' +
                '⚠️ 分頁陷阱：回傳沒有 totalRow，只有 totalPage；pageSize 只接受 10/20/30/50/100/200 ' +
                '這幾個離散值（PageSizeEnum，帶其他值後端回 errorCode=9）。' +
                '2026-08-26 dev 實測：agentId 不存在時回業務錯誤 errorCode=2702 agentAgentNotFound' +
                '（與同 service 的 GetReportStatistics 用 errorCode=11 "Agent not found" 不同，' +
                '兩支對「代理不存在」用不同錯誤碼，呼叫端不能假設一致）；statisticsDateStart/End 省略' +
                '可正常查詢（不受同 service 其他方法的跨月限制）。修正 displayTag 預設值 bug 後重測仍回傳空結果，' +
                '確認該代理在 dev 環境確實無遊戲注單紀錄，非本 tool 缺陷。',
            inputSchema: {
                agentId: z.number().int().describe('代理 UID，必填'),
                displayTag: z.number().int().default(-1).describe('遊戲類型，GameDisplayTagEnum，-1=全部（必須明確帶 -1，省略在後端會被當成 0 而非全部）'),
                brandId: z.number().int().optional().describe('遊戲品牌 ID，0 或省略為全部'),
                statisticsDateStart: z.number().int().optional().describe('統計日期區間開始（epoch ms）'),
                statisticsDateEnd: z.number().int().optional().describe('統計日期區間結束（epoch ms）'),
                page: z.number().int().min(1).default(1).describe('頁碼，從 1 開始'),
                pageSize: z.union([ z.literal(10), z.literal(20), z.literal(30), z.literal(50), z.literal(100), z.literal(200) ])
                    .default(50).describe('每頁筆數，PageSizeEnum 固定選項，僅接受 10/20/30/50/100/200'),
            },
        },
        async (input) => {
            const { page, pageSize, ...searchFields } = input;
            const searchParams = AgentGameReportSearchParams.create(searchFields);
            const r = await withAutoRelogin(() => remote.agentBackOffice.agentPlatform.GetAgentGameReports(searchParams, page, pageSize));
            if (r.failed) return asErrorResult(r);
            return asTextResult(deepFixLongs({
                success: true,
                summary: r.data?.summary,
                totalPage: r.data?.totalPage,
                rows: r.data?.rows ?? [],
            }));
        },
    );
}
