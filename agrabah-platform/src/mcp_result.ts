/**
 * mcp_result.ts — 共用的 MCP tool 回傳值包裝，所有 tools/*.ts 共用。
 */

export function asTextResult(payload: unknown) {
    return {
        content: [ { type: 'text' as const, text: JSON.stringify(payload, null, 2) } ],
    };
}
