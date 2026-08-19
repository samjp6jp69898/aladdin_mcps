import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, utimesSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import type { AuthVariables } from './auth.ts';

// auth.ts 現在 import audit_log.ts（H32：認證失敗會呼叫 logAuthFailure），後者
// 在第一次寫入時才延遲 open 檔案，但路徑在模組載入當下就讀環境變數決定——這裡
// 跟 files.test.ts 用同一種手法，把它指到測試專用的暫存目錄，不讓這份測試在
// 每次執行時往真實的 logs/audit.jsonl 寫入大量 auth_failure 假資料。用
// top-level await 確保 import 發生在設定環境變數之後（type-only import 在
// 編譯期會被完全抹除，不會提早觸發模組載入）。
const auditLogTestDir = mkdtempSync(join(tmpdir(), 'agrabah-platform-auth-test-auditlog-'));
process.env.AGRABAH_PLATFORM_AUDIT_LOG_PATH = join(auditLogTestDir, 'audit.jsonl');

const { createBearerAuthGuard, getIdentity } = await import('./auth.ts');

function buildApp(registryPath: string) {
    const app = new Hono<{ Variables: AuthVariables }>();
    app.use('*', createBearerAuthGuard(registryPath));
    app.get('/whoami', c => c.text(getIdentity(c)));
    return app;
}

function writeRegistry(path: string, tokens: Array<Record<string, unknown>>) {
    writeFileSync(path, JSON.stringify({ tokens }));
}

/** 強制推進 mtime：同機測試在同一秒內連續寫檔，部分檔案系統的 mtime 解析度
 * 不夠細，若不手動推進可能導致 mtime 快取誤判「檔案沒變」。 */
function bumpMtime(path: string, deltaMs: number) {
    const stat = statSync(path);
    const next = new Date(stat.mtimeMs + deltaMs);
    utimesSync(path, next, next);
}

let dir: string | undefined;

afterEach(() => {
    if (dir) {
        rmSync(dir, { recursive: true, force: true });
        dir = undefined;
    }
});

