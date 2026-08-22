import { describe, test, expect } from 'bun:test';
import { mkdtempSync, readFileSync, existsSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono, type Context } from 'hono';

// LOG_PATH/MAX_BYTES 在模組載入時就讀一次環境變數，所以必須在 import 之前
// 設定好，指到測試專用的暫存目錄——不能借用真實的 logs/audit.jsonl（跟其他
// 並行測試互相污染，也不該在 repo 目錄留下真實稽核檔案）。用 top-level await
// 確保 import 發生在設定環境變數之後（比照 files.test.ts 的既有手法）。
const testDir = mkdtempSync(join(tmpdir(), 'aladdin-platform-audit-log-test-'));
const logPath = join(testDir, 'audit.jsonl');
process.env.ALADDIN_PLATFORM_AUDIT_LOG_PATH = logPath;
process.env.ALADDIN_PLATFORM_AUDIT_LOG_MAX_BYTES = '500'; // 小門檻，方便測輪替不必真的灌大量資料

const {
    runWithAuditAccumulator,
    setAuditResult,
    setAuditTool,
    setAuditLoginIdentifier,
    logAuthenticatedRequest,
    logAuthFailure,
    summarizeToolOutcome,
    auditLogConfigForTests,
} = await import('./audit_log.ts');

function readLines(path: string): Array<Record<string, unknown>> {
    if (!existsSync(path)) return [];
    return readFileSync(path, 'utf-8')
        .split('\n')
        .filter(line => line.length > 0)
        .map(line => JSON.parse(line));
}

async function fakeContext(overrides: { path?: string; method?: string; xff?: string } = {}): Promise<Context> {
    const app = new Hono();
    let captured!: Context;
    app.all('*', c => {
        captured = c;
        return c.text('ok');
    });
    const headers: Record<string, string> = {};
    if (overrides.xff) headers['x-forwarded-for'] = overrides.xff;
    await app.request(overrides.path ?? '/mcp', { method: overrides.method ?? 'POST', headers });
    return captured;
}

describe('audit_log — 基本寫入格式', () => {
    test('logAuthenticatedRequest 寫出含所有欄位的一行 JSON，tool/agrabahIdentifier 預設 null', async () => {
        const c = await fakeContext({ path: '/mcp', method: 'POST', xff: '1.2.3.4, 10.0.0.1' });
        runWithAuditAccumulator(() => {
            logAuthenticatedRequest(c as never, 'Landon', performance.now());
        });

        const lines = readLines(auditLogConfigForTests().path);
        expect(lines.length).toBe(1);
        const line = lines[0];
        expect(line.event).toBe('request');
        expect(line.identity).toBe('Landon');
        expect(line.sourceIp).toBe('1.2.3.4'); // 只取第一個（最靠近呼叫端的那個）
        expect(line.method).toBe('POST');
        expect(line.path).toBe('/mcp');
        expect(line.tool).toBeNull();
        expect(line.agrabahIdentifier).toBeNull();
        expect(line.result).toBe('unknown');
        expect(typeof line.durationMs).toBe('number');
        expect(typeof line.ts).toBe('string');
    });

    test('沒有 X-Forwarded-For header：sourceIp 為 null，不臆造來源 IP', async () => {
        const c = await fakeContext({ path: '/health' });
        runWithAuditAccumulator(() => {
            logAuthenticatedRequest(c as never, 'Landon', performance.now());
        });
        const lines = readLines(auditLogConfigForTests().path);
        expect(lines.at(-1)?.sourceIp).toBeNull();
    });

    test('setAuditTool / setAuditResult / setAuditLoginIdentifier 會回填到同一個 request 的稽核行', async () => {
        const c = await fakeContext({ path: '/mcp' });
        runWithAuditAccumulator(() => {
            setAuditTool('aladdin_platform_game_vendor_platform_list_games', 'success');
            logAuthenticatedRequest(c as never, 'Landon', performance.now());
        });
        const last = readLines(auditLogConfigForTests().path).at(-1);
        expect(last?.tool).toBe('aladdin_platform_game_vendor_platform_list_games');
        expect(last?.result).toBe('success');
    });

    test('setAuditLoginIdentifier 只影響同一個 ALS context，不會洩漏到另一個併發 request', async () => {
        const cA = await fakeContext({ path: '/login' });
        const cB = await fakeContext({ path: '/login' });

        await Promise.all([
            runWithAuditAccumulator(async () => {
                setAuditLoginIdentifier('userA');
                setAuditResult('success');
                await new Promise(r => setTimeout(r, 0)); // 讓兩個 context 交錯執行
                logAuthenticatedRequest(cA as never, 'landon', performance.now());
            }),
            runWithAuditAccumulator(async () => {
                setAuditLoginIdentifier('userB');
                setAuditResult('error:401');
                logAuthenticatedRequest(cB as never, 'alice', performance.now());
            }),
        ]);

        const lines = readLines(auditLogConfigForTests().path);
        const tailTwo = lines.slice(-2);
        const forA = tailTwo.find(l => l.agrabahIdentifier === 'userA');
        const forB = tailTwo.find(l => l.agrabahIdentifier === 'userB');
        expect(forA?.identity).toBe('landon');
        expect(forA?.result).toBe('success');
        expect(forB?.identity).toBe('alice');
        expect(forB?.result).toBe('error:401');
    });

    test('logAuthFailure 只帶來源 IP、method、path、reason，不含任何 token 相關欄位', async () => {
        const c = await fakeContext({ path: '/mcp', xff: '9.9.9.9' });
        logAuthFailure(c as never, 'invalid_token');
        const last = readLines(auditLogConfigForTests().path).at(-1);
        expect(last?.event).toBe('auth_failure');
        expect(last?.sourceIp).toBe('9.9.9.9');
        expect(last?.reason).toBe('invalid_token');
        expect(Object.keys(last ?? {})).not.toContain('token');
        expect(JSON.stringify(last)).not.toContain('Bearer');
    });
});

