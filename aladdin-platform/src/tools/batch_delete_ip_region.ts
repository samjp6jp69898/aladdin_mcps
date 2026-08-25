/**
 * tools/batch_delete_ip_region.ts — aladdin_platform_risk_platform_ip_region_batch_delete_ip_region
 *
 * rajah: RiskPlatformIpRegion.BatchDeleteIpRegion（risk_back_office.rajah:34，需要
 * @Permission "Risk.IpRestriction.GameIp.BatchDelete"）
 *
 * 2026-08-25 讀 agrabah 後端原始碼查證（risk_platform_ip_region.ts:448-488）：
 * - **硬刪除**，非軟刪除，刪除後無法復原。
 * - 非 transaction：單次批量 SELECT（`id IN (...) AND platform_id = ?`，同時取 audit 快照欄位）+
 *   單次批量 DELETE，兩者操作同一組「真的存在且屬於當前平台」的 id 集合。
 * - `response.success` 只包含「真的存在且屬於當前平台、因此真的被刪除」的 id；輸入的 ids 裡不存在
 *   或屬於別平台的，不會出現在 success 陣列裡，也不會被誤刪，但無法從結果分辨兩者。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerBatchDeleteIpRegionTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_risk_platform_ip_region_batch_delete_ip_region',
        {
            title: 'Batch delete IP/region game-access restriction rules (hard delete)',
            description:
                '批量刪除多筆「限制遊戲 IP/地區」規則（rajah: RiskPlatformIpRegion.BatchDeleteIpRegion，' +
                'risk_back_office.rajah:34）。⚠️ 硬刪除，非軟刪除，刪除後無法復原，執行前請跟操作者確認清楚。' +
                '⚠️ 部分成功語意：回傳的 success 只包含「真的存在且屬於當前平台、因此真的被刪除」的 id。' +
                '輸入的 id 若沒出現在 success 陣列中，代表該 id 不存在或屬於別的平台，無法從結果進一步區分，' +
                '但可確定沒有被誤刪（後端只刪除真的查到的那組 id）。' +
                '單筆版本見 aladdin_platform_risk_platform_ip_region_delete_ip_region。' +
                'prod 執行前確認：當這個 server 是正式環境（prod）時，執行本工具前必須先用 AskUserQuestion' +
                '（或功能相同的方式）明確詢問使用者是否要在正式環境執行這個操作，取得明確同意後才可以帶上 confirm 參數；' +
                '絕不能自行假設使用者同意。非 prod 環境（dev/pre/evi）不需要、也會忽略 confirm 欄位。',
            inputSchema: {
                ids: z.array(z.number().int()).describe('規則 id 陣列，從 get_ip_region_list 取得'),
                confirm: z.string().optional().describe(
                    `正式環境（prod）專用的強制確認欄位；非 prod 環境會被忽略、不需提供。當這個 server 是正式環境時，` +
                    `必須先取得使用者明確同意，再帶上精確字串 "${ PROD_CONFIRM_TOKEN }" 才會執行，否則本工具會拒絕執行並回錯誤。`,
                ),
            },
        },
        async ({ ids, confirm }) => {
            assertProdConfirmed(confirm);
            const r = await withAutoRelogin(() => remote.riskBackOffice.riskPlatformIpRegion.BatchDeleteIpRegion(ids));
            if (r.failed) return asErrorResult(r);
            const succeeded = r.data?.success ?? [];
            const notFound = ids.filter((id) => !succeeded.includes(id));
            return asTextResult({
                success: true,
                deleted: succeeded,
                notFound: notFound.length > 0 ? notFound : undefined,
                note: notFound.length > 0 ? 'notFound 裡的 id：不存在或不屬於當前平台，沒有被誤刪' : undefined,
            });
        },
    );
}
