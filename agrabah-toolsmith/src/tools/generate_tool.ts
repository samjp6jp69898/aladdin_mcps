/**
 * tools/generate_tool.ts — agrabah_toolsmith_generate_tool
 *
 * 刻意用 agrabah_toolsmith_* 前綴跟既有 agrabah_<admin|platform>_<動詞>_<名詞>
 * （呼叫 RPC 用）區分開，見 /Users/user/.claude/plans/logical-jumping-cook.md
 * 第 2 節。
 *
 * H23：接上真正的執行邏輯（H22 骨架階段回的是固定假資料）。併發控制 + spawn
 * sub-agent + 收集回傳值三層邏輯分別在 ../agent/{concurrency-limiter,
 * run-agent,collect-output}.ts，這裡只是把三者串起來：
 *   1. tryAcquire 拿不到名額 → 立刻回 busy（不排隊、不讓連線懸掛）。
 *   2. spawn 前後各拍一次正式目錄的 git status 快照。
 *   3. 同步 await run-agent 跑完（完成訊號來自 child process exit 的 Promise
 *      resolve，不是輪詢/sleep）。
 *   4. collectOutput 組裝最終回傳值。
 *   5. finally 一定 release 名額，不管上面哪一步拋出例外。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { asTextResult } from '../mcp_result.ts';
import { CONCURRENCY_LIMIT } from '../const.ts';
import { createConcurrencyLimiter } from '../agent/concurrency-limiter.ts';
import { runAgent } from '../agent/run-agent.ts';
import { snapshotRealDirs, collectOutput } from '../agent/collect-output.ts';

// 全 process 共用同一份額度，這個檔案是唯一消費者——tryAcquire 用在 handler
// 開頭，release 用在 finally，不管成功/失敗/例外都會執行到。
const limiter = createConcurrencyLimiter(CONCURRENCY_LIMIT);

export function registerGenerateToolTool(server: McpServer): void {
    server.registerTool(
        'agrabah_toolsmith_generate_tool',
        {
            title: 'Generate a new agrabah-admin / agrabah-platform tool',
            description:
                '用自然語言描述想要 agrabah-admin 或 agrabah-platform 新增/擴充的能力。' +
                '會在工程師本機觸發一個具有原始碼權限的 agent 完成研究/實作/驗證，' +
                '回傳生成的完整檔案內容（整份內容，不是 diff，可直接整檔覆蓋貼上）。' +
                '任一時刻只服務一個請求（N=1 併發），忙碌中會立刻回傳 errorKind:"busy"' +
                '（不排隊），執行時間可能長達數分鐘。',
            inputSchema: {
                target: z.enum([ 'admin', 'platform' ]).describe('要擴充哪個後台的 MCP server：admin 或 platform'),
                request: z.string().min(10).max(4000).describe('自然語言描述想要新增/擴充的能力，至少 10 字、至多 4000 字'),
                notes: z.string().max(2000).optional().describe('補充資訊（例如已知的欄位限制、參考案例），非必填，至多 2000 字'),
            },
        },
        async ({ target, request, notes }) => {
            if (!limiter.tryAcquire()) {
                return asTextResult({
                    success: false,
                    errorKind: 'busy',
                    message: '目前已有另一個請求正在執行（N=1 併發上限），請稍後再試，不會排隊。',
                });
            }

            try {
                const before = snapshotRealDirs();
                const agentResult = await runAgent({ target, request, notes });
                const after = snapshotRealDirs();

                const collected = collectOutput({
                    requestId: agentResult.requestId,
                    manifestPath: agentResult.manifestPath,
                    outputDir: agentResult.outputDir,
                    before,
                    after,
                    durationSeconds: agentResult.durationSeconds,
                });

                return asTextResult(collected);
            } finally {
                limiter.release();
            }
        },
    );
}
