import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOSTED_RELOGIN_REQUIRED_MESSAGE } from './const.ts';

/**
 * withStderrStackLogging 的分流測試：tool handler 拋出的「需要重新登入」是預期中的
 * 業務狀態，要被轉成正常的 tool result 回傳（否則 MCP SDK 會把例外變成 JSON-RPC 層的
 * 錯誤，企劃端的 Claude Code 只會顯示「連線失敗」）；其他例外——包含 H36 的 prod
 * confirm 閘門——的處理必須一字不變。與 platform 版邏輯逐字相同，兩個 package 各自獨立。
 *
 * 為什麼在子行程跑而不是直接 import http.ts：bun test 的所有測試檔共用同一個模組
 * registry，http.ts 會連帶載入 files.ts / audit_log.ts，而這兩支都在模組載入當下就把
 * 環境變數固化成模組級常數（TMP_DIR、LOG_PATH、MAX_BYTES）。誰先載入誰說了算，直接
 * import 會讓本檔的暫存目錄設定蓋掉 files.test.ts / audit_log.test.ts 的（已實測會讓
 * 那些測試失敗）。開一個子行程，環境變數只在子行程內生效，本檔就能用真實的 http.ts
 * （不是複製一份邏輯來測）而不干擾任何其他測試檔。
 *
 * 子行程也不會起 server：Bun 只對「進入點模組」的 default export 起服務，這裡的進入點
 * 是 -e 傳入的腳本，http.ts 只是被 import，不會佔用 launchd 正在服務的埠（已實測驗證）。
 */
const testDir = mkdtempSync(join(tmpdir(), 'aladdin-admin-http-test-'));
const auditLogPath = join(testDir, 'audit.jsonl');
const TOOL_NAME = 'aladdin_admin_game_vendor_admin_list_games';

const childScript = `
const DIR = ${ JSON.stringify(dirname(fileURLToPath(import.meta.url))) };
const { withStderrStackLogging } = await import(DIR + '/http.ts');
const { ReloginRequiredError, ProdConfirmRequiredError } = await import(DIR + '/session.ts');
const { runWithAuditAccumulator, logAuthenticatedRequest } = await import(DIR + '/audit_log.ts');
const { HOSTED_RELOGIN_REQUIRED_MESSAGE } = await import(DIR + '/const.ts');

// withStderrStackLogging 覆寫 server.registerTool，所以傳一個只負責記下「被註冊進去的
// 是哪個函式」的假 server 就能拿到包裝後的 handler，不必動用 SDK 內部結構或起 transport。
function wrap(handler) {
    let wrapped;
    const fakeServer = { registerTool: (_n, _c, h) => { wrapped = h; } };
    withStderrStackLogging(fakeServer);
    fakeServer.registerTool(${ JSON.stringify(TOOL_NAME) }, {}, handler);
    return wrapped;
}

const fakeCtx = { req: { header: () => undefined, method: 'POST', path: '/mcp' } };

async function run(handler) {
    const logs = [];
    const originalConsoleError = console.error;
    console.error = (...args) => logs.push(args.map(String).join(' '));
    let threw = false;
    let value = null;
    let errorMessage = null;
    // 照真實流程：整個 tool 呼叫包在 request 的稽核累積範圍內，結束後寫出那一行。
    await runWithAuditAccumulator(async () => {
        try {
            value = await wrap(handler)();
        } catch (err) {
            threw = true;
            errorMessage = err instanceof Error ? err.message : String(err);
        }
        logAuthenticatedRequest(fakeCtx, 'tester', performance.now());
    });
    console.error = originalConsoleError;
    return { threw, value, errorMessage, logs };
}

const relogin = await run(async () => { throw new ReloginRequiredError(HOSTED_RELOGIN_REQUIRED_MESSAGE); });
const unexpected = await run(async () => { throw new Error('資料庫連線炸了'); });
const prodConfirm = await run(async () => { throw new ProdConfirmRequiredError('需要 confirm'); });
const ok = await run(async () => ({ content: [ { type: 'text', text: JSON.stringify({ success: true }) } ] }));

const auditLines = (await Bun.file(process.env.ALADDIN_ADMIN_AUDIT_LOG_PATH).text())
    .trim().split('\\n').map(line => JSON.parse(line));

await Bun.write(Bun.stdout, JSON.stringify({ relogin, unexpected, prodConfirm, ok, auditLines }));
// 顯式結束：files.ts 在模組載入時就掛了一個週期性清理的 setInterval，子行程不會自己
// 結束，spawnSync 會一直等下去。
process.exit(0);
`;

