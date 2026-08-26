/**
 * tools/delete_ip_region.ts — aladdin_platform_risk_platform_ip_region_delete_ip_region
 *
 * rajah: RiskPlatformIpRegion.DeleteIpRegion（risk_back_office.rajah:31，需要
 * @Permission "Risk.IpRestriction.GameIp.Ops.Delete"）
 *
 * 2026-08-25 讀 agrabah 後端原始碼查證（risk_platform_ip_region.ts:384-412 的私有 deleteIpRegion()）：
 * - **硬刪除**：`DELETE FROM platform_risk_ip_regions WHERE id = ? AND platform_id = ?`，非軟刪除，
 *   刪除後這筆規則無法復原、也不會出現在 get_ip_region_list 的結果裡。
 * - 刪除前先查驗 id + platform_id 是否存在（供 audit log 快照欄位用），不存在回 errorCode=idNotExists
 *   （非拋例外），不會對別平台的 id 或不存在的 id 執行任何 DELETE。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerDeleteIpRegionTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_risk_platform_ip_region_delete_ip_region',
        {
            title: 'Delete an IP/region game-access restriction rule (hard delete)',
            description:
                '刪除單一「限制遊戲 IP/地區」規則（rajah: RiskPlatformIpRegion.DeleteIpRegion，risk_back_office.rajah:31）。' +
                '⚠️ 硬刪除，非軟刪除：刪除後無法復原，也不會再出現在 get_ip_region_list 的結果裡，執行前請跟操作者確認清楚。' +
                'id 從 aladdin_platform_risk_platform_ip_region_get_ip_region_list 取得，只能刪除當前登入平台自己的規則' +
                '（後端強制 platform_id 過濾）。id 不存在或屬於別平台時回業務錯誤（idNotExists），非例外、不會誤刪。' +
                '批量版本見 aladdin_platform_risk_platform_ip_region_batch_delete_ip_region。' +
                'prod 執行前確認：當這個 server 是正式環境（prod）時，執行本工具前必須先用 AskUserQuestion' +
                '（或功能相同的方式）明確詢問使用者是否要在正式環境執行這個操作，取得明確同意後才可以帶上 confirm 參數；' +
                '絕不能自行假設使用者同意。非 prod 環境（dev/pre/evi）不需要、也會忽略 confirm 欄位。',
            inputSchema: {
                id: z.number().int().describe('規則 id，從 get_ip_region_list 取得'),
                confirm: z.string().optional().describe(
                    `正式環境（prod）專用的強制確認欄位；非 prod 環境會被忽略、不需提供。當這個 server 是正式環境時，` +
                    `必須先取得使用者明確同意，再帶上精確字串 "${ PROD_CONFIRM_TOKEN }" 才會執行，否則本工具會拒絕執行並回錯誤。`,
                ),
            },
        },
        async ({ id, confirm }) => {
            assertProdConfirmed(confirm);
            const r = await withAutoRelogin(() => remote.riskBackOffice.riskPlatformIpRegion.DeleteIpRegion(id));
            if (r.failed) return asErrorResult(r);
            return asTextResult({ success: true, message: '刪除成功' });
        },
    );
}
