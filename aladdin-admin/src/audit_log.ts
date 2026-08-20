/**
 * audit_log.ts — H32：稽核 log，把「誰、對哪個路徑/tool 做了什麼、結果如何」寫成
 * JSON Lines，供操作歸屬到人（plan.md D2 動機）與稽核憑證外洩範圍（§4.2）之用。
 *
 * 一個通過 Bearer 認證的 request 恰好一行（event:"request"）；欄位：ts / identity
 * （H3 名冊 display_name，不是 token 值）/ sourceIp（X-Forwarded-For，ngrok/proxy
 * 帶的來源 IP）/ method / path / tool（tools/call 時的 tool 名稱，其餘請求固定
 * null）/ result（'success' 或 'error:<code或短原因>'）/ agrabahIdentifier（僅
 * /login 成功時帶，這次使用的 agrabah 帳號 identifier，使我方 log 與 agrabah 後端
 * log 對得起來）/ durationMs。
 *
 * tool/result/agrabahIdentifier 這幾個欄位在 MCP tool 呼叫、/login 當下才確定，
 * 最外層 middleware 開始處理 request 時還不知道——用 AsyncLocalStorage 讓深處的
 *呼叫點（http.ts 的 registerTool 包裝層、/login handler）把資訊回填到「這個
 * request」的累積物件，最外層 middleware 在 next() resolve（含拋例外的路徑，見
 * http.ts 的 try/finally）後讀出來寫成一行——不必自行解析 MCP JSON-RPC body，
 * 避免與 SDK 路由邏輯重複（同 D8「tools 程式碼不重寫」的精神）。
 *
 * 認證失敗是另一種事件（event:"auth_failure"）：這類請求連 identity 都沒有，
 * 只帶來源 IP 與失敗原因，不含嘗試的 token 值——由 auth.ts 在判定失敗當下呼叫。
 *
 * 輸出位置：獨立檔案 <package>/logs/audit.jsonl（預設；可用
 * ALADDIN_ADMIN_AUDIT_LOG_PATH 覆蓋，供多環境部署各自指到不同檔案、供測試指到
 * 暫存目錄——覆蓋慣例同 TOKENS_PATH/TMP_DIR）。這個目錄與 H13 的
 * launchd-server.err.log 是同一個 logs/，已被 obsidian .gitignore 的
 * `mcps/aladdin-admin/logs/` 規則整個涵蓋，不進版本控制。
 *
 * 刻意不透過 console.error 借用 launchd 用 StandardErrorPath 開好的既有 stderr
 * fd：那個 fd 是 launchd 在 spawn 本行程「之前」就以路徑重導向開好的，行程存活
 * 期間對它 rename 並不會讓後續寫入換到新檔（fd 綁定的是 inode 不是路徑，之後
 * 每次 write() 仍會落在被搬走的舊檔上）——要做到「行程不重啟也能真的輪替」
 * 必須自己完整持有 open/write/rotate 的每一步，這正是本模組的做法：獨立的
 * fd，我們自己 open、自己決定何時 close+rename+重新 open。
 *
 * 輪替：每次寫入前用目前持有的 fd 呼叫 fstatSync 檢查大小，超過門檻
 * （ALADDIN_ADMIN_AUDIT_LOG_MAX_BYTES，預設 10MB）就 closeSync 現有 fd、
 * renameSync 成 `.1`（只留一份歷史，覆蓋更早的 `.1`，避免無限堆疊小檔案）、
 * openSync 一個新檔重新開始。整段檢查＋輪替＋寫入都是同步呼叫、中間沒有任何
 * await，Bun 單執行緒 event loop 保證這段期間不會有另一個 request 的稽核寫入
 * 插進來打斷——不是靠等待或排程，是同步呼叫序列本身的結構保證（CLAUDE.md
 * 禁止用等待解決正確性問題，這裡本來就不需要等待）。
 *
 * fd 延遲到第一次真的要寫入時才開（ensureOpen），不在 import 當下就有檔案
 * I/O 副作用：只是 import 這個模組（例如被 auth.ts 靜態 import）不該無條件在
 * 檔案系統留下東西，只有真的觸發一次 auth_failure 或 request 事件才會開檔。
 *
 * best-effort：稽核 I/O（open/rotate/write 任一步）失敗一律在 appendLine()
 * 內部 catch 掉、console.error 記錄，絕不上拋給呼叫端——這個模組是輔助設施，
 * 不能因為磁碟滿了或權限問題就讓正常的業務 request 跟著失敗（http.ts 在
 * finally 區塊呼叫 logAuthenticatedRequest，若這裡拋出會蓋掉 next() 的
 * 成功回應變 500；若 next() 本身已拋出，finally 再拋新例外依 JS 語意會取代
 * 原始例外）。失敗後把 fd 重置為 null，讓下一次呼叫的 ensureOpen() 自動
 * 重新 mkdir+open，不需要重啟行程——這對「輪替中途失敗」尤其重要：
 * closeSync 已執行但 renameSync/openSync 還沒成功時，若不重置 fd，模組會
 * 卡在「已關閉但非 null」，之後所有稽核寫入永久失敗直到重啟。
 */

