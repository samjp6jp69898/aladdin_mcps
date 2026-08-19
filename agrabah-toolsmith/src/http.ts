#!/usr/bin/env bun
/**
 * http.ts — MCP server over Streamable HTTP transport（Hono），stateless。
 *
 * 依 /Users/user/aladdin/obsidian/mcps/_hosted-rollout/plan.md D9 與
 * /Users/user/.claude/plans/logical-jumping-cook.md Phase 1/2，比照
 * agrabah-admin/src/http.ts（H1 定型並實測過的版本，commit eda293d2）沿用
 * 同一套契約，不另外摸索一套：
 *   - 端點：POST|DELETE /mcp（MCP streamable HTTP，GET 見下方說明回 405）、
 *     GET /health。
 *   - 綁定 127.0.0.1：8788 是一個「送一段自然語言就會 spawn 一個
 *     bypassPermissions agent」的端點且全員共用單一 token，絕不該在區網上
 *     可達——比 admin/platform 的曝露風險更高，這個契約對本服務尤其重要。
 *   - app.onError 只回通用訊息、完整例外只寫 stderr。
 *   - Bearer 認證（見 ./auth.ts）：掛在 /health 以外所有路徑，單一共用
 *     token 從環境變數 TOOLSMITH_API_TOKEN 讀取（與 admin/platform 的
 *     per-user 名冊機制刻意不同，見 auth.ts 檔頭說明）。
 *
 * 本檔（H22）只做服務骨架：agrabah_toolsmith_generate_tool 目前回傳固定假
 * 資料（見 tools/generate_tool.ts），真正 spawn 本機 sub-agent 的執行邏輯
 * 是未來 task 的範圍，不影響本檔的傳輸層/認證層設計。
 *
 * stateless 模式下 WebStandardStreamableHTTPServerTransport 規定一個
 * transport 只能處理一個 request，所以每個 request 都 new 一個
 * McpServer + transport，並在 handleRequest resolve 後立刻 close（詳細
 * 理由見 agrabah-admin/src/http.ts 檔頭註解，這裡不重複）。
 *
 * GET /mcp 不交給 transport 處理，直接回 405：讓 transport 開 SSE stream
 * 會被 finally 的 server.close() 搶先切斷，導致 SDK client 誤判連線意外
 * 中斷、以 1 秒間隔無限重連（H1 已用真實 SDK client 實測驗證過此修法）。
 */

import { Hono } from 'hono';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';

import { registerToolsmithTools } from './tools/index.ts';
import { createBearerAuthGuard } from './auth.ts';

const PORT = Number(process.env.TOOLSMITH_HTTP_PORT ?? 8788);

const app = new Hono();

// 帶 Origin header 的請求一律拒絕：我們的合法用戶端是 Claude Code，不是瀏覽器，
// 不會送 Origin；MCP streamable HTTP 規範要求驗證 Origin 防 DNS rebinding。
// 沿用 agrabah-admin/src/http.ts 的既有寫法。
app.use('*', async (c, next) => {
    if (c.req.header('origin') !== undefined) {
        return c.text('Forbidden', 403);
    }
    await next();
});

// Bearer 認證：刻意註冊在下面所有 route（含 /health）之前，理由同
// agrabah-admin/src/http.ts——route handler 提前 return 不呼叫 next() 會讓
// 後面才註冊的 app.use('*', ...) 完全不會被執行到，放最前面則不論未來新
// route 寫在檔案裡的哪個位置都一定會先經過這裡。/health 例外邏輯在
// middleware 內部依路徑判斷，不依賴任何 route 的註冊順序。
const bearerAuthGuard = createBearerAuthGuard(process.env.TOOLSMITH_API_TOKEN);
app.use('*', async (c, next) => {
    if (c.req.path === '/health') {
        return next();
    }
    return bearerAuthGuard(c, next);
});

// 不驗證任何東西，供 launchd / 監控探測；不透露服務身分（比照
// telegram-dispatcher/server.ts:68 與 agrabah-admin/src/http.ts），因為經
// proxy 後公網可達，回傳服務身分等於向掃描者確認這後面有一個會 spawn
// bypassPermissions agent 的端點。
app.get('/health', c => c.json({ status: 'ok', uptime_seconds: Math.floor(process.uptime()) }));

// SDK 的 CallToolRequestSchema handler（mcp.js）對任何 tool 拋出的例外一律
// 靜默接住，只把 error.message 包成 isError:true 回給呼叫端，從不 log——
// 這裡不改動任何 tools/*.ts，改在 registerTool 外面包一層：每支 tool 呼叫
// 仍照原樣執行、原樣回傳/拋出，只是在拋出前先把完整堆疊寫進 stderr。逐字
// 沿用 agrabah-admin/src/http.ts 的寫法。
function withStderrStackLogging(server: McpServer): void {
    const originalRegisterTool = server.registerTool.bind(server);
    server.registerTool = ((name: string, config: unknown, handler: (...args: unknown[]) => unknown) => {
        const wrapped = async (...args: unknown[]) => {
            try {
                return await handler(...args);
            } catch (err) {
                console.error(`[agrabah-toolsmith http] tool "${ name }" 拋出未預期例外：${ err instanceof Error ? (err.stack ?? err.message) : String(err) }`);
                throw err;
            }
        };
        return originalRegisterTool(name, config as never, wrapped as never);
    }) as typeof server.registerTool;
}

app.all('/mcp', async c => {
    if (c.req.method === 'GET') {
        return c.text('Method Not Allowed', 405, { Allow: 'POST, DELETE' });
    }

    const server = new McpServer(
        { name: 'agrabah-toolsmith', version: '0.1.0' },
        { capabilities: { tools: {} } },
    );
    withStderrStackLogging(server);
    registerToolsmithTools(server);

    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
    await server.connect(transport);
    try {
        return await transport.handleRequest(c.req.raw);
    } finally {
        await server.close();
    }
});

// 完整例外只寫 stderr、回應只給通用訊息（比照 telegram-dispatcher/server.ts:51-57
// 與 agrabah-admin/src/http.ts）。本服務目前不像 admin/platform 用絕對路徑
// import 公司 monorepo，但未來 sub-agent 執行邏輯（scratch/ 路徑操作等）
// 一樣可能拋出帶本機路徑的例外，這層防線先備好。
app.onError((err, c) => {
    console.error(`[agrabah-toolsmith http] unhandled error: ${ err instanceof Error ? (err.stack ?? err.message) : String(err) }`);
    return c.text('Internal Server Error', 500);
});

console.error(`[agrabah-toolsmith MCP] http server ready on 127.0.0.1:${ PORT }`);

export default {
    fetch: app.fetch,
    port: PORT,
    hostname: '127.0.0.1',
};
