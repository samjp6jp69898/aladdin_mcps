/**
 * tools/view_agent_phone_number.ts — aladdin_platform_agent_platform_view_phone_number
 *
 * rajah: AgentPlatform.ViewPhoneNumber（agent_back_office.rajah:330-333，
 * `@Permission "VentureAgent.AgentList.Phone.View"` + `@Totp`，無參數）。
 *
 * 分類依據 method-category-checklist.md 第 9 節「驗證類不能單憑前綴斷定唯讀」——方法名叫
 * View，實際是**授權動作**：agrabah 後端實作（agent_platform.ts:57-65）只是把
 * Keys.showSensitiveInfoPhoneNumber(platformId, userId) 這個 Redis key set 成 '1'，
 * TTL 1 小時，不回傳任何手機號碼本身。呼叫本身不洩漏 PII，效果是讓目前登入身分接下來
 * 1 小時內，在其他清單/查詢 tool（尚未包裝）看到的代理會員手機號碼欄位從打碼變成明碼。
 * 冪等：重複呼叫只是把 TTL 重新設回 1 小時，不會報錯或疊加。
 *
 * 對應查詢用 aladdin_platform_agent_platform_get_phone_number_visibility 可確認目前是否仍在有效期內。
 *
 * 安全考量（method-category-checklist.md 第 8 節橫切分類）：rajah 已同時掛
 * `@Permission` 與 `@Totp`（二次驗證，需該平台路由設定生效才會真的被要求），保護層級比部分
 * 「只掛 @Permission 沒掛 @Totp」的密碼重設類 method 更完整，本 tool 不需額外補二次確認機制，
 * 但 description 明確標示「呼叫後 1 小時內會讓下游查詢顯示真實手機號碼」，避免呼叫端在不必要的
 * 情境下順手呼叫。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerViewAgentPhoneNumberTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_agent_platform_view_phone_number',
        {
            title: 'Authorize viewing unmasked agent member phone numbers for 1 hour',
            description:
                '開通目前登入操作者「查看代理會員手機號碼明碼」的授權，效期 1 小時' +
                '（rajah: AgentPlatform.ViewPhoneNumber，agent_back_office.rajah:330-333，' +
                '需權限節點 VentureAgent.AgentList.Phone.View，且掛 @Totp 二次驗證——是否真的要求驗證碼' +
                '取決於該平台路由的 TOTP 設定）。' +
                '**這支方法本身不回傳任何手機號碼**，success=true 只代表授權已開通；效果會反映在' +
                '其他顯示會員手機號碼的清單/查詢 method（目前尚未包裝成 MCP tool）——那些 method 在' +
                '這個授權有效期內會回傳明碼、過期後回傳打碼版本。' +
                '冪等：重複呼叫只是把有效期重新延長到「呼叫當下起 1 小時」，不會報錯，不會疊加多份授權。' +
                '可用 aladdin_platform_agent_platform_get_phone_number_visibility 查目前是否仍在有效期內。' +
                'rajah 目前沒有提供撤銷/提前關閉的 method，開通後只能等 1 小時 TTL 自然到期，無法主動收回。',
            inputSchema: {},
        },
        async () => {
            const r = await withAutoRelogin(() => remote.agentBackOffice.agentPlatform.ViewPhoneNumber());
            if (r.failed) return asErrorResult(r);
            return asTextResult({ success: r.data?.success ?? false });
        },
    );
}
