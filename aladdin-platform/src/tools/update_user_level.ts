/**
 * tools/update_user_level.ts — aladdin_platform_user_level_update
 *
 * rajah: UserLevel.Update(@Validate userLevel UserLevelConfig 1)
 * （user_level_back_office.rajah:225，@LoginRequired、無 @Permission）——後台「會員管理」→
 * 「會員層級」的「編輯」（只改顯示名稱與顏色）。
 *
 * 2026-08-28 讀 agrabah 後端原始碼查證
 * （agrabah/src/servers/user_level_back_office/services/user_level.ts:317-364，methodUpdate）：
 * 真的寫 DB、非 placeholder。三個要寫進 description 的事實：
 * 1. **只有 name 與 color 會被寫回**（user_level.ts:336-338），level/type/strategyRules 帶了也不會變——
 *    要改 auto 層級的排序位置得走 ChangeAutoLevel（本 tool 不涵蓋）。
 * 2. **name/color 是無條件覆蓋**（不是「有帶才改」的稀疏合併）：後端直接把 payload 的兩個值寫進 DB，
 *    沒帶就等於送 protobuf 預設值（空字串／0），會把原本的名稱清空、顏色歸零。
 *    因此本 tool 依 method-category-checklist.md 第 4 節的操作性要求，**一律先讀現值**
 *    （GetNameList 取得該 id 的 name/color），只覆蓋呼叫端明確要改的欄位，其餘原樣帶回。
 * 3. id 不存在（或不屬於本平台）時回 idNotExists（user_level.ts:325-327）。
 *
 * 分類：本質是「用 id 定位的部分欄位更新」，套用第 4 節的先讀現值 + round-trip 逐欄比對要求：
 * 更新後回讀 GetNameList，確認要改的欄位已生效、**沒要求變更的欄位仍等於呼叫前的值**。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { UserLevelConfig } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerUpdateUserLevelTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_user_level_update',
        {
            title: 'Update the name/color of an existing user level',
            description:
                '修改本平台既有會員層級的名稱與顏色（rajah: UserLevel.Update，後台「會員管理」→「會員層級」→「編輯」）。' +
                '**後端只會寫回 name 與 color 兩個欄位**，層級種類（type）、層級序數（level）、策略規則都改不了；' +
                '要調整 auto 層級的排序位置是另一支 method（ChangeAutoLevel），本 tool 不涵蓋。' +
                '後端對 name/color 是**無條件覆蓋**（沒帶就會被寫成空字串／0），所以本 tool 一律先讀現值再合併：' +
                '只帶 name 就只改名稱、顏色維持原值；只帶 color 就只改顏色、名稱維持原值；兩個都不帶會直接擋下不呼叫。' +
                '更新後會自動回讀做 round-trip 驗證，逐欄比對「有要求變更的欄位已生效」且' +
                '「沒要求變更的欄位仍等於呼叫前的值」，verified=true 才代表確實成功。' +
                'id 用 aladdin_platform_user_level_get_name_list 取得；id 不存在時後端回 idNotExists。' +
                '2026-08-28 dev 實測（pk-platform.alddev.com）：只改名稱（顏色不動）、只改顏色（名稱不動）、' +
                '兩者都改，三種情境的 round-trip 逐欄比對皆通過，測試層級測完即刪除復原。',
            inputSchema: {
                id: z.number().int().describe('要修改的會員層級 id；用 aladdin_platform_user_level_get_name_list 取得合法值'),
                name: z.string().min(1).max(30).optional().describe('新的層級名稱，最長 30 字；不帶代表不改（沿用現值）'),
                color: z.number().int().min(0).optional().describe('新的色票整數值；不帶代表不改（沿用現值）'),
            },
        },
        async ({ id, name, color }) => {
            if (name === undefined && color === undefined) {
                return asTextResult({
                    success: false,
                    reason: 'NOTHING_TO_UPDATE',
                    message: 'name 與 color 都沒有帶，沒有任何要修改的欄位，未呼叫後端',
                });
            }

            // 先讀現值（第 4 節硬性要求）：後端是無條件覆蓋，沒讀現值就送出等於把沒帶的欄位清掉
            const before = await withAutoRelogin(() => remote.userLevelBackOffice.userLevel.GetNameList());
            if (before.failed) return asErrorResult(before, { hint: '讀取現值失敗，為避免把未指定的欄位覆蓋成空值，本次未執行更新' });
            const current = (before.data?.rows ?? []).find((row) => row.id === id);
            if (!current) {
                return asTextResult({
                    success: false,
                    reason: 'NOT_FOUND',
                    message: `層級 id=${ id } 不存在或已被刪除，未執行更新`,
                    hint: '用 aladdin_platform_user_level_get_name_list 確認目前可用的層級 id',
                });
            }

            const nextName = name ?? current.name;
            const nextColor = color ?? current.color;
            const payload = UserLevelConfig.create({ id, name: nextName, color: nextColor });
            const r = await withAutoRelogin(() => remote.userLevelBackOffice.userLevel.Update(payload));
            if (r.failed) return asErrorResult(r);

            // round-trip：逐欄比對（含「沒要求改的欄位是否被動到」）
            const after = await withAutoRelogin(() => remote.userLevelBackOffice.userLevel.GetNameList());
            if (after.failed) {
                return asTextResult({ success: true, id, verified: false, before: current, hint: '更新 RPC 已成功，但回讀確認失敗，請自行用 aladdin_platform_user_level_get_name_list 確認' });
            }
            const updated = (after.data?.rows ?? []).find((row) => row.id === id);
            if (!updated) {
                return asTextResult({ success: false, id, verified: false, reason: 'NOT_FOUND_AFTER_UPDATE', before: current, message: '更新 RPC 回報成功，但回讀找不到這個 id，請人工確認 dev 上的實際狀態' });
            }
            const nameOk = updated.name === nextName;
            const colorOk = updated.color === nextColor;
            // nameOk/colorOk 已涵蓋「有帶到的欄位是否生效」與「沒帶到的欄位是否維持現值」
            //（沒帶時 nextName/nextColor 就等於現值），這裡只補查後端不該動、本 tool 也沒送的欄位。
            const untouchedOk = updated.type === current.type;
            const verified = nameOk && colorOk && untouchedOk;
            return asTextResult({
                success: true,
                id,
                verified,
                before: current,
                after: updated,
                ...(verified ? {} : { hint: 'round-trip 比對不一致：請檢查 before/after，可能有未預期的後端覆寫行為' }),
            });
        },
    );
}
