/**
 * tools/create_or_update_sensitive_word.ts — aladdin_platform_sensitive_word_platform_create_or_update_sensitive_word
 *
 * rajah: SensitiveWordPlatform.CreateOrUpdateSensitiveWord(sensitiveWord SensitiveWordEdit 1)
 * （rajah/services/sensitive_word_back_office.rajah:14）
 *
 * ⚠️ **這支 method 完全沒有掛 @Permission**：service 標頭只有 `@Module "SensitiveWord"`、沒有 service 級
 * @Permission（sensitive_word_back_office.rajah:1-2），而 rajah 的 @Permission 是逐 method 標註、
 * 不會從上一個 method 延續——同 service 的 `GetSensitiveWords`(:10-12) 掛 DailyOperation.SensitiveWord、
 * `BatchRemoveSensitiveWord`(:16-17) 掛 …SensitiveWord.Remove，唯獨這支**寫入** method 兩者皆無。
 * 前端菜單用的 `DailyOperation.SensitiveWord.Create`(:19-20) 與 `…SensitiveWord.Ops.Edit`(:22-23)
 * 只掛在 Placeholder 方法上（純權限節點佔位符，不是 API），**沒有綁到真正的寫入 API**。
 * 也就是說：任何能通過本後台登入與 SensitiveWord 模組開關的帳號都能呼叫這支新增/修改敏感詞，
 * 不需要 Create/Edit 權限節點。這是查證後端與 rajah 後得到的事實，非推測；本工具照實際情況包裝，
 * 並在 description 標明，不假裝它受權限保護。
 *
 * method-category-checklist.md 第 0 節排除規則已過：agrabah 對應 Service
 * （agrabah/src/servers/sensitive_word_back_office/services/sensitive_word_platform.ts:73-96，
 * methodCreateOrUpdateSensitiveWord）確認有真實 override，非 notImplemented；非 @NoPublic。
 * ⚠️ 同 service 的分組相關兩支（GetSensitiveWordGroups / CreateOrUpdateSensitiveWordGroup）**沒有**
 * override（GetSensitiveWordGroups 的實作被整段註解並標 TODO、同檔 :115-135；CreateOrUpdateSensitiveWordGroup 在該檔根本不存在，連註解版本都沒有），呼叫必定 notImplemented，不要包成 tool。
 *
 * 分類：第 4 節「寫入 — Upsert / CreateOrUpdate」，且新增分支同時觸及第 3 節（Create 的查重要求）。
 * 逐項檢查結果：
 * - **id=0/未帶走新增、id>0 走更新**：後端用 `if (sensitiveWord.id)` 分流
 *   （sensitive_word_platform.ts:80-93）。本工具明確判斷並在回傳的 `mode` 告知。
 * - **更新分支是整包覆蓋**：`UPDATE ... SET word = ?, group_id = ?, remarks = ? WHERE platform_id = ? AND id = ?`
 *   （agrabah/src/managers/sensitive_word_manager.ts:331-340）——三個欄位無條件覆寫，沒帶到的會被寫成空值。
 *   因此第 4 節「先讀現值、只覆蓋要改欄位」是硬性必要。
 * - **⚠️ 但這個 service 沒有任何「依 id 讀一筆」的 method**（整個 service 只有分頁的 GetSensitiveWords，
 *   而且它連篩選條件都沒有）。依 checklist 第 2 節 B 級與第 5 節，這種情況只能逐頁掃描定位，
 *   且**必須真的掃到底**、設上限與逾時保護、觸頂時回結構化狀態——本檔的 `scanAllSensitiveWords()`
 *   就是照那節的四點規格實作（pageSize 用該 service 的硬上限 200、最多 20 頁 = 4000 筆、
 *   整體 30 秒 / 單頁 5 秒逾時、觸頂回 `hitScanCap: true` 而非謊稱「已掃描全部」）。
 * - **⚠️ 規模風險（checklist 第 2 節第 4 點）**：掃描上限是 4000 筆，而敏感詞表是**可預期會長過這個
 *   數字**的——來源列舉裡有 `Import`（文件匯入）與 `Report`（檢舉機制自動新增）兩種
 *   （sensitive_word.rajah:37-45），且單次新增就允許 1000 筆（sensitive_word_manager.ts:30）。
 *   一旦超過 4000 筆，本工具的更新分支會對排在後段的 id 直接拒絕送出（回 hitScanCap 說明「無法斷定
 *   不存在」，不會謊稱找不到）。這是結構性限制、不是調高上限能解決的：正解是請後端補一支帶 id 的
 *   直接查詢 method。description 已標明。
 * - **⚠️ 更新不存在的 id 會打壞後端**：Manager 讀現值後**沒有檢查 `data === null`**，
 *   UPDATE 影響 0 列不算錯誤，接著寫 audit 時存取 `existingResult.data.word`
 *   （sensitive_word_manager.ts:308-352）→ 對不存在的 id 會拋 TypeError，而不是回乾淨的錯誤碼。
 *   本工具的「先掃描定位現值」這一步天然把它擋掉了：找不到就直接回錯誤、不送出。
 * - **round-trip 驗證**：寫入後再掃一次讀回，逐欄比對「沒有要求變更的欄位」是否維持原值。
 *   ⚠️ 讀取走的是**唯讀副本**（sensitive_word_manager.ts:184），主從延遲可能讓剛寫入的值還讀不到，
 *   因此驗證失敗時本工具回報 `verified: false` + 明確說明，**不會**倒過來宣稱寫入失敗。
 * - **新增分支的查重（第 3 節）**：後端自己會查重（同 platform + 同 group 內同名詞回
 *   `sensitiveWordExisted`，訊息帶已存在的詞），本工具把該錯誤原樣轉述並提示成因。
 * - **無法用回傳 id 做 round-trip**：rajah 宣告空回傳、client decode 成 Empty，新增後拿不到 id。
 *   本工具用「寫入前後掃描結果的差集」推導新建的 id（可能是多筆，見下方逗號分隔語意）。
 *
 * 2026-08-28 讀 agrabah 後端原始碼查證（sensitive_word_manager.ts:216-366）：
 * - **新增分支吃逗號分隔的多筆敏感詞**：`sensitiveWord` 字串會被 `split(',')` → 逐筆 normalize →
 *   去重 → 一次 `insertObjects` 多列（:225-265）。所以「新增」可能一次建立多筆。
 *   **更新分支不會 split**，整個字串（含逗號）會被當成單一敏感詞內容（:293）。這是同一個欄位在
 *   兩個分支語意不同的真實陷阱，description 已明講。
 * - **normalize 會改寫你送出的字串**：轉小寫、零寬字元/全形空格/一般空白視為空白處理
 *   （`normalizeWord`，:134-177）。所以讀回值可能與送出值不同（例如大寫變小寫），
 *   本工具在 round-trip 比對不一致時據實回報而非靜默忽略。
 * - **長度/筆數限制**（module-level 常數 :28/:30/:32）：新增時整串上限 5000 字、拆分後上限 1000 筆、
 *   單筆上限 50 字；更新時整串上限 5000 且單筆上限 50（等效於 50）。超過分別回
 *   `sensitiveWordAddLengthLimitExceeded` / `sensitiveWordAddItemLimitExceeded`。
 *   ⚠️ 只有「整串 5000 字」這條比的是**原始長度**（:221），另外兩條（1000 筆 / 單筆 50 字）比的是
 *   **normalize 之後**的結果。normalize 後全空回 `ErrorCode.requestNotValid`。
 *   本工具在送出前用**與後端等價的 normalize**（本檔的 `normalizeSensitiveWord()`，逐條對齊
 *   sensitive_word_manager.ts:134-177 與 :45/:52/:54 三條 regex）做同一組檢查並給中文說明——
 *   2026-08-28 review 指出初版用 `trim()` 近似會同時擋錯與漏擋，已改正。
 * - **⚠️ groupId 的兩套值不一致（後端 bug 級陷阱）**：新增與更新都用
 *   `const groupId = sensitiveWord.sensitiveWordGroupId || 1` 當**查重**的分組（:218/:291），
 *   但更新的 UPDATE 語句寫進 DB 的是**未經 fallback 的原始值** `sensitiveWord.sensitiveWordGroupId`
 *   （:334）——傳 0 會查重在 group 1、卻把 group_id 寫成 0。本工具因此**強制** sensitiveWordGroupId >= 1
 *   （預設沿用現值或 1），不讓呼叫端踩到這個不一致。
 * - `sensitiveWordSourceType` 是 @Readonly：新增一律寫死 `Manual`（:261），呼叫端無法指定，
 *   因此本工具不開放這個參數。
 * - 寫入成功後會 audit（SystemIdEnum.sensitiveWord，sensitiveWordCreate / sensitiveWordUpdate）
 *   並發訊息通知 SensitiveWord server 刷新快取（`_invalidateAndPublishSensitiveWordGroupReload`）。
 *
 * 2026-08-28 dev 實測（pk-platform.alddev.com，帳號 landon001）：
 * - **新增（逗號分隔多筆 + normalize 實證）**：送 `"MCPTestWordAAA,MCPTestWordBBB"`，回報 createdCount=2、
 *   用清單差集正確推導出 id=605/606；**存進 DB 的值是全小寫的 `mcptestwordaaa` / `mcptestwordbbb`**，
 *   實證後端 normalize 會改寫送出的內容（description 已據此標明）；sourceType 皆為 Manual、groupId 皆為 1。
 * - **查重**：對同一個詞再新增一次，回 errorCode=3605 `sensitiveWordExisted`，message 帶已存在的詞
 *   `mcptestwordaaa`，與後端把 existingWords 塞進錯誤訊息的實作一致。
 * - **更新 + 局部合併驗證**（checklist 第 4 節硬性要求）：對 id=605 只帶 `remarks`，
 *   回讀後 changedFields=["remarks"]、unchangedFieldsOk=true，sensitiveWord 與 sensitiveWordGroupId
 *   維持原值——證實「先掃描取現值再合併」確實擋住了後端 `SET word=?, group_id=?, remarks=?` 的整包覆蓋。
 * - **不存在的 id**：帶 id=99999999 被本工具擋在送出前（回「已掃描到底：1 頁 / 6 筆」+ 未執行任何寫入），
 *   沒有讓後端走到那個會拋 TypeError 的 audit 分支。
 * - **測試資料已完全清除**：新建的 605/606 都用 batch_remove_sensitive_word 硬刪，
 *   最後重掃確認本平台回到原本的 4 筆（id 17/37/40/41）、無任何 MCP 測試殘留。
 * - **2026-08-28 review 後的修正複測**（三項都真打 dev）：
 *   (1) normalize 對齊：送只含零寬字元（U+200B×2）的內容被正確擋下（初版用 trim() 會放行、
 *       讓後端回 requestNotValid）；送「原始 59 字、normalize 後 50 字」的含空白長詞被正確放行
 *       並建立成功（id=607，存進去是去空白的 50 字），初版用原始長度比 50 會誤拒。
 *   (2) before/after 的 sensitiveWordSourceType 現在都顯示 "Manual"（初版 before 是數字 1、
 *       after 是 "Manual"，同一份輸出兩種表示法會被誤讀成欄位被改）。
 *   (3) 更新分支（id=608 只改 remarks）仍為 changedFields=["remarks"]、unchangedFieldsOk=true。
 *   複測用的 607/608 皆已硬刪，最終重掃確認本平台仍是原本 4 筆、無殘留。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { SensitiveWordEdit } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { SENSITIVE_WORD_SOURCE_TYPE_MAP, SENSITIVE_WORD_LIMITS, numberToMapKey } from '../const.ts';

/**
 * 與後端 `SensitiveWordManager.normalizeWord`（agrabah/src/managers/sensitive_word_manager.ts:134-177）
 * 等價的正規化：逐字元轉小寫 → 丟掉零寬字元/全形空格/一般空白 → 全形轉半形 → 再過濾一次空白。
 * 後端的三條 regex 定義在同檔 :45/:52/:54。
 *
 * 為什麼一定要對齊而不能用 `trim()`：長度/筆數上限（1000 筆 / 單筆 50 字）在後端都是**對 normalize
 * 之後的字串**判斷的。用 `trim()` 近似會同時「擋錯」與「漏擋」——含空白的長詞會被本工具誤拒
 * （後端 normalize 後其實沒超長）、只含零寬字元的輸入會被本工具放行（後端 normalize 後為空、
 * 回 requestNotValid）。2026-08-28 review 指出初版用 trim() 與檔頭「用同一組規則檢查」的宣稱不符，
 * 已改成這支等價實作。
 */
