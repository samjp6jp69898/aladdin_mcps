import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * H38：session.ts 在模組載入時對 ALADDIN_ADMIN_API_URL / ALADDIN_ADMIN_IS_PROD
 * 做的 fail-loud 交叉檢查——這是這個檔案唯一測的東西，之前完全沒有任何永久
 * 測試檔覆蓋這段邏輯（H36 當初只用真實起 server 的方式手動驗證過一輪，沒有
 * 留下 bun:test 覆蓋，見 tasks.json H36/H38 changelog）。
 *
 * 每個案例都在獨立子行程執行：session.ts 的這段判斷是模組載入當下的頂層
 *程式碼，只會在同一個 Node/Bun module registry 裡執行一次，同一個測試檔案
 * 內用不同 process.env 值重複 import 拿不到不同結果（後載入的會直接命中
 * cache）。比照 http.test.ts 的既有手法：用 `bun -e` 開子行程，環境變數只在
 * 子行程內生效，不會互相污染、也不會污染其他測試檔。
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

describe('H38 — ALADDIN_ADMIN_API_URL / ALADDIN_ADMIN_IS_PROD 交叉檢查', () => {
    test('已知 dev 網域 + 未設定 IS_PROD：正常啟動（既有部署現況，不得誤擋）', () => {
        const r = tryImportSession({ ALADDIN_ADMIN_API_URL: 'https://admin.alddev.com', ALADDIN_ADMIN_IS_PROD: undefined });
        expect(r.status).toBe(0);
        expect(r.stdout).toContain('IMPORT_OK');
    });

    test('已知 pre 網域（ald777.com）+ 未設定 IS_PROD：正常啟動', () => {
        const r = tryImportSession({ ALADDIN_ADMIN_API_URL: 'https://abu-admin.ald777.com', ALADDIN_ADMIN_IS_PROD: undefined });
        expect(r.status).toBe(0);
    });

    test('已知 evi 網域（godev2.com）+ 未設定 IS_PROD：正常啟動', () => {
        const r = tryImportSession({ ALADDIN_ADMIN_API_URL: 'https://admin.godev2.com', ALADDIN_ADMIN_IS_PROD: undefined });
        expect(r.status).toBe(0);
    });

    // review 抓到的真實繞過（H38 收尾修正）：一開始用 URL 字串子字串比對，這幾個刻意把
    // marker 字串塞進網域其他位置的假網域全部會被誤判成「已知非 prod」而放行。改成
    // hostname 精確/後綴比對後，這四個案例都必須被擋下——沒有 IS_PROD=true 一律拒絕啟動。
    test.each([
        [ 'marker 當網域前綴的一部分（prod-alddev.com-attacker.evil.com）', 'https://prod-alddev.com-attacker.evil.com' ],
        [ 'marker 出現在更深的子網域鏈中間（prod.aladdin.com.ald777.com.evil.io）', 'https://prod.aladdin.com.ald777.com.evil.io' ],
        [ 'localhost 只是子網域字串的一部分（evil-localhost-lookalike.attacker.com）', 'https://evil-localhost-lookalike.attacker.com' ],
        [ 'marker 出現在 path 裡、不是 hostname（real-prod-api.internal/godev2.com/phish）', 'https://real-prod-api.internal/godev2.com/phish' ],
    ])('子字串繞過已修：%s + 未設定 IS_PROD：拒絕啟動', (_label: string, url: string) => {
        const r = tryImportSession({ ALADDIN_ADMIN_API_URL: url, ALADDIN_ADMIN_IS_PROD: undefined });
        expect(r.status).not.toBe(0);
        expect(r.stderr).toContain('可能是正式環境卻忘了開啟 prod confirm 閘門');
    });

    test('BASE_URL 不是合法 URL（解析不出 hostname）+ 未設定 IS_PROD：保守拒絕啟動', () => {
        const r = tryImportSession({ ALADDIN_ADMIN_API_URL: 'not-a-valid-url', ALADDIN_ADMIN_IS_PROD: undefined });
        expect(r.status).not.toBe(0);
        expect(r.stderr).toContain('可能是正式環境卻忘了開啟 prod confirm 閘門');
    });

    test('本機測試佔位網域（127.0.0.1）+ 未設定 IS_PROD：正常啟動（既有測試檔大量依賴這個組合，不得回歸）', () => {
        const r = tryImportSession({ ALADDIN_ADMIN_API_URL: 'http://127.0.0.1:1/never-called', ALADDIN_ADMIN_IS_PROD: undefined });
        expect(r.status).toBe(0);
    });

    test('核心情境：不像已知非 prod 網域的 URL + 未設定 IS_PROD：拒絕啟動', () => {
        const r = tryImportSession({ ALADDIN_ADMIN_API_URL: 'https://admin.aladdin-realprod-example.com', ALADDIN_ADMIN_IS_PROD: undefined });
        expect(r.status).not.toBe(0);
        expect(r.stderr).toContain('可能是正式環境卻忘了開啟 prod confirm 閘門');
    });

    test('不像已知非 prod 網域的 URL + 明確 IS_PROD=false：仍然拒絕啟動（顯式 false 不能豁免這個檢查）', () => {
        const r = tryImportSession({ ALADDIN_ADMIN_API_URL: 'https://admin.aladdin-realprod-example.com', ALADDIN_ADMIN_IS_PROD: 'false' });
        expect(r.status).not.toBe(0);
        expect(r.stderr).toContain('可能是正式環境卻忘了開啟 prod confirm 閘門');
    });

    test('不像已知非 prod 網域的 URL + 明確 IS_PROD=true：放行（H36 既有的測試手法，沒有真實 prod 網址可測時的組合矛盾）', () => {
        const r = tryImportSession({ ALADDIN_ADMIN_API_URL: 'https://admin.aladdin-realprod-example.com', ALADDIN_ADMIN_IS_PROD: 'true' });
        expect(r.status).toBe(0);
    });

    test('已知 dev 網域 + IS_PROD=true：放行（H36 既有測試手法，未受本次交叉檢查影響）', () => {
        const r = tryImportSession({ ALADDIN_ADMIN_API_URL: 'https://admin.alddev.com', ALADDIN_ADMIN_IS_PROD: 'true' });
        expect(r.status).toBe(0);
    });

    test('IS_PROD 值不合法（非 true/false）：既有行為不受本次改動影響，仍拒絕啟動', () => {
        const r = tryImportSession({ ALADDIN_ADMIN_API_URL: 'https://admin.alddev.com', ALADDIN_ADMIN_IS_PROD: '1' });
        expect(r.status).not.toBe(0);
        expect(r.stderr).toContain('只接受 true 或 false');
    });
});
