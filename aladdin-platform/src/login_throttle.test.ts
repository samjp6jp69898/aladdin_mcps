import { describe, expect, test } from 'bun:test';
import { checkThrottle, recordFailure, recordSuccess } from './login_throttle.ts';

/**
 * 每個 test 用獨立、不會被其他 test 撞到的 identity 字串（模組內狀態是
 * module-level Map，跨 test 共用同一份儲存），避免互相污染。
 * 冷卻期驗證全部用注入的假時鐘（`now: () => number`）推進時間，不用 sleep
 * （CLAUDE.md 硬規則）。
 */

describe('login_throttle', () => {
    test('未曾失敗過：一律放行', () => {
        expect(checkThrottle('never-failed-1')).toEqual({ allowed: true });
    });

    test('失敗次數低於門檻：仍放行', () => {
        const id = 'below-threshold-1';
        recordFailure(id);
        recordFailure(id);
        recordFailure(id);
        recordFailure(id);
        expect(checkThrottle(id)).toEqual({ allowed: true });
    });

    test('連續失敗達門檻（5 次）：進入冷卻期，回 allowed:false', () => {
        const id = 'threshold-1';
        for (let i = 0; i < 5; i++) recordFailure(id);
        const check = checkThrottle(id);
        expect(check.allowed).toBe(false);
        if (!check.allowed) expect(check.retryAfterSeconds).toBeGreaterThan(0);
    });

    test('冷卻期內：即使再檢查也持續回 allowed:false，不因為多檢查幾次而提早放行', () => {
        const id = 'threshold-2';
        for (let i = 0; i < 5; i++) recordFailure(id);
        expect(checkThrottle(id).allowed).toBe(false);
        expect(checkThrottle(id).allowed).toBe(false);
        expect(checkThrottle(id).allowed).toBe(false);
    });

    test('冷卻期用時間戳比較，時鐘推進超過 COOLDOWN_MS 後自動放行（不 sleep）', () => {
        const id = 'cooldown-expiry-1';
        let fakeNow = 1_000_000;
        const clock = () => fakeNow;

        for (let i = 0; i < 5; i++) recordFailure(id, clock);
        expect(checkThrottle(id, clock).allowed).toBe(false);

        fakeNow += 5 * 60 * 1000 + 1; // 推進超過 5 分鐘冷卻期
        expect(checkThrottle(id, clock)).toEqual({ allowed: true });
    });

    test('登入成功：計數與鎖定狀態歸零，之後重新累積才會再次觸發冷卻', () => {
        const id = 'success-resets-1';
        recordFailure(id);
        recordFailure(id);
        recordFailure(id);
        recordFailure(id);
        recordSuccess(id);
        expect(checkThrottle(id).allowed).toBe(true);

        // 歸零後要再連續失敗 5 次才會鎖，不是從上次的 4 次繼續累加。
        recordFailure(id);
        recordFailure(id);
        recordFailure(id);
        recordFailure(id);
        expect(checkThrottle(id).allowed).toBe(true);
        recordFailure(id);
        expect(checkThrottle(id).allowed).toBe(false);
    });

    test('不同 identity 的節流狀態互不干擾', () => {
        const a = 'isolated-a';
        const b = 'isolated-b';
        for (let i = 0; i < 5; i++) recordFailure(a);
        expect(checkThrottle(a).allowed).toBe(false);
        expect(checkThrottle(b).allowed).toBe(true);
    });
});
