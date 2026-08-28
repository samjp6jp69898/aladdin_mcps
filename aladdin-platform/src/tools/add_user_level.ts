/**
 * tools/add_user_level.ts — aladdin_platform_user_level_add
 *
 * rajah: UserLevel.Add(@Validate userLevel UserLevelConfig 1) (id i32 1)
 * （user_level_back_office.rajah:223，@LoginRequired、無 @Permission）——後台「會員管理」→
 * 「會員層級」的「新增層級」。
 *
 * 2026-08-28 讀 agrabah 後端原始碼查證
 * （agrabah/src/servers/user_level_back_office/services/user_level.ts:66-135，methodAdd）：
 * 真的寫 DB、非 placeholder。四個要寫進 description 的事實：
 * 1. **只有 type/name/color/level 會被寫入**（user_level.ts:97-103），UserLevelConfig 其餘欄位
 *    （strategyRules/userCount/id）呼叫端帶了也不生效。
 * 2. **type=auto 時 level 由後端自動指派**：先 insert 一筆空的 DbUserLevelStrategyRule，再取
 *    目前最大 auto level +1（沒有任何 auto 層級時給 1，user_level.ts:73-96），呼叫端帶的 level 會被覆蓋。
 * 3. **type=static 時 level 原樣採用呼叫端的值**（user_level.ts:99），後端不檢查、不自動編號；
 *    dev 實測既有固定層級的 level 全為 0（前端固定送 0），所以本 tool 的 level 預設 0。
 * 4. 後端**沒有任何名稱唯一性檢查**，同名層級可以無限建立。因此本 tool 依 method-category-checklist.md
 *    第 3 節「有天然業務鍵的建議/強制先查重再建立」，預設先用 GetNameList 查同名層級，撞名就
 *    直接擋下並回報既有 id，除非呼叫端明確帶 allowDuplicateName=true。
 *
 * 分類（method-category-checklist.md 第 3 節「寫入 — 新增」）：
 * - 先查重（見上）。
 * - 完成後用回傳 id 做 round-trip 驗證：本 tool 在 Add 成功後再呼叫一次 GetNameList，確認新 id
 *   真的存在且 name/type/color 與送出值一致，才回報 success（不以「RPC 沒報錯」當作業務成功）。
 * - 冪等性：這支是真正的 insert，**重複呼叫會產生多筆不同 id 的層級**，不可自動重試。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { UserLevelConfig } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { USER_LEVEL_TYPE_KEYS, USER_LEVEL_TYPE_MAP } from '../const.ts';

export function registerAddUserLevelTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_user_level_add',
        {
            title: 'Create a new user level on the current platform',
            description:
                '在本平台新增一個會員層級（rajah: UserLevel.Add，後台「會員管理」→「會員層級」→「新增」）。' +
                '**這是真正的新增，重複呼叫會建立多筆同名不同 id 的層級，失敗時不要自動重試。** ' +
                'type=auto（自動層級）時 level 由後端自動指派為「目前最大 auto level + 1」，帶了也會被覆蓋；' +
                'type=static（固定層級）時 level 原樣採用呼叫端的值，後端不檢查也不編號（dev 現況全為 0，故預設 0）。' +
                '後端只寫入 type/name/color/level 四個欄位，其餘欄位帶了不生效。' +
                '後端沒有名稱唯一性檢查，所以本 tool 預設先查同名層級、撞名就擋下並回報既有 id；' +
                '確定要建立同名層級時才帶 allowDuplicateName=true。' +
                '建立成功後本 tool 會自動再查一次層級清單做 round-trip 驗證，確認 name/type/color 與送出值一致。' +
                '新增的層級預設沒有任何會員，可用 aladdin_platform_user_level_delete 刪除（只要會員數為 0）。' +
                '2026-08-28 dev 實測（pk-platform.alddev.com）：建立 static 層級並 round-trip 驗證、' +
                '撞名擋下、測試資料建立後即刪除復原，皆已驗過。',
            inputSchema: {
                name: z.string().min(1).max(30).describe('層級名稱，必填，最長 30 字（rajah @Rules "Required; MaxLength(30)"）'),
                type: z.enum(USER_LEVEL_TYPE_KEYS).describe('層級種類：auto=自動層級（level 由後端自動編號）／static=固定層級'),
                color: z.number().int().min(0).default(0).describe('後台色票的整數表示（例如 16711680 為紅色），預設 0'),
                level: z.number().int().min(0).default(0).describe('層級序數，只有 type=static 時有意義（後端原樣寫入）；type=auto 時後端會覆蓋成自動編號'),
                allowDuplicateName: z.boolean().default(false).describe('預設 false：發現同名層級就擋下不建立。確定要建立同名層級時才設 true'),
            },
        },
        async ({ name, type, color, level, allowDuplicateName }) => {
            const typeValue = USER_LEVEL_TYPE_MAP[ type ];

            // 查重：後端無唯一性檢查，撞名預設擋下（method-category-checklist.md 第 3 節）
            const before = await withAutoRelogin(() => remote.userLevelBackOffice.userLevel.GetNameList());
            if (before.failed) return asErrorResult(before, { hint: '查重用的層級清單讀取失敗，為避免建立重複層級，本次未執行新增' });
            const beforeRows = before.data?.rows ?? [];
            const duplicated = beforeRows.filter((row) => row.name === name);
            if (duplicated.length > 0 && !allowDuplicateName) {
                return asTextResult({
                    success: false,
                    reason: 'DUPLICATE_NAME',
                    message: `已存在同名層級（${ duplicated.map((row) => `id=${ row.id }`).join(', ') }），未建立新層級`,
                    existing: duplicated,
                    hint: '確定要另外建立一個同名層級，請重新呼叫並帶 allowDuplicateName=true；若只是要改既有層級，改用 aladdin_platform_user_level_update',
                });
            }

            const payload = UserLevelConfig.create({ name, color, level, type: typeValue });
            const r = await withAutoRelogin(() => remote.userLevelBackOffice.userLevel.Add(payload));
            if (r.failed) return asErrorResult(r);

            const newId = r.data?.id;

            // round-trip：不以「RPC 沒報錯」當作業務成功，回讀確認真的建立且欄位一致
            const after = await withAutoRelogin(() => remote.userLevelBackOffice.userLevel.GetNameList());
            if (after.failed) {
                return asTextResult({
                    success: true,
                    id: newId,
                    verified: false,
                    hint: '新增的 RPC 已成功，但 round-trip 回讀層級清單失敗，請自行用 aladdin_platform_user_level_get_name_list 確認',
                });
            }
            const created = (after.data?.rows ?? []).find((row) => row.id === newId);
            if (!created) {
                return asTextResult({
                    success: false,
                    id: newId,
                    verified: false,
                    reason: 'NOT_FOUND_AFTER_CREATE',
                    message: '新增 RPC 回報成功，但回讀層級清單找不到這個 id，請人工確認 dev 上的實際狀態',
                });
            }
            const matched = created.name === name && created.type === typeValue && created.color === color;
            return asTextResult({
                success: true,
                id: newId,
                verified: matched,
                created,
                ...(matched ? {} : { hint: '回讀到的欄位與送出值不一致（後端可能有自己的覆寫邏輯，例如 auto 型的 level 自動編號），請比對 created 內容' }),
            });
        },
    );
}
