/**
 * tools/export_registration_ip_quotas.ts — aladdin_platform_app_user_ip_quota_platform_export_registration_ip_quotas
 *
 * rajah: AppUserIpQuotaPlatform.ExportRegistrationIpQuotas（user_back_office.rajah:570，
 * 需要 @Permission "Risk.IpRestriction.SameIp.Export"，獨立於 .SameIp 之外的權限節點）
 *
 * 2026-08-26 讀 agrabah 後端原始碼查證（app_user_ip_quota_platform.ts:101-123）：
 * - **與 ListRegistrationIpQuotas 完全共用同一段程式碼**（邊界檢查、
 *   RegistrationIpQuotaManager.listRecords() 呼叫皆相同），差別只在獨立掛 .Export 權限節點、
 *   純讀取不寫 audit、不清 cache。屬於 method-category-checklist.md 第 10 節「Export 模式 1：
 *   同步直出」，非非同步 Job 模式，可直接包裝，不需要輪詢。
 * - 搜尋條件/分頁行為/pageSize 上限（200，超過明確拒絕）與 list 工具完全一致，見
 *   list_registration_ip_quotas.ts 檔頭註解，本檔案不重複展開，共用同一組 buildSearch/format 函式。
 * - 供 export_back_office 匯出任務分批取資料設計，呼叫端若要匯出全量資料需自行逐頁呼叫。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { listRegistrationIpQuotasInput, buildRegistrationIpQuotaSearch, formatRegistrationIpQuotaRow } from './list_registration_ip_quotas.ts';

export function registerExportRegistrationIpQuotasTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_app_user_ip_quota_platform_export_registration_ip_quotas',
        {
            title: 'Export registration IP quota records',
            description:
                '匯出本平台「註冊 IP 配額」紀錄（rajah: AppUserIpQuotaPlatform.ExportRegistrationIpQuotas，' +
                'user_back_office.rajah:570）。搜尋條件、分頁行為（pageSize 上限 200、totalPage 只有 page=1 才計算' +
                '等）與 aladdin_platform_app_user_ip_quota_platform_list_registration_ip_quotas 完全一致——' +
                '後端這支與 List 共用同一段查詢邏輯，唯一差別是獨立掛 .Export 權限節點、不寫 audit log，' +
                '供匯出任務分批取資料用途，非「看列表」的操作紀錄。同步直出，非非同步 Job，不需要輪詢；' +
                '要匯出全量資料請自行逐頁呼叫直到 rows.length < pageSize。',
            inputSchema: listRegistrationIpQuotasInput,
        },
        async (input) => {
            const search = buildRegistrationIpQuotaSearch(input);
            const r = await withAutoRelogin(() => remote.appUserBackOffice.appUserIpQuotaPlatform.ExportRegistrationIpQuotas(search, input.page, input.pageSize));
            if (r.failed) return asErrorResult(r);
            return asTextResult({
                success: true,
                rows: (r.data?.rows ?? []).map((row) => formatRegistrationIpQuotaRow(row as unknown as Record<string, unknown>)),
                totalPage: r.data?.totalPage,
                totalRow: r.data?.totalRow,
            });
        },
    );
}
