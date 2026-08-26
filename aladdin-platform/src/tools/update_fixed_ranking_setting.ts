/**
 * tools/update_fixed_ranking_setting.ts — aladdin_platform_fixed_ranking_platform_update_fixed_ranking_setting
 *
 * rajah: FixedRankingPlatform.UpdateFixedRankingSetting(setting FixedRankingSettingEdit 1)
 * （ranking_back_office.rajah:243，需要 @Permission "PlatCapCfg.FixedRanking.Setting.Opt.Edit"）——
 * 編輯固定榜單（i18n name + supportedPeriods + maxDisplayCount + showUser），業務鍵是 kind
 * （@Readonly，只能用來定位既有設定，不能建立新的——固定榜單只有系統內建的三種，沒有 Create）。
 *
 * 2026-08-26 讀 agrabah 後端原始碼查證
 * （agrabah/src/servers/ranking_back_office/services/fixed_ranking_platform.ts:122-201，
 * methodUpdateFixedRankingSetting）：
 * - `supportedPeriods` 有合法性檢查（`getAllowedPeriodsForKind`）：turnover/profit 只接受
 *   thisWeek/lastWeek/thisMonth/lastMonth，contribution 只接受 allTime，帶不允許的組合直接
 *   回 invalidData；空陣列合法（=停算該榜的效能保險開關）。
 * - kind 找不到對應設定（unknown 或非法列舉值）回 invalidData。
 * - **全欄位整包覆蓋，沒有任何 partial merge**：`name`（i18n）用 `updateById` 整組覆蓋，
 *   `supportedPeriods` 是 DELETE 全部舊值 + INSERT 傳入值（純覆蓋，不是 diff），
 *   `maxDisplayCount`/`showUser` 直接覆寫成呼叫端傳入值——依 method-category-checklist.md
 *   第 4/5 節規則，本工具呼叫前必須先讀現值（`ListFixedRankingSettings` 找對應 kind），
 *   只覆蓋呼叫端明確要改的欄位，其餘原樣帶回，否則會把沒指定的欄位覆蓋成 undefined/空值。
 * - `status`/`operator` 不受影響（status 是另一支 method `ChangeFixedRankingStatus` 管的，
 *   operator 會被後端自動改成當前操作者，呼叫端不需要也不能指定）。
 *
 * **2026-08-26 已通過 dev 實測**（對 pk-platform.alddev.com 直接呼叫底層 rajah method，
 * 涵蓋：kind=contribution 帶不允許的 thisWeek → errorCode=9 invalidData；round-trip 對真實資料
 * kind=turnover 只改 maxDisplayCount（1↔2）、其餘欄位原樣帶回 → 讀回驗證變更生效 → 改回原值 →
 * 讀回驗證已復原，全程無殘留髒資料）。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { FixedRankingSettingEdit } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import {
    FIXED_RANKING_KIND_MAP, FIXED_RANKING_KIND_KEYS,
    FIXED_RANKING_PERIOD_MAP, FIXED_RANKING_PERIOD_KEYS,
    FIXED_RANKING_MAX_DISPLAY_COUNT_MAP, FIXED_RANKING_MAX_DISPLAY_COUNT_KEYS,
    ACTIVE_STATUS_MAP,
} from '../const.ts';

const localizationSchema = z.array(z.object({ code: z.string(), value: z.string() }));

export function registerUpdateFixedRankingSettingTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_fixed_ranking_platform_update_fixed_ranking_setting',
        {
            title: 'Update a fixed ranking board setting',
            description:
                '編輯本平台某一張固定榜單的設定（rajah: FixedRankingPlatform.UpdateFixedRankingSetting，' +
                '需要權限節點 PlatCapCfg.FixedRanking.Setting.Opt.Edit）。kind 只能用來定位既有的三種固定' +
                '榜單之一，不能建立新的（固定榜單沒有 Create）。**後端對 name/supportedPeriods/' +
                'maxDisplayCount/showUser 這四個欄位是整包覆蓋，沒有 partial merge**——本工具已先呼叫 ' +
                'ListFixedRankingSettings 讀現值，只覆蓋你有帶到的欄位，其餘沿用現值，不會不小心清空。' +
                'supportedPeriods 合法組合：turnover/profit（流水榜/盈利榜）只能是 thisWeek/lastWeek/' +
                'thisMonth/lastMonth 的子集，contribution（等級榜）只能是 allTime 或空陣列；帶不允許的' +
                '週期會被後端拒絕（invalidData）。空陣列合法，代表停算該榜。' +
                '**2026-08-26 dev 實測確認**上述行為與 round-trip 修改/復原。',
            inputSchema: {
                kind: z.enum(FIXED_RANKING_KIND_KEYS).describe('要編輯的固定榜單種類（業務鍵，用來定位既有設定）'),
                name: localizationSchema.optional().describe('多語名稱陣列（{code, value}），不帶則沿用現值'),
                supportedPeriods: z.array(z.enum(FIXED_RANKING_PERIOD_KEYS)).optional().describe(
                    '支援的週期清單，不帶則沿用現值。turnover/profit 限 thisWeek/lastWeek/thisMonth/lastMonth 子集；' +
                    'contribution 限 allTime 或空陣列。傳空陣列 [] 代表明確停算該榜（合法值，不是「不覆蓋」的意思——' +
                    '要沿用現值請整個省略此參數）。',
                ),
                maxDisplayCount: z.enum(FIXED_RANKING_MAX_DISPLAY_COUNT_KEYS).optional().describe('最大顯示名次，不帶則沿用現值'),
                showUser: z.enum([ 'enabled', 'disabled' ]).optional().describe('是否顯示玩家自身名次，不帶則沿用現值'),
            },
        },
        async ({ kind, name, supportedPeriods, maxDisplayCount, showUser }) => {
            const kindValue = FIXED_RANKING_KIND_MAP[ kind ];
            const listBefore = await withAutoRelogin(() => remote.rankingBackOffice.fixedRankingPlatform.ListFixedRankingSettings());
            if (listBefore.failed) return asErrorResult(listBefore);
            const before = listBefore.data?.rows?.find((row) => row.kind === kindValue);
            if (!before) {
                return asTextResult({ success: false, message: `找不到 kind=${ kind } 的固定榜單設定，非預期，請人工確認` });
            }

            const setting = FixedRankingSettingEdit.create({
                kind: kindValue,
                name: name ?? before.name,
                supportedPeriods: supportedPeriods !== undefined
                    ? supportedPeriods.map((p) => FIXED_RANKING_PERIOD_MAP[ p ])
                    : before.supportedPeriods,
                maxDisplayCount: maxDisplayCount !== undefined ? FIXED_RANKING_MAX_DISPLAY_COUNT_MAP[ maxDisplayCount ] : before.maxDisplayCount,
                showUser: showUser !== undefined ? ACTIVE_STATUS_MAP[ showUser ] : before.showUser,
            });

            const r = await withAutoRelogin(() => remote.rankingBackOffice.fixedRankingPlatform.UpdateFixedRankingSetting(setting));
            if (r.failed) return asErrorResult(r);

            const listAfter = await withAutoRelogin(() => remote.rankingBackOffice.fixedRankingPlatform.ListFixedRankingSettings());
            const after = !listAfter.failed ? listAfter.data?.rows?.find((row) => row.kind === kindValue) : undefined;

            return asTextResult({ success: true, message: '更新成功', readBack: after ?? null });
        },
    );
}
