/**
 * tools/get_ip_region_list.ts — aladdin_platform_risk_platform_ip_region_get_ip_region_list
 *
 * rajah: RiskPlatformIpRegion.GetIpRegionList（risk_back_office.rajah:19，需要
 * @Permission "Risk.IpRestriction.GameIp"）
 *
 * 2026-08-25 讀 agrabah 後端原始碼查證（risk_platform_ip_region.ts:25-94）：
 * - `limitContent` 搜尋不是 LIKE 子字串比對，是逗號分隔多值的 FIND_IN_SET OR 查詢
 *   （RiskIpManager.buildOrCondition）——傳入 "1.1.1.1,US" 等同「limit_content 欄位裡
 *   逗號分隔值包含 1.1.1.1 或包含 US 的任一筆」，不是模糊比對整個欄位字串。
 * - `remark` 搜尋才是真正的 LIKE 模糊比對。
 * - `status`/`limitItem`/`limitMethod` 用 `> 0` 判斷是否套用篩選，帶 0（或不帶）等同不篩選。
 * - `pageSize` 是固定選項的 PageSizeEnum，不是任意 i32；`serverDefault`(0) 由後端轉成 100。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { RiskIpRegionSearch } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { ACTIVE_STATUS_MAP, RISK_LIMIT_ITEM_MAP, RISK_LIMIT_METHOD_MAP, PAGE_SIZE_KEYS, PAGE_SIZE_MAP } from '../const.ts';

export function registerGetIpRegionListTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_risk_platform_ip_region_get_ip_region_list',
        {
            title: 'List IP/region game-access restriction rules',
            description:
                '分頁查詢當前平台「限制遊戲 IP/地區」規則（rajah: RiskPlatformIpRegion.GetIpRegionList，' +
                'risk_back_office.rajah:19）。所有搜尋條件皆選填。' +
                '⚠️ limitContent 不是子字串模糊比對：是把輸入依逗號拆成多個值，用 OR 邏輯比對每筆規則的 ' +
                'limitContent 欄位（本身也是逗號分隔的 IP/國碼清單）是否包含任一個輸入值（FIND_IN_SET），' +
                '例如輸入 "1.1.1.1,US" 會找出 limitContent 欄位包含 1.1.1.1 或包含 US 的規則，不是整欄位字串比對。' +
                'remark 才是真正的 LIKE 模糊比對。' +
                'status/limitItem/limitMethod 不帶時視為不篩選。' +
                'pageSize 只能是固定選項之一（serverDefault=0 會轉成 100/10/20/30/50/100/200），不是任意數字。' +
                '⚠️ 分頁陷阱（與同 server 內其他 List 系列 tool 共用同一個 getPageData 實作）：totalPage 只有 page=1 ' +
                '時後端才會真的計算，page>1 時固定回 0，不能用它判斷「是否還有下一頁」，翻頁到底要改用 ' +
                'rows.length < pageSize。' +
                '回傳的 RiskIpRegion 含 status（1=啟用/2=停用）、promptText（多語提示文字陣列）、customerId' +
                '（客服連結 id，0=未開啟）——這三欄在後台表單標 @Hide（表單不顯示），但 API 本身仍會回傳，' +
                '本工具原樣透出。gameType 是 RiskGameTypeEnum 數值：provider=1（廠商）/specified=2（指定遊戲）；' +
                'limitItem 是 RiskLimitItemEnum：gameBlack=1（黑名單）/gameWhite=2（白名單）；' +
                'limitMethod 是 RiskLimitMethodEnum：ip=1/countryCode=2。',
            inputSchema: {
                page: z.number().int().min(1).default(1).describe('頁碼，從 1 開始'),
                pageSize: z.enum(PAGE_SIZE_KEYS).default('size50').describe('每頁筆數，只能是固定選項之一'),
                status: z.enum([ 'enabled', 'disabled' ]).optional().describe('依狀態篩選，不帶則不篩選'),
                limitItem: z.enum([ 'gameBlack', 'gameWhite' ]).optional().describe('依黑名單/白名單類型篩選，不帶則不篩選'),
                limitMethod: z.enum([ 'ip', 'countryCode' ]).optional().describe('依限制方式（IP/國碼）篩選，不帶則不篩選'),
                limitContent: z.string().optional().describe(
                    '依限制內容篩選，逗號分隔多值、OR 邏輯（FIND_IN_SET，非子字串模糊比對），見上方 description 說明',
                ),
                remark: z.string().optional().describe('依備註篩選（LIKE 模糊比對）'),
                updatedAtTimestampStart: z.number().int().optional().describe('更新時間區間起點，毫秒 epoch'),
                updatedAtTimestampEnd: z.number().int().optional().describe('更新時間區間終點，毫秒 epoch'),
            },
        },
        async ({ page, pageSize, status, limitItem, limitMethod, limitContent, remark, updatedAtTimestampStart, updatedAtTimestampEnd }) => {
            const search = RiskIpRegionSearch.create({
                status: status ? ACTIVE_STATUS_MAP[ status ] : 0,
                limitItem: limitItem ? RISK_LIMIT_ITEM_MAP[ limitItem ] : 0,
                limitMethod: limitMethod ? RISK_LIMIT_METHOD_MAP[ limitMethod ] : 0,
                limitContent: limitContent ?? '',
                remark: remark ?? '',
                updatedAtTimestampStart: updatedAtTimestampStart ?? 0,
                updatedAtTimestampEnd: updatedAtTimestampEnd ?? 0,
            });
            const r = await withAutoRelogin(() => remote.riskBackOffice.riskPlatformIpRegion.GetIpRegionList(search, page, PAGE_SIZE_MAP[ pageSize ]));
            if (r.failed) return asErrorResult(r);
            return asTextResult({
                success: true,
                rows: r.data?.rows ?? [],
                totalPage: r.data?.totalPage,
            });
        },
    );
}
