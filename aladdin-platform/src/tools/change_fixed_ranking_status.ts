/**
 * tools/change_fixed_ranking_status.ts — aladdin_platform_fixed_ranking_platform_change_fixed_ranking_status
 *
 * rajah: FixedRankingPlatform.ChangeFixedRankingStatus(kind FixedRankingKindEnum 1, status ActiveStatusEnum 2)
 * （ranking_back_office.rajah:239，需要 @Permission "PlatCapCfg.FixedRanking.Setting.Status"）——
 * 啟用/停用整張固定榜單（後台「排行榜設置」頁面的開關）。
 *
 * 2026-08-26 讀 agrabah 後端原始碼查證
 * （agrabah/src/servers/ranking_back_office/services/fixed_ranking_platform.ts:211-245，
 * methodChangeFixedRankingStatus）：kind 找不到對應設定（`ensureFixedRankingSettingsSeeded`
 * 已確保 turnover/profit/contribution 三個真實 kind 都存在，只有 kind=unknown(0) 或非法列舉值
 * 才會找不到）回 `invalidData`（不是 objectNotFound，跟同 domain 其他方法的錯誤碼慣例不同，
 * 已如實記錄）。
 *
 * **2026-08-26 已通過 dev 實測**（對 pk-platform.alddev.com 直接呼叫底層 rajah method，
 * 涵蓋：kind=unknown(0) → errorCode=9 invalidData；status 非法列舉值 254 → errorCode=9；
 * round-trip 對真實資料 kind=1 切換 enabled→disabled→讀回驗證變更生效→切回 enabled→
 * 讀回驗證已復原，全程無殘留髒資料）。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { ACTIVE_STATUS_MAP, FIXED_RANKING_KIND_MAP, FIXED_RANKING_KIND_KEYS } from '../const.ts';

export function registerChangeFixedRankingStatusTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_fixed_ranking_platform_change_fixed_ranking_status',
        {
            title: 'Enable or disable a fixed ranking board',
            description:
                '啟用/停用本平台某一張固定榜單（rajah: FixedRankingPlatform.ChangeFixedRankingStatus，' +
                '需要權限節點 PlatCapCfg.FixedRanking.Setting.Status）。kind 是固定的三種榜單種類' +
                '（來自 aladdin_platform_fixed_ranking_platform_list_fixed_ranking_settings 的 kind 欄位）。' +
                '**2026-08-26 dev 實測確認**：kind 不存在（如 unknown）或 status 帶非法列舉值皆回 ' +
                'invalidData；目標狀態與現值相同時呼叫仍會成功（冪等 no-op）。',
            inputSchema: {
                kind: z.enum(FIXED_RANKING_KIND_KEYS).describe('固定榜單種類：turnover 流水榜 / profit 盈利榜 / contribution 等級榜'),
                status: z.enum([ 'enabled', 'disabled' ]).describe('目標狀態'),
            },
        },
        async ({ kind, status }) => {
            const r = await withAutoRelogin(() => remote.rankingBackOffice.fixedRankingPlatform.ChangeFixedRankingStatus(
                FIXED_RANKING_KIND_MAP[ kind ], ACTIVE_STATUS_MAP[ status ],
            ));
            if (r.failed) return asErrorResult(r);
            return asTextResult({ success: true, message: '狀態已更新' });
        },
    );
}
