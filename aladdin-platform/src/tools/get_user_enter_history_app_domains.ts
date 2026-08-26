/**
 * tools/get_user_enter_history_app_domains.ts — aladdin_platform_user_enter_history_platform_get_app_domains
 *
 * rajah: UserEnterHistoryPlatform.GetAppDomains（user_back_office.rajah:3345，
 * 需要 @Permission "ReportAnalysis.VisitReport.DomainReport" 這類報表底下的存取權限，
 * 服務層級註解為 "ReportAnalysis"）——無參數，回傳本平台可用於訪問報表篩選的域名清單。
 *
 * ⚠️ 命名撞名提醒（非真正的同一支 RPC）：`CorePlatform` 另有一支同名的 `GetAppDomains(page)`
 * （remote.gen.ts:42065），但那是不同 service、不同簽名（帶分頁）、語意也不同（App 網域管理列表，
 * 非訪問報表篩選用途）。本工具三段式命名已含 service 段（user_enter_history_platform），
 * 與 core_platform 版本不會撞名，呼叫端務必看清楚 service 段避免叫錯。
 *
 * domains 回傳供 get_domain_report / get_device_report 兩支報表工具的 domains 參數使用。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerGetUserEnterHistoryAppDomainsTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_user_enter_history_platform_get_app_domains',
        {
            title: 'List app domains available for visit-report filtering',
            description:
                '取得本平台「訪問報表」（域名/設備/VIP/等級分析）可用的域名清單（rajah: ' +
                'UserEnterHistoryPlatform.GetAppDomains，user_back_office.rajah:3345）。無參數。' +
                '⚠️ 與 CorePlatform.GetAppDomains（不同 service，帶分頁，App 網域管理用途）是不同 RPC，不要混淆。' +
                '回傳的 domains 供 aladdin_platform_user_enter_history_platform_get_domain_report / ' +
                'aladdin_platform_user_enter_history_platform_get_device_report 的 domains 參數篩選用。',
            inputSchema: {},
        },
        async () => {
            const r = await withAutoRelogin(() => remote.appUserBackOffice.userEnterHistoryPlatform.GetAppDomains());
            if (r.failed) return asErrorResult(r);
            return asTextResult({ success: true, domains: r.data?.domains ?? [] });
        },
    );
}
