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
const auditLogTestDir = mkdtempSync(join(tmpdir(), 'aladdin-platform-auth-test-auditlog-'));
process.env.ALADDIN_PLATFORM_AUDIT_LOG_PATH = join(auditLogTestDir, 'audit.jsonl');

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

    // ── M3 fail-closed 語意 ───────────────────────────────────────────────
    // 以下這組測試的期望在 M3 被整批反轉：舊行為是「名冊載入失敗 → 沿用前一份
    // 有效名冊」，等於用一份磁碟上已不存在的狀態繼續放行請求；外洩通報後維運者
    // 最直覺的止血動作（刪掉名冊檔、或手改存壞）因此完全不撤銷任何 token。
    // 新語意：只有一份完整通過驗證的名冊能授權請求，任何讀不到/解析不了/驗證
    // 不過的情況一律全部 401。詳細取捨見 auth.ts 檔頭。

    test('名冊格式驗證：重複 token 時 fail-closed，舊 token 一併失效', async () => {
        dir = mkdtempSync(join(tmpdir(), 'auth-test-'));
        const registryPath = join(dir, 'tokens.json');
        writeRegistry(registryPath, [{ id: 'alice', token: 'alice-token', display_name: 'Alice', issued_at: '2026-08-19' }]);

        const app = buildApp(registryPath);
        const before = await app.request('/whoami', { headers: { authorization: 'Bearer alice-token' } });
        expect(before.status).toBe(200);

        // 壞掉的名冊：同一個 token 出現兩次（id 不同）——身分變得有歧義，不可授權。
        writeRegistry(registryPath, [
            { id: 'alice', token: 'dup-token', display_name: 'Alice', issued_at: '2026-08-19' },
            { id: 'mallory', token: 'dup-token', display_name: 'Mallory', issued_at: '2026-08-19' },
        ]);
        bumpMtime(registryPath, 1000);

        const oldToken = await app.request('/whoami', { headers: { authorization: 'Bearer alice-token' } });
        expect(oldToken.status).toBe(401);

        const ambiguous = await app.request('/whoami', { headers: { authorization: 'Bearer dup-token' } });
        expect(ambiguous.status).toBe(401);
    });

    test('名冊格式驗證：重複 id 時 fail-closed，舊 token 一併失效', async () => {
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

        const oldToken = await app.request('/whoami', { headers: { authorization: 'Bearer alice-token' } });
        expect(oldToken.status).toBe(401);

        const rejectedNew = await app.request('/whoami', { headers: { authorization: 'Bearer alice-token-2' } });
        expect(rejectedNew.status).toBe(401);
    });

    // 缺欄位的名冊：M3 之前這裡的風險是「被當成合法資料收下」——缺 id 時 identity
    // 變成 undefined、缺 token 時比對邏輯對 undefined 呼叫 Buffer.from() 直接拋
    // 例外，而該例外在每個 request 各自的比對迴圈裡、不在 loadRegistry 的
    // try/catch 內，會讓所有身分（不只壞掉那筆）全部 500。fail-closed 之後這層
    // 保護更強：不合格條目連這次都進不了授權路徑，結果是乾淨的 401 而不是 500。

    test('條目缺少 token：fail-closed 回 401，不拋例外也不回 500', async () => {
        dir = mkdtempSync(join(tmpdir(), 'auth-test-'));
        const registryPath = join(dir, 'tokens.json');
        writeRegistry(registryPath, [{ id: 'alice', token: 'alice-token', display_name: 'Alice', issued_at: '2026-08-19' }]);

        const app = buildApp(registryPath);
        const before = await app.request('/whoami', { headers: { authorization: 'Bearer alice-token' } });
        expect(before.status).toBe(200);

        writeRegistry(registryPath, [{ id: 'orphan', display_name: 'Orphan', issued_at: '2026-08-19' }]);
        bumpMtime(registryPath, 1000);

        const oldToken = await app.request('/whoami', { headers: { authorization: 'Bearer alice-token' } });
        expect(oldToken.status).toBe(401);

        // 關鍵：是 401 而不是 500——沒有任何 request 打進壞條目的比對而拋例外。
        const noCrash = await app.request('/whoami', { headers: { authorization: 'Bearer anything' } });
        expect(noCrash.status).toBe(401);
    });

    test('條目缺少 id：fail-closed 回 401，不把 identity 設成 undefined', async () => {
        dir = mkdtempSync(join(tmpdir(), 'auth-test-'));
        const registryPath = join(dir, 'tokens.json');
        writeRegistry(registryPath, [{ id: 'alice', token: 'alice-token', display_name: 'Alice', issued_at: '2026-08-19' }]);

        const app = buildApp(registryPath);
        const before = await app.request('/whoami', { headers: { authorization: 'Bearer alice-token' } });
        expect(before.status).toBe(200);

        writeRegistry(registryPath, [{ token: 'orphan-token', display_name: 'Orphan', issued_at: '2026-08-19' }]);
        bumpMtime(registryPath, 1000);

        const oldToken = await app.request('/whoami', { headers: { authorization: 'Bearer alice-token' } });
        expect(oldToken.status).toBe(401);

        const rejectedNew = await app.request('/whoami', { headers: { authorization: 'Bearer orphan-token' } });
        expect(rejectedNew.status).toBe(401);
    });

    test('tokens 欄位不是陣列（如 null）：fail-closed 回 401', async () => {
        dir = mkdtempSync(join(tmpdir(), 'auth-test-'));
        const registryPath = join(dir, 'tokens.json');
        writeRegistry(registryPath, [{ id: 'alice', token: 'alice-token', display_name: 'Alice', issued_at: '2026-08-19' }]);

        const app = buildApp(registryPath);
        const before = await app.request('/whoami', { headers: { authorization: 'Bearer alice-token' } });
        expect(before.status).toBe(200);

        writeFileSync(registryPath, JSON.stringify({ tokens: null }));
        bumpMtime(registryPath, 1000);

        const oldToken = await app.request('/whoami', { headers: { authorization: 'Bearer alice-token' } });
        expect(oldToken.status).toBe(401);
    });

    test('名冊檔內容是空物件 {}：fail-closed 回 401，不拋例外', async () => {
        dir = mkdtempSync(join(tmpdir(), 'auth-test-'));
        const registryPath = join(dir, 'tokens.json');
        writeRegistry(registryPath, [{ id: 'alice', token: 'alice-token', display_name: 'Alice', issued_at: '2026-08-19' }]);

        const app = buildApp(registryPath);
        const before = await app.request('/whoami', { headers: { authorization: 'Bearer alice-token' } });
        expect(before.status).toBe(200);

        writeFileSync(registryPath, JSON.stringify({}));
        bumpMtime(registryPath, 1000);

        const oldToken = await app.request('/whoami', { headers: { authorization: 'Bearer alice-token' } });
        expect(oldToken.status).toBe(401);
    });

    // ── M3 主場景：載入成功「之後」名冊消失或損毀 ─────────────────────────
    // 原本的測試只覆蓋「名冊檔從未存在」（上面那則），而真正的事故形狀是
    // 「服務已經跑一陣子、名冊載入成功過，維運者才去刪檔／改壞」。

    test('載入成功後名冊檔被刪除：立刻全部 401，不沿用記憶體裡的舊名冊', async () => {
        dir = mkdtempSync(join(tmpdir(), 'auth-test-'));
        const registryPath = join(dir, 'tokens.json');
        writeRegistry(registryPath, [{ id: 'alice', token: 'alice-token', display_name: 'Alice', issued_at: '2026-08-19' }]);

        const app = buildApp(registryPath);
        const before = await app.request('/whoami', { headers: { authorization: 'Bearer alice-token' } });
        expect(before.status).toBe(200);

        // 外洩通報後最直覺的止血動作：把整份名冊刪掉。這必須真的撤銷所有 token。
        rmSync(registryPath);

        const afterDelete = await app.request('/whoami', { headers: { authorization: 'Bearer alice-token' } });
        expect(afterDelete.status).toBe(401);
    });

    test('載入成功後名冊被寫成壞 JSON：立刻全部 401，被撤銷的 token 不會存活', async () => {
        dir = mkdtempSync(join(tmpdir(), 'auth-test-'));
        const registryPath = join(dir, 'tokens.json');
        writeRegistry(registryPath, [
            { id: 'alice', token: 'alice-token', display_name: 'Alice', issued_at: '2026-08-19' },
            { id: 'mallory', token: 'leaked-token', display_name: 'Mallory', issued_at: '2026-08-19' },
        ]);

        const app = buildApp(registryPath);
        expect((await app.request('/whoami', { headers: { authorization: 'Bearer leaked-token' } })).status).toBe(200);

        // 維運者想刪掉 mallory 那筆，但存檔時手滑弄出語法錯誤（少一個右大括號）。
        writeFileSync(registryPath, '{"tokens":[{"id":"alice","token":"alice-token","display_name":"Alice","issued_at":"2026-08-19"}');
        bumpMtime(registryPath, 1000);

        // 舊行為：解析失敗 → 沿用前一份 → 外洩的 leaked-token continue 有效。
        const leaked = await app.request('/whoami', { headers: { authorization: 'Bearer leaked-token' } });
        expect(leaked.status).toBe(401);

        const alice = await app.request('/whoami', { headers: { authorization: 'Bearer alice-token' } });
        expect(alice.status).toBe(401);
    });

    test('壞名冊修好後自動恢復認證，不需要重啟行程', async () => {
        dir = mkdtempSync(join(tmpdir(), 'auth-test-'));
        const registryPath = join(dir, 'tokens.json');
        writeRegistry(registryPath, [{ id: 'alice', token: 'alice-token', display_name: 'Alice', issued_at: '2026-08-19' }]);

        const app = buildApp(registryPath);
        expect((await app.request('/whoami', { headers: { authorization: 'Bearer alice-token' } })).status).toBe(200);

        writeFileSync(registryPath, 'not json at all');
        bumpMtime(registryPath, 1000);
        expect((await app.request('/whoami', { headers: { authorization: 'Bearer alice-token' } })).status).toBe(401);

        // fail-closed 的代價必須是有界且可自癒的：改回合法名冊後，同一支 app、
        // 同一個行程就恢復——這是「單筆手誤讓全體 401」這個取捨能成立的前提。
        writeRegistry(registryPath, [{ id: 'alice', token: 'alice-token', display_name: 'Alice', issued_at: '2026-08-19' }]);
        bumpMtime(registryPath, 2000);

        const recovered = await app.request('/whoami', { headers: { authorization: 'Bearer alice-token' } });
        expect(recovered.status).toBe(200);
        expect(await recovered.text()).toBe('alice');
    });

    test('撤銷後 mtime 被還原成完全相同的值：撤銷仍然生效', async () => {
        dir = mkdtempSync(join(tmpdir(), 'auth-test-'));
        const registryPath = join(dir, 'tokens.json');
        writeRegistry(registryPath, [
            { id: 'alice', token: 'alice-token', display_name: 'Alice', issued_at: '2026-08-19' },
            { id: 'mallory', token: 'leaked-token', display_name: 'Mallory', issued_at: '2026-08-19' },
        ]);
        const originalMtime = statSync(registryPath).mtimeMs;

        const app = buildApp(registryPath);
        expect((await app.request('/whoami', { headers: { authorization: 'Bearer leaked-token' } })).status).toBe(200);

        // 撤銷 mallory，然後把 mtime 還原成一模一樣的值（編輯器保留時間戳、rsync
        // --times、手動 touch -r 都會造成這個結果）。任何以 mtime 判定「檔案沒變」
        // 的快取都會在這裡繼續放行已撤銷的 token。
        writeRegistry(registryPath, [{ id: 'alice', token: 'alice-token', display_name: 'Alice', issued_at: '2026-08-19' }]);
        const restored = new Date(originalMtime);
        utimesSync(registryPath, restored, restored);
        expect(statSync(registryPath).mtimeMs).toBe(originalMtime);

        const revoked = await app.request('/whoami', { headers: { authorization: 'Bearer leaked-token' } });
        expect(revoked.status).toBe(401);

        const alice = await app.request('/whoami', { headers: { authorization: 'Bearer alice-token' } });
        expect(alice.status).toBe(200);
    });

    test('fail-closed 的 stderr 訊息明確說明已拒絕所有請求，且不含任何 token 值', async () => {
        dir = mkdtempSync(join(tmpdir(), 'auth-test-'));
        const registryPath = join(dir, 'tokens.json');
        writeRegistry(registryPath, [{ id: 'alice', token: 'SUPERSECRETTOKENVALUE', display_name: 'Alice', issued_at: '2026-08-19' }]);

        const app = buildApp(registryPath);
        expect((await app.request('/whoami', { headers: { authorization: 'Bearer SUPERSECRETTOKENVALUE' } })).status).toBe(200);

        const captured: string[] = [];
        const originalError = console.error;
        console.error = (...args: unknown[]) => { captured.push(args.map(String).join(' ')); };
        try {
            // 少一組引號，token 值變成 JSON 語法錯誤的位置——Bun 的 JSON.parse 訊息
            // 會把它原樣嵌進 `Unexpected identifier "SUPERSECRETTOKENVALUE"`，舊碼
            // 直接把該訊息插進 stderr，等於把 token 寫進 log（H17/H18 教訓）。
            writeFileSync(registryPath, '{"tokens": SUPERSECRETTOKENVALUE}');
            bumpMtime(registryPath, 1000);

            const res = await app.request('/whoami', { headers: { authorization: 'Bearer SUPERSECRETTOKENVALUE' } });
            expect(res.status).toBe(401);
        } finally {
            console.error = originalError;
        }

        const log = captured.join('\n');
        expect(log).toContain('拒絕所有請求');
        expect(log).not.toContain('SUPERSECRETTOKENVALUE');
    });

    test('名冊載入失敗時 stderr 不會每個 request 都刷一行（同一原因只印一次）', async () => {
        dir = mkdtempSync(join(tmpdir(), 'auth-test-'));
        const registryPath = join(dir, 'tokens.json');
        writeRegistry(registryPath, [{ id: 'alice', token: 'alice-token', display_name: 'Alice', issued_at: '2026-08-19' }]);

        const app = buildApp(registryPath);
        expect((await app.request('/whoami', { headers: { authorization: 'Bearer alice-token' } })).status).toBe(200);

        const captured: string[] = [];
        const originalError = console.error;
        console.error = (...args: unknown[]) => { captured.push(args.map(String).join(' ')); };
        try {
            writeFileSync(registryPath, 'not json at all');
            bumpMtime(registryPath, 1000);
            for (let i = 0; i < 5; i++) {
                await app.request('/whoami', { headers: { authorization: 'Bearer alice-token' } });
            }
        } finally {
            console.error = originalError;
        }

        // 去重是為了讓「第一行」不被洗掉；它只影響 log，不影響授權（上面每一次都 401）。
        expect(captured.filter(line => line.includes('拒絕所有請求')).length).toBe(1);
    });
});
