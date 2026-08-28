/**
 * tools/get_sensitive_words.ts — aladdin_platform_sensitive_word_platform_get_sensitive_words
 *
 * rajah: SensitiveWordPlatform.GetSensitiveWords(page i32 1, pageSize i32 2)
 * (rows [SensitiveWordEdit] 1, totalPage i32 2)
 * （rajah/services/sensitive_word_back_office.rajah:12，method 自帶
 * @Permission "DailyOperation.SensitiveWord"；service 只掛 @Module "SensitiveWord"、沒有 service 級
 * @Permission，也不是 @NoPublic）
 *
 * method-category-checklist.md 第 0 節排除規則已過：agrabah 對應 Service
 * （agrabah/src/servers/sensitive_word_back_office/services/sensitive_word_platform.ts:41-59，
 * methodGetSensitiveWords）確認有真實 override、真的查 DB，非 notImplemented。
 * ⚠️ 同 service 的 `GetSensitiveWordGroups` / `CreateOrUpdateSensitiveWordGroup` **沒有** override
 * （實作被整段註解掉並標 TODO，同檔 :115-135），呼叫必定回 notImplemented——本 domain 只有敏感詞本身
 * 的三支方法可用，分組相關的兩支不要包成 tool。
 *
 * 分類：第 2 節「讀取清單」**B 級（最高風險）**——這支的參數**只有 page/pageSize，連範圍鍵都沒有**，
 * 完全沒有任何可鎖定單一目標的欄位，也沒有任何 sibling 的「用 id 或業務鍵直接查一筆」method
 * （整個 service 只有這一支讀取方法）。因此：
 * - 本工具維持單純的分頁清單，**不**在內部做任何「用文字找特定敏感詞」的查找，避免踩到第 2 節
 *   明令禁止的「只查第一頁就宣稱找不到」。
 * - 需要依 id 取現值的場景（CreateOrUpdateSensitiveWord 更新前的「先讀現值」）由
 *   create_or_update_sensitive_word.ts 內的 `findSensitiveWordById()` 處理，那支有依第 2 節
 *   規定實作完整的逐頁掃描到底 + 掃描上限 + 逾時保護 + 觸頂時回結構化狀態。
 *
 * 2026-08-28 讀 agrabah 後端原始碼查證：
 * - `pageSize > 200` 直接回 `ErrorCode.exceedRequestLimit`（sensitive_word_platform.ts:47-49，
 *   `PAGE_SIZE_LIMIT = 200` 在同檔 :17）——跟本 server 其他 list method「後端沒有上界」的情況不同，
 *   這支是後端自己會擋。本工具在 zod 層就收在 200，不讓呼叫端拿到這個錯誤。
 * - 查詢綁 `platform_id = ?`、排序 `id ASC`，走**唯讀副本**
 *   （`_getSensitiveWordReadonlyDatabase`，sensitive_word_manager.ts:184），
 *   所以剛寫入的資料可能因主從延遲短暫讀不到——這是本 method 特有、其他 roulette 系列沒有的性質。
 * - 回傳只有 `totalPage`，沒有 totalRow；且共用 helper `getPageData`
 *   （agrabah/src/common/database_helper.ts:204-217）只在 `page === 1` 時跑 count，其他頁固定回 0。
 *   本工具在非第一頁回 `totalPage: null`，不透傳那個會被誤讀成「查無資料」的 0。
 * - 回傳 model `SensitiveWordEdit`（sensitive_word.rajah:17-27）五個欄位：
 *   `id`(@Readonly) / `sensitiveWordSourceType`(@Readonly) / `sensitiveWord` /
 *   `sensitiveWordGroupId`(@Hide) / `remarks`，全部由 Manager 逐欄組出
 *   （sensitive_word_manager.ts:196-204）。無 i64、無密鑰/PII 欄位。
 *
 * 2026-08-28 dev 實測（pk-platform.alddev.com，帳號 landon001）：
 * - pageSize=5：page=1 回 totalPage=1 + 4 筆真實資料（本平台目前只有 4 個敏感詞：
 *   id 17/37/40/41），每列的 sensitiveWordSourceType 皆正確轉成 "Manual"、sensitiveWordGroupId 皆為 1。
 * - **覆蓋 checklist 第 2 節「目標不在第一頁」的驗收要求**：本平台資料量小，改用 pageSize=1 製造多頁——
 *   page=1 回 totalPage=4（真值）、page=3 回 totalPage=null 且仍取得第 3 筆（id=40「草」），
 *   證實非第一頁確實拿不到 totalPage，本工具回 null 而非透傳 0 的處理正確。
 * - pageSize=201 被本工具的 zod 擋在送出前（後端會回 exceedRequestLimit）。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { SENSITIVE_WORD_SOURCE_TYPE_MAP, SENSITIVE_WORD_LIMITS, numberToMapKey } from '../const.ts';

export function registerGetSensitiveWordsTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_sensitive_word_platform_get_sensitive_words',
        {
            title: "List the current platform's sensitive words",
            description:
                '分頁查詢本平台的敏感詞列表（rajah: SensitiveWordPlatform.GetSensitiveWords，需要權限節點 ' +
                'DailyOperation.SensitiveWord；後台「日常運營／敏感詞」頁）。' +
                '**這支完全沒有任何篩選條件**（參數只有 page/pageSize），也沒有「依 id 查一筆」的姐妹方法——' +
                '要找特定敏感詞只能自己翻頁比對。若目的是修改某一筆，直接把 id 交給 ' +
                'aladdin_platform_sensitive_word_platform_create_or_update_sensitive_word，' +
                '那支內部會自己逐頁掃描到底取得現值，不需要你先翻頁。' +
                '**pageSize 上限 200**，超過後端直接回 exceedRequestLimit（本工具已在參數層擋下）。' +
                '回傳只有 totalPage、沒有 totalRow，且 **totalPage 只有 page=1 時是真值**' +
                '（後端共用分頁 helper 只在第一頁跑 count），非第一頁本工具回 null，' +
                '請用「rows 筆數 < pageSize 即最後一頁」判斷終點。' +
                '⚠️ 本 method 走**唯讀副本資料庫**，剛新增/修改的敏感詞可能因主從延遲短暫查不到，' +
                '不要用它立刻驗證剛才的寫入。' +
                'sensitiveWordSourceType 是唯讀欄位：Manual(手動輸入)/Import(文件匯入)/Report(檢舉機制新增)，' +
                '經本 MCP 新增的一律是 Manual。這是純讀取查詢，可安全重複呼叫。',
            inputSchema: {
                page: z.number().int().min(1).optional().describe('頁碼，從 1 開始，預設 1'),
                pageSize: z.number().int().min(1).max(SENSITIVE_WORD_LIMITS.maxPageSize).optional()
                    .describe(`每頁筆數，1~${ SENSITIVE_WORD_LIMITS.maxPageSize }（後端硬性上限，超過回 exceedRequestLimit）；省略時送 0 由後端套用預設值 100`),
            },
        },
        async (input) => {
            const page = input.page ?? 1;
            const r = await withAutoRelogin(() => remote.sensitiveWordBackOffice.sensitiveWordPlatform.GetSensitiveWords(
                page,
                input.pageSize ?? 0,
            ));
            if (r.failed) return asErrorResult(r);

            const rows = (r.data?.rows ?? []).map((row) => ({
                ...row,
                sensitiveWordSourceType: numberToMapKey(SENSITIVE_WORD_SOURCE_TYPE_MAP, row.sensitiveWordSourceType ?? 0),
            }));

            return asTextResult({
                success: true,
                page,
                totalPage: page === 1 ? (r.data?.totalPage ?? 0) : null,
                pagingNote: page === 1
                    ? '本 method 不回傳 totalRow，無法得知總筆數'
                    : '本 method 不回傳 totalRow；且 totalPage 只有 page=1 時才是真值（後端只在第一頁跑 count），故此處為 null。判斷是否最後一頁請用「rows 筆數 < pageSize」',
                replicaNote: '本 method 讀唯讀副本，剛寫入的資料可能短暫讀不到',
                rows,
            });
        },
    );
}