describe('createBearerAuthGuard', () => {
    test('不帶 Authorization header：401', async () => {
        dir = mkdtempSync(join(tmpdir(), 'auth-test-'));
        const registryPath = join(dir, 'tokens.json');
        writeRegistry(registryPath, [{ id: 'a', token: 'secret-a', display_name: 'A', issued_at: '2026-08-19' }]);

        const res = await buildApp(registryPath).request('/whoami');
        expect(res.status).toBe(401);
    });

    test('帶錯誤 token：401，且 body 不洩漏正確 token 的片段或長度資訊', async () => {
        dir = mkdtempSync(join(tmpdir(), 'auth-test-'));
        const registryPath = join(dir, 'tokens.json');
        writeRegistry(registryPath, [{ id: 'a', token: 'a-very-long-correct-token-value', display_name: 'A', issued_at: '2026-08-19' }]);

        const res = await buildApp(registryPath).request('/whoami', {
            headers: { authorization: 'Bearer wrong' },
        });
        expect(res.status).toBe(401);
        const body = await res.text();
        expect(body.toLowerCase()).not.toContain('a-very-long-correct-token-value');
        expect(body).not.toMatch(/\d/); // 不透露長度等數字資訊
    });

    test('長度不同的錯誤 token 不會拋例外，一樣回 401', async () => {
        dir = mkdtempSync(join(tmpdir(), 'auth-test-'));
        const registryPath = join(dir, 'tokens.json');
        writeRegistry(registryPath, [{ id: 'a', token: 'a-very-long-correct-token-value', display_name: 'A', issued_at: '2026-08-19' }]);

        const res = await buildApp(registryPath).request('/whoami', {
            headers: { authorization: 'Bearer x' },
        });
        expect(res.status).toBe(401);
    });

    test('帶正確 token：放行，identity 是名冊的 id', async () => {
        dir = mkdtempSync(join(tmpdir(), 'auth-test-'));
        const registryPath = join(dir, 'tokens.json');
        writeRegistry(registryPath, [{ id: 'landon', token: 'correct-token', display_name: 'Landon', issued_at: '2026-08-19' }]);

        const res = await buildApp(registryPath).request('/whoami', {
            headers: { authorization: 'Bearer correct-token' },
        });
        expect(res.status).toBe(200);
        expect(await res.text()).toBe('landon');
    });

    test('名冊檔不存在：不拋例外，任何 token 皆 401', async () => {
        dir = mkdtempSync(join(tmpdir(), 'auth-test-'));
        const registryPath = join(dir, 'does-not-exist.json');

        const res = await buildApp(registryPath).request('/whoami', {
            headers: { authorization: 'Bearer whatever' },
        });
        expect(res.status).toBe(401);
    });

    test('身分傳遞是唯一 id 而非顯示名：兩個顯示名相同、id 不同的條目視為不同身分', async () => {
        dir = mkdtempSync(join(tmpdir(), 'auth-test-'));
        const registryPath = join(dir, 'tokens.json');
        writeRegistry(registryPath, [
            { id: 'landon-1', token: 'token-one', display_name: 'Landon', issued_at: '2026-08-19' },
            { id: 'landon-2', token: 'token-two', display_name: 'Landon', issued_at: '2026-08-19' },
        ]);

        const app = buildApp(registryPath);
        const res1 = await app.request('/whoami', { headers: { authorization: 'Bearer token-one' } });
        const res2 = await app.request('/whoami', { headers: { authorization: 'Bearer token-two' } });
        expect(await res1.text()).toBe('landon-1');
        expect(await res2.text()).toBe('landon-2');
    });

    test('名冊熱重載：移除一把 token 後不重啟即時 401，另一把仍可用', async () => {
        dir = mkdtempSync(join(tmpdir(), 'auth-test-'));
        const registryPath = join(dir, 'tokens.json');
        writeRegistry(registryPath, [
            { id: 'alice', token: 'alice-token', display_name: 'Alice', issued_at: '2026-08-19' },
            { id: 'bob', token: 'bob-token', display_name: 'Bob', issued_at: '2026-08-19' },
        ]);

        const app = buildApp(registryPath);
        const before = await app.request('/whoami', { headers: { authorization: 'Bearer alice-token' } });
        expect(before.status).toBe(200);

        // 撤銷 alice：從名冊移除，同一個行程、同一支 app，不重啟。
        writeRegistry(registryPath, [{ id: 'bob', token: 'bob-token', display_name: 'Bob', issued_at: '2026-08-19' }]);
        bumpMtime(registryPath, 1000);

        const afterAlice = await app.request('/whoami', { headers: { authorization: 'Bearer alice-token' } });
        expect(afterAlice.status).toBe(401);

        const afterBob = await app.request('/whoami', { headers: { authorization: 'Bearer bob-token' } });
        expect(afterBob.status).toBe(200);
        expect(await afterBob.text()).toBe('bob');
    });

    test('名冊格式驗證：重複 token 時拒絕該次載入，沿用前一份有效名冊', async () => {
        dir = mkdtempSync(join(tmpdir(), 'auth-test-'));
        const registryPath = join(dir, 'tokens.json');
        writeRegistry(registryPath, [{ id: 'alice', token: 'alice-token', display_name: 'Alice', issued_at: '2026-08-19' }]);

        const app = buildApp(registryPath);
        const before = await app.request('/whoami', { headers: { authorization: 'Bearer alice-token' } });
        expect(before.status).toBe(200);

        // 壞掉的名冊：同一個 token 出現兩次（id 不同）。
        writeRegistry(registryPath, [
            { id: 'alice', token: 'dup-token', display_name: 'Alice', issued_at: '2026-08-19' },
            { id: 'mallory', token: 'dup-token', display_name: 'Mallory', issued_at: '2026-08-19' },
        ]);
        bumpMtime(registryPath, 1000);

        // 沿用前一份有效名冊：alice 的舊 token 仍然有效，壞名冊裡的新 token 不生效。
        const stillOld = await app.request('/whoami', { headers: { authorization: 'Bearer alice-token' } });
        expect(stillOld.status).toBe(200);

        const rejectedNew = await app.request('/whoami', { headers: { authorization: 'Bearer dup-token' } });
        expect(rejectedNew.status).toBe(401);
    });

    test('名冊格式驗證：重複 id 時拒絕該次載入，沿用前一份有效名冊', async () => {
        dir = mkdtempSync(join(tmpdir(), 'auth-test-'));
        const registryPath = join(dir, 'tokens.json');
        writeRegistry(registryPath, [{ id: 'alice', token: 'alice-token', display_name: 'Alice', issued_at: '2026-08-19' }]);

        const app = buildApp(registryPath);
        const before = await app.request('/whoami', { headers: { authorization: 'Bearer alice-token' } });
        expect(before.status).toBe(200);

        // 壞掉的名冊：同一個 id 出現兩次（token 不同）。
        writeRegistry(registryPath, [
            { id: 'alice', token: 'alice-token-2', display_name: 'Alice', issued_at: '2026-08-19' },
            { id: 'alice', token: 'alice-token-3', display_name: 'Alice Duplicate', issued_at: '2026-08-19' },
        ]);
        bumpMtime(registryPath, 1000);

        const stillOld = await app.request('/whoami', { headers: { authorization: 'Bearer alice-token' } });
        expect(stillOld.status).toBe(200);

        const rejectedNew = await app.request('/whoami', { headers: { authorization: 'Bearer alice-token-2' } });
        expect(rejectedNew.status).toBe(401);
    });

    // 三個 review 找到的真實 bug（見 commit）的回歸測試：一份手誤缺欄位的
    // 名冊，過去會被當成合法資料快取（缺 id 時 identity 變成 undefined、
    // 缺 token 時比對邏輯對 undefined 呼叫 Buffer.from() 直接拋例外），而且
    // 後者的例外發生在每個 request 各自的比對迴圈裡、不在 loadRegistry 的
    // try/catch 保護範圍內，會讓「這次載入」之後的所有身分（不只壞掉那筆）
    // 全部 500，直到名冊修好——一筆手誤打掛整層認證。

    test('條目缺少 token：拒絕該次載入，不拋例外、不誤放行、沿用前一份有效名冊', async () => {
        dir = mkdtempSync(join(tmpdir(), 'auth-test-'));
        const registryPath = join(dir, 'tokens.json');
        writeRegistry(registryPath, [{ id: 'alice', token: 'alice-token', display_name: 'Alice', issued_at: '2026-08-19' }]);

        const app = buildApp(registryPath);
        const before = await app.request('/whoami', { headers: { authorization: 'Bearer alice-token' } });
        expect(before.status).toBe(200);

        writeRegistry(registryPath, [{ id: 'orphan', display_name: 'Orphan', issued_at: '2026-08-19' }]);
        bumpMtime(registryPath, 1000);

        // 沿用前一份有效名冊：alice 仍然有效。
        const stillOld = await app.request('/whoami', { headers: { authorization: 'Bearer alice-token' } });
        expect(stillOld.status).toBe(200);

        // 用任何 token 都不該打進壞掉的那筆條目而拋例外導致 500。
        const noCrash = await app.request('/whoami', { headers: { authorization: 'Bearer anything' } });
        expect(noCrash.status).toBe(401);
    });

    test('條目缺少 id：拒絕該次載入，不把 identity 設成 undefined、沿用前一份有效名冊', async () => {
        dir = mkdtempSync(join(tmpdir(), 'auth-test-'));
        const registryPath = join(dir, 'tokens.json');
        writeRegistry(registryPath, [{ id: 'alice', token: 'alice-token', display_name: 'Alice', issued_at: '2026-08-19' }]);

        const app = buildApp(registryPath);
        const before = await app.request('/whoami', { headers: { authorization: 'Bearer alice-token' } });
        expect(before.status).toBe(200);

        writeRegistry(registryPath, [{ token: 'orphan-token', display_name: 'Orphan', issued_at: '2026-08-19' }]);
        bumpMtime(registryPath, 1000);

        const stillOld = await app.request('/whoami', { headers: { authorization: 'Bearer alice-token' } });
        expect(stillOld.status).toBe(200);

        const rejectedNew = await app.request('/whoami', { headers: { authorization: 'Bearer orphan-token' } });
        expect(rejectedNew.status).toBe(401);
    });

    test('tokens 欄位不是陣列（如 null）：不靜默清空成功名冊，沿用前一份有效名冊', async () => {
        dir = mkdtempSync(join(tmpdir(), 'auth-test-'));
        const registryPath = join(dir, 'tokens.json');
        writeRegistry(registryPath, [{ id: 'alice', token: 'alice-token', display_name: 'Alice', issued_at: '2026-08-19' }]);

        const app = buildApp(registryPath);
        const before = await app.request('/whoami', { headers: { authorization: 'Bearer alice-token' } });
        expect(before.status).toBe(200);

        writeFileSync(registryPath, JSON.stringify({ tokens: null }));
        bumpMtime(registryPath, 1000);

        // 過去的 bug：非陣列被當成空陣列，靜默覆蓋掉前一份有效快取，alice 會變 401。
        const stillOld = await app.request('/whoami', { headers: { authorization: 'Bearer alice-token' } });
        expect(stillOld.status).toBe(200);
    });

    test('名冊檔內容是空物件 {}：不拋例外，視為格式錯誤沿用前一份有效名冊', async () => {
        dir = mkdtempSync(join(tmpdir(), 'auth-test-'));
        const registryPath = join(dir, 'tokens.json');
        writeRegistry(registryPath, [{ id: 'alice', token: 'alice-token', display_name: 'Alice', issued_at: '2026-08-19' }]);

        const app = buildApp(registryPath);
        const before = await app.request('/whoami', { headers: { authorization: 'Bearer alice-token' } });
        expect(before.status).toBe(200);

        writeFileSync(registryPath, JSON.stringify({}));
        bumpMtime(registryPath, 1000);

        const stillOld = await app.request('/whoami', { headers: { authorization: 'Bearer alice-token' } });
        expect(stillOld.status).toBe(200);
    });
});
