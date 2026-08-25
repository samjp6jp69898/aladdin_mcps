/**
 * tools/get_customer_config_restrict.ts — aladdin_platform_customer_platform_get_customer_config_restrict
 *
 * rajah: CustomerPlatform.GetCustomerConfigRestrict（customer_back_office.rajah:49，無 @Permission，
 * 由 service 內其他 method 綁定的權限樹涵蓋，對應「客服設置」→「通用設定」→
 * 「訪問受限制」選項清單）。
 *
 * 後端實作（agrabah/.../customer_platform.ts:235-260）：無參數、不分頁，直接撈本平台全部
 * `customer_category_config` 列（不分 category），只回傳 id/name/restrictStatus 三個欄位——
 * 屬 method-category-checklist.md 第 2 節「完全不分頁的全撈，小型列舉表可放心用」，本平台的
 * 客服連線類型設定筆數與 list_customer_category_details 觀察到的規模同級（個位數到十位數），
 * 不是持續成長的 log 類表。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { ACTIVE_STATUS_MAP } from '../const.ts';

/** 數字 → 對照表 key 的字串；查不到已知 key 時原樣回傳數字，不讓未知值消失。 */
function describeEnum<T extends Record<string, number>>(map: T, value: number | null | undefined): string | number {
    if (value === null || value === undefined) return value as never;
    const hit = Object.entries(map).find(([ , v ]) => v === value);
    return hit ? hit[ 0 ] : value;
}

export function registerGetCustomerConfigRestrictTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_customer_platform_get_customer_config_restrict',
        {
            title: 'Get customer service general setting — access restriction options',
            description:
                '讀取本平台「客服設置」→「通用設定」→「訪問受限制」的選項清單' +
                '（rajah: CustomerPlatform.GetCustomerConfigRestrict）。無參數，一次回傳本平台全部' +
                '客服連線類型（跨 komi/wbgcorp/dotcloud，不分 category）的 id/name/restrictStatus，' +
                '不分頁。restrictStatus=enabled 表示這筆是本平台目前被選為「訪問受限制」生效項目' +
                '（同 platformId 全部連線項目裡最多一筆是 enabled，其餘皆 disabled）——' +
                '這跟 aladdin_platform_customer_platform_list_details 回傳的 status（該連線項目本身的' +
                '啟用/停用）是完全不同的兩個欄位，兩者恰好都渲染成 enabled/disabled 字串但語意不同，勿混用。' +
                '要修改「同 platformId 只能選一個」的實際生效設定要改用 SetCustomerConfigRestrict' +
                '（目前尚未包成 tool）。',
            inputSchema: {},
        },
        async () => {
            const r = await withAutoRelogin(() => remote.customerBackOffice.customerPlatform.GetCustomerConfigRestrict());
            if (r.failed) return asErrorResult(r);

            const rows = (r.data?.rows ?? []).map(row => ({
                id: row.id,
                name: row.name,
                restrictStatus: describeEnum(ACTIVE_STATUS_MAP, row.restrictStatus as number),
            }));

            return asTextResult({ success: true, rows });
        },
    );
}
