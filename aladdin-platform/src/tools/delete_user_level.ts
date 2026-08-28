/**
 * tools/delete_user_level.ts — aladdin_platform_user_level_delete
 *
 * rajah: UserLevel.Delete(id i32 1)（user_level_back_office.rajah:227，@LoginRequired、無 @Permission）
 * ——後台「會員管理」→「會員層級」的「刪除」。
 *
 * 2026-08-28 讀 agrabah 後端原始碼查證
 * （agrabah/src/servers/user_level_back_office/services/user_level.ts:239-311，methodDelete）：
 * 真的寫 DB、非 placeholder。四個要寫進 description 的事實（method-category-checklist.md 第 7 節
 * 明列「軟刪/硬刪必須查證、冪等性必須實測」）：
 * 1. **軟刪除**：`deleted = 1`，資料列仍在（user_level.ts:257-259），不是硬刪。
 * 2. **有會員就擋**：先 count DbUserLevel，>0 時回 requestNotValid 且訊息是後端硬編碼的簡中字串
 *    「会员人数不为0，无法删除」（user_level.ts:249-254）。要先把會員調到別的層級才刪得掉。
 * 3. **不存在的 id 直接回成功**（user_level.ts:245-248 load 不到就 `return GenieResult.success`），
 *    不會報錯——所以「RPC 成功」不等於「真的刪到東西」。本 tool 因此在刪除前先查一次層級清單確認
 *    目標存在、刪除後再查一次確認已消失，兩段都不成立就據實回報，不讓呼叫端誤以為刪成功。
 * 4. **刪除 auto 型層級會連帶重排其餘 auto 層級的 level**（1,2,3… 連號，user_level.ts:262-274）——
 *    這是會改到「其他層級」資料的副作用，必須在 description 講明。
 *
 * 冪等性（第 7 節要求實測）：後端**讀原始碼**確認對不存在/已刪除的 id 是 `return GenieResult.success`
 * （user_level.ts:245-248），也就是重複刪除不會噴錯；但 2026-08-28 的 dev 實測**沒有**直接對後端打這個情境
 * ——因為本 tool 的 pre-check 會先攔下不存在的 id 回報 NOT_FOUND（這條路徑已實測），不會把它包裝成
 * 「刪除成功」。要驗證後端原始行為需繞過本 tool 直接打 RPC，本輪未做。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { USER_LEVEL_TYPE_MAP } from '../const.ts';

export function registerDeleteUserLevelTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_user_level_delete',
        {
            title: 'Delete (soft) a user level on the current platform',
            description:
                '刪除本平台的一個會員層級（rajah: UserLevel.Delete，後台「會員管理」→「會員層級」→「刪除」）。' +
                '**軟刪除**（deleted=1），資料列仍留在 DB，但之後所有查詢都看不到，且本 tool 無法復原——' +
                '要復原需要人工改 DB。' +
                '**該層級底下還有會員時後端會擋下**（回 requestNotValid，訊息為後端硬編碼的「会员人数不为0，无法删除」），' +
                '要先把會員調到別的層級才刪得掉——**目前沒有對應的 MCP tool 可做這件事**' +
                '（rajah 有 UserLevel.changeUserLevel，但因為它會寫入無法刪除的層級變更紀錄，尚未包成 tool），' +
                '請改由後台操作或請開發者處理。用 aladdin_platform_user_level_get_list 的 userCount 可以先確認人數。' +
                '**刪除 auto（自動）層級會連帶把其餘 auto 層級的 level 重排成 1,2,3… 連號**，' +
                '也就是會改到其他層級的資料，不只影響被刪的那一筆；刪除 static（固定）層級沒有這個副作用。' +
                '注意後端對「不存在的 id」是直接回成功而不報錯，所以本 tool 會先查一次層級清單確認目標存在' +
                '（不存在直接回 NOT_FOUND、不呼叫刪除），刪除後再回讀一次確認真的消失，' +
                'verified=true 才代表確實刪除成功。' +
                'id 用 aladdin_platform_user_level_get_name_list 取得，不要自己猜。' +
                '2026-08-28 dev 實測（pk-platform.alddev.com）：刪除自建的 7 筆測試層級並確認消失、' +
                '對不存在 id 回 NOT_FOUND、對有會員的層級（id=20，859 人）被後端擋下，三種情境皆驗過。',
            inputSchema: {
                id: z.number().int().describe('要刪除的會員層級 id；用 aladdin_platform_user_level_get_name_list 取得合法值'),
            },
        },
        async ({ id }) => {
            // pre-check：後端對不存在 id 直接回成功，這裡先確認目標真的存在
            const before = await withAutoRelogin(() => remote.userLevelBackOffice.userLevel.GetNameList());
            if (before.failed) return asErrorResult(before, { hint: '刪除前的存在性確認失敗，為避免誤判成功，本次未執行刪除' });
            const target = (before.data?.rows ?? []).find((row) => row.id === id);
            if (!target) {
                return asTextResult({
                    success: false,
                    reason: 'NOT_FOUND',
                    message: `層級 id=${ id } 不存在或已被刪除，未執行刪除（後端對不存在的 id 會直接回成功，容易誤判）`,
                    hint: '用 aladdin_platform_user_level_get_name_list 確認目前可用的層級 id',
                });
            }

            const r = await withAutoRelogin(() => remote.userLevelBackOffice.userLevel.Delete(id));
            if (r.failed) return asErrorResult(r, { hint: '若訊息是「会员人数不为0，无法删除」，代表該層級底下還有會員，要先把會員調到其他層級才能刪除' });

            // round-trip：回讀確認真的消失
            const after = await withAutoRelogin(() => remote.userLevelBackOffice.userLevel.GetNameList());
            if (after.failed) {
                return asTextResult({ success: true, id, deleted: target, verified: false, hint: '刪除 RPC 已成功，但回讀確認失敗，請自行用 aladdin_platform_user_level_get_name_list 確認' });
            }
            const stillThere = (after.data?.rows ?? []).some((row) => row.id === id);
            return asTextResult({
                success: !stillThere,
                id,
                deleted: target,
                verified: !stillThere,
                ...(stillThere ? { reason: 'STILL_PRESENT', message: '刪除 RPC 回報成功，但回讀後該層級仍在清單中，請人工確認 dev 上的實際狀態' } : {}),
                ...(target.type === USER_LEVEL_TYPE_MAP.auto ? { note: '被刪除的是 auto 層級，後端已連帶把其餘 auto 層級的 level 重排為 1,2,3… 連號' } : {}),
            });
        },
    );
}
