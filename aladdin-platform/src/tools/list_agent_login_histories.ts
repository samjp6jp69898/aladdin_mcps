/**
 * tools/list_agent_login_histories.ts — aladdin_platform_agent_platform_get_agent_login_histories
 *
 * rajah: AgentPlatform.GetAgentLoginHistories（agent_back_office.rajah:387，
 * `@Permission "VentureAgent.AgentLoginHistories"`）。
 *
 * 分類依據 method-category-checklist.md 第 2 節「讀取清單」——回傳 `rows`+`totalPage`+`totalRow`，
 * `AgentLoginHistorySearch`（agent_back_office.rajah:161-178）以 `identifier`/`appUserId` 可鎖定
 * 單一目標，屬 A 級。8 個欄位（含內嵌的 page/pageSize，這支方法把分頁參數放進 search model 本身，
 * 不像同 service 其他方法是獨立的 method 參數）在 rajah 與生成型別完全對齊。
 *
 * ⚠️ 2026-08-26 讀源碼發現的重要語意落差：儘管掛在 `VentureAgent`（代理）權限模組底下，
 * agrabah/src/servers/agent_back_office/services/agent_platform.ts:612-693 的實作**完全沒有
 * agentId 篩選條件**，只用 `context.platformId` 限定——查詢範圍是「整個平台底下所有 App User
 * （不分是否為代理/代理下線）的登入紀錄」，不是「某代理團隊底下會員的登入紀錄」。名稱與權限樹
 * 位置容易誤導成「查某代理的登入紀錄」，實際上任何有此權限節點的操作者都能查到全平台任何會員的
 * 登入紀錄，與呼叫端是哪個代理無關。`identifier` 是會員（App User）登入帳號，不是代理帳號。
 *
 * appUserId 是外部可見 id（string），後端內部會先查表換成 user_login_histories 用的內部 id
 * （userIdToAgentId，agrabah/.../models/app_user_id.ts:66），查無對應時回空結果而非錯誤。
 * lastLoginIp 是精確比對（INET6_ATON 完全相等），origin 才是模糊比對（LIKE）。
 *
 * 回傳的 ip 欄位是登入 IP，屬 method-category-checklist.md 第 8 節「一般 PII」，比照
 * list_agent_report_details.ts 的處理方式預設遮罩，revealIp=true 才回傳完整值。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { AgentLoginHistorySearch } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { deepFixLongs, maskIp } from '../const.ts';

export function registerListAgentLoginHistoriesTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_agent_platform_get_agent_login_histories',
        {
            title: 'List app user login histories (platform-wide, not agent-scoped)',
            description:
                '分頁查詢會員（App User）的登入紀錄（rajah: AgentPlatform.GetAgentLoginHistories，' +
                'agent_back_office.rajah:387，需權限節點 VentureAgent.AgentLoginHistories）。' +
                '⚠️ 重要：儘管掛在代理權限模組底下，2026-08-26 讀源碼確認實作完全沒有 agentId 篩選，' +
                '查詢範圍是「目前登入平台底下全部會員的登入紀錄」，不限於任何特定代理的下線會員——' +
                '不要假設這支只回傳「該代理團隊」的資料。' +
                'identifier 是會員登入帳號（非代理帳號），appUserId 是會員外部 id（字串），查無對應' +
                '內部紀錄時回空結果非錯誤。lastLoginIp（搜尋條件）是精確比對（完全相等），origin 是模糊比對' +
                '（LIKE）；回傳欄位叫 ip，跟搜尋條件 lastLoginIp 是同一個概念，只是 rajah model 命名不同源' +
                '（AgentLoginHistorySearch.lastLoginIp vs AgentLoginHistory.ip），不是兩件事。' +
                '固定只回傳 remark ∈ {登入成功/密碼錯誤/驗證失敗} 三種狀態，其餘登入狀態不會出現。' +
                'ip 欄位預設遮罩中間兩段（如 1.2.3.4 → 1.*.*.4），revealIp=true 才回傳完整值——' +
                '不在既有 SensitiveFieldEnum 保護範圍內，屬本 tool 自行加上的保護。' +
                '⚠️ 只認 4 段式 IPv4，非此格式（含 IPv6，agent_login_histories 用 INET6_ATON 儲存，' +
                '理論上可存 IPv6）原樣回傳、不遮罩。' +
                'page/pageSize 是內嵌在搜尋參數裡（與同 service 其他分頁方法不同，那些是獨立的 method 參數）；' +
                'pageSize 只接受 10/20/30/50/100/200 這幾個離散值（PageSizeEnum）。' +
                '回傳同時有 totalPage 與 totalRow，可直接用 totalRow 判斷筆數，不受無 totalRow 的' +
                '分頁陷阱影響（與同 service 多數方法不同）。' +
                '超長時間區間等邊界情境未實測驗證，呼叫端應留意。',
            inputSchema: {
                identifier: z.string().optional().describe('會員登入帳號，精確比對（完全相等）'),
                appUserId: z.string().optional().describe('會員外部 id（字串），精確比對，查無對應回空結果'),
                lastLoginIp: z.string().optional().describe('登入 IP，精確比對（完全相等）'),
                origin: z.string().optional().describe('登入網址，模糊比對（LIKE）'),
                createdStartAtTimestamp: z.number().int().optional().describe('登入時間區間開始（epoch ms）'),
                createdEndAtTimestamp: z.number().int().optional().describe('登入時間區間結束（epoch ms）'),
                page: z.number().int().min(1).default(1).describe('頁碼，從 1 開始'),
                pageSize: z.union([ z.literal(10), z.literal(20), z.literal(30), z.literal(50), z.literal(100), z.literal(200) ])
                    .default(50).describe('每頁筆數，PageSizeEnum 固定選項，僅接受 10/20/30/50/100/200'),
                revealIp: z.boolean().default(false).describe('true 才回傳完整 ip，預設遮罩'),
            },
        },
        async (input) => {
            const { revealIp, ...searchFields } = input;
            const params = AgentLoginHistorySearch.create(searchFields);
            const r = await withAutoRelogin(() => remote.agentBackOffice.agentPlatform.GetAgentLoginHistories(params));
            if (r.failed) return asErrorResult(r);
            const rows = (r.data?.rows ?? []).map((row) => ({
                ...row,
                ip: revealIp ? row.ip : maskIp(row.ip),
            }));
            return asTextResult(deepFixLongs({
                success: true,
                totalPage: r.data?.totalPage,
                totalRow: r.data?.totalRow,
                rows,
            }));
        },
    );
}