describe('audit_log — summarizeToolOutcome', () => {
    test('業務成功（success:true）判定為 success', () => {
        const value = { content: [ { type: 'text', text: JSON.stringify({ success: true, rows: [] }) } ] };
        expect(summarizeToolOutcome(value)).toBe('success');
    });

    test('業務失敗（success:false + errorCode）判定為 error:<code>', () => {
        const value = { content: [ { type: 'text', text: JSON.stringify({ success: false, errorCode: 103, message: 'x' }) } ] };
        expect(summarizeToolOutcome(value)).toBe('error:103');
    });

    test('非預期格式（不是 JSON、缺 content）不拋例外，退回 success', () => {
        expect(summarizeToolOutcome({ content: [ { type: 'text', text: 'not json' } ] })).toBe('success');
        expect(summarizeToolOutcome(undefined)).toBe('success');
        expect(summarizeToolOutcome({})).toBe('success');
    });
});

describe('audit_log — 輪替', () => {
    test('超過大小門檻時輪替：舊內容搬進 .1，原路徑變成只含新內容的小檔', async () => {
        // 刻意不用 rmSync 清空 testDir 重來：模組內的 fd 是延遲開啟且跨測試持續
        // 持有的單例（見 audit_log.ts 的 ensureOpen），若在它已經開啟之後把底下
        // 的檔案整個砍掉，之後的 renameSync(LOG_PATH, ...) 會因為來源路徑已不
        // 存在而拋例外——這正是 audit_log.ts 檔頭說明的「fd 綁定 inode 不是
        // 路徑」那個現象的另一種展現。改成不清空、只驗證「寫夠多行之後 .1 確實
        // 出現、且輪替後的當前檔沒有無限累積」，這兩個斷言不依賴起始狀態是空的。
        const c = await fakeContext({ path: '/mcp' });

        // MAX_BYTES=500，每行約 100+ bytes，寫足夠多行必然觸發至少一次輪替。
        for (let i = 0; i < 20; i++) {
            runWithAuditAccumulator(() => {
                setAuditTool(`tool_${ i }`, 'success');
                logAuthenticatedRequest(c as never, 'Landon', performance.now());
            });
        }

        const { path, maxBytes } = auditLogConfigForTests();
        expect(existsSync(`${ path }.1`)).toBe(true); // 舊檔確實被輪替出去，不是無限成長

        const currentLines = readLines(path);
        expect(currentLines.length).toBeGreaterThan(0);
        expect(currentLines.every(l => l.event === 'request')).toBe(true);

        // 輪替後的「當前檔」本身仍在門檻附近（不是舊內容+新內容疊在一起無限長）。
        const { statSync } = await import('node:fs');
        expect(statSync(path).size).toBeLessThan(maxBytes * 4);

        const backupLines = readLines(`${ path }.1`);
        expect(backupLines.length).toBeGreaterThan(0); // .1 確實保留了被輪替出去的舊內容
    });
});

describe('audit_log — best-effort：I/O 失敗不影響 request，且能自我修復', () => {
    test('輪替中途失敗（目錄不可存取）：不拋例外；目錄恢復可存取後下一次寫入自動修復，不必重啟、不必等待', async () => {
        const c = await fakeContext({ path: '/mcp' });

        // 用 chmod 0o000（連 execute/search 權限都收回）注入一個確定性的失敗：
        // 這會讓「路徑解析」全部失敗（renameSync 的來源/目的地、ensureOpen()
        // 內 fd===null 時要重開的 openSync），但不影響已經開啟的 fd 本身
        // （fstatSync/closeSync 只操作 fd 數字、不需要路徑解析，仍會成功）——
        // 精準對應 review 指出的風險 (c)：closeSync 之後、openSync 之前失敗。
        // 這是可注入、可重現的失敗，不靠 sleep/時間；下面的「自我修復」驗證
        // 也是靠 chmod 改回可寫這個明確的狀態變化，不是等出來的。
        chmodSync(testDir, 0o000);
        try {
            // MAX_BYTES=500，每行約 100+ bytes：不論這個測試開始時當前檔已經
            // 多大，15 行（最壞情況從 0 開始也遠超過 500 bytes）都保證期間至少
            // 觸發一次輪替嘗試，而輪替嘗試在目錄被鎖住時必定失敗。
            expect(() => {
                for (let i = 0; i < 15; i++) {
                    runWithAuditAccumulator(() => {
                        setAuditTool(`blocked_${ i }`, 'success');
                        logAuthenticatedRequest(c as never, 'Landon', performance.now());
                    });
                }
            }).not.toThrow(); // best-effort：即使底層 I/O 全部失敗，呼叫端也拿不到例外
        } finally {
            chmodSync(testDir, 0o700); // 還原可寫，供下面驗證自我修復
        }

        // 目錄恢復可存取後，緊接著（同一個同步測試流程內，沒有任何等待）呼叫
        // 一次，應該直接成功並寫進檔案——證明 appendLine 失敗後有把 fd 重置成
        // null，下次呼叫的 ensureOpen() 會自動重新 mkdir+open，不需要重啟行程。
        runWithAuditAccumulator(() => {
            setAuditTool('healed_after_chmod_back', 'success');
            logAuthenticatedRequest(c as never, 'Landon', performance.now());
        });

        const lines = readLines(auditLogConfigForTests().path);
        expect(lines.some(l => l.tool === 'healed_after_chmod_back')).toBe(true);
    });
});
