/**
 * tools/list_registration_ip_quotas.ts — aladdin_platform_app_user_ip_quota_platform_list_registration_ip_quotas
 *
 * rajah: AppUserIpQuotaPlatform.ListRegistrationIpQuotas（user_back_office.rajah:565，
 * 需要 @Permission "Risk.IpRestriction.SameIp"）
 *
 * 2026-08-26 讀 agrabah 後端原始碼查證（app_user_ip_quota_platform.ts:72-94 →
 * RegistrationIpQuotaManager.listRecords()，registration_ip_quota_manager.ts:459-526）：
 * - 依 platform_id + 動態 where（status/ip/usedCountMax/updatedAt 區間）查 `registration_ip_quotas`，
 *   排序 id DESC。**pageSize 上限 200 是在 service 層明確 clamp/拒絕（`pageSize > 200` 直接回
 *   errorCode=invalidData），不是靜默截斷**，這支 method 的 pageSize 參數是裸 i32（非
 *   PageSizeEnum），本工具在 zod schema 端同步限制 max(200) 提前擋掉，減少一次無謂的 RPC 往返。
 * - 只有 page=1 時後端才會真的計算 totalRow/totalPage，page>1 固定回 0（同 getPageData 慣例），
 *   翻頁到底要用 `rows.length < pageSize` 判斷，不能用 totalPage 判斷是否還有下一頁。
 * - status 篩選型別是 ActiveStatusEnum（rajah `ListRegistrationIpQuotaSearch.status`），只能篩
 *   enabled/disabled，不篩不帶或帶 0。ip 精準比對（非模糊）。usedCountMax 是「已使用數 <= 此值」
 *   的上限篩選，0（不傳）表示不篩選。
 * - 額外批次補 lastOperator（RPC 查帳號）與 registeredAccountCount（同 IP 註冊會員數，
 *   JOIN user_login_details/users），非 N+1，可信任。
 * - ip 是可鎖定單一目標的欄位（method-category-checklist.md 第 2 節 A 級，相對安全）。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { ListRegistrationIpQuotaSearch } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { ACTIVE_STATUS_MAP, STATUS_MAP, describeEnum, toPlainNumber } from '../const.ts';

export const listRegistrationIpQuotasInput = {
    page: z.number().int().min(1).default(1).describe('頁碼，從 1 開始'),
    pageSize: z.number().int().min(1).max(200).default(50).describe('每頁筆數，1~200（裸 i32，非固定選項；後端 >200 直接拒絕，非截斷）'),
    status: z.enum([ 'enabled', 'disabled' ]).optional().describe('依狀態篩選（ActiveStatusEnum），不帶則不篩選'),
    ip: z.string().optional().describe('精準比對 IP（非模糊查詢），不帶則不篩選'),
    usedCountMax: z.number().int().min(0).optional().describe('已使用註冊數上限：查 usedCount <= 此值，0 或不帶表示不篩選'),
    updatedAtStartTimestamp: z.number().int().optional().describe('更新時間區間起點，毫秒 epoch，0 或不帶表示不篩選'),
    updatedAtEndTimestamp: z.number().int().optional().describe('更新時間區間終點，毫秒 epoch，0 或不帶表示不篩選'),
};

type ListRegistrationIpQuotasInput = {
    page: number;
    pageSize: number;
    status?: 'enabled' | 'disabled';
    ip?: string;
    usedCountMax?: number;
    updatedAtStartTimestamp?: number;
    updatedAtEndTimestamp?: number;
};

/** list/export 兩支 tool 共用的搜尋條件組裝與呼叫邏輯（export 只差權限節點與不寫 audit，見 export 工具檔頭註解）。 */
export function buildRegistrationIpQuotaSearch(input: ListRegistrationIpQuotasInput) {
    return ListRegistrationIpQuotaSearch.create({
        status: input.status ? ACTIVE_STATUS_MAP[ input.status ] : 0,
        ip: input.ip ?? '',
        usedCountMax: input.usedCountMax ?? 0,
        updatedAtStartTimestamp: input.updatedAtStartTimestamp ?? 0,
        updatedAtEndTimestamp: input.updatedAtEndTimestamp ?? 0,
    });
}

/** 回傳列格式化：status 是 StatusEnum（非 ActiveStatusEnum），releasedAtTimestamp/updatedAtTimestamp/createdAtTimestamp 轉純數字。 */
export function formatRegistrationIpQuotaRow(row: Record<string, unknown>): Record<string, unknown> {
    return {
        ...row,
        id: toPlainNumber(row.id), // id 是 i64（rajah user_back_office.rajah:467），protobufjs decode 出來是 Long 物件，非純數字
        status: describeEnum(STATUS_MAP, row.status as number),
        releasedAtTimestamp: toPlainNumber(row.releasedAtTimestamp),
        updatedAtTimestamp: toPlainNumber(row.updatedAtTimestamp),
        createdAtTimestamp: toPlainNumber(row.createdAtTimestamp),
    };
}

export function registerListRegistrationIpQuotasTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_app_user_ip_quota_platform_list_registration_ip_quotas',
        {
            title: 'List registration IP quota records',
            description:
                '分頁查詢本平台「註冊 IP 配額」紀錄（rajah: AppUserIpQuotaPlatform.ListRegistrationIpQuotas，' +
                'user_back_office.rajah:565）。所有搜尋條件皆選填，ip 為精準比對。' +
                '⚠️ pageSize 上限 200（後端明確拒絕超過 200 的請求，非靜默截斷），非固定選項清單。' +
                '⚠️ 分頁陷阱：totalPage 只有 page=1 時後端才會真的計算，page>1 固定回 0，不能用它判斷是否還有下一頁，' +
                '翻頁到底要改用 rows.length < pageSize。' +
                '回傳每列含 status（單筆 IP 目前啟用/停用狀態，StatusEnum）、usedCount/remainingCount' +
                '（已用/剩餘註冊數）、lastReleasedCount/releasedAtTimestamp（最後一次釋放配額的數量與時間，' +
                '0 表示從未釋放）、registeredAccountCount（用此 IP 註冊的會員總數）、lastOperator（最後後台操作人帳號，' +
                '空字串表示系統或尚未操作）。要查某 IP 下實際註冊的會員清單，改用 ' +
                'aladdin_platform_app_user_ip_quota_platform_list_registration_ip_users。',
            inputSchema: listRegistrationIpQuotasInput,
        },
        async (input) => {
            const search = buildRegistrationIpQuotaSearch(input);
            const r = await withAutoRelogin(() => remote.appUserBackOffice.appUserIpQuotaPlatform.ListRegistrationIpQuotas(search, input.page, input.pageSize));
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
