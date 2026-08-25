/**
 * tools/create_or_update_point_holiday_bonus.ts — aladdin_platform_point_platform_create_or_update_point_holiday_bonus
 *
 * rajah: PointPlatform.CreateOrUpdatePointHolidayBonus（point_back_office.rajah:298，
 * 需要 @Permission "Store.Point.Activity.Holiday"）
 *
 * 分類（method-category-checklist.md 第 4 節）：id=0 新增、id>0 編輯的 upsert 慣例。
 * 本方法回傳值是 Empty（rajah 無回傳欄位），新增時無法直接拿到新 id，round-trip 讀回改用
 * GetPointHolidaySetting 撈全部 rows 後以 name 比對定位（2026-08-25 讀原始碼確認 name 未強制
 * unique，比對結果僅供輔助確認、找不到不代表寫入失敗，description 已如實揭露此限制）。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { PointHolidayBonus } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { deepFixLongs } from '../const.ts';

export function registerCreateOrUpdatePointHolidayBonusTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_point_platform_create_or_update_point_holiday_bonus',
        {
            title: 'Create or update a holiday bonus entry',
            description:
                '新增或編輯一筆節假日獎勵設置（rajah: PointPlatform.CreateOrUpdatePointHolidayBonus，需要權限節點 ' +
                'Store.Point.Activity.Holiday）。id=0（或不帶）為新增，id>0 為編輯既有設置' +
                '（id 從 aladdin_platform_point_platform_get_point_holiday_setting 的 rows 取得，編輯不存在的 id ' +
                '回錯誤碼 pointHolidayBonusNotFound）。' +
                '2026-08-25 讀原始碼查證（agrabah/src/servers/point_back_office/services/point_platform.ts:890-971）：' +
                '起訖時間會由後端依平台時區正規化為「開始日 00:00:00 ~ 結束日 23:59:59」（只精確到天，時分秒會被' +
                '覆寫，帶入時分秒無意義）；期間不可與其他未刪除設置重疊（含編輯時排除自身），重疊回錯誤碼 ' +
                'pointHolidayBonusPeriodOverlap；寫入過程有平台級 global lock 防併發重疊。' +
                '⚠️ 本 RPC 回傳值是 Empty，新增時無法直接取得新產生的 id——本工具寫入成功後改用 ' +
                'GetPointHolidaySetting 撈全部設置、以 name 比對嘗試定位剛建立的紀錄並回傳供核對，name 若與既有' +
                '設置重複可能比對到錯誤筆、或編輯後 name 也改了導致原比對邏輯失準，找不到精準匹配時會如實回報' +
                '「找不到，非失敗」而非報錯，回傳的完整清單可自行核對。' +
                'prod 執行前確認：當這個 server 是正式環境（prod）時，執行本工具前必須先用 AskUserQuestion' +
                '（或功能相同的方式）明確詢問使用者是否要在正式環境執行這個操作，取得明確同意後才可以帶上 confirm 參數；' +
                '絕不能自行假設使用者同意。非 prod 環境不需要、也會忽略 confirm 欄位。',
            inputSchema: {
                id: z.number().int().min(0).default(0).describe('0 或不帶＝新增；>0＝編輯該 id 既有設置'),
                name: z.string().min(1).max(50).describe('節假日名稱'),
                startedAtTimestamp: z.number().int().describe('開始時間（毫秒 epoch），後端只取日期部分正規化為當日 00:00:00'),
                endedAtTimestamp: z.number().int().describe('結束時間（毫秒 epoch），後端只取日期部分正規化為當日 23:59:59'),
                signInMultiplier: z.number().int().min(1).describe('簽到積分倍數，須 ≥1'),
                turnoverMultiplier: z.number().int().min(1).describe('流水返利倍數，須 ≥1'),
                confirm: z.string().optional().describe(
                    `正式環境（prod）專用的強制確認欄位；非 prod 環境會被忽略、不需提供。當這個 server 是正式環境時，` +
                    `必須先取得使用者明確同意，再帶上精確字串 "${ PROD_CONFIRM_TOKEN }" 才會執行，否則本工具會拒絕執行並回錯誤。`,
                ),
            },
        },
        async (input) => {
            assertProdConfirmed(input.confirm);

            const bonus = PointHolidayBonus.create({
                id: input.id,
                name: input.name,
                startedAtTimestamp: input.startedAtTimestamp,
                endedAtTimestamp: input.endedAtTimestamp,
                signInMultiplier: input.signInMultiplier,
                turnoverMultiplier: input.turnoverMultiplier,
            });

            const r = await withAutoRelogin(() => remote.pointBackOffice.pointPlatform.CreateOrUpdatePointHolidayBonus(bonus));
            if (r.failed) return asErrorResult(r);

            const checkR = await withAutoRelogin(() => remote.pointBackOffice.pointPlatform.GetPointHolidaySetting());
            const rows = deepFixLongs(checkR.failed ? [] : (checkR.data?.rows ?? []));
            const matched = input.id > 0
                ? rows.find((row) => row.id === input.id)
                : rows.find((row) => row.name === input.name);

            return asTextResult({
                success: true,
                message: input.id > 0 ? '節假日設置已更新' : '節假日設置已新增',
                readBack: matched ?? { note: '以 name 比對沒找到精準匹配，非失敗；請自行核對下方完整清單', rows },
            });
        },
    );
}
