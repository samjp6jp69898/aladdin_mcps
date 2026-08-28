/**
 * tools/batch_remove_sensitive_word.ts — aladdin_platform_sensitive_word_platform_batch_remove_sensitive_word
 *
 * rajah: SensitiveWordPlatform.BatchRemoveSensitiveWord(sensitiveWordIds [i32] 1)
 * （rajah/services/sensitive_word_back_office.rajah:17，method 自帶
 * @Permission "DailyOperation.SensitiveWord.Remove"；service 只掛 @Module "SensitiveWord"、
 * 沒有 service 級 @Permission，也不是 @NoPublic）
 *
 * method-category-checklist.md 第 0 節排除規則已過：agrabah 對應 Service
 * （agrabah/src/servers/sensitive_word_back_office/services/sensitive_word_platform.ts:106-114，
 * methodBatchRemoveSensitiveWord → Manager :369-409）確認有真實 override、真的下 DELETE，非 notImplemented。
 *
 * 分類：第 7 節「寫入 — 刪除」。逐項檢查結果：
 * - **軟刪還是硬刪 → 硬刪，已查證**：Manager 直接下
 *   `DELETE FROM sensitive_words WHERE platform_id = ? AND id IN (?)`
 *   （agrabah/src/managers/sensitive_word_manager.ts:393-396），**不是** status 欄位軟刪。
 *   資料刪掉就沒了，本 domain 也沒有任何還原機制。description 已用最顯著的方式標明。
 * - **冪等性**：SQL DELETE 對不存在的 id 影響 0 列、不報錯，且後端沒有檢查影響列數
 *   （:398-400 只看 `deleteResult.failed`）。所以**同一批 id 刪第二次一樣回成功**——
 *   「成功」不代表這次真的刪掉了東西。本工具因此在刪除前後各掃一次清單，回報**實際消失的 id**
 *   與**原本就不存在的 id**，不讓呼叫端把「RPC 成功」誤讀成「這些 id 都被刪掉了」。
 * - **批量是全有全無還是部分成功**：單一 SQL DELETE 在一個 statement 內完成，不存在「刪了一半」；
 *   但**傳入不存在的 id 不會報錯也不會被回報**——這正是上一點要靠前後掃描補足的資訊。
 * - **刪除前先確認記錄存在**：本工具強制先掃描（`scanAllSensitiveWords`，與
 *   create_or_update_sensitive_word.ts 共用同一支、符合第 2 節 B 級的逐頁掃描到底規格），
 *   把「這些 id 目前存在嗎」如實回報，並在**全部都不存在**時直接拒絕送出（避免無意義的寫入與 audit）。
 * - **⚠️ 掃描觸頂時不可以把 notFoundIds 講成確定**（2026-08-28 review 指出的缺陷，已修正）：
 *   掃描上限是 4000 筆，若部分 id 落在上限之外，它們在掃描結果裡看起來就像「不存在」。
 *   初版只在「全部都找不到」那條分支處理 `hitScanCap`，成功分支則完全沒揭露掃描是否被截斷，
 *   會把「掃描沒掃到、實際存在且已被刪掉」的 id 標成「送出前就不存在」。現在成功分支一律附上
 *   `scan.hitScanCap`，並在觸頂時把該欄位改名為 `notSeenInScanIds` + 附警語，與姐妹檔
 *   create_or_update_sensitive_word.ts 對同一情境的處理口徑一致。
 * - **參數邊界**：`ids` 為空或超過 200 筆一律回 `ErrorCode.requestNotValid`
 *   （sensitive_word_manager.ts:373-378，`BATCH_DELETE_LIMIT = 200` 在同檔 :34）。
 *   本工具在 zod 層就收在 1~200。
 * - **跨租戶**：DELETE 條件同時綁 `platform_id = ?`，別平台的 id 傳進來只會影響 0 列。
 * - 刪除成功後後端會 audit（SystemIdEnum.sensitiveWord，sensitiveWordDelete）並發訊息通知
 *   SensitiveWord server 刷新快取（`_invalidateAndPublishSensitiveWordGroupReload`）。
 *
 * ⚠️ **回讀走唯讀副本**（sensitive_word_manager.ts:184）：刪除後的驗證掃描可能因主從延遲仍看到舊資料，
 * 此時本工具回 `verified: false` 並說明，**不會**倒過來宣稱刪除失敗。
 *
 * 2026-08-28 dev 實測（pk-platform.alddev.com，帳號 landon001）：
 * - **部分存在 / 部分不存在**：送 `[605, 99999999]`（605 是同 session 建立的測試詞、99999999 不存在），
 *   回 actuallyDeletedIds=[605]、notFoundIds=[99999999]、stillPresentIds=[]——證實前後掃描確實補足了
 *   後端不會回報的「哪些 id 根本不存在」資訊。
 * - **冪等實證**：同一批 id 再刪一次，此時全部都不存在，被本工具擋在送出前
 *   （若直接送出後端會回成功但實際什麼也沒刪，正是第 7 節要防的誤讀）。
 * - **硬刪除實證**：刪除後重掃清單，605/606 都真的消失，沒有任何「狀態變成已刪除」的殘留列。
 * - 測試結束後本平台回到原本的 4 筆（id 17/37/40/41），dev 無殘留。
 * - **2026-08-28 review 後的修正複測**：成功分支現在一律附上
 *   `scan: { beforeScannedPages, beforeScannedRows, afterScannedPages, afterScannedRows, hitScanCap }`，
 *   實測刪除 id=607 時正確回報 before 5 筆 / after 4 筆 / hitScanCap=false；本平台資料量小、
 *   觸頂分支（notSeenInScanIds）在 dev 上無法自然重現，該分支的正確性靠程式碼審查而非實測。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { SENSITIVE_WORD_LIMITS } from '../const.ts';
import { scanAllSensitiveWords } from './create_or_update_sensitive_word.ts';

export function registerBatchRemoveSensitiveWordTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_sensitive_word_platform_batch_remove_sensitive_word',
        {
            title: 'Batch delete sensitive words (HARD delete, irreversible)',
            description:
                '批次刪除敏感詞（rajah: SensitiveWordPlatform.BatchRemoveSensitiveWord，需要權限節點 ' +
                'DailyOperation.SensitiveWord.Remove）。' +
                '⚠️ **這是硬刪除（DELETE FROM），資料直接消失、不可復原、沒有任何還原機制**——已查證後端實作，' +
                '不是 status 欄位的軟刪除。呼叫前請確認 id 正確。' +
                `單次 1~${ SENSITIVE_WORD_LIMITS.batchDeleteLimit } 筆（超過或空陣列後端回 requestNotValid，本工具已在參數層擋下）。` +
                '⚠️ **後端對不存在的 id 不會報錯**（DELETE 影響 0 列也算成功），所以「RPC 成功」不等於' +
                '「這些 id 都被刪掉了」。本工具因此在刪除前後各掃一次清單，回報 actuallyDeletedIds（真的消失的）' +
                '與 notFoundIds（送出前就不存在的）；若送出的 id **全部**都不存在，會直接拒絕、不執行寫入。' +
                '⚠️ **掃描上限 4000 筆**：敏感詞表可能長過這個數字，掃描觸頂時本工具會把 notFoundIds 改名為 ' +
                'notSeenInScanIds 並附警語（「掃描範圍內沒看到」≠「不存在」），回傳一律附上 scan.hitScanCap 供判斷。' +
                'id 來源請用 aladdin_platform_sensitive_word_platform_get_sensitive_words。' +
                '⚠️ 回讀走唯讀副本，主從延遲時可能仍看到已刪資料，此時回 verified=false（**不代表刪除失敗**）。',
            inputSchema: {
                sensitiveWordIds: z.array(z.number().int().min(1))
                    .min(1).max(SENSITIVE_WORD_LIMITS.batchDeleteLimit)
                    .describe(`要刪除的敏感詞 id 陣列，1~${ SENSITIVE_WORD_LIMITS.batchDeleteLimit } 筆。**硬刪除，不可復原**`),
                confirm: z.string().optional().describe(`prod 環境專用的二次確認字串（非 prod 環境不需要）。需要時填入 ${ PROD_CONFIRM_TOKEN }`),
            },
        },
        async (input) => {
            assertProdConfirmed(input.confirm);

            // ---- 1. 刪除前先確認這些 id 現在存在嗎（第 7 節要求） ----
            const before = await scanAllSensitiveWords();
            if (!before.ok) {
                return asTextResult({ success: false, message: `刪除前讀取現況失敗，未執行任何刪除：${ before.message }（errorCode=${ before.errorCode }）` });
            }
            const existingIds = new Set(before.rows.map((r) => r.id));
            const targets = before.rows.filter((r) => input.sensitiveWordIds.includes(r.id));
            const notFoundIds = input.sensitiveWordIds.filter((id) => !existingIds.has(id));

            if (targets.length === 0) {
                return asTextResult({
                    success: false,
                    message: before.hitScanCap
                        ? `送出的 id 在掃描上限內（${ before.scannedPages } 頁 / ${ before.scannedRows } 筆）都沒找到，而且掃描已觸頂、尚未掃到底，無法斷定它們不存在。未執行任何刪除。`
                        : '送出的 id 全部都不存在於本平台的敏感詞清單（已掃描到底），未執行任何刪除（避免產生無意義的操作日誌）。',
                    notFoundIds,
                    scan: { scannedPages: before.scannedPages, scannedRows: before.scannedRows, hitScanCap: before.hitScanCap },
                });
            }

            // ---- 2. 刪除 ----
            const w = await withAutoRelogin(() => remote.sensitiveWordBackOffice.sensitiveWordPlatform.BatchRemoveSensitiveWord(input.sensitiveWordIds));
            if (w.failed) {
                return asErrorResult(w, { hint: `requestNotValid 通常是 id 陣列為空或超過 ${ SENSITIVE_WORD_LIMITS.batchDeleteLimit } 筆` });
            }

            // ---- 3. round-trip 確認實際消失了哪些 ----
            const after = await scanAllSensitiveWords();
            if (!after.ok) {
                return asTextResult({
                    success: true, verified: false,
                    requestedIds: input.sensitiveWordIds,
                    message: `刪除的 RPC 已成功回應，但回讀確認失敗：${ after.message }。請自行用 aladdin_platform_sensitive_word_platform_get_sensitive_words 覆核`,
                });
            }
            const remainingIds = new Set(after.rows.map((r) => r.id));
            const actuallyDeletedIds = targets.map((t) => t.id).filter((id) => !remainingIds.has(id));
            const stillPresentIds = targets.map((t) => t.id).filter((id) => remainingIds.has(id));

            // 掃描被截斷時，「掃描裡沒看到」不等於「不存在」——那些 id 可能落在 4000 筆上限之外、
            // 實際存在且已經被這次 DELETE 刪掉了。此時改名並附警語，不對呼叫端做確定性斷言。
            const scanTruncated = before.hitScanCap || after.hitScanCap;

            return asTextResult({
                success: true,
                verified: stillPresentIds.length === 0,
                requestedIds: input.sensitiveWordIds,
                existedBeforeDelete: targets.map((t) => ({ id: t.id, sensitiveWord: t.sensitiveWord, sensitiveWordGroupId: t.sensitiveWordGroupId })),
                ...(scanTruncated
                    ? { notSeenInScanIds: notFoundIds, notSeenInScanNote: '⚠️ 掃描已觸頂（未掃到底），這些 id 只是「掃描範圍內沒看到」，不代表它們不存在——落在掃描上限之外且實際存在的 id 也會被這次刪除刪掉，但不會出現在 actuallyDeletedIds 裡' }
                    : { notFoundIds }),
                actuallyDeletedIds,
                actuallyDeletedNote: scanTruncated
                    ? '⚠️ 掃描已觸頂，actuallyDeletedIds 只涵蓋掃描範圍內確認過的 id，實際被刪除的可能更多'
                    : undefined,
                stillPresentIds,
                scan: {
                    beforeScannedPages: before.scannedPages, beforeScannedRows: before.scannedRows,
                    afterScannedPages: after.scannedPages, afterScannedRows: after.scannedRows,
                    hitScanCap: scanTruncated,
                },
                message: stillPresentIds.length === 0
                    ? undefined
                    : '刪除的 RPC 已成功回應，但回讀時這些 id 仍然存在（本 method 讀唯讀副本，可能是主從延遲）。請稍後自行覆核，這不一定代表刪除失敗。',
                deleteWarning: '⚠️ 硬刪除，已刪除的資料無法復原',
            });
        },
    );
}
