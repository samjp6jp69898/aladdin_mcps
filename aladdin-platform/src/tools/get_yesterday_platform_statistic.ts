/**
 * tools/get_yesterday_platform_statistic.ts —
 * aladdin_platform_statistic_platform_get_yesterday_platform_statistic
 *
 * rajah: StatisticPlatform.GetYesterdayPlatformStatistic(currencyCode string 3, type
 * PlatformStatisticTypeEnum 4) (list [TimespanValueData] 1)（rajah/services/statistic.rajah:2431，
 * 非 @NoPublic，@Permission "DataSum.Dashboard"）
 *
 * method-category-checklist.md 第 0 節排除規則已過：agrabah 對應 Service
 * （statistic_platform.ts:461 methodGetYesterdayPlatformStatistic，共用私有方法
 * getHourlyPlatformStatistic，statistic_platform.ts:387）確認有真實實作，非 notImplemented。
 * 分類與注意事項同 aladdin_platform_statistic_platform_get_today_platform_statistic（同一段查詢邏輯，
 * 差別只在時間區間）：
 * - 固定回傳「昨日」24 小時補零後的陣列，無法分辨「真實值 0」與「尚無資料」。
 * - type="platformProfitRate" 會回全 0 假資料（後端從未寫入這個 type 的統計列）。
 * - type 為 onlineUsers/maxOnlineUsers/onlineMembers/maxOnlineMembers 時 currencyCode 會被強制忽略。
 * - 昨日區間依平台時區計算 [今日 00:00 − 1 天, 今日 00:00)。
 *
 * **與 GetTodayPlatformStatistic 的關鍵差異（2026-08-26 讀源碼查證）**：
 * - **本 method 回應 model 沒有 `lastUpdatedAtTimestamp` 欄位**（rajah 定義只有 `list`），昨日資料
 *   已成定案不需要「最後更新時間」語意，本工具回應也不輸出這個欄位（不是漏轉，是後端本來就沒有）。
 *
 * 純讀取查詢，可安全重複呼叫。
 *
 * 2026-08-26 於 pk-platform.alddev.com dev 環境實測：呼叫一次成功（errorCode=0，type=onlineUsers，
 * 回傳固定 24 筆，且未帶 currencyCode 相關報錯，符合「onlineUsers 忽略 currencyCode」的描述）。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { toPlainNumber, PLATFORM_STATISTIC_TYPE_KEYS, PLATFORM_STATISTIC_TYPE_MAP } from '../const.ts';

export function registerGetYesterdayPlatformStatisticTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_statistic_platform_get_yesterday_platform_statistic',
        {
            title: 'Get yesterday hourly platform statistic (dashboard chart)',
            description:
                '查詢昨日每小時平台統計數據（rajah: StatisticPlatform.GetYesterdayPlatformStatistic）。與 ' +
                'aladdin_platform_statistic_platform_get_today_platform_statistic 共用同一段查詢邏輯，差別只在' +
                '時間區間（昨日 00:00 ~ 今日 00:00，依平台時區）。固定回傳 24 筆（無資料的小時補值 0，無法分辨' +
                '「真實值 0」與「尚無資料」）。**type="platformProfitRate" 會回全 0 假資料**（後端從未寫入這個' +
                'type 的統計列）。type 為 onlineUsers/maxOnlineUsers/onlineMembers/maxOnlineMembers 時' +
                'currencyCode 會被強制忽略。**本方法回應沒有 lastUpdatedAtTimestamp 欄位**（rajah 定義本來就' +
                '沒有，非本工具漏轉）。純讀取查詢，可安全重複呼叫。',
            inputSchema: {
                currencyCode: z.string().describe('幣別代碼，如 "USD"；對 onlineUsers 系列 type 會被忽略'),
                type: z.enum(PLATFORM_STATISTIC_TYPE_KEYS).describe('統計類型（PlatformStatisticTypeEnum），如 "betAmount"/"depositAmount"/"onlineUsers" 等；platformProfitRate 會回全 0 假資料，見說明'),
            },
        },
        async (input) => {
            const r = await withAutoRelogin(() =>
                remote.statistic.statisticPlatform.GetYesterdayPlatformStatistic(
                    input.currencyCode,
                    PLATFORM_STATISTIC_TYPE_MAP[ input.type ],
                ),
            );
            if (r.failed) return asErrorResult(r);

            const list = (r.data?.list ?? []).map((row) => ({
                startedAtTimestamp: toPlainNumber(row.startedAtTimestamp),
                value: toPlainNumber(row.value),
            }));

            return asTextResult({ success: true, list });
        },
    );
}
