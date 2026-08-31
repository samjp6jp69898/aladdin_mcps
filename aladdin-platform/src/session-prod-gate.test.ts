import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * H38：session.ts 在模組載入時對 ALADDIN_PLATFORM_API_URL / ALADDIN_PLATFORM_IS_PROD
 * 做的 fail-loud 交叉檢查，設計與測試手法逐字比照 admin 端
 * aladdin-admin/src/session-prod-gate.test.ts。platform 之前完全沒有
 * prod 閘門（H38 缺口二），這是這個檔案第一次出現這類測試。
 */
const DIR = dirname(fileURLToPath(import.meta.url));

function tryImportSession(env: Record<string, string | undefined>) {
    const childScript = `
        try {
            await import(${ JSON.stringify(DIR) } + '/session.ts');
            console.log('IMPORT_OK');
            process.exit(0);
        } catch (err) {
            console.error(err instanceof Error ? err.message : String(err));
            process.exit(1);
        }
    `;
    return spawnSync('bun', [ '-e', childScript ], {
        encoding: 'utf-8',
        env: { ...process.env, ...env },
        timeout: 30_000,
    });
}

describe('H38 — ALADDIN_PLATFORM_API_URL / ALADDIN_PLATFORM_IS_PROD 交叉檢查', () => {
    test('已知 dev 網域（alddev.com）+ 未設定 IS_PROD：正常啟動（既有部署現況，不得誤擋）', () => {
        const r = tryImportSession({ ALADDIN_PLATFORM_API_URL: 'https://pk-platform.alddev.com', ALADDIN_PLATFORM_IS_PROD: undefined });
        expect(r.status).toBe(0);
        expect(r.stdout).toContain('IMPORT_OK');
    });

    test('本機測試佔位網域（127.0.0.1）+ 未設定 IS_PROD：正常啟動（既有測試檔大量依賴這個組合，不得回歸）', () => {
        const r = tryImportSession({ ALADDIN_PLATFORM_API_URL: 'http://127.0.0.1:1/never-called', ALADDIN_PLATFORM_IS_PROD: undefined });
        expect(r.status).toBe(0);
    });

    // review 抓到的真實繞過（H38 收尾修正），逐字比照 admin 端 session-prod-gate.test.ts
    // 同一組案例：一開始用 URL 字串子字串比對會被這些刻意構造的假網域繞過。
    test.each([
        [ 'marker 當網域前綴的一部分', 'https://prod-alddev.com-attacker.evil.com' ],
        [ 'marker 出現在更深的子網域鏈中間', 'https://prod.aladdin.com.ald777.com.evil.io' ],
        [ 'localhost 只是子網域字串的一部分', 'https://evil-localhost-lookalike.attacker.com' ],
        [ 'marker 出現在 path 裡、不是 hostname', 'https://real-prod-api.internal/godev2.com/phish' ],
    ])('子字串繞過已修：%s + 未設定 IS_PROD：拒絕啟動', (_label: string, url: string) => {
        const r = tryImportSession({ ALADDIN_PLATFORM_API_URL: url, ALADDIN_PLATFORM_IS_PROD: undefined });
        expect(r.status).not.toBe(0);
        expect(r.stderr).toContain('可能是正式環境卻忘了開啟 prod confirm 閘門');
    });

    test('BASE_URL 不是合法 URL（解析不出 hostname）+ 未設定 IS_PROD：保守拒絕啟動', () => {
        const r = tryImportSession({ ALADDIN_PLATFORM_API_URL: 'not-a-valid-url', ALADDIN_PLATFORM_IS_PROD: undefined });
        expect(r.status).not.toBe(0);
        expect(r.stderr).toContain('可能是正式環境卻忘了開啟 prod confirm 閘門');
    });

    test('核心情境：不像已知非 prod 網域的 URL + 未設定 IS_PROD：拒絕啟動', () => {
        const r = tryImportSession({ ALADDIN_PLATFORM_API_URL: 'https://pk-platform.aladdin-realprod-example.com', ALADDIN_PLATFORM_IS_PROD: undefined });
        expect(r.status).not.toBe(0);
        expect(r.stderr).toContain('可能是正式環境卻忘了開啟 prod confirm 閘門');
    });

    test('不像已知非 prod 網域的 URL + 明確 IS_PROD=false：仍然拒絕啟動（顯式 false 不能豁免這個檢查）', () => {
        const r = tryImportSession({ ALADDIN_PLATFORM_API_URL: 'https://pk-platform.aladdin-realprod-example.com', ALADDIN_PLATFORM_IS_PROD: 'false' });
        expect(r.status).not.toBe(0);
        expect(r.stderr).toContain('可能是正式環境卻忘了開啟 prod confirm 閘門');
    });

    test('不像已知非 prod 網域的 URL + 明確 IS_PROD=true：放行（沒有真實 prod 網址可測時的組合矛盾，比照 admin 端 H36 手法）', () => {
        const r = tryImportSession({ ALADDIN_PLATFORM_API_URL: 'https://pk-platform.aladdin-realprod-example.com', ALADDIN_PLATFORM_IS_PROD: 'true' });
        expect(r.status).toBe(0);
    });

    test('已知 dev 網域 + IS_PROD=true：放行（未受本次交叉檢查影響）', () => {
        const r = tryImportSession({ ALADDIN_PLATFORM_API_URL: 'https://pk-platform.alddev.com', ALADDIN_PLATFORM_IS_PROD: 'true' });
        expect(r.status).toBe(0);
    });

    test('IS_PROD 值不合法（非 true/false）：拒絕啟動', () => {
        const r = tryImportSession({ ALADDIN_PLATFORM_API_URL: 'https://pk-platform.alddev.com', ALADDIN_PLATFORM_IS_PROD: '1' });
        expect(r.status).not.toBe(0);
        expect(r.stderr).toContain('只接受 true 或 false');
    });
});