const child = spawnSync('bun', [ '-e', childScript ], {
    encoding: 'utf-8',
    env: {
        ...process.env,
        // 本檔全程不發網路請求（handler 都是測試自己提供的 thunk），這個值只是為了滿足
        // session.ts 對 ALADDIN_ADMIN_API_URL 的啟動檢查。
        ALADDIN_ADMIN_API_URL: 'http://127.0.0.1:1/never-called-in-this-test',
        ALADDIN_ADMIN_AUDIT_LOG_PATH: auditLogPath,
        // 必須明確指定：子行程繼承的是本測試行程的 process.env，而 audit_log.test.ts 為了
        // 測輪替會把這個門檻設成 500 bytes（同行程共用 process.env，先跑到誰就留下誰的值）。
        // 不覆蓋回正常值的話，子行程寫到第三行就輪替、把前面的行搬去 .1，下面按索引取的
        // 斷言會隨測試檔執行順序時好時壞。
        ALADDIN_ADMIN_AUDIT_LOG_MAX_BYTES: String(10 * 1024 * 1024),
        ALADDIN_ADMIN_FILES_TMP_DIR: join(testDir, 'tmp-uploads'),
    },
    timeout: 60_000,
});

if (child.status !== 0) {
    throw new Error(`子行程失敗（exit ${ child.status }）：\n${ child.stderr }`);
}

const observed = JSON.parse(child.stdout) as {
    relogin: { threw: boolean; value: { content: Array<{ text: string }> } | null; logs: string[] };
    unexpected: { threw: boolean; errorMessage: string | null; logs: string[] };
    prodConfirm: { threw: boolean; logs: string[] };
    auditLines: Array<Record<string, unknown>>;
};

describe('withStderrStackLogging — 需要重新登入（預期狀態）', () => {
    test('轉成一般 tool result 回傳、不往上拋，內容是 asErrorResult 格式的重登信號', () => {
        expect(observed.relogin.threw).toBe(false);
        const payload = JSON.parse(observed.relogin.value!.content[ 0 ]!.text);
        expect(payload.success).toBe(false);
        expect(payload.reloginRequired).toBe(true);
        expect(payload.errorName).toBe('loginRequired');
        expect(payload.message).toBe(HOSTED_RELOGIN_REQUIRED_MESSAGE);
    });

    test('稽核記成專屬的 error:relogin_required，與 error:exception 分得開', () => {
        expect(observed.auditLines[ 0 ]!.tool).toBe(TOOL_NAME);
        expect(observed.auditLines[ 0 ]!.result).toBe('error:relogin_required');
    });

    test('stderr 只留可追蹤的一行，不印堆疊', () => {
        expect(observed.relogin.logs.length).toBe(1);
        expect(observed.relogin.logs[ 0 ]).toContain(TOOL_NAME);
        expect(observed.relogin.logs[ 0 ]).toContain(HOSTED_RELOGIN_REQUIRED_MESSAGE);
        expect(observed.relogin.logs[ 0 ]).not.toContain('\n'); // 堆疊必然多行
        expect(observed.relogin.logs[ 0 ]).not.toContain(' at '); // 也不含任何 stack frame
    });
});

describe('withStderrStackLogging — 其他結果（行為不得改變）', () => {
    test('真正的未預期例外：仍往上拋、仍印完整堆疊、稽核仍記 error:exception', () => {
        expect(observed.unexpected.threw).toBe(true);
        expect(observed.unexpected.errorMessage).toBe('資料庫連線炸了');
        expect(observed.unexpected.logs.length).toBe(1);
        expect(observed.unexpected.logs[ 0 ]).toContain('拋出未預期例外');
        expect(observed.unexpected.logs[ 0 ]).toContain(' at '); // 堆疊照印
        expect(observed.auditLines[ 1 ]!.result).toBe('error:exception');
    });

    test('H36 的 prod confirm 閘門：仍往上拋、仍記 error:prod_confirm_required', () => {
        expect(observed.prodConfirm.threw).toBe(true);
        expect(observed.prodConfirm.logs[ 0 ]).toContain('被 prod confirm 閘門擋下');
        expect(observed.auditLines[ 2 ]!.result).toBe('error:prod_confirm_required');
    });

    test('成功回傳的 tool 不受影響，稽核仍記 success', () => {
        expect(observed.auditLines[ 3 ]!.result).toBe('success');
    });
});
