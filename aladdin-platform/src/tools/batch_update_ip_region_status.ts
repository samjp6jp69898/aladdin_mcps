/**
 * tools/batch_update_ip_region_status.ts — aladdin_platform_risk_platform_ip_region_batch_update_ip_region_status
 *
 * rajah: RiskPlatformIpRegion.BatchUpdateIpRegionStatus（risk_back_office.rajah:28，需要
 * @Permission "Risk.IpRestriction.GameIp.BatchUpdateStatus"）
 *
 * 2026-08-25 讀 agrabah 後端原始碼查證（risk_platform_ip_region.ts:334-379）：
 * - 非 transaction：單次批量 SELECT（`id IN (...) AND platform_id = ?`）+ 單次批量 UPDATE。
 * - 呼叫端帶的 ids 若不存在、或屬於別的平台，會在 SELECT 這步被排除，不進 UPDATE、也不進
 *   回傳的 success 陣列——無法從結果分辨「id 不存在」跟「id 屬於別平台」。
 * - 已經是目標狀態的 id 會被過濾掉，不執行實際 UPDATE、也不進 success 陣列（跟 UpdateIpRegionStatus
 *   單筆版的 no-op 語意一致，只是這裡是「從 success 清單中被排除」而非顯式成功回應）。
 * - `response.success` 只包含「真的從舊狀態被改成新狀態」的 id；輸入的 ids 裡沒出現在 success
 *   陣列中的，代表以下三種情況之一：id 不存在 / id 屬於別平台 / 已經是目標狀態——無法進一步區分。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { ACTIVE_STATUS_MAP } from '../const.ts';

export function registerBatchUpdateIpRegionStatusTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_risk_platform_ip_region_batch_update_ip_region_status',
        {
            title: 'Batch toggle IP/region restriction rules\' status',
            description:
                '批量切換多筆「限制遊戲 IP/地區」規則的啟用/停用狀態（rajah: ' +
                'RiskPlatformIpRegion.BatchUpdateIpRegionStatus，risk_back_office.rajah:28）。' +
                '⚠️ 部分成功語意：回傳的 success 只包含「真的從舊狀態被改成新狀態」的 id。' +
                '輸入的 id 若沒出現在 success 陣列中，代表下列三種情況之一，無法進一步區分：id 不存在 / id 屬於別平台 / ' +
                '該筆已經是目標狀態（no-op，非失敗）。若需要確認特定 id 為何沒被列入，建議另外用 ' +
                'aladdin_platform_risk_platform_ip_region_get_ip_region_list 查目前狀態核對。' +
                '這支不是 transaction（單次批量 SELECT 篩選存在且需要變更的 id，再單次批量 UPDATE），' +
                'ids 為空陣列時直接回成功、success 為空陣列，不呼叫後端。' +
                '單筆版本見 aladdin_platform_risk_platform_ip_region_update_ip_region_status。' +
                'prod 執行前確認：當這個 server 是正式環境（prod）時，執行本工具前必須先用 AskUserQuestion' +
                '（或功能相同的方式）明確詢問使用者是否要在正式環境執行這個操作，取得明確同意後才可以帶上 confirm 參數；' +
                '絕不能自行假設使用者同意。非 prod 環境（dev/pre/evi）不需要、也會忽略 confirm 欄位。',
            inputSchema: {
                ids: z.array(z.number().int()).describe('規則 id 陣列，從 get_ip_region_list 取得'),
                status: z.enum([ 'enabled', 'disabled' ]).describe('目標狀態'),
                confirm: z.string().optional().describe(
                    `正式環境（prod）專用的強制確認欄位；非 prod 環境會被忽略、不需提供。當這個 server 是正式環境時，` +
                    `必須先取得使用者明確同意，再帶上精確字串 "${ PROD_CONFIRM_TOKEN }" 才會執行，否則本工具會拒絕執行並回錯誤。`,
                ),
            },
        },
        async ({ ids, status, confirm }) => {
            assertProdConfirmed(confirm);
            const r = await withAutoRelogin(() => remote.riskBackOffice.riskPlatformIpRegion.BatchUpdateIpRegionStatus(ids, ACTIVE_STATUS_MAP[ status ]));
            if (r.failed) return asErrorResult(r);
            const succeeded = r.data?.success ?? [];
            const notApplied = ids.filter((id) => !succeeded.includes(id));
            return asTextResult({
                success: true,
                succeeded,
                notApplied,
                note: notApplied.length > 0
                    ? 'notApplied 裡的 id：不存在、不屬於當前平台、或已經是目標狀態，三者無法從結果區分'
                    : undefined,
            });
        },
    );
}
