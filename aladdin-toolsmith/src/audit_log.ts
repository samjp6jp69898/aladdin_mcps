/**
 * audit_log.ts — 稽核 log，把「誰、對哪個路徑/tool 做了什麼、結果如何」寫成
 * JSON Lines。逐字沿用 aladdin-admin/src/audit_log.ts 的設計（fd 自持有、
 * 同步輪替、AsyncLocalStorage 回填、best-effort 不影響業務 request），
 * 差異只在拿掉 admin 特有的 /login agrabahIdentifier 欄位——toolsmith 沒有
 * 對應的登入端點。詳細理由（為何自持 fd、為何同步輪替、為何 best-effort）
 * 見 aladdin-admin/src/audit_log.ts 檔頭註解，這裡不重複。
 *
 * 2026-08-31：toolsmith 原本完全沒有稽核 log（auth.ts 檔頭曾明寫這是刻意的
 * 範圍縮減），導致 tg-monitor 的「使用 Session」「即時序列」等分頁看不到
 * toolsmith 的任何 tool 使用紀錄。這裡補上，並在 tg-monitor/lib/services.ts
 * 註冊 auditLog 路徑後即可被同一套 ingest 邏輯讀到。
 *
 * 輸出位置：<package>/logs/audit.jsonl（預設；可用 TOOLSMITH_AUDIT_LOG_PATH
 * 覆蓋），已被 aladdin_mcps .gitignore 的 `aladdin-toolsmith/logs/` 規則
 * 整個涵蓋，不進版本控制。
 */

import { openSync, closeSync, renameSync, writeSync, fstatSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Context } from 'hono';

const LOG_PATH = process.env.TOOLSMITH_AUDIT_LOG_PATH
    ?? new URL('../logs/audit.jsonl', import.meta.url).pathname;
const MAX_BYTES = Number(process.env.TOOLSMITH_AUDIT_LOG_MAX_BYTES ?? 10 * 1024 * 1024); // 10MB

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

// -------- 每個 request 的稽核累積狀態（tool 呼叫結束時回填） --------

interface AuditAccumulator {
    tool: string | null;
    result: string;
}

const accumulatorStorage = new AsyncLocalStorage<AuditAccumulator>();

/**
 * http.ts 的最外層稽核 middleware 用這支包住整個 request 處理範圍。result
 * 預設 'unknown' 而非 'success'：如果某條路徑忘了呼叫 setAuditTool()，log 會
 * 誠實顯示 'unknown' 而不是誤導性地看起來像成功。
 */
export function runWithAuditAccumulator<T>(fn: () => T): T {
    return accumulatorStorage.run({ tool: null, result: 'unknown' }, fn);
}

function currentAccumulator(): AuditAccumulator | undefined {
    return accumulatorStorage.getStore();
}

/** http.ts 的 registerTool 包裝層在 tool 呼叫結束時呼叫，記錄 tool 名稱與結果。 */
export function setAuditTool(toolName: string, result: string): void {
    const acc = currentAccumulator();
    if (acc) {
        acc.tool = toolName;
        acc.result = result;
    }
}

// -------- 對外的兩支寫入入口 --------

function extractSourceIp(c: Context): string | null {
    const xff = c.req.header('x-forwarded-for');
    if (!xff) return null;
    return xff.split(',')[0]?.trim() || null;
}

/**
 * 最外層 middleware 在 next() resolve（含例外路徑，見 http.ts 的 try/finally）後呼叫，
 * 寫恰好一行。identity 是名冊唯一 id（歸屬鍵）；displayName 只供人類閱讀。
 */
export function logAuthenticatedRequest(c: Context, identity: string, displayName: string, startedAtMs: number): void {
    const acc = currentAccumulator();
    appendLine({
        ts: new Date().toISOString(),
        event: 'request',
        identity,
        displayName,
        sourceIp: extractSourceIp(c),
        method: c.req.method,
        path: c.req.path,
        tool: acc?.tool ?? null,
        result: acc?.result ?? 'unknown',
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
 * tools/*.ts 對「業務失敗」的慣例是回傳 `{success:false, errorKind, message}`
 * 的 JSON 文字內容（見 generate_tool.ts / query_log.ts），而不是拋例外——
 * 這裡盡力解析內容，解析不出來就當作 'success'（tool 本身確實沒拋例外）。
 */
export function summarizeToolOutcome(resolvedValue: unknown): string {
    try {
        const content = (resolvedValue as { content?: Array<{ text?: string }> })?.content;
        const text = content?.[0]?.text;
        if (typeof text === 'string') {
            const parsed = JSON.parse(text) as { success?: boolean; errorKind?: unknown };
            if (parsed && parsed.success === false) {
                return `error:${ parsed.errorKind ?? 'business_failure' }`;
            }
        }
    } catch {
        // 非預期格式時不阻斷主流程，退回 'success'。
    }
    return 'success';
}
