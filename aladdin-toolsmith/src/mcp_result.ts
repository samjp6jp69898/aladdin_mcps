/**
 * mcp_result.ts — 共用的 MCP tool 回傳值包裝，所有 tools/*.ts 共用。
 * 逐字沿用 aladdin-admin/src/mcp_result.ts（同一個小工具，複製優於共用套件層，
 * 依 CLAUDE.md Rule 2 Simplicity First——三個 server 目前各自獨立 package）。
 */

export function asTextResult(payload: unknown) {
    return {
        content: [ { type: 'text' as const, text: JSON.stringify(payload, null, 2) } ],
    };
}
