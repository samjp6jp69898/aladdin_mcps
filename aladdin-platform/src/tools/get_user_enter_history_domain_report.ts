/**
 * tools/get_user_enter_history_domain_report.ts — aladdin_platform_user_enter_history_platform_get_domain_report
 *
 * rajah: UserEnterHistoryPlatform.GetDomainReport（user_back_office.rajah:3347，
 * 需要 @Permission "ReportAnalysis.VisitReport.DomainReport"）
 *
 * 2026-08-26 讀 agrabah 後端原始碼查證（user_enter_history.ts:108-118 → 共用 helper
 * queryLoginHistoryReport，:27-51）：
 * - domains **非必填**：空陣列＝不篩選域名（查全部），不帶等同空陣列。
 * - 時間區間有硬性限制：`endTimestamp <= startTimestamp` 直接回 errorCode=invalidData；
 *   區間跨度 **上限 92 天**（程式碼字面量是 `TimezoneHelper.oneDay * 92`，⚠️ 檔案內鄰近的
 *   doc 註解寫「31 天」與程式碼實際值不符，本工具的 description 以實測/程式碼字面量的 92 天為準）。
 * - 資料來源是 MySQL 表 `user_enter_histories`（非 StarRocks），依 `platform_id` + 時間區間
 *   （+ 選填 domain IN）過濾、`GROUP BY domain` 聚合；guest 判定為 `userId=0`、member 為
 *   `userId>0`，兩者分別用 device_id/user_id 去重計數。
 * - domains 建議先用 aladdin_platform_user_enter_history_platform_get_app_domains 取得合法值清單，
 *   但不帶或帶空陣列並非錯誤，是「查全部域名」的合法用法。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerGetUserEnterHistoryDomainReportTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_user_enter_history_platform_get_domain_report',
        {
            title: 'Get visit report grouped by domain',
            description:
                '查詢本平台「訪問報表」的域名分析（rajah: UserEnterHistoryPlatform.GetDomainReport，' +
                'user_back_office.rajah:3347）。domains 選填，省略或空陣列＝不篩選（查全部域名）；' +
                '建議先用 aladdin_platform_user_enter_history_platform_get_app_domains 取得合法值清單。' +
                '⚠️ endTimestamp 必須大於 startTimestamp，且區間跨度上限 92 天，超過會回業務錯誤' +
                '（errorCode=invalidData），非例外。' +
                '回傳每列（依 domain 分組）含 guestVisited/userVisited（訪問次數，遊客/會員分開）、' +
                'guestCount/userCount（訪問人數，遊客/會員分開，依 device_id/user_id 去重計數），皆為原始計數、非佔比。',
            inputSchema: {
                domains: z.array(z.string()).optional().describe('要篩選的域名清單，建議先用 get_app_domains 取得合法值；省略或空陣列表示不篩選（查全部域名）'),
                startTimestamp: z.number().int().describe('查詢區間起點，毫秒 epoch，須小於 endTimestamp'),
                endTimestamp: z.number().int().describe('查詢區間終點，毫秒 epoch，與 startTimestamp 的跨度上限 92 天'),
            },
        },
        async ({ domains, startTimestamp, endTimestamp }) => {
            const r = await withAutoRelogin(() => remote.appUserBackOffice.userEnterHistoryPlatform.GetDomainReport(domains ?? [], startTimestamp, endTimestamp));
            if (r.failed) return asErrorResult(r);
            return asTextResult({ success: true, rows: r.data?.rows ?? [] });
        },
    );
}
