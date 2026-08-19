/**
 * tools/index.ts — 把所有 tool 註冊函式掛到同一個 McpServer 實例。
 * 純聚合層，不放任何業務邏輯。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { registerLoginTool } from './login.ts';
import { registerCreateGameVendorTool } from './create_game_vendor.ts';
import { registerCreateGameTool } from './create_game.ts';
import { registerEditGameTool } from './edit_game.ts';
import { registerListVendorGamesTool } from './list_vendor_games.ts';

export type ServerMode = 'stdio' | 'hosted';

/**
 * H7：hosted 模式停用 login tool（plan.md D4）——企劃端沒有帳密可透過這支
 * tool 使用，且帳密不該經由 MCP tool 參數進入 LLM 對話紀錄；hosted 模式改走
 * POST /login REST 端點（見 http.ts）。stdio 模式（工程師本機）維持註冊，
 * TOTP 互動情境可能還需要它。
 */
export function registerAdminTools(server: McpServer, mode: ServerMode = 'stdio'): void {
    if (mode === 'stdio') {
        registerLoginTool(server);
    }
    registerCreateGameVendorTool(server);
    registerCreateGameTool(server);
    registerEditGameTool(server);
    registerListVendorGamesTool(server);
}
