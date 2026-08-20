import { describe, expect, test } from 'bun:test';
import { AgrabahErrorCodeEnum } from '/Users/user/aladdin/abu/platform/src/generated/remote.gen.ts';
import { asErrorResult, asReloginRequiredResult } from './mcp_result.ts';
import { HOSTED_RELOGIN_REQUIRED_MESSAGE } from './const.ts';

/**
 * H11 review 收尾（安全 review + 正確性 review 皆指出零測試覆蓋）：只測
 * asErrorResult 的兩條最容易在未來重構時默默壞掉的分支——已知碼反查、
 * 未知碼 fallback、extra 不覆蓋核心欄位（驗證 extra 已改放在展開式最前面，
 * 不會蓋掉 success/errorCode/errorName/message）。與 admin 版邏輯逐字相同，
 * 兩個 package 各自獨立，不共用（本來就是兩份各自 import 各自 remote.gen.ts 的 enum）。
 */
function parsePayload(result: ReturnType<typeof asErrorResult>): Record<string, unknown> {
    return JSON.parse(result.content[ 0 ].text);
}

describe('asErrorResult', () => {
    test('已知碼：errorName 用 AgrabahErrorCodeEnum 反查取得', () => {
        // 303 = AgrabahErrorCodeEnum.gameVendorGameNotExists（rajah/services/common.rajah:102），
        // 與 onboard_vendor_game.ts 的 hint 判斷用的是同一個 enum member。
        const payload = parsePayload(asErrorResult({ errorCode: 303, message: '' }));
        expect(payload).toEqual({
            success: false,
            errorCode: 303,
            errorName: 'gameVendorGameNotExists',
            message: '',
        });
    });

    test('未知碼：反查不到時保留原始數字並標示「(未知錯誤碼)」，不讓 undefined 流入回應', () => {
        const payload = parsePayload(asErrorResult({ errorCode: 999999999, message: 'boom' }));
        expect(payload[ 'errorCode' ]).toBe(999999999);
        expect(payload[ 'errorName' ]).toBe('(未知錯誤碼)');
        expect(payload[ 'message' ]).toBe('boom');
    });

    test('extra 附加診斷欄位（如 hint），不覆蓋 success/errorCode/errorName/message 四個核心欄位', () => {
        const payload = parsePayload(
            asErrorResult(
                { errorCode: 303, message: 'real message' },
                { success: true, errorCode: -1, errorName: 'spoofed', message: 'spoofed message', hint: '額外提示' },
            ),
        );
        // 即使 extra 惡意/誤帶了同名欄位，核心四欄仍以真實錯誤資料為準。
        expect(payload[ 'success' ]).toBe(false);
        expect(payload[ 'errorCode' ]).toBe(303);
        expect(payload[ 'errorName' ]).toBe('gameVendorGameNotExists');
        expect(payload[ 'message' ]).toBe('real message');
        expect(payload[ 'hint' ]).toBe('額外提示');
    });
});

describe('asReloginRequiredResult', () => {
    test('與其他業務錯誤同格式：success/errorCode/errorName/message 四個核心欄位齊全，另帶機器可辨識的 reloginRequired 旗標', () => {
        const payload = parsePayload(asReloginRequiredResult());
        expect(payload).toEqual({
            reloginRequired: true,
            success: false,
            errorCode: AgrabahErrorCodeEnum.loginRequired,
            errorName: 'loginRequired',
            message: HOSTED_RELOGIN_REQUIRED_MESSAGE,
        });
    });
});
