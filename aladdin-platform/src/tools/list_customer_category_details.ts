/**
 * tools/list_customer_category_details.ts — aladdin_platform_customer_platform_list_details
 *
 * rajah: CustomerPlatform.ListDetails（customer_back_office.rajah:34，@Permission "PlatCapCfg.CsManage.CsSet"）
 * 對應前端頁面：abu/platform/src/pages/product_system/CustomerSettings.vue（單一頁面使用，
 * 未被其他頁面共用，見 customer_platform.ts:129 檔頭註解），列出本平台某個客服連線類型
 * （CustomerCategoryEnum：komi/wbgcorp/dotcloud）底下已設定的客服連線項目。
 *
 * 安全考量：後端實作（agrabah/src/servers/customer_back_office/services/customer_platform.ts
 * methodListDetails）對每筆資料的 `data` 欄位會呼叫 `adapter.decrypt(row.data)` 後回傳——這是
 * 三方客服系統的連線密鑰/憑證（見 method-category-checklist.md 第 8 節「回傳值本身是密鑰的，
 * 預設不自動包成 MCP tool」）。本 tool 業務上不需要暴露這個欄位，因此刻意不回傳 `data`，
 * 只回傳其餘可安全瀏覽的欄位。
 *
 * 分類註記（method-category-checklist.md 第 2 節）：只有 category（範圍鍵，非可鎖定單一目標
 * 的 id/code 欄位）+ page/pageSize，屬 B 級。此 method 沒有以 id 直接查單筆的 sibling method，
 * 但用途是「瀏覽某類型底下的連線設定清單」（該平台單一類型下數量少，客服連線設定非持續成長的
 * log 類表），不是拿來當「用業務鍵查特定一筆」的內部查找工具，故不強制本 tool 內部逐頁掃描到
 * 底——page/pageSize 原樣透傳給呼叫端自行翻頁，語意同 list_vendor_games.ts。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { ICustomerCategoryCommon } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { CUSTOMER_CATEGORY_MAP, CUSTOMER_CONFIG_JUMP_MAP, ACTIVE_STATUS_MAP } from '../const.ts';

/** 數字 → 對照表 key 的字串；查不到已知 key 時原樣回傳數字，不讓未知值消失。 */
function describeEnum<T extends Record<string, number>>(map: T, value: number | null | undefined): string | number {
    if (value === null || value === undefined) return value as never;
    const hit = Object.entries(map).find(([ , v ]) => v === value);
    return hit ? hit[ 0 ] : value;
}

export function registerListCustomerCategoryDetailsTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_customer_platform_list_details',
        {
            title: 'List customer service category connection details',
            description:
                '查詢本平台某個客服連線類型（category）底下已設定的客服連線項目清單' +
                '（rajah: CustomerPlatform.ListDetails，對應「客服連線類型」設定頁面）。' +
                '安全考量：回傳刻意不含後端解密後的 `data` 欄位（三方客服系統連線密鑰），' +
                '只回傳 id/category/name/status/localizedName/displayIcon/jumpMethod/vipIds/sortOrder。' +
                'category 只有 komi/wbgcorp/dotcloud 三種固定值，不是可鎖定單一目標的欄位——' +
                '此 method 沒有以 id 直接查單筆的 sibling method，若要找特定一筆需自行翻頁比對，' +
                'page/pageSize 原樣透傳、本 tool 不會自動掃描到底。',
            inputSchema: {
                category: z.enum([ 'komi', 'wbgcorp', 'dotcloud' ]).describe('客服連線類型（三方客服系統）'),
                page: z.number().int().min(1).optional().describe('頁碼，從 1 開始，預設 1'),
                // pageSize 是 rajah PageSizeEnum（@Validate），後端硬驗證只接受 0/10/20/30/50/100/200，
                // 不是連續區間——2026-08-25 review 發現若寫成 z.number().min(1).max(200) 會放行
                // 15/25/60 這類非法值，通過 zod 後被後端以不易理解的 invalidData 拒絕。
                pageSize: z.union([ z.literal(10), z.literal(20), z.literal(30), z.literal(50), z.literal(100), z.literal(200) ])
                    .optional().describe('每頁筆數，只接受 10/20/30/50/100/200（PageSizeEnum），省略時用後端 DefaultPageSize'),
            },
        },
        async ({ category, page, pageSize }) => {
            const r = await withAutoRelogin(() => remote.customerBackOffice.customerPlatform.ListDetails(
                CUSTOMER_CATEGORY_MAP[ category ],
                page ?? 1,
                pageSize ?? 0, // PageSizeEnum.serverDefault=0，後端會 fallback 成 DefaultPageSize
            ));
            if (r.failed) return asErrorResult(r);

            const rows = (r.data?.rows ?? []).map((row: ICustomerCategoryCommon) => ({
                id: row.id,
                category: describeEnum(CUSTOMER_CATEGORY_MAP, row.category as number),
                name: row.name,
                status: describeEnum(ACTIVE_STATUS_MAP, row.status as number),
                localizedName: row.localizedName,
                displayIcon: row.displayIcon,
                jumpMethod: describeEnum(CUSTOMER_CONFIG_JUMP_MAP, row.jumpMethod as number),
                vipIds: row.vipIds,
                sortOrder: row.sortOrder,
            }));

            return asTextResult({ success: true, rows, totalPage: r.data?.totalPage });
        },
    );
}
