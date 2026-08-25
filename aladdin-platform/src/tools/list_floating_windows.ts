/**
 * tools/list_floating_windows.ts — aladdin_platform_ad_floating_window_platform_get_configs
 *
 * rajah: AdFloatingWindowPlatform.GetConfigs(search AdSearch 1, page i32 2, pageSize PageSizeEnum 3)
 * （advertisement_back_office.rajah:188，需要 @Permission "Advertisement.FloatingWindow"）
 *
 * 對應前端頁面：「廣告管理」→「浮窗設置」，abu/platform/src/pages/advertisement/AdFloatingWindow.vue。
 *
 * 這支跟 `aladdin_platform_ad_home_page_pop_up_platform_get_configs`（首頁彈窗）底層共用同一套
 * `DeriveCacheManager` 泛型快取邏輯（agrabah/src/servers/advertisement_back_office/cache_manager.ts），
 * 但呼叫時 `isFloatingWindow=true`，行為有幾個關鍵差異，2026-08-25 讀原始碼查證：
 * - **`displayType` 對本 method 是真的會生效的篩選欄位**（跟首頁彈窗那支不同，那支固定忽略）：
 *   `buildAdSearchWhere`（cache_manager.ts:92-95）`isFloatingWindow && displayType!=null && !==0` 才會
 *   加上 `AND display_type = ?`。合法值見 `AdFloatingWindowDisplayTypeEnum`
 *   （RightSideList=1/CarouselDrag=2/Standalone=3）。
 * - **title 是 `[LocalizationString]` 多語系陣列**（首頁彈窗是單一 string），title 篩選走
 *   `JSON_SEARCH(title,'one',?,NULL,'$[*].value') IS NOT NULL`（cache_manager.ts:87-90）——比對
 *   任一語言的 `value` 欄位是否包含篩選字串（部分比對，非精確比對）。
 * - status 未帶或 unknown 時同樣預設排除 deleted（cache_manager.ts:70-76，跟首頁彈窗共用同一段邏輯）。
 * - **totalPage 只有 page=1 時才會計算，其餘頁固定回 0**（`getPageData`，
 *   `agrabah/src/common/database_helper.ts:204-217`，跟首頁彈窗那支同一個共用函式，同樣的陷阱）。
 * - noExpired（@Hide）、startTimestamp/endTimestamp 篩選邏輯與首頁彈窗那支完全相同。
 *
 * 2026-08-25 dev（pk-platform.alddev.com）實測：用真正的 `@modelcontextprotocol/sdk`
 * `StdioClientTransport` + `tools/call`（非直打 remote.gen.ts）驗證，見 handler 呼叫處與 README。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { AdSearch } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { STATUS_MAP, STATUS_KEYS } from '../const.ts';

const DISPLAY_TYPE_MAP = { RightSideList: 1, CarouselDrag: 2, Standalone: 3 } as const;

export function registerListFloatingWindowsTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_ad_floating_window_platform_get_configs',
        {
            title: 'List floating window ads on this platform',
            description:
                '查詢本平台「廣告管理」→「浮窗設置」的廣告設定清單（rajah: AdFloatingWindowPlatform.GetConfigs，' +
                '需要權限節點 Advertisement.FloatingWindow）。' +
                'status 未帶或 unknown 時後端預設排除已刪除（deleted）的資料。' +
                'title 是多語系陣列，比對是「任一語言的 value 部分比對」（JSON_SEARCH），非精確比對，' +
                '若要找特定一筆廣告可能仍需翻頁核對。' +
                'displayType **對這支 method 真的會篩選**（跟首頁彈窗的同名欄位不同，那支被忽略）：' +
                'RightSideList=右側直列／CarouselDrag=輪播拖曳／Standalone=獨立浮窗。' +
                'startTimestamp/endTimestamp 篩選的是「展示時間窗與此區間重疊」，常態展示（未設定起訖時間）' +
                '不會被時間篩選排除。noExpired 帶 true 時額外篩選「尚未過期」的廣告。' +
                '**重要**：totalPage 只有 page=1 時後端才會真的計算，其餘頁一律回 0——不能把非第 1 頁的 ' +
                'totalPage=0 誤判成「沒有下一頁」，請以第一次（page=1）取得的 totalPage 為準，或用 ' +
                'rows.length < pageSize 判斷是否已到最後一頁。排序固定為 sortOrder 由小到大。',
            inputSchema: {
                title: z.string().optional().describe('依廣告標題部分比對（任一語言的 value 包含此字串），不保證鎖定單一筆'),
                status: z.enum(STATUS_KEYS).optional().describe(
                    '狀態篩選：unknown/enabled/disabled/frozen/deleted；未帶或帶 unknown 時後端預設排除 deleted，' +
                    '要查已刪除資料需明確帶 deleted',
                ),
                displayType: z.enum([ 'RightSideList', 'CarouselDrag', 'Standalone' ]).optional().describe(
                    '展示類型篩選，對這支 method 真的會生效',
                ),
                startTimestamp: z.number().int().optional().describe(
                    '展示時間窗篩選起點（毫秒 epoch）：篩選 start_at 為空或 >= 此值的廣告，常態展示不受影響',
                ),
                endTimestamp: z.number().int().optional().describe(
                    '展示時間窗篩選終點（毫秒 epoch）：篩選 end_at 為空或 <= 此值的廣告，常態展示不受影響',
                ),
                noExpired: z.boolean().optional().describe('true 時額外篩選「尚未過期」（end_at 為空或大於目前時間）的廣告'),
                page: z.number().int().min(1).optional().describe('頁碼，從 1 開始；預設 1'),
                pageSize: z.number().int().min(1).max(200).optional().describe(
                    '每頁筆數，rajah PageSizeEnum 合法值：10/20/30/50/100/200；預設 50',
                ),
            },
        },
        async ({ title, status, displayType, startTimestamp, endTimestamp, noExpired, page, pageSize }) => {
            const search = AdSearch.create({
                title: title ?? '',
                status: status ? STATUS_MAP[ status ] : undefined,
                startTimestamp: startTimestamp ?? 0,
                endTimestamp: endTimestamp ?? 0,
                noExpired: noExpired ?? false,
                displayType: displayType ? DISPLAY_TYPE_MAP[ displayType ] : undefined,
            });

            const r = await withAutoRelogin(() => remote.advertisementBackOffice.adFloatingWindowPlatform.GetConfigs(search, page ?? 1, pageSize ?? 50));
            if (r.failed) return asErrorResult(r);

            return asTextResult({
                success: true,
                rows: r.data?.rows ?? [],
                totalPage: r.data?.totalPage,
                totalPageNote: (page ?? 1) === 1
                    ? undefined
                    : 'page != 1 時 totalPage 恆為 0（後端只在 page=1 才計算 COUNT），非「沒有下一頁」的訊號',
            });
        },
    );
}
