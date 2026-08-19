/**
 * tools/generate_tool.ts — agrabah_toolsmith_generate_tool
 *
 * 刻意用 agrabah_toolsmith_* 前綴跟既有 agrabah_<admin|platform>_<動詞>_<名詞>
 * （呼叫 RPC 用）區分開，見 /Users/user/.claude/plans/logical-jumping-cook.md
 * 第 2 節。
 *
 * 本檔（H22）只掛骨架：inputSchema 已依第 2 節定案，但 handler 尚未接上真正
 * 會 spawn 本機 sub-agent 的執行邏輯（agent/run-agent.ts、prompt-builder.ts、
 * concurrency-limiter.ts、collect-output.ts）——那是未來 task 的範圍。任何
 * 呼叫目前一律回傳固定假資料，不代表任何檔案已被實際生成、也沒有任何本機
 * agent 被觸發。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { asTextResult } from '../mcp_result.ts';

export function registerGenerateToolTool(server: McpServer): void {
    server.registerTool(
        'agrabah_toolsmith_generate_tool',
        {
            title: 'Generate a new agrabah-admin / agrabah-platform tool (stub — currently returns fake data)',
            description:
                '用自然語言描述想要 agrabah-admin 或 agrabah-platform 新增/擴充的能力。' +
                '正式版本會在工程師本機觸發一個具有原始碼權限的 agent 完成研究/實作/驗證，' +
                '回傳生成的完整檔案內容。**目前版本（骨架階段）尚未接上真正的執行邏輯，' +
                '任何呼叫都會回傳固定的假資料**，不代表任何檔案已被實際生成、也沒有任何本機' +
                'agent 被觸發，僅供驗證 MCP 協定層與認證是否正常。',
            inputSchema: {
                target: z.enum([ 'admin', 'platform' ]).describe('要擴充哪個後台的 MCP server：admin 或 platform'),
                request: z.string().min(10).max(4000).describe('自然語言描述想要新增/擴充的能力，至少 10 字、至多 4000 字'),
                notes: z.string().max(2000).optional().describe('補充資訊（例如已知的欄位限制、參考案例），非必填，至多 2000 字'),
            },
        },
        async ({ target, request, notes }) => {
            return asTextResult({
                success: true,
                requestId: `stub-${ Date.now() }`,
                summary:
                    `[骨架階段假資料] 收到 target=${ target } 的需求描述（${ request.length } 字` +
                    `${ notes !== undefined ? '，含補充說明' : '' }），尚未執行任何 sub-agent，` +
                    '此回應不代表任何檔案已被生成。',
                files: [],
                verification: { ran: false, notes: '骨架階段：未執行任何驗證，因為尚未觸發 sub-agent' },
                warnings: [ '這是 H22 骨架 task 的固定假資料，真正的 sub-agent 執行邏輯尚未實作' ],
                realDirsTouched: false,
                durationSeconds: 0,
            });
        },
    );
}
