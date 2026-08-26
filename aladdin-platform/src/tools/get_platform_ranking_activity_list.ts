/**
 * tools/get_platform_ranking_activity_list.ts — aladdin_platform_ranking_platform_get_platform_ranking_activity_list
 *
 * rajah: RankingPlatform.GetPlatformRankingActivityList（ranking_back_office.rajah:107，
 * 無 @Permission，任何已登入身分皆可呼叫）——回傳當前平台「展示期間尚未結束」的活動排行榜
 * id + 多語名稱精簡清單，供其他表單的下拉選單使用（如活動配置勾選要疊加的排行榜）。
 *
 * 2026-08-26 讀 agrabah 後端原始碼查證
 * （agrabah/src/servers/ranking_back_office/services/ranking_platform.ts:315-326，
 * methodGetPlatformRankingActivityList）：真的查 DB，`WHERE platform_id = ? AND
 * exhibit_end_timestamp > now()`，非 placeholder。**這不是「本平台全部活動排行榜」**——
 * 展示期間已結束的設定不會出現在這裡，即使 status 仍是 enabled；要看完整清單（含已過期）
 * 用 aladdin_platform_ranking_platform_list_activity_ranking_setting。
 *
 * 2026-08-26 dev 實測（pk-platform.alddev.com，帳號 landon001）：
 * 對照 list_activity_ranking_settings 同時期回傳的 14 筆全量設定，本方法只回傳其中 5 筆
 * （展示期尚未結束的），確認過濾邏輯符合預期。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerGetPlatformRankingActivityListTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_ranking_platform_get_platform_ranking_activity_list',
        {
            title: "Get the current platform's still-exhibiting ranking activities (id + name)",
            description:
                '取得當前平台（登入身分綁定的 platformId）**展示期間尚未結束**的活動排行榜 id + 多語名稱' +
                '精簡清單（rajah: RankingPlatform.GetPlatformRankingActivityList，無參數，無權限節點限制）。' +
                '⚠️ 這不是「本平台全部活動排行榜」：後端過濾條件是 exhibitEndTimestamp > 現在時間，展示期已結束的' +
                '設定即使 status 仍是 enabled 也不會出現在這裡。要看完整清單（含已過期/已停用）改用 ' +
                'aladdin_platform_ranking_platform_list_activity_ranking_setting。' +
                '2026-08-26 dev 實測：同時期全量清單有 14 筆，本方法只回傳其中 5 筆展示中的。',
            inputSchema: {},
        },
        async () => {
            const r = await withAutoRelogin(() => remote.rankingBackOffice.rankingPlatform.GetPlatformRankingActivityList());
            if (r.failed) return asErrorResult(r);
            return asTextResult({ success: true, rows: r.data?.rows ?? [] });
        },
    );
}