import { openSync, closeSync, renameSync, writeSync, fstatSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Context } from 'hono';

const LOG_PATH = process.env.ALADDIN_ADMIN_AUDIT_LOG_PATH
    ?? new URL('../logs/audit.jsonl', import.meta.url).pathname;
const MAX_BYTES = Number(process.env.ALADDIN_ADMIN_AUDIT_LOG_MAX_BYTES ?? 10 * 1024 * 1024); // 10MB

/** 供測試讀取目前生效的路徑/門檻，不做其他用途。 */
export function auditLogConfigForTests(): { path: string; maxBytes: number } {
    return { path: LOG_PATH, maxBytes: MAX_BYTES };
}

let fd: number | null = null;

function ensureOpen(): number {
    if (fd === null) {
        mkdirSync(dirname(LOG_PATH), { recursive: true });
        fd = openSync(LOG_PATH, 'a');
    }
    return fd;
}

function rotateIfNeeded(): void {
    const current = ensureOpen();
    if (fstatSync(current).size < MAX_BYTES) return;
    closeSync(current);
    renameSync(LOG_PATH, `${ LOG_PATH }.1`);
    fd = openSync(LOG_PATH, 'a');
}

/**
 * best-effort 寫入：稽核 log 是輔助設施，不是業務正確性的一部分——任何一步
 * （ensureOpen 的 mkdirSync/openSync、rotateIfNeeded 的 fstatSync/closeSync/
 * renameSync/openSync、最後的 writeSync）失敗都只能 console.error 記錄後吞掉，
 * 絕不能讓例外往上傳給呼叫端（http.ts 在 finally 區塊呼叫，例外會蓋掉
 * next() 的成功回應變成 500；若 next() 本身已拋出，finally 內再拋新例外依
 * JS 語意會取代原始例外，讓真正的錯誤原因對維運不可見）。
 *
 * 失敗時一律把 module-level `fd` 重置為 null：不論失敗發生在哪個階段
 * （包含輪替中途 closeSync 已執行、renameSync/openSync 尚未成功的窗口），
 * 下次呼叫的 ensureOpen() 只認 `fd === null` 這個條件就會重新 mkdir+open，
 * 不會卡在「已關閉但非 null」的狀態一路失敗到行程重啟——這就是自我修復。
 * 重置前先嘗試 closeSync 舊 fd（同樣包 try，失敗也吞掉）避免 fd 洩漏。
 */
function appendLine(record: Record<string, unknown>): void {
    try {
        rotateIfNeeded();
        writeSync(fd as number, `${ JSON.stringify(record) }\n`);
    } catch (err) {
        if (fd !== null) {
            try {
                closeSync(fd);
            } catch {
                // 連 close 都失敗：忽略，反正下面就要把 fd 重置成 null 放棄這個描述符。
            }
        }
        fd = null;
        console.error(`[audit_log] 稽核寫入失敗（best-effort，不影響本次 request，下次寫入會自動重開檔案）：${ err instanceof Error ? err.message : String(err) }`);
    }
}

// -------- 每個 request 的稽核累積狀態（tool 呼叫 / /login 成功時回填） --------

interface AuditAccumulator {
    tool: string | null;
    result: string;
    agrabahIdentifier: string | null;
}

