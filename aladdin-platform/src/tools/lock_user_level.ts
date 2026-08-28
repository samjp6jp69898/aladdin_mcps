/**
 * tools/lock_user_level.ts — aladdin_platform_user_level_lock_user
 *
 * rajah: UserLevel.lockUser(userIds [i32] 1, locked StatusEnum 2)
 * （user_level_back_office.rajah:238，@LoginRequired、無 @Permission；rajah 的 method 名稱是小寫
 * 開頭的 `lockUser`，故 tool 名稱第三段照實轉成 `lock_user`）——後台「會員層級」的批次「層級鎖定／解鎖」。
 *
 * 2026-08-28 讀 agrabah 後端原始碼查證
 * （agrabah/src/servers/user_level_back_office/services/user_level.ts:593-615，methodlockUser）：
 * 真的寫 DB、非 placeholder。四個要寫進 description 的事實
 * （method-category-checklist.md 第 6 節「狀態轉換」＋「批量部分失敗」要求）：
 * 1. **帶明確目標狀態，不是 bit-flip**：後端把 `locked` 直接寫進 DbUserLevel.locked，
 *    呼叫端要自己決定要鎖還是要解鎖，不能期待「再呼叫一次會自動反轉」。
 * 2. **語意反直覺**：`locked = StatusEnum.enabled(1)` 代表**已鎖定**、`disabled(2)` 代表未鎖定
 *    （UserLevelInternalService 以 `locked === enabled` 判斷是否跳過自動升降級）。本 tool 對外只收
 *    lock／unlock 兩個字面值再轉成 1／2，避免呼叫端在這個反直覺的對應上出錯。
 * 3. **逐筆 continue、永遠回成功**：每個 userId 各自 load + update，load 失敗或查無此人只寫 log
 *    然後 continue（user_level.ts:596-611），最後一律 `return GenieResult.success`——
 *    **RPC 成功不代表每一筆都成功**，也拿不到失敗清單。本 tool 因此依第 6 節要求，
 *    在回傳裡明講「無法得知哪幾筆失敗」，並提供可選的回讀驗證（見下）。
 * 4. 後端的 audit 呼叫是被註解掉的（user_level.ts:613），這個操作**不會留下稽核紀錄**。
 *
 * 回讀驗證：這支沒有「用 userId 直接查鎖定狀態」的 sibling method，唯一能看到 locked 的是
 * GetUserList（以 userLevelId 分頁列出）。因此本 tool 提供選填的 verifyInUserLevelId：帶了就在
 * 寫入後逐頁掃該層級的會員清單比對這批 userId 的 locked 實際值。掃描依第 2 節 B 級的上限要求設限：
 * pageSize 固定 200（PageSizeEnum 上限）、最多 20 頁（4000 筆），全部目標都找到就提早結束；
 * 觸頂時回傳 hitScanCap=true 與已掃描頁數，不假裝「已掃到底」。
 * 終止判斷優先用第 1 頁回應的 totalPage（agrabah 的分頁框架只有 page===1 會計算 totalPage，
 * agrabah/src/common/database_helper.ts:204-217），沒拿到才退回「該頁未滿 pageSize 即最後一頁」的推斷——
 * 只靠後者時，會員數剛好是 200 整數倍會誤判成觸頂（保守方向，不會謊報 verified）。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { PAGE_SIZE_MAP, STATUS_MAP } from '../const.ts';

const LOCK_STATE_MAP = { lock: STATUS_MAP.enabled, unlock: STATUS_MAP.disabled } as const;
const VERIFY_PAGE_SIZE = PAGE_SIZE_MAP.size200;
const VERIFY_MAX_PAGES = 20;

export function registerLockUserLevelTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_user_level_lock_user',
        {
            title: "Lock or unlock members' user level (batch)",
            description:
                '批次鎖定／解鎖會員的層級（rajah: UserLevel.lockUser，後台「會員管理」→「會員層級」→' +
                '層級會員清單的「層級鎖定」）。鎖定後該會員**不會再被層級策略自動升降級**，' +
                '後台人工變更層級仍可執行。' +
                '**這是帶明確目標狀態的操作，不是 toggle**：要鎖就送 locked=lock、要解鎖就送 locked=unlock，' +
                '重複送同一個狀態是安全的（後端直接覆寫同一個值，不會報錯）。' +
                '底層 StatusEnum 的對應反直覺（enabled=1 代表已鎖定、disabled=2 代表未鎖定），' +
                '本 tool 已代為轉換，呼叫端只要用 lock／unlock。' +
                '**後端逐筆處理、查無此會員只寫 log 就跳過，且無論如何都回成功**——' +
                '所以「呼叫成功」不代表每一筆都生效，後端也不回失敗清單。' +
                '要確認實際結果，請帶 verifyInUserLevelId（這批會員目前所在的層級 id）：' +
                '本 tool 會在寫入後逐頁掃該層級的會員清單，回報每個 userId 實際的 locked 狀態；' +
                '掃描上限為 20 頁 × 200 筆，觸頂會回 hitScanCap=true 而不是假裝掃完。' +
                '不帶 verifyInUserLevelId 時本 tool 不做任何回讀，verified 會是 false。' +
                'userId 是會員的數字 id（不是帳號字串），可從 aladdin_platform_user_level_get_user_list 取得。' +
                '此操作**不會寫入稽核 log**（後端的 audit 呼叫被註解掉了）。' +
                '2026-08-28 dev 實測（pk-platform.alddev.com）：對 userLevelId=20 的真實會員鎖定→回讀確認 locked 變化→' +
                '解鎖還原成原值，以及不存在的 userId（後端靜默跳過、仍回成功）兩種情境皆驗過，測完已復原。',
            inputSchema: {
                userIds: z.array(z.number().int()).min(1).describe('要變更的會員 userId 陣列（數字 id，不是帳號字串）'),
                locked: z.enum([ 'lock', 'unlock' ]).describe('目標狀態：lock=鎖定層級（不再自動升降級）／unlock=解除鎖定。不是 toggle，要明確指定'),
                verifyInUserLevelId: z.number().int().optional().describe('選填：這批會員目前所在的層級 id，帶了才會在寫入後回讀驗證實際 locked 狀態'),
            },
        },
        async ({ userIds, locked, verifyInUserLevelId }) => {
            const lockedValue = LOCK_STATE_MAP[ locked ];
            const r = await withAutoRelogin(() => remote.userLevelBackOffice.userLevel.lockUser(userIds, lockedValue));
            if (r.failed) return asErrorResult(r);

            const baseResult = {
                success: true,
                requested: { userIds, locked, lockedValue },
                note: '後端逐筆處理、查無此會員時靜默跳過並仍回成功，且不回傳失敗清單——單看 RPC 結果無法得知哪幾筆真的生效',
            };

            if (verifyInUserLevelId === undefined) {
                return asTextResult({
                    ...baseResult,
                    verified: false,
                    hint: '要確認實際結果，請帶 verifyInUserLevelId（這批會員所在的層級 id）重新呼叫，或自行用 aladdin_platform_user_level_get_user_list 查看 locked 欄位',
                });
            }

            // 回讀驗證：逐頁掃描該層級的會員清單，找齊就提早結束；上限 20 頁 × 200 筆
            const remaining = new Set(userIds);
            const found: Record<number, number> = {};
            let scannedPages = 0;
            let scannedRows = 0;
            let hitScanCap = false;
            let totalPage: number | undefined;   // 只有 page===1 的回應才有真值（見檔頭）
            for (let page = 1; page <= VERIFY_MAX_PAGES; page++) {
                const listResult = await withAutoRelogin(() => remote.userLevelBackOffice.userLevel.GetUserList(
                    verifyInUserLevelId,
                    '',
                    page,
                    VERIFY_PAGE_SIZE,
                ));
                if (listResult.failed) {
                    return asTextResult({
                        ...baseResult,
                        verified: false,
                        scannedPages,
                        scannedRows,
                        hint: `回讀驗證時第 ${ page } 頁查詢失敗（${ listResult.message }），寫入本身已成功，請自行用 aladdin_platform_user_level_get_user_list 確認`,
                    });
                }
                const rows = listResult.data?.rows ?? [];
                if (page === 1) totalPage = listResult.data?.totalPage ?? undefined;
                scannedPages = page;
                scannedRows += rows.length;
                for (const row of rows) {
                    const rowUserId = row.userId;
                    if (rowUserId === null || rowUserId === undefined) continue;
                    if (remaining.has(rowUserId)) {
                        found[ rowUserId ] = row.locked ?? -1;
                        remaining.delete(rowUserId);
                    }
                }
                if (remaining.size === 0) break;
                // 終止條件優先用第 1 頁拿到的 totalPage（精確），沒有才退回「未滿一頁即最後一頁」的推斷
                if (totalPage !== undefined && totalPage > 0 && page >= totalPage) break;
                if (rows.length < VERIFY_PAGE_SIZE) break;
                if (page === VERIFY_MAX_PAGES) hitScanCap = true;
            }

            const mismatched = Object.entries(found)
                .filter(([ , value ]) => value !== lockedValue)
                .map(([ userId, value ]) => ({ userId: Number(userId), actualLocked: value }));

            return asTextResult({
                ...baseResult,
                verified: remaining.size === 0 && mismatched.length === 0,
                verifiedInUserLevelId: verifyInUserLevelId,
                actualLocked: found,
                notFoundInThatLevel: [ ...remaining ],
                mismatched,
                scannedPages,
                scannedRows,
                hitScanCap,
                ...(remaining.size > 0
                    ? { hint: hitScanCap
                        ? '掃描已達 20 頁上限仍未找齊，這些 userId 可能在更後面的頁次，或根本不在這個層級——請改用 aladdin_platform_user_level_get_user_list 帶 account 精確查詢'
                        : '這些 userId 不在指定層級的會員清單裡（層級 id 帶錯，或該會員不存在／不在本平台）——後端對這種情況是靜默跳過的' }
                    : {}),
            });
        },
    );
}
