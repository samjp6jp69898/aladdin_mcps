/**
 * tools/update_ip_region_status.ts — aladdin_platform_risk_platform_ip_region_update_ip_region_status
 *
 * rajah: RiskPlatformIpRegion.UpdateIpRegionStatus（risk_back_office.rajah:25，需要
 * @Permission "Risk.IpRestriction.GameIp.Status.ToggleStatus"）——只切換單一規則的 status，
 * 不動其他欄位。
 *
 * 2026-08-25 讀 agrabah 後端原始碼查證（risk_platform_ip_region.ts:258-293 的私有 updateStatus()）：
 * - 目標 status 非法（非 ActiveStatusEnum 值）時回 errorCode=invalidData。
 * - id 不存在或屬於別平台（`WHERE id = ? AND platform_id = ?`）時回 errorCode=idNotExists（非拋例外）。
 * - **同值呼叫是明確的 no-op**：後端會先查目前 status，若與目標值相同直接回成功、完全不執行 UPDATE
 *   （不像純 SQL UPDATE 那樣依賴 MySQL affectedRows 語意），可放心重複呼叫同一個目標狀態。
 * - 影響列數 0（理論上只會在同值判斷之外的競態下發生）回 errorCode=objectNotFound。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { ACTIVE_STATUS_MAP } from '../const.ts';

export function registerUpdateIpRegionStatusTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_risk_platform_ip_region_update_ip_region_status',
        {
            title: 'Toggle an IP/region restriction rule\'s enabled/disabled status',
            description:
                '切換單一「限制遊戲 IP/地區」規則的啟用/停用狀態（rajah: RiskPlatformIpRegion.UpdateIpRegionStatus，' +
                'risk_back_office.rajah:25）。只改 status，不動其他欄位。' +
                'id 從 aladdin_platform_risk_platform_ip_region_get_ip_region_list 取得，只能操作當前登入平台自己的規則' +
                '（後端強制 platform_id 過濾）。' +
                'status 合法值（rajah ActiveStatusEnum）：enabled（1，啟用）/ disabled（2，停用）。' +
                '同值呼叫是明確的 no-op（後端先查現況，相同則直接回成功、不執行實際 UPDATE），可放心重複呼叫。' +
                'id 不存在或屬於別平台時回業務錯誤（idNotExists），非例外。' +
                '批量版本見 aladdin_platform_risk_platform_ip_region_batch_update_ip_region_status。' +
                'prod 執行前確認：當這個 server 是正式環境（prod）時，執行本工具前必須先用 AskUserQuestion' +
                '（或功能相同的方式）明確詢問使用者是否要在正式環境執行這個操作，取得明確同意後才可以帶上 confirm 參數；' +
                '絕不能自行假設使用者同意。非 prod 環境（dev/pre/evi）不需要、也會忽略 confirm 欄位。',
            inputSchema: {
                id: z.number().int().describe('規則 id，從 get_ip_region_list 取得'),
                status: z.enum([ 'enabled', 'disabled' ]).describe('目標狀態'),
                confirm: z.string().optional().describe(
                    `正式環境（prod）專用的強制確認欄位；非 prod 環境會被忽略、不需提供。當這個 server 是正式環境時，` +
                    `必須先取得使用者明確同意，再帶上精確字串 "${ PROD_CONFIRM_TOKEN }" 才會執行，否則本工具會拒絕執行並回錯誤。`,
                ),
            },
        },
        async ({ id, status, confirm }) => {
            assertProdConfirmed(confirm);
            const r = await withAutoRelogin(() => remote.riskBackOffice.riskPlatformIpRegion.UpdateIpRegionStatus(id, ACTIVE_STATUS_MAP[ status ]));
            if (r.failed) return asErrorResult(r);
            return asTextResult({ success: true, message: '更新成功' });
        },
    );
}
