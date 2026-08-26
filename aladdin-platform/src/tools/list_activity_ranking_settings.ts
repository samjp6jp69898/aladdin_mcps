/**
 * tools/list_activity_ranking_settings.ts — aladdin_platform_ranking_platform_list_activity_ranking_setting
 *
 * rajah: RankingPlatform.ListActivityRankingSetting（ranking_back_office.rajah:106，
 * 需要 @Permission "BonusCenter.AcRanking"）——分頁列出當前平台（登入身分綁定）的
 * 全部活動排行榜設定（後台「優惠中心 > 活動排行榜」列表頁）。
 *
 * 2026-08-26 讀 agrabah 後端原始碼查證
 * （agrabah/src/servers/ranking_back_office/services/ranking_platform.ts:263-301，
 * methodListActivityRankingSetting）：真的查 DB（`getPageData` + `platform_id = ?`），
 * 非 placeholder；沒有 search 條件，純 page/pageSize，但這是活動排行榜設定（營運人員
 * 手動建立的活動配置），數量天然有限，屬於方法分類文件第 2 節「小型列舉表」情境，
 * 不需要逐頁掃描到底的強制檢查。
 *
 * 2026-08-26 dev 實測（pk-platform.alddev.com，帳號 landon001）：
 * ListActivityRankingSetting(1, 50) 回傳 14 筆真實資料，totalPage=1。
 *
 * i64 欄位（各 timestamp）與 CurrencyLink（minimumAmount）用 const.ts 的
 * deepFixLongs 統一轉成一般 number，避免 protobufjs Long 物件被 JSON.stringify 成
 * 難以閱讀、且依呼叫路徑不同而不一致的形狀。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { deepFixLongs, PAGE_SIZE_KEYS, PAGE_SIZE_MAP } from '../const.ts';

export function registerListActivityRankingSettingsTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_ranking_platform_list_activity_ranking_setting',
        {
            title: "List the current platform's activity ranking settings",
            description:
                '分頁查詢當前平台（登入身分綁定的 platformId，非參數帶入）的全部活動排行榜設定' +
                '（rajah: RankingPlatform.ListActivityRankingSetting，需要權限節點 BonusCenter.AcRanking；' +
                '後台「優惠中心 > 活動排行榜」列表頁）。此 method 沒有 search 篩選條件，只能翻頁後在' +
                '呼叫端過濾；活動排行榜是營運人員手動建立的配置，數量天然有限，不需要逐頁掃描到底。' +
                'status 是 rajah StatusEnum 數值（unknown=0/enabled=1/disabled=2/frozen=3/deleted=10）；' +
                'rankingType 是 RankingTypeEnum（winLose=1 營利金額 / validBet=2 有效投注）；' +
                'rankingTarget 是 RankingTargetEnum（gameBrand=1/game=2/all=3）；periodReset 是 ' +
                'ActivityRankingPeriodResetEnum（none=0/daily=1/weekly=2）。' +
                '2026-08-26 dev 實測（pk-platform.alddev.com）回傳 14 筆真實資料。',
            inputSchema: {
                page: z.number().int().min(1).default(1).describe('頁碼，從 1 開始'),
                pageSize: z.enum(PAGE_SIZE_KEYS).default('size50').describe('每頁筆數（PageSizeEnum 固定選項，非任意數字）'),
            },
        },
        async ({ page, pageSize }) => {
            const r = await withAutoRelogin(() => remote.rankingBackOffice.rankingPlatform.ListActivityRankingSetting(page, PAGE_SIZE_MAP[ pageSize ]));
            if (r.failed) return asErrorResult(r);
            return asTextResult({
                success: true,
                rows: deepFixLongs(r.data?.rows ?? []),
                totalPage: r.data?.totalPage,
            });
        },
    );
}
