/**
 * mcp_result.ts — 共用的 MCP tool 回傳值包裝，所有 tools/*.ts 共用。
 */

import { AgrabahErrorCodeEnum } from '/Users/user/aladdin/abu/platform/src/generated/remote.gen.ts';
import { HOSTED_RELOGIN_REQUIRED_MESSAGE } from './const.ts';

export function asTextResult(payload: unknown) {
    return {
        content: [ { type: 'text' as const, text: JSON.stringify(payload, null, 2) } ],
    };
}

/**
 * H11（plan.md D10）：組裝失敗回應給 agent。後端 GenieResponse 只回 errorCode（數字）
 * 與 message（字串常是空字串，不可靠），沒有錯誤名稱欄位；errorName 是用生成的
 * AgrabahErrorCodeEnum 對 errorCode 做反向映射反查得到（如 gameVendorGameNotExists），
 * 反查不到（未知碼）時保留原始數字並如實標示，不讓 undefined 流入回應文案。
 * extra 供個別 tool 附加診斷欄位（如 onboard_vendor_game 的 hint），不影響上述欄位。
 */
export function asErrorResult(r: { errorCode: number; message: string }, extra?: Record<string, unknown>) {
    return asTextResult({
        ...extra,
        success: false,
        errorCode: r.errorCode,
        errorName: AgrabahErrorCodeEnum[ r.errorCode ] ?? '(未知錯誤碼)',
        message: r.message,
    });
}

/**
 * hosted 模式「需要重新登入」的失敗回應（由 http.ts 的包裝層在攔到
 * session.ts 的 ReloginRequiredError 時回傳，不是各 tool 自己組）。
 *
 * 刻意走 asErrorResult 而不是另造一種格式：agent 端解析失敗回應的方式對所有
 * 業務錯誤一致（success/errorCode/errorName/message），重登這種狀態沒有理由
 * 例外。errorCode 用 loginRequired——這就是後端對「登入態失效」的既有代碼，
 * 尚未登入時後端還沒被呼叫、也是同一種狀態。額外的 reloginRequired 旗標讓
 * agent 不必比對中文字串就能判斷下一步是重跑登入 skill；文案本身仍止於
 * HOSTED_RELOGIN_REQUIRED_MESSAGE（D11 只陳述事實，不引導跨後台操作）。
 */
export function asReloginRequiredResult() {
    return asErrorResult(
        { errorCode: AgrabahErrorCodeEnum.loginRequired, message: HOSTED_RELOGIN_REQUIRED_MESSAGE },
        { reloginRequired: true },
    );
}
