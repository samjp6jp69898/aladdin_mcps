/**
 * tools/get_today_platform_statistic.ts —
 * aladdin_platform_statistic_platform_get_today_platform_statistic
 *
 * rajah: StatisticPlatform.GetTodayPlatformStatistic(currencyCode string 3, type
 * PlatformStatisticTypeEnum 4) (list [TimespanValueData] 1, lastUpdatedAtTimestamp i64 2)
 * （rajah/services/statistic.rajah:2428，非 @NoPublic，@Permission "DataSum.Dashboard"）
 *
 * method-category-checklist.md 第 0 節排除規則已過：agrabah 對應 Service
 * （statistic_platform.ts:448 methodGetTodayPlatformStatistic，實際邏輯在私有方法
 * getHourlyPlatformStatistic，statistic_platform.ts:387）確認有真實實作（查
 * hourly_platform_statistics 表），非 notImplemented。
 * 分類：第 2 節「讀取清單」——A 級：固定回傳「今日 24 小時」的補值後陣列，範圍已被業務語意
 * （今日）天然收斂，非開放式分頁掃描。
 *
 * 2026-08-26 讀 agrabah 後端原始碼查證（statistic_platform.ts:387-435）：
 * - **24 小時補零**：某小時無資料會補一筆 `{ startedAtTimestamp, value: 0 }`，回傳陣列固定 24 筆
 *   （除非查到的原始筆數已 >= 24，理論上不會超過），無法從回傳結果直接分辨「真實值 0」與
 *   「該小時尚無資料」。
 * - **type=platformProfitRate（20）會回全 0 假資料**：後端 hourly_platform_statistics 表從未寫入這個
 *   type（平台獲利率設計上由前端即時用 betAmount/winLoseAmount 算，不是後端統計出來的值），帶這個
 *   type 查詢一定拿到 24 筆補零資料，不代表「今日獲利率是 0」。
 * - **currencyCode 對 onlineUsers/maxOnlineUsers/onlineMembers/maxOnlineMembers 這四類 type 無效**：
 *   後端會把 currencyCode 強制清空再查（跨幣別統一計算），帶任何值都會被忽略。
 * - `lastUpdatedAtTimestamp` 取「有資料時最後一筆原始 row 的 updated_at」，若當日完全無資料則為 0；
 *   注意這是「原始查詢結果最後一筆」的更新時間，不是「所有已補零小時的最後更新時間」。
 * - 今日的區間邊界依 `context.timezone`（平台時區）計算 [today 00:00, 明日 00:00)，不是 UTC。
 * - 純讀取查詢，可安全重複呼叫。
 *
 * 2026-08-26 於 pk-platform.alddev.com dev 環境實測：呼叫一次成功（errorCode=0，type=betAmount，
 * 回傳固定 24 筆），確認補零與陣列長度符合預期；未逐一覆蓋每個 PlatformStatisticTypeEnum 值。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { toPlainNumber, PLATFORM_STATISTIC_TYPE_KEYS, PLATFORM_STATISTIC_TYPE_MAP } from '../const.ts';

export function registerGetTodayPlatformStatisticTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_statistic_platform_get_today_platform_statistic',
        {
            title: 'Get today hourly platform statistic (dashboard chart)',
            description:
                '查詢今日每小時平台統計數據（後台 Dashboard 每小時走勢圖用）（rajah: ' +
                'StatisticPlatform.GetTodayPlatformStatistic）。固定回傳 24 筆（依平台時區今日 00:00 起算，' +
                '無資料的小時補值 0），**無法從結果分辨「真實值 0」與「尚無資料」**。' +
                '**type="platformProfitRate" 會回全 0 假資料**：後端從未把這個 type 寫入統計表（設計上由前端' +
                '即時計算），不代表今日獲利率真的是 0，不建議用這支查該類型。' +
                'type 為 onlineUsers/maxOnlineUsers/onlineMembers/maxOnlineMembers 時 currencyCode 會被後端' +
                '強制忽略（跨幣別統一計算）。lastUpdatedAtTimestamp 是「有資料時最後一筆原始資料」的更新時間，' +
                '今日完全無資料時為 0。純讀取查詢，可安全重複呼叫。',
            inputSchema: {
                currencyCode: z.string().describe('幣別代碼，如 "USD"；對 onlineUsers 系列 type 會被忽略'),
                type: z.enum(PLATFORM_STATISTIC_TYPE_KEYS).describe('統計類型（PlatformStatisticTypeEnum），如 "betAmount"/"depositAmount"/"onlineUsers" 等；platformProfitRate 會回全 0 假資料，見說明'),
            },
        },
        async (input) => {
            const r = await withAutoRelogin(() =>
                remote.statistic.statisticPlatform.GetTodayPlatformStatistic(
                    input.currencyCode,
                    PLATFORM_STATISTIC_TYPE_MAP[ input.type ],
                ),
            );
            if (r.failed) return asErrorResult(r);

            const list = (r.data?.list ?? []).map((row) => ({
                startedAtTimestamp: toPlainNumber(row.startedAtTimestamp),
                value: toPlainNumber(row.value),
            }));

            return asTextResult({
                success: true,
                list,
                lastUpdatedAtTimestamp: toPlainNumber(r.data?.lastUpdatedAtTimestamp),
            });
        },
    );
}
