/**
 * tools/get_agent_phone_number_visibility.ts — aladdin_platform_agent_platform_get_phone_number_visibility
 *
 * rajah: AgentPlatform.GetPhoneNumberVisibility（agent_back_office.rajah:330，無 @Permission、無參數）。
 *
 * 分類依據 method-category-checklist.md 第 1 節「讀取單筆」——不是全域設定，是查詢「目前登入的操作者
 * 對代理會員手機號碼欄位的臨時可視性授權」是否仍有效（開關狀態）。
 *
 * agrabah 後端實作（agrabah/src/servers/agent_back_office/services/agent_platform.ts:68-71）：
 *   response.visible = await context._engines.cache.exists(Keys.showSensitiveInfoPhoneNumber(context.platformId, context.userId))
 * 純讀 Redis cache key 是否存在，非 placeholder。此 key 由同 service 的 ViewPhoneNumber
 * （@Permission "VentureAgent.AgentList.Phone.View"、@Totp）寫入，TTL 1 小時
 * （agent_platform.ts:58-66）。也就是說：
 *   - 這支方法只回傳「目前登入身分（platformId + userId）」的授權快照，沒有任何輸入參數，
 *     不能查詢別的操作者或別的平台。
 *   - 回傳 visible=true 代表 1 小時內曾成功呼叫過 ViewPhoneNumber（且未過期）；預設/過期後為 false。
 *   - 本輪只包這支唯讀查詢 tool，不包 ViewPhoneNumber 本身——它掛 @Totp 且是取得授權的動作，
 *     不是單純查詢，需要另外評估二次驗證流程後再決定是否包裝。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerGetAgentPhoneNumberVisibilityTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_agent_platform_get_phone_number_visibility',
        {
            title: "Check current operator's temporary phone-number reveal authorization",
            description:
                '查詢目前登入的平台操作者，對代理會員手機號碼欄位的「臨時可視性授權」是否仍有效' +
                '（rajah: AgentPlatform.GetPhoneNumberVisibility，agent_back_office.rajah:330，無參數、無 @Permission）。' +
                '後端讀取 Redis cache key（context.platformId + context.userId 組成），此 key 由 ' +
                'ViewPhoneNumber（掛 @Totp，未包裝為本 MCP tool）寫入，TTL 1 小時。' +
                '回傳 visible=true 代表 1 小時內曾成功查看過、目前仍在有效期內；false 代表尚未授權或已過期。' +
                '無參數，不能查詢其他操作者或其他平台的授權狀態——後端只認目前登入身分。',
            inputSchema: {},
        },
        async () => {
            const r = await withAutoRelogin(() => remote.agentBackOffice.agentPlatform.GetPhoneNumberVisibility());
            if (r.failed) return asErrorResult(r);
            return asTextResult({ success: true, visible: r.data?.visible ?? false });
        },
    );
}
