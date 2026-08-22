import { describe, expect, test } from 'bun:test';

/**
 * session.ts 的雙模式分流測試：hosted 模式（有 identity）在沒有登入態時要拋出可辨識的
 * ReloginRequiredError——http.ts 的包裝層正是靠 instanceof 判斷才能把它轉成 tool result
 * 而不是讓它上拋成 JSON-RPC 錯誤；stdio 模式（沒有 identity）不得走到這條路徑。
 *
 * 全程不發網路請求：hosted 分支在呼叫任何 RPC 之前就中止，stdio 分支則因為刻意清掉
 * env 帳密而在送出登入請求之前就中止。API URL 只是為了滿足 session.ts 的啟動檢查，
 * 指到一個明顯不是真實環境的值（比照 http.test.ts）。
 */
process.env.ALADDIN_PLATFORM_API_URL = 'http://127.0.0.1:1/never-called-in-this-test';
delete process.env.ALADDIN_PLATFORM_USER;
delete process.env.ALADDIN_PLATFORM_PASSWORD;
// 2026-08-22：閒置逾時測試用的小門檻。必須在 import session.ts 之前設定
// （IDLE_TIMEOUT_MS 是模組載入時讀一次的 top-level const，比照 BASE_URL 等既有慣例）。
process.env.ALADDIN_PLATFORM_SESSION_IDLE_TIMEOUT_MS = '50';

const { withAutoRelogin, runWithIdentity, ReloginRequiredError, setSessionForTests } = await import('./session.ts');
const { HOSTED_RELOGIN_REQUIRED_MESSAGE } = await import('./const.ts');

describe('withAutoRelogin — hosted 模式沒有登入態', () => {
    test('拋出 ReloginRequiredError（訊息止於 HOSTED_RELOGIN_REQUIRED_MESSAGE），且不呼叫下游 RPC', async () => {
        let called = false;
        const thunk = async () => {
            called = true;
            return { failed: false, errorCode: 0, message: '', data: null };
        };

        const err = await runWithIdentity('some-planner-id', async () => {
            try {
                await withAutoRelogin(thunk);
                return null;
            } catch (e) {
                return e;
            }
        });

        expect(err).toBeInstanceOf(ReloginRequiredError);
        expect((err as Error).message).toBe(HOSTED_RELOGIN_REQUIRED_MESSAGE);
        expect(called).toBe(false);
    });
});

describe('hosted 登入態閒置逾時（2026-08-22，使用者裁定，H28 risk_notes (9)）', () => {
    test('距上次存取已超過門檻：視同未登入，拋 ReloginRequiredError 且不呼叫下游 RPC', async () => {
        let called = false;
        const thunk = async () => {
            called = true;
            return { failed: false, errorCode: 0, message: '', data: null };
        };

        const err = await runWithIdentity('idle-planner', async () => {
            // lastActivityMsAgo 遠大於門檻（50ms），不必真的等待——直接構造「已閒置超過門檻」的既定狀態。
            setSessionForTests('idle-planner', 'fake-token', 10_000);
            try {
                await withAutoRelogin(thunk);
                return null;
            } catch (e) {
                return e;
            }
        });

        expect(err).toBeInstanceOf(ReloginRequiredError);
        expect((err as Error).message).toBe(HOSTED_RELOGIN_REQUIRED_MESSAGE);
        expect(called).toBe(false);
    });

    test('距上次存取仍在門檻內：視為已登入，正常呼叫下游 RPC 不要求重登', async () => {
        let called = false;
        const thunk = async () => {
            called = true;
            return { failed: false, errorCode: 0, message: '', data: { ok: true } };
        };

        const result = await runWithIdentity('fresh-planner', async () => {
            setSessionForTests('fresh-planner', 'fake-token', 0); // 剛剛才存取過
            return withAutoRelogin(thunk);
        });

        expect(called).toBe(true);
        expect(result.failed).toBe(false);
    });
});

describe('withAutoRelogin — stdio 模式（沒有 identity）行為不變', () => {
    test('不走重登信號路徑：沒有 env 帳密時拋的是既有的「缺少登入帳密」一般例外', async () => {
        const err = await withAutoRelogin(async () => ({ failed: false, errorCode: 0, message: '', data: null }))
            .then(() => null)
            .catch((e: unknown) => e);

        expect(err).toBeInstanceOf(Error);
        expect(err).not.toBeInstanceOf(ReloginRequiredError);
        expect((err as Error).message).toContain('缺少登入帳密');
    });
});