const accumulatorStorage = new AsyncLocalStorage<AuditAccumulator>();

/**
 * http.ts 的最外層稽核 middleware 用這支包住整個 request 處理範圍（比照
 * session.ts 的 runWithIdentity 同一種 ALS 用法，兩個 ALS context 各自獨立、
 * 可以同時巢狀套用）。result 預設 'unknown' 而非 'success'：如果某條路徑忘了
 * 呼叫 setAuditResult()，log 會誠實顯示 'unknown' 而不是誤導性地看起來像成功。
 */
export function runWithAuditAccumulator<T>(fn: () => T): T {
    return accumulatorStorage.run({ tool: null, result: 'unknown', agrabahIdentifier: null }, fn);
}

function currentAccumulator(): AuditAccumulator | undefined {
    return accumulatorStorage.getStore();
}

/** /login、/files 等 handler 在各自的成功/失敗分支呼叫，記錄這個 request 的結果。 */
export function setAuditResult(result: string): void {
    const acc = currentAccumulator();
    if (acc) acc.result = result;
}

/** http.ts 的 registerTool 包裝層在 tool 呼叫結束時呼叫，同時記錄 tool 名稱與結果。 */
export function setAuditTool(toolName: string, result: string): void {
    const acc = currentAccumulator();
    if (acc) {
        acc.tool = toolName;
        acc.result = result;
    }
}

/** POST /login 成功時呼叫：記錄這次使用的 agrabah identifier（不含密碼）。 */
export function setAuditLoginIdentifier(agrabahIdentifier: string): void {
    const acc = currentAccumulator();
    if (acc) acc.agrabahIdentifier = agrabahIdentifier;
}

// -------- 對外的兩支寫入入口 --------

function extractSourceIp(c: Context): string | null {
    const xff = c.req.header('x-forwarded-for');
    if (!xff) return null;
    return xff.split(',')[0]?.trim() || null;
}

/** 最外層 middleware 在 next() resolve（含例外路徑，見 http.ts 的 try/finally）後呼叫，寫恰好一行。 */
export function logAuthenticatedRequest(c: Context, identity: string, startedAtMs: number): void {
    const acc = currentAccumulator();
    appendLine({
        ts: new Date().toISOString(),
        event: 'request',
        identity,
        sourceIp: extractSourceIp(c),
        method: c.req.method,
        path: c.req.path,
        tool: acc?.tool ?? null,
        result: acc?.result ?? 'unknown',
        agrabahIdentifier: acc?.agrabahIdentifier ?? null,
        durationMs: Math.round(performance.now() - startedAtMs),
    });
}

/** auth.ts 在 Bearer 認證失敗時呼叫。不含嘗試的 token 值，只有來源 IP 與失敗原因。 */
export function logAuthFailure(c: Context, reason: string): void {
    appendLine({
        ts: new Date().toISOString(),
        event: 'auth_failure',
        sourceIp: extractSourceIp(c),
        method: c.req.method,
        path: c.req.path,
        reason,
    });
}

/**
 * 從 tool handler 的回傳值（asTextResult 包出來的 MCP content）萃取業務層結果。
 * tools/*.ts 對「業務失敗」的慣例是回傳 `{success:false, errorCode, message}`
 * 的 JSON 文字內容，而不是拋例外（SDK 不會因此標記 isError）——所以純看
 * handler 有沒有拋例外抓不到這種失敗，這裡盡力解析內容，解析不出來就當作
 * 'success'（tool 本身確實沒拋例外，這是誠實的退回值，不是誤判）。
 */
export function summarizeToolOutcome(resolvedValue: unknown): string {
    try {
        const content = (resolvedValue as { content?: Array<{ text?: string }> })?.content;
        const text = content?.[0]?.text;
        if (typeof text === 'string') {
            const parsed = JSON.parse(text) as { success?: boolean; errorCode?: unknown };
            if (parsed && parsed.success === false) {
                return `error:${ parsed.errorCode ?? 'business_failure' }`;
            }
        }
    } catch {
        // 非預期格式時不阻斷主流程，退回 'success'（tool 本身沒拋例外）。
    }
    return 'success';
}
