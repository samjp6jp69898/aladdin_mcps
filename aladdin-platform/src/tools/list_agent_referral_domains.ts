/**
 * tools/list_agent_referral_domains.ts — aladdin_platform_agent_platform_list_referral_domains
 *
 * rajah: AgentPlatform.ListReferralDomains（agent_back_office.rajah:407，服務層級
 * `@Permission "VentureAgent"`，method 本身無額外 @Permission）。
 *
 * 分類依據 method-category-checklist.md 第 1 節「讀取單筆/複合 key」——用 agentId 換回該代理
 * 全部推廣域名（ReferralDomain[]，agent_back_office.rajah:1216-1225），非分頁清單，一次全撈。
 * 無 PII 欄位（id/agentId/domain/createdAtTimestamp）。
 *
 * 用途：查某代理目前綁定的推廣域名與各自的 id，供之後呼叫 DeleteReferralDomain（referralDomainId）
 * 或核對 AddReferralDomain 新增結果使用（本輪這兩支寫入 method 因後端 validateAgentStatus() 卡點
 * 已標記 needs_clarification，暫未包裝）。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { deepFixLongs } from '../const.ts';

export function registerListAgentReferralDomainsTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_agent_platform_list_referral_domains',
        {
            title: "List an agent's referral domains",
            description:
                '列出指定代理目前綁定的推廣域名清單（rajah: AgentPlatform.ListReferralDomains，' +
                'agent_back_office.rajah:407）。agentId 必填，無分頁，一次回傳全部。' +
                '無 PII 欄位。2026-08-26 dev 實測：agentId 不存在時回傳空陣列而非錯誤，無法用空結果' +
                '判斷 agentId 是否真的存在，需另外用查代理清單的 method 確認。',
            inputSchema: {
                agentId: z.number().int().describe('代理 UID，必填'),
            },
        },
        async ({ agentId }) => {
            const r = await withAutoRelogin(() => remote.agentBackOffice.agentPlatform.ListReferralDomains(agentId));
            if (r.failed) return asErrorResult(r);
            return asTextResult(deepFixLongs({ success: true, referralDomains: r.data?.referralDomains ?? [] }));
        },
    );
}
