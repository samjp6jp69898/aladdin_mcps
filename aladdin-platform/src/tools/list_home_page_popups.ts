/**
 * tools/list_home_page_popups.ts — aladdin_platform_ad_home_page_pop_up_platform_get_configs
 *
 * rajah: AdHomePagePopUpPlatform.GetConfigs(search AdSearch 1, page i32 2, pageSize PageSizeEnum 3)
 * （advertisement_back_office.rajah:98，需要 @Permission "Advertisement.HomePagePopUp"）
 *
 * 對應前端頁面：「廣告管理」→「首頁彈窗」，abu/platform/src/pages/advertisement/AdHomepagePopupList.vue
 * 的 loadData(page, pageSize)。
 *
 * 2026-08-25 讀 agrabah 後端原始碼查證
 * （agrabah/src/servers/advertisement_back_office/services/ad_home_page_pop_up.ts:52-65
 *   methodGetConfigs → cache_manager.ts 的 AdCacheManager.getPlatformAds → buildAdSearchWhere，
 *   非空殼、非佔位，真的查 DB）：
 * - `status` 未帶或帶 unknown(0) 時，後端**預設排除 status=deleted 的資料**（`AND status != deleted`），
 *   不是「不篩選」；要明確查已刪除的資料才需要帶 status=deleted。
 * - `title` 是 `title LIKE '%<title>%'` 的部分比對（非 AdSearch 共用的浮窗分支，那支是 JSON_SEARCH），
 *   不是精確比對，也不保證鎖定單一筆——本 tool 不是「用業務鍵查特定一筆」的精準查找工具，找特定
 *   一筆廣告仍可能需要翻頁核對。
 * - `startTimestamp`/`endTimestamp` 篩選語意是「該廣告的展示時間窗與此區間有重疊」（`start_at IS NULL
 *   OR start_at >= startTimestamp`、`end_at IS NULL OR end_at <= endTimestamp`），常態展示（start_at/
 *   end_at 為 NULL）不會被時間篩選排除掉。
 * - `noExpired`（rajah `@Hide`，後台表單不顯示但 API 支援）帶 true 時額外加一條「尚未過期」
 *   （`end_at IS NULL OR end_at > 現在時間`）的篩選。
 * - `displayType` 對這支 method **完全被忽略**：`buildAdSearchWhere` 只在 `isFloatingWindow=true`
 *   （浮窗列表，另一支不同 method）才套用這個欄位；`AdSearch` 是浮窗與彈窗共用的搜尋 model，
 *   rajah 註解已註明「僅浮窗列表頁使用；其餘廣告類型的列表頁應忽略此欄位」，此處如實照做——
 *   schema 仍列出此欄位（依 method-category-checklist.md 全欄位規則），但帶了對結果無任何影響。
 * - **`totalPage`/`totalRow` 只有在 `page===1` 時才會真的查 COUNT 並計算**（`common/database_helper.ts`
 *   `getPageData()`：`if (page === 1) { ... totalPage = getTotalPage(...) }`），其餘頁一律回
 *   `totalPage=0`——**不能把非第 1 頁拿到的 `totalPage=0` 誤判成「沒有下一頁」或查詢異常**。
 *   判斷有沒有更多頁請以第一次（page=1）拿到的 `totalPage` 為準，或用 `rows.length < pageSize`
 *   判斷是否已是最後一頁。
 * - 排序固定 `sort_order ASC`，無法由呼叫端調整。
 * - 每筆額外合併 `rolesVisible`（角色可見性設定）與 `operatorName`（跨服務查詢操作者名稱，
 *   500 筆一批），非單純 DB 直出欄位。
 *
 * pageSize 是 rajah `PageSizeEnum`（`common.rajah`：10/20/30/50/100/200，其中 0=serverDefault），
 * 後端有上限保護，非裸 `i32` 無界輸入。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { AdSearch } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { STATUS_MAP, STATUS_KEYS } from '../const.ts';

export function registerListHomePagePopupsTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_ad_home_page_pop_up_platform_get_configs',
        {
            title: 'List home page popup ads on this platform',
            description:
                '查詢本平台「廣告管理」→「首頁彈窗」的廣告設定清單（rajah: AdHomePagePopUpPlatform.GetConfigs，' +
                '需要權限節點 Advertisement.HomePagePopUp）。' +
                'status 未帶或帶 unknown 時，後端預設排除已刪除（deleted）的資料，非真正「不篩選」；' +
                '要查已刪除資料需明確帶 status=deleted。' +
                'title 是部分比對（LIKE %title%），非精確比對、也不保證鎖定單一筆，若要找特定一筆廣告' +
                '可能仍需翻頁核對。' +
                'startTimestamp/endTimestamp 篩選的是「展示時間窗與此區間重疊」，常態展示（未設定起訖時間）' +
                '的廣告不會被時間篩選排除。noExpired 帶 true 時額外篩選「尚未過期」的廣告。' +
                'displayType 欄位對此 method 完全無效（只有「首頁浮窗」列表那支不同 method 會用到，' +
                'AdSearch 是兩者共用的搜尋 model），帶了也不影響結果，僅為 schema 完整性保留。' +
                '**重要**：totalPage 只有在 page=1 時後端才會真的計算，其餘頁一律回 0——不能把非第 1 頁的 ' +
                'totalPage=0 誤判成「沒有下一頁」，請以第一次（page=1）取得的 totalPage 為準，或用 ' +
                'rows.length < pageSize 判斷是否已到最後一頁。排序固定為 sortOrder 由小到大，不可調整。',
            inputSchema: {
                title: z.string().optional().describe('依廣告標題部分比對（LIKE %title%），不保證鎖定單一筆'),
                status: z.enum(STATUS_KEYS).optional().describe(
                    '狀態篩選：unknown/enabled/disabled/frozen/deleted；未帶或帶 unknown 時後端預設排除 deleted，' +
                    '要查已刪除資料需明確帶 deleted',
                ),
                startTimestamp: z.number().int().optional().describe(
                    '展示時間窗篩選起點（毫秒 epoch）：篩選 start_at 為空或 >= 此值的廣告，常態展示（未設起訖時間）不受影響',
                ),
                endTimestamp: z.number().int().optional().describe(
                    '展示時間窗篩選終點（毫秒 epoch）：篩選 end_at 為空或 <= 此值的廣告，常態展示（未設起訖時間）不受影響',
                ),
                noExpired: z.boolean().optional().describe('true 時額外篩選「尚未過期」（end_at 為空或大於目前時間）的廣告'),
                displayType: z.enum([ 'RightSideList', 'CarouselDrag', 'Standalone' ]).optional().describe(
                    '對此 method 完全無效（僅「首頁浮窗」列表另一支 method 會用到），帶了也不影響結果，可略過不帶',
                ),
                page: z.number().int().min(1).optional().describe('頁碼，從 1 開始；預設 1'),
                pageSize: z.number().int().min(1).max(200).optional().describe(
                    '每頁筆數，rajah PageSizeEnum 合法值：10/20/30/50/100/200；預設 50',
                ),
            },
        },
        async ({ title, status, startTimestamp, endTimestamp, noExpired, displayType, page, pageSize }) => {
            const DISPLAY_TYPE_MAP = { RightSideList: 1, CarouselDrag: 2, Standalone: 3 } as const;

            const search = AdSearch.create({
                title: title ?? '',
                status: status ? STATUS_MAP[ status ] : undefined,
                startTimestamp: startTimestamp ?? 0,
                endTimestamp: endTimestamp ?? 0,
                noExpired: noExpired ?? false,
                displayType: displayType ? DISPLAY_TYPE_MAP[ displayType ] : undefined,
            });

            const r = await withAutoRelogin(() => remote.advertisementBackOffice.adHomePagePopUpPlatform.GetConfigs(search, page ?? 1, pageSize ?? 50));
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
