/**
 * tools/list_fixed_ranking_settings.ts — aladdin_platform_fixed_ranking_platform_list_fixed_ranking_settings
 *
 * rajah: FixedRankingPlatform.ListFixedRankingSettings（ranking_back_office.rajah:235，
 * 需要 @Permission "PlatCapCfg.FixedRanking.Setting"）——列出本平台所有固定榜單設定
 * （後台「排行榜設置」頁面：流水榜/盈利榜/等級榜三種固定種類，非活動排行榜）。
 *
 * 2026-08-26 讀 agrabah 後端原始碼查證
 * （agrabah/src/servers/ranking_back_office/services/fixed_ranking_platform.ts:62-105，
 * methodListFixedRankingSettings）：真的查 DB（`ensureFixedRankingSettingsSeeded` 確保
 * 三種固定 kind 都已存在，缺的會自動補種預設值），非 placeholder；無參數、不分頁——
 * FixedRankingKindEnum 只有 turnover/profit/contribution 三個非 unknown 值，固定榜單種類
 * 數量不會成長，屬小型列舉表。
 *
 * 2026-08-26 dev 實測（pk-platform.alddev.com，帳號 landon001）：回傳 3 筆
 * （kind=1 流水榜／kind=2 盈利榜／kind=3 等级榜），皆 status=1 enabled。
 * `updatedAtTimestamp` 實測回傳的是十進位字串（非 number、也非 protobufjs Long 物件，
 * const.ts 的 deepFixLongs 抓不到這種形狀），額外用 Number() 轉成一般數字。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerListFixedRankingSettingsTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_fixed_ranking_platform_list_fixed_ranking_settings',
        {
            title: "List the current platform's fixed ranking settings",
            description:
                '列出本平台所有固定榜單設定（rajah: FixedRankingPlatform.ListFixedRankingSettings，' +
                '需要權限節點 PlatCapCfg.FixedRanking.Setting；後台「排行榜設置」頁面）。' +
                '固定榜單是系統內建的三種種類（非活動排行榜，不能新增/刪除，只能編輯設定），無參數、不分頁。' +
                'kind 是 FixedRankingKindEnum（turnover=1 流水榜 / profit=2 盈利榜 / contribution=3 等級榜）；' +
                'supportedPeriods 是 FixedRankingPeriodEnum 陣列（thisWeek=2/lastWeek=3/thisMonth=4/lastMonth=5 ' +
                '供流水榜盈利榜使用，allTime=6 供等級榜使用，今日 today=1 已停用僅供歷史保留）；' +
                'maxDisplayCount 是 FixedRankingMaxDisplayCountEnum（hundred=1 → 實際 100 名 / threeHundred=2 → ' +
                '實際 300 名）；showUser/status 是 ActiveStatusEnum（enabled=1/disabled=2）。' +
                '2026-08-26 dev 實測回傳 3 筆真實資料。',
            inputSchema: {},
        },
        async () => {
            const r = await withAutoRelogin(() => remote.rankingBackOffice.fixedRankingPlatform.ListFixedRankingSettings());
            if (r.failed) return asErrorResult(r);
            const rows = (r.data?.rows ?? []).map((row) => ({ ...row, updatedAtTimestamp: Number(row.updatedAtTimestamp) }));
            return asTextResult({ success: true, rows });
        },
    );
}
