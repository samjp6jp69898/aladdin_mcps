/**
 * tools/update_vip_point_setting.ts — aladdin_platform_point_platform_update_vip_point_setting
 *
 * rajah: PointPlatform.GetVipPointSetting + UpdateVipPointSetting（point_back_office.rajah:264,267，
 * 需要 @Permission "Store.Point.Setting.Ops.Edit"）
 *
 * 分類（method-category-checklist.md 第 4 節「Upsert」精神）：UpdateVipPointSetting 吃整包
 * VipPointSettingEdit，先讀現值、只覆蓋呼叫端明確帶的欄位、完成後 round-trip。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { VipPointSettingEdit, DisplayTagPointRebate, CurrencyLink } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { ACTIVE_STATUS_MAP, GAME_DISPLAY_TAG_KEYS, GAME_DISPLAY_TAG_MAP, deepFixLongs } from '../const.ts';

const currencyLinkSchema = z.array(z.object({
    code: z.string().describe('幣別代碼，如 CNY/USD'),
    value: z.number().int().describe('該幣別的儲存值（已依 @Type "Percent:100000" 放大，非顯示用小數）'),
})).describe('多幣別陣列，每種平台幣別各一筆');

export function registerUpdateVipPointSettingTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_point_platform_update_vip_point_setting',
        {
            title: 'Update a VIP level point rebate setting',
            description:
                '更新指定 VIP 層級的積分返利設定並儲存（rajah: PointPlatform.GetVipPointSetting 讀現值 + ' +
                'UpdateVipPointSetting 寫入，需要權限節點 Store.Point.Setting.Ops.Edit）。vipLevelSettingId 從 ' +
                'aladdin_platform_point_platform_list_vip_point_settings 取得，必填、用來鎖定目標層級。' +
                '其餘欄位皆為 optional：只帶你要改的欄位，其餘先讀現值原樣帶回。' +
                'rebateRateDefault/displayTagPointRebates[].rate 是「積分返利比例」（rajah `@Type "Percent:100000"`），' +
                '傳入的 value 必須是已放大 100000 倍的整數（例如要設 1% 傳 1000，不是傳 0.01 或 1）；' +
                '每個陣列元素代表一種平台幣別，code 用平台既有的幣別代碼（不驗證是否為合法平台幣別，帶錯代碼會' +
                '寫入一筆該工具無法識別的孤兒設定，建議先用 aladdin_platform_point_platform_get_vip_point_setting ' +
                '讀現值確認目前使用的幣別代碼）。displayTagPointRebates 若帶入，需涵蓋完整的遊戲分類清單' +
                '（slot/board/fish/live/sport/eSport/lottery），2026-08-25 讀原始碼查證' +
                '（point_platform.ts:572-643）後端是逐分類個別 UPDATE，未帶到的分類維持讀回的現值、不會清空。' +
                '完成後會自動讀回最新設定一併回傳。' +
                'prod 執行前確認：當這個 server 是正式環境（prod）時，執行本工具前必須先用 AskUserQuestion' +
                '（或功能相同的方式）明確詢問使用者是否要在正式環境執行這個操作，取得明確同意後才可以帶上 confirm 參數；' +
                '絕不能自行假設使用者同意。非 prod 環境不需要、也會忽略 confirm 欄位。',
            inputSchema: {
                vipLevelSettingId: z.number().int().describe('VIP 層級 id，來自 aladdin_platform_point_platform_list_vip_point_settings 的回傳結果'),
                rebateMax: z.number().int().min(0).optional().describe('積分返利上限（原始整數值，非放大值）'),
                userLevelStatus: z.enum([ 'enabled', 'disabled' ]).optional().describe('用戶層級參與限制開關'),
                userLevelIds: z.array(z.number().int()).optional().describe('參與此積分返利規則的會員層級 id 清單（整批覆蓋）'),
                rebateRateDefault: currencyLinkSchema.optional().describe('積分返利比例預設值（多幣別，見上方 description 換算說明）'),
                displayTagPointRebates: z.array(z.object({
                    displayTag: z.enum(GAME_DISPLAY_TAG_KEYS).describe('遊戲分類'),
                    rate: currencyLinkSchema.describe('該遊戲分類的積分返利比例（多幣別，見上方 description 換算說明）'),
                })).optional().describe('依遊戲分類個別設定的積分返利比例，未帶到的分類維持現值'),
                confirm: z.string().optional().describe(
                    `正式環境（prod）專用的強制確認欄位；非 prod 環境會被忽略、不需提供。當這個 server 是正式環境時，` +
                    `必須先取得使用者明確同意，再帶上精確字串 "${ PROD_CONFIRM_TOKEN }" 才會執行，否則本工具會拒絕執行並回錯誤。`,
                ),
            },
        },
        async (input) => {
            assertProdConfirmed(input.confirm);

            const getR = await withAutoRelogin(() => remote.pointBackOffice.pointPlatform.GetVipPointSetting(input.vipLevelSettingId));
            if (getR.failed) return asErrorResult(getR);
            const base = getR.data?.settingEdit;
            if (!base) return asTextResult({ success: false, message: '讀取目前設定失敗：後端回傳空值' });

            const overrides: Record<string, unknown> = {};
            if (input.rebateMax !== undefined) overrides.rebateMax = input.rebateMax;
            if (input.userLevelStatus !== undefined) overrides.userLevelStatus = ACTIVE_STATUS_MAP[ input.userLevelStatus ];
            if (input.userLevelIds !== undefined) overrides.userLevelIds = input.userLevelIds;
            if (input.rebateRateDefault !== undefined) {
                overrides.rebateRateDefault = input.rebateRateDefault.map((link) => CurrencyLink.create(link));
            }
            if (input.displayTagPointRebates !== undefined) {
                // 只覆蓋呼叫端明確帶到的分類，其餘沿用讀回現值（displayTag 對應同一份陣列）。
                const overrideByTag = new Map(input.displayTagPointRebates.map((row) => [ GAME_DISPLAY_TAG_MAP[ row.displayTag ], row.rate ]));
                overrides.displayTagPointRebates = (base.displayTagPointRebates ?? []).map((existing) => {
                    const overrideRate = overrideByTag.get(existing.displayTag ?? 0);
                    if (overrideRate === undefined) return DisplayTagPointRebate.create(existing);
                    return DisplayTagPointRebate.create({ displayTag: existing.displayTag, rate: overrideRate.map((link) => CurrencyLink.create(link)) });
                });
            }

            const merged = VipPointSettingEdit.create({ ...base, ...overrides, vipLevelSettingId: input.vipLevelSettingId });

            const setR = await withAutoRelogin(() => remote.pointBackOffice.pointPlatform.UpdateVipPointSetting(merged));
            if (setR.failed) return asErrorResult(setR);

            const checkR = await withAutoRelogin(() => remote.pointBackOffice.pointPlatform.GetVipPointSetting(input.vipLevelSettingId));
            return asTextResult({
                success: true,
                message: 'VIP 積分設定已更新',
                settingEdit: checkR.failed ? null : deepFixLongs(checkR.data?.settingEdit),
            });
        },
    );
}
