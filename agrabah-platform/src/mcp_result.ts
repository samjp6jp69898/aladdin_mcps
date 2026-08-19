/**
 * mcp_result.ts — 共用的 MCP tool 回傳值包裝，所有 tools/*.ts 共用。
 */

import { AgrabahErrorCodeEnum } from '/Users/user/aladdin/abu/platform/src/generated/remote.gen.ts';

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
