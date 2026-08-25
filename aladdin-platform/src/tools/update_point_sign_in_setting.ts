/**
 * tools/update_point_sign_in_setting.ts — aladdin_platform_point_platform_update_point_sign_in_setting
 *
 * rajah: PointPlatform.GetPointSignInSetting + UpdatePointSignInSetting（point_back_office.rajah:275,278，
 * 需要 @Permission "Store.Point.Activity.SignIn"）
 *
 * 分類（method-category-checklist.md 第 4 節「Upsert」精神）：吃整包 PointSignInSettingEdit，
 * 先讀現值、只覆蓋呼叫端明確帶的欄位、完成後 round-trip。streakBonuses 是整組全量替換
 * （DELETE + INSERT，2026-08-25 讀 point_platform.ts:767-813 查證），非增量。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { PointSignInSettingEdit, PointSignInStreakBonus, CurrencyLink } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { ACTIVE_STATUS_MAP, deepFixLongs } from '../const.ts';

const currencyLinkSchema = z.array(z.object({
    code: z.string().describe('幣別代碼，如 CNY/USD'),
    value: z.number().int().describe('該幣別的儲存金額（依 @Type "Currency" 規則存放，非顯示用小數）'),
})).describe('多幣別陣列，每種平台幣別各一筆');

export function registerUpdatePointSignInSettingTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_point_platform_update_point_sign_in_setting',
        {
            title: 'Update sign-in reward settings',
            description:
                '更新本平台「商城系統 > 積分管理 > 積分活動 > 簽到獎勵」的設定並儲存（rajah: ' +
                'PointPlatform.GetPointSignInSetting 讀現值 + UpdatePointSignInSetting 寫入，需要權限節點 ' +
                'Store.Point.Activity.SignIn）。無參數 platformId，單例設定。所有欄位皆為 optional：只帶你要改的' +
                '欄位，其餘先讀現值原樣帶回。⚠️ streakBonuses 若帶入，是**整組全量替換**（後端先刪除全部舊紀錄再' +
                '整批新增，2026-08-25 讀 agrabah/src/servers/point_back_office/services/point_platform.ts:767-813 ' +
                '查證），不是增量新增／單筆修改——若只想改其中一天的倍率，仍須帶入完整清單，否則其餘天數的設定會' +
                '一併消失。days 必須是正整數且不可重複，baseReward 必須 ≥1，違反會回 invalidData 錯誤，不會寫入。' +
                '完成後會自動讀回最新設定一併回傳。' +
                'prod 執行前確認：當這個 server 是正式環境（prod）時，執行本工具前必須先用 AskUserQuestion' +
                '（或功能相同的方式）明確詢問使用者是否要在正式環境執行這個操作，取得明確同意後才可以帶上 confirm 參數；' +
                '絕不能自行假設使用者同意。非 prod 環境不需要、也會忽略 confirm 欄位。',
            inputSchema: {
                status: z.enum([ 'enabled', 'disabled' ]).optional().describe('簽到獎勵開關'),
                depositCondition: z.enum([ 'daily' ]).optional().describe('簽到充值條件：daily=每日充值達門檻才可簽到'),
                depositAmounts: currencyLinkSchema.optional().describe('充值額度達成門檻（多幣別）'),
                baseReward: z.number().int().min(1).optional().describe('簽到基礎獎勵積分數量，必須 ≥1'),
                streakBonuses: z.array(z.object({
                    days: z.number().int().min(1).describe('連續簽到天數，須為正整數且不可與其他項目重複'),
                    multiplier: z.number().int().min(1).describe('該天數對應的積分倍率，須為正整數'),
                })).optional().describe('⚠️ 整組全量替換，不是增量新增——若帶入，須為完整清單'),
                confirm: z.string().optional().describe(
                    `正式環境（prod）專用的強制確認欄位；非 prod 環境會被忽略、不需提供。當這個 server 是正式環境時，` +
                    `必須先取得使用者明確同意，再帶上精確字串 "${ PROD_CONFIRM_TOKEN }" 才會執行，否則本工具會拒絕執行並回錯誤。`,
                ),
            },
        },
        async (input) => {
            assertProdConfirmed(input.confirm);

            const getR = await withAutoRelogin(() => remote.pointBackOffice.pointPlatform.GetPointSignInSetting());
            if (getR.failed) return asErrorResult(getR);
            const base = getR.data?.settingEdit;
            if (!base) return asTextResult({ success: false, message: '讀取目前設定失敗：後端回傳空值' });

            const overrides: Record<string, unknown> = {};
            if (input.status !== undefined) overrides.status = ACTIVE_STATUS_MAP[ input.status ];
            if (input.depositCondition !== undefined) overrides.depositCondition = 1; // daily=1（PointSignInDepositConditionEnum）
            if (input.depositAmounts !== undefined) overrides.depositAmounts = input.depositAmounts.map((link) => CurrencyLink.create(link));
            if (input.baseReward !== undefined) overrides.baseReward = input.baseReward;
            if (input.streakBonuses !== undefined) overrides.streakBonuses = input.streakBonuses.map((bonus) => PointSignInStreakBonus.create(bonus));

            const merged = PointSignInSettingEdit.create({ ...base, ...overrides });

            const setR = await withAutoRelogin(() => remote.pointBackOffice.pointPlatform.UpdatePointSignInSetting(merged));
            if (setR.failed) return asErrorResult(setR);

            const checkR = await withAutoRelogin(() => remote.pointBackOffice.pointPlatform.GetPointSignInSetting());
            return asTextResult({
                success: true,
                message: '簽到獎勵設定已更新',
                settingEdit: checkR.failed ? null : deepFixLongs(checkR.data?.settingEdit),
            });
        },
    );
}
