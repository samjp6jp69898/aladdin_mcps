/**
 * tools/list.ts — aladdin_kit_list
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { runKitScript } from '../spawn_kit_script.ts';
import { asTextResult } from '../mcp_result.ts';

export function registerListKitsTool(server: McpServer): void {
    server.registerTool(
        'aladdin_kit_list',
        {
            title: '列出已核發的企劃 kit',
            description:
                '列出兩份 token 名冊（admin-dev、platform-dev-pk）目前所有已核發的 id / 顯示名 / 核發時間，' +
                '不含 token 值本身。呼叫 aladdin_kit_issue 前，可以先用這支確認某個 id 是不是已經核發過。',
            inputSchema: {},
        },
        async () => {
            const result = runKitScript([ '--list' ]);
            return asTextResult({
                success: result.success,
                output: result.stdout || undefined,
                error: result.success ? undefined : (result.stderr || '（腳本無輸出，僅回傳非 0 exit code）'),
            });
        },
    );
}
