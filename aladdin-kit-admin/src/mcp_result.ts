/**
 * mcp_result.ts — 共用的 MCP tool 回傳值包裝。跟 aladdin-admin/aladdin-platform 的同名檔案
 * 刻意各自獨立一份（未共用套件），但本檔沒有 errorCode 反查 enum 的需求（本 server 不打
 * agrabah RPC，只是包一支 CLI 腳本），所以比那兩份簡單很多。
 */

export function asTextResult(payload: unknown) {
    return {
        content: [ { type: 'text' as const, text: JSON.stringify(payload, null, 2) } ],
    };
}
