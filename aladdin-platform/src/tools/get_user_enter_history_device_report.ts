/**
 * tools/get_user_enter_history_device_report.ts — aladdin_platform_user_enter_history_platform_get_device_report
 *
 * rajah: UserEnterHistoryPlatform.GetDeviceReport（user_back_office.rajah:3349，
 * 需要 @Permission "ReportAnalysis.VisitReport.DeviceReport"）
 *
 * 2026-08-26 讀 agrabah 後端原始碼查證（user_enter_history.ts:134-144，共用同一段
 * queryLoginHistoryReport helper，與 get_domain_report.ts 完全同構）：
 * - domains/時間區間限制（跨度上限 92 天，⚠️ 鄰近 doc 註解誤寫 31 天，以程式碼字面量 92 天為準）、
 *   資料來源（MySQL `user_enter_histories`，非 StarRocks）與 domain report 一致，差別只在
 *   `GROUP BY device` 而非 `GROUP BY domain`。
 * - `device` 欄位（i32）確認是 `LoginDeviceEnum`：`DbUserEnterHistory.device` ORM 欄位型別即為
 *   `LoginDeviceEnum`（database_types/user.ts），資料源頭是 `AppUserEnter` job 的 `device` 欄位
 *   （rajah/jobs/app_user.rajah 同型別，寫入時原樣複製），非另一套編碼，本工具原樣格式化成字串。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { LOGIN_DEVICE_MAP, describeEnum } from '../const.ts';

export function registerGetUserEnterHistoryDeviceReportTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_user_enter_history_platform_get_device_report',
        {
            title: 'Get visit report grouped by device type',
            description:
                '查詢本平台「訪問報表」的設備分析（rajah: UserEnterHistoryPlatform.GetDeviceReport，' +
                'user_back_office.rajah:3349）。domains 選填，省略或空陣列＝不篩選（查全部域名）；' +
                '建議先用 aladdin_platform_user_enter_history_platform_get_app_domains 取得合法值清單。' +
                '⚠️ endTimestamp 必須大於 startTimestamp，且區間跨度上限 92 天，超過會回業務錯誤' +
                '（errorCode=invalidData），非例外。' +
                '回傳每列（依設備類型分組）含 device（LoginDeviceEnum：ios/android/pc/mac/unknown）、' +
                'guestVisited/userVisited（訪問次數，遊客/會員分開）、guestCount/userCount' +
                '（訪問人數，遊客/會員分開，依 device_id/user_id 去重計數），皆為原始計數、非佔比。',
            inputSchema: {
                domains: z.array(z.string()).optional().describe('要篩選的域名清單，建議先用 get_app_domains 取得合法值；省略或空陣列表示不篩選（查全部域名）'),
                startTimestamp: z.number().int().describe('查詢區間起點，毫秒 epoch，須小於 endTimestamp'),
                endTimestamp: z.number().int().describe('查詢區間終點，毫秒 epoch，與 startTimestamp 的跨度上限 92 天'),
            },
        },
        async ({ domains, startTimestamp, endTimestamp }) => {
            const r = await withAutoRelogin(() => remote.appUserBackOffice.userEnterHistoryPlatform.GetDeviceReport(domains ?? [], startTimestamp, endTimestamp));
            if (r.failed) return asErrorResult(r);
            return asTextResult({
                success: true,
                rows: (r.data?.rows ?? []).map((row) => {
                    const rr = row as unknown as Record<string, unknown>;
                    return { ...rr, device: describeEnum(LOGIN_DEVICE_MAP, rr.device as number) };
                }),
            });
        },
    );
}