export function normalizeSensitiveWord(word: string): string {
    const out: string[] = [];
    for (const ch of word) {
        const lower = ch.toLocaleLowerCase();
        if (/[\u200B\u200C\u200D\uFEFF\u3000\s]/.test(lower)) continue;
        const halfWidth = lower.replace(/[\uFF01-\uFF5E]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
        if (/\s/.test(halfWidth)) continue;
        for (const outChar of halfWidth) {
            if (/\s/.test(outChar)) continue;
            out.push(outChar);
        }
    }
    return out.join('');
}

/** checklist 第 2 節 B 級「逐頁掃描到底」的具體規格：頁數上限、整體逾時、單頁逾時。 */
const SCAN_PAGE_SIZE = SENSITIVE_WORD_LIMITS.maxPageSize; // 200，該 service 的硬上限
const SCAN_PAGE_CAP = 20;                                  // 20 頁 × 200 = 4000 筆
const SCAN_TOTAL_TIMEOUT_MS = 30_000;
const SCAN_PAGE_TIMEOUT_MS = 5_000;

export type ScannedWord = { id: number; sensitiveWord: string; sensitiveWordGroupId: number; remarks: string; sensitiveWordSourceType: number };
export type ScanResult =
    | { ok: true; rows: ScannedWord[]; scannedPages: number; scannedRows: number; hitScanCap: boolean }
    | { ok: false; errorCode: number; message: string };

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
    // 這裡的 timer 是「單頁請求逾時保護」，不是用等待去規避競態，符合 CLAUDE.md 硬規則的允許範圍。
    return Promise.race([
        p,
        new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${ label } 逾時（${ ms }ms）`)), ms)),
    ]);
}

/**
 * 逐頁掃描敏感詞清單到底（第 2 節 B 級規格）。這個 service 沒有任何「依 id / 依文字直接查一筆」的
 * method，也沒有任何篩選條件，所以定位單筆只能靠掃描；**掃描到底、有上限、觸頂如實回報**是硬性要求，
 * 不可以只查第一頁就宣稱找不到。
 */
export async function scanAllSensitiveWords(): Promise<ScanResult> {
    const started = Date.now();
    const rows: ScannedWord[] = [];
    let scannedPages = 0;

    for (let page = 1; page <= SCAN_PAGE_CAP; page++) {
        if (Date.now() - started > SCAN_TOTAL_TIMEOUT_MS) {
            return { ok: true, rows, scannedPages, scannedRows: rows.length, hitScanCap: true };
        }
        let r;
        try {
            r = await withTimeout(
                withAutoRelogin(() => remote.sensitiveWordBackOffice.sensitiveWordPlatform.GetSensitiveWords(page, SCAN_PAGE_SIZE)),
                SCAN_PAGE_TIMEOUT_MS,
                `敏感詞清單第 ${ page } 頁`,
            );
        } catch (e) {
            return { ok: false, errorCode: -1, message: (e as Error).message };
        }
        if (r.failed) return { ok: false, errorCode: r.errorCode, message: r.message };

        const pageRows = (r.data?.rows ?? []) as unknown as ScannedWord[];
        scannedPages = page;
        rows.push(...pageRows);
        // 本 method 的 totalPage 只有 page=1 才是真值，所以終止條件用「這頁筆數 < pageSize」
        // （checklist 第 2 節對「回傳沒有可靠 total 的 method」的指定做法）。
        if (pageRows.length < SCAN_PAGE_SIZE) {
            return { ok: true, rows, scannedPages, scannedRows: rows.length, hitScanCap: false };
        }
    }
    return { ok: true, rows, scannedPages, scannedRows: rows.length, hitScanCap: true };
}

export function registerCreateOrUpdateSensitiveWordTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_sensitive_word_platform_create_or_update_sensitive_word',
        {
            title: 'Create or update sensitive word(s)',
            description:
                '新增或修改敏感詞（rajah: SensitiveWordPlatform.CreateOrUpdateSensitiveWord）。' +
                '**帶 id = 修改既有那一筆，不帶 id = 新增**。' +
                '⚠️ **同一個 sensitiveWord 欄位在兩個分支語意不同**：新增時字串會被**用逗號拆成多筆**' +
                '（去重後一次建立多筆敏感詞）；修改時**不會拆**，整個字串（含逗號）就是那一筆的內容。' +
                '⚠️ **後端會 normalize 你送出的文字**：轉小寫、零寬字元/全形空格/一般空白都當空白處理，' +
                '所以存進去的值可能跟你送的不完全一樣（本工具會在回讀比對時據實回報差異）。' +
                `限制：新增時整串 ≤ ${ SENSITIVE_WORD_LIMITS.maxAddLength } 字、拆分後 ≤ ${ SENSITIVE_WORD_LIMITS.maxAddItem } 筆、` +
                `單筆 ≤ ${ SENSITIVE_WORD_LIMITS.maxItemLength } 字；修改時單筆 ≤ ${ SENSITIVE_WORD_LIMITS.maxItemLength } 字。` +
                '同一分組內已存在相同的詞會回 sensitiveWordExisted（訊息帶已存在的詞）。' +
                '⚠️ **這支寫入 method 在 rajah 上沒有掛任何 @Permission**（前端菜單的 Create/Edit 權限節點只掛在 ' +
                'Placeholder 方法上、沒綁到真正的 API），任何能登入本後台且該平台有開啟 SensitiveWord 模組的帳號都能呼叫。' +
                '⚠️ **sensitiveWordGroupId 必須 >= 1**：後端查重用 `groupId || 1` 但 UPDATE 寫入用未 fallback 的原始值，' +
                '傳 0 會造成「查重在分組 1、實際寫成分組 0」的不一致，本工具因此不接受 0。' +
                'sensitiveWordSourceType 是唯讀欄位（新增一律為 Manual），不開放指定。' +
                '本工具在修改前會**逐頁掃描到底**取得該 id 的現值再合併（這個 service 沒有任何依 id 查一筆的方法），' +
                '⚠️ **掃描上限 4000 筆**：敏感詞表可能因文件匯入/檢舉機制自動新增而長過這個數字，' +
                '屆時排在後段的 id 會無法更新（本工具會如實回報「掃描觸頂、無法斷定不存在」，不會謊稱找不到）；' +
                '這需要後端補一支依 id 直接查詢的 method 才能根治。' +
                '找不到就直接拒絕、不送出——後端對不存在的 id 不會回乾淨錯誤碼，而是會在寫 audit 時拋未處理例外。' +
                '寫入後會再掃一次做 round-trip 比對；⚠️ 讀取走唯讀副本，主從延遲可能讓剛寫入的值暫時讀不到，' +
                '此時回 verified=false（**不代表寫入失敗**）。',
            inputSchema: {
                id: z.number().int().min(1).optional().describe('要修改的敏感詞 id（來自 aladdin_platform_sensitive_word_platform_get_sensitive_words）；省略代表新增'),
                sensitiveWord: z.string().min(1).optional()
                    .describe('敏感詞內容。**新增時可用逗號分隔一次建立多筆**；修改時整串視為單一敏感詞（不會被拆）。新增時必填；修改時省略則沿用現值'),
                sensitiveWordGroupId: z.number().int().min(1).optional()
                    .describe(`分組 id，必須 >= 1（傳 0 會觸發後端查重與寫入用不同分組的不一致）。省略時：修改沿用現值、新增用預設分組 ${ SENSITIVE_WORD_LIMITS.defaultGroupId }`),
                remarks: z.string().optional().describe('備註。⚠️ 修改時省略會沿用現值（本工具先讀現值再合併）；但後端本身是無條件覆寫這個欄位的'),
                confirm: z.string().optional().describe(`prod 環境專用的二次確認字串（非 prod 環境不需要）。需要時填入 ${ PROD_CONFIRM_TOKEN }`),
            },
        },
        async (input) => {
            assertProdConfirmed(input.confirm);
            const isUpdate = input.id !== undefined;

            // ---- 1. 掃描現況（更新要取現值；新增要取「寫入前的 id 集合」供事後推導新 id） ----
            const before = await scanAllSensitiveWords();
            if (!before.ok) {
                return asTextResult({ success: false, mode: isUpdate ? 'update' : 'create', message: `讀取現況失敗，未執行任何寫入：${ before.message }（errorCode=${ before.errorCode }）` });
            }

            let base: ScannedWord | undefined;
            if (isUpdate) {
                base = before.rows.find((r) => r.id === input.id);
                if (!base) {
                    return asTextResult({
                        success: false,
                        mode: 'update',
                        message: before.hitScanCap
                            ? `在掃描上限內（${ before.scannedPages } 頁 / ${ before.scannedRows } 筆）沒有找到 id=${ input.id }，而且**掃描已觸頂、尚未掃到底**，無法斷定它不存在。未執行任何寫入。`
                            : `id=${ input.id } 不存在於本平台的敏感詞清單（已掃描到底：${ before.scannedPages } 頁 / ${ before.scannedRows } 筆）。未執行任何寫入。`,
                        scan: { scannedPages: before.scannedPages, scannedRows: before.scannedRows, hitScanCap: before.hitScanCap },
                    });
                }
            }

            // ---- 2. 合併 ----
            const word = input.sensitiveWord ?? base?.sensitiveWord ?? '';
            // ⚠️ 這裡刻意用 `||` 而不是 `??` 處理「沿用現值」：DB 裡可能已經存在 group_id = 0 的列
            // （正是上面那個後端 fallback 不一致造成的結果），`??` 不擋 0 會把 0 再送回去、
            // 讓後端又一次「查重在 group 1、寫回 group 0」。2026-08-28 review 指出初版只有在呼叫端
            // 顯式傳值時（zod .min(1)）才擋得住 0，沿用現值這條路徑沒擋，已修正。
            const groupId = input.sensitiveWordGroupId ?? (base?.sensitiveWordGroupId || SENSITIVE_WORD_LIMITS.defaultGroupId);
            const remarks = input.remarks ?? base?.remarks ?? '';

            // ---- 3. 送出前檢查（與後端同一組規則，轉成可行動的中文訊息） ----
            const problems: string[] = [];
            if (!word) problems.push('sensitiveWord 是必填（新增時必須提供；修改時若省略會沿用現值，現值為空代表資料異常）');
            if (word.length > SENSITIVE_WORD_LIMITS.maxAddLength) problems.push(`sensitiveWord 整串長度 ${ word.length } 超過後端上限 ${ SENSITIVE_WORD_LIMITS.maxAddLength }`);
            if (isUpdate) {
                // 後端比的是 normalize 之後的長度（sensitive_word_manager.ts:293/:300），不是原始長度。
                const normalized = normalizeSensitiveWord(word);
                if (normalized.length === 0) problems.push('sensitiveWord 經後端正規化（轉小寫、去空白與零寬字元）後會變成空字串，後端會回 requestNotValid');
                if (normalized.length > SENSITIVE_WORD_LIMITS.maxItemLength) problems.push(`修改時整串就是單一敏感詞，正規化後長度 ${ normalized.length } 超過單筆上限 ${ SENSITIVE_WORD_LIMITS.maxItemLength }`);
            } else {
                // 與後端逐字對齊：split(',') → normalize → 濾掉空字串 → 去重（sensitive_word_manager.ts:225-230）。
                const items = Array.from(new Set(word.split(',').map((w) => normalizeSensitiveWord(w)).filter((w) => w.length > 0)));
                if (items.length === 0) problems.push('sensitiveWord 用逗號拆分並經後端正規化（轉小寫、去空白與零寬字元）後沒有任何非空內容，後端會回 requestNotValid');
                if (items.length > SENSITIVE_WORD_LIMITS.maxAddItem) problems.push(`逗號拆分後共 ${ items.length } 筆，超過後端上限 ${ SENSITIVE_WORD_LIMITS.maxAddItem }`);
                const tooLong = items.filter((w) => w.length > SENSITIVE_WORD_LIMITS.maxItemLength);
                if (tooLong.length > 0) problems.push(`有 ${ tooLong.length } 筆單筆長度超過 ${ SENSITIVE_WORD_LIMITS.maxItemLength } 字（例如「${ tooLong[0]!.slice(0, 20) }…」）`);
            }
            if (problems.length > 0) {
                return asTextResult({ success: false, mode: isUpdate ? 'update' : 'create', message: '參數檢查未通過，未執行任何寫入', problems });
            }

            // ---- 4. 寫入 ----
            const payload = SensitiveWordEdit.create({
                id: input.id ?? 0,
                sensitiveWord: word,
                sensitiveWordGroupId: groupId,
                remarks,
                sensitiveWordSourceType: base?.sensitiveWordSourceType ?? SENSITIVE_WORD_SOURCE_TYPE_MAP.Manual,
            });
            const w = await withAutoRelogin(() => remote.sensitiveWordBackOffice.sensitiveWordPlatform.CreateOrUpdateSensitiveWord(payload));
            if (w.failed) {
                return asErrorResult(w, {
                    mode: isUpdate ? 'update' : 'create',
                    hint: 'sensitiveWordExisted 代表同一分組內已經有一模一樣的詞（message 會列出是哪些）；'
                        + 'sensitiveWordAddLengthLimitExceeded / sensitiveWordAddItemLimitExceeded 是長度或筆數超限；'
                        + 'requestNotValid 通常是 normalize（轉小寫、去空白/零寬字元）之後內容變成空的',
                });
            }

            // ---- 5. round-trip 讀回（唯讀副本，可能有主從延遲） ----
            const after = await scanAllSensitiveWords();
            if (!after.ok) {
                return asTextResult({
                    success: true, mode: isUpdate ? 'update' : 'create', verified: false,
                    message: `寫入的 RPC 已成功回應，但回讀確認失敗：${ after.message }。請自行用 aladdin_platform_sensitive_word_platform_get_sensitive_words 覆核`,
                });
            }

            if (isUpdate) {
                const now = after.rows.find((r) => r.id === input.id);
                if (!now) {
                    return asTextResult({
                        success: true, mode: 'update', id: input.id, verified: false,
                        message: '寫入的 RPC 已成功回應，但回讀時找不到這筆資料（本 method 讀唯讀副本，可能是主從延遲）。請稍後自行覆核，這不代表寫入失敗。',
                    });
                }
                const changed = (['sensitiveWord', 'sensitiveWordGroupId', 'remarks'] as const).filter((k) => base![k] !== now[k]);
                const requested = (['sensitiveWord', 'sensitiveWordGroupId', 'remarks'] as const).filter((k) => input[k] !== undefined);
                return asTextResult({
                    success: true,
                    mode: 'update',
                    id: input.id,
                    verified: true,
                    verification: {
                        requestedFields: requested,
                        changedFields: changed,
                        unchangedFieldsOk: changed.every((k) => requested.includes(k)),
                        normalizedDiff: input.sensitiveWord !== undefined && now.sensitiveWord !== input.sensitiveWord
                            ? { sent: input.sensitiveWord, stored: now.sensitiveWord, note: '後端 normalize（轉小寫／去空白與零寬字元）改寫了送出的內容，這是預期行為' }
                            : null,
                        note: 'changedFields 應該只包含你這次明確指定的欄位',
                    },
                    // before/after 必須用同一種表示法，否則呼叫端會把「1 vs Manual」誤讀成欄位被改掉。
                    before: { ...base!, sensitiveWordSourceType: numberToMapKey(SENSITIVE_WORD_SOURCE_TYPE_MAP, base!.sensitiveWordSourceType) },
                    after: { ...now, sensitiveWordSourceType: numberToMapKey(SENSITIVE_WORD_SOURCE_TYPE_MAP, now.sensitiveWordSourceType) },
                });
            }

            const beforeIds = new Set(before.rows.map((r) => r.id));
            const created = after.rows.filter((r) => !beforeIds.has(r.id));
            return asTextResult({
                success: true,
                mode: 'create',
                verified: created.length > 0,
                createdCount: created.length,
                createdIdSource: 'diff（本 method 空回傳、拿不到 id，改用寫入前後清單差集推導）',
                created: created.map((r) => ({ ...r, sensitiveWordSourceType: numberToMapKey(SENSITIVE_WORD_SOURCE_TYPE_MAP, r.sensitiveWordSourceType) })),
                message: created.length === 0
                    ? '寫入的 RPC 已成功回應，但回讀時看不到新資料（本 method 讀唯讀副本，可能是主從延遲）。請稍後自行覆核，這不代表寫入失敗。'
                    : undefined,
                deleteHint: '要刪除請用 aladdin_platform_sensitive_word_platform_batch_remove_sensitive_word（硬刪除，不可復原）',
            });
        },
    );
}
