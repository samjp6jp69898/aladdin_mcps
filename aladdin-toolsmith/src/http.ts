#!/usr/bin/env bun
/**
 * http.ts — MCP server over Streamable HTTP transport（Hono），stateless。
 *
 * 依 /Users/user/aladdin/aladdin_mcps/_hosted-rollout/plan.md D9 與
 * /Users/user/.claude/plans/logical-jumping-cook.md Phase 1/2，比照
 * aladdin-admin/src/http.ts（H1 定型並實測過的版本，commit eda293d2）沿用
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
 * 本檔（H22）只做服務骨架：aladdin_toolsmith_generate_tool 目前回傳固定假
 * 資料（見 tools/generate_tool.ts），真正 spawn 本機 sub-agent 的執行邏輯
 * 是未來 task 的範圍，不影響本檔的傳輸層/認證層設計。
 *
 * stateless 模式下 WebStandardStreamableHTTPServerTransport 規定一個
 * transport 只能處理一個 request，所以每個 request 都 new 一個
 * McpServer + transport，並在 handleRequest resolve 後立刻 close（詳細
 * 理由見 aladdin-admin/src/http.ts 檔頭註解，這裡不重複）。
 *
 * GET /mcp 不交給 transport 處理，直接回 405：讓 transport 開 SSE stream
 * 會被 finally 的 server.close() 搶先切斷，導致 SDK client 誤判連線意外
 * 中斷、以 1 秒間隔無限重連（H1 已用真實 SDK client 實測驗證過此修法）。
 */

import { Hono } from 'hono';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';

import { registerToolsmithTools } from './tools/index.ts';
import { createBearerAuthGuard, getIdentity, type AuthVariables } from './auth.ts';
import { runWithIdentity } from './identity.ts';
import { cleanupOrphanedRequestsOnStartup } from './agent/conversation.ts';
import { SCRATCH_DIR } from './const.ts';

const PORT = Number(process.env.TOOLSMITH_HTTP_PORT ?? 8788);

// 2026-08-20（對抗性 session review）：generate_tool.ts 非阻塞化後，「正在
// 處理中」完全靠記憶體狀態，行程重啟會讓 scratch/ 底下殘留卡在非終局 status
// 的孤兒請求（見 conversation.ts 檔頭說明）。每次啟動先清一次，這樣即使是
// 這次為了套用新程式碼而做的 `launchctl kickstart` 重啟，也不會留下永遠
// 卡住的請求。
{
    const { cleaned } = cleanupOrphanedRequestsOnStartup(SCRATCH_DIR);
    if (cleaned > 0) {
        console.error(`[aladdin-toolsmith http] 啟動清理：${ cleaned } 筆孤兒請求已標記為 failed。`);
    }
}

// 2026-08-20：從單一共用 token 改成比照 aladdin-admin 的 per-user 名冊（見
// auth.ts 檔頭說明），預設落在本 package 根目錄、已被 aladdin_mcps repo
// .gitignore 排除，可用環境變數覆蓋。
const TOKENS_PATH = process.env.TOOLSMITH_TOKENS_PATH
    ?? new URL('../tokens.json', import.meta.url).pathname;

const app = new Hono<{ Variables: AuthVariables }>();

// 帶 Origin header 的請求一律拒絕：我們的合法用戶端是 Claude Code，不是瀏覽器，
// 不會送 Origin；MCP streamable HTTP 規範要求驗證 Origin 防 DNS rebinding。
// 沿用 aladdin-admin/src/http.ts 的既有寫法。
app.use('*', async (c, next) => {
    if (c.req.header('origin') !== undefined) {
        return c.text('Forbidden', 403);
    }
    await next();
});

// Bearer 認證：刻意註冊在下面所有 route（含 /health）之前，理由同
// aladdin-admin/src/http.ts——route handler 提前 return 不呼叫 next() 會讓
// 後面才註冊的 app.use('*', ...) 完全不會被執行到，放最前面則不論未來新
// route 寫在檔案裡的哪個位置都一定會先經過這裡。/health 例外邏輯在
// middleware 內部依路徑判斷，不依賴任何 route 的註冊順序。
const bearerAuthGuard = createBearerAuthGuard(TOKENS_PATH);
app.use('*', async (c, next) => {
    if (c.req.path === '/health') {
        return next();
    }
    return bearerAuthGuard(c, next);
});

// 不驗證任何東西，供 launchd / 監控探測；不透露服務身分（比照
// telegram-dispatcher/server.ts:68 與 aladdin-admin/src/http.ts），因為經
// proxy 後公網可達，回傳服務身分等於向掃描者確認這後面有一個會 spawn
// bypassPermissions agent 的端點。
app.get('/health', c => c.json({ status: 'ok', uptime_seconds: Math.floor(process.uptime()) }));

// SDK 的 CallToolRequestSchema handler（mcp.js）對任何 tool 拋出的例外一律
// 靜默接住，只把 error.message 包成 isError:true 回給呼叫端，從不 log——
// 這裡不改動任何 tools/*.ts，改在 registerTool 外面包一層：每支 tool 呼叫
// 仍照原樣執行、原樣回傳/拋出，只是在拋出前先把完整堆疊寫進 stderr。逐字
// 沿用 aladdin-admin/src/http.ts 的寫法。
function withStderrStackLogging(server: McpServer): void {
    const originalRegisterTool = server.registerTool.bind(server);
    server.registerTool = ((name: string, config: unknown, handler: (...args: unknown[]) => unknown) => {
        const wrapped = async (...args: unknown[]) => {
            try {
                return await handler(...args);
            } catch (err) {
                console.error(`[aladdin-toolsmith http] tool "${ name }" 拋出未預期例外：${ err instanceof Error ? (err.stack ?? err.message) : String(err) }`);
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

    // 把這個 request 通過 Bearer middleware 解出的身分（tokens.json 唯一 id）
    // 灌進 identity.ts 的 AsyncLocalStorage，讓這次 request 觸發的
    // aladdin_toolsmith_generate_tool handler 能透過 getCurrentIdentity() 讀到
    // 「這是誰發起的」，寫進 conversation.json / commit message / Telegram
    // 通知——見 identity.ts 檔頭說明，整段 McpServer 建立/處理/關閉都包在同一個
    // identity context 內，確保沒有任何一步漏在外面（比照 aladdin-admin/
    // src/http.ts 的 runWithIdentity 用法）。
    return runWithIdentity(getIdentity(c), async () => {
        const server = new McpServer(
            { name: 'aladdin-toolsmith', version: '0.1.0' },
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
});

// 完整例外只寫 stderr、回應只給通用訊息（比照 telegram-dispatcher/server.ts:51-57
// 與 aladdin-admin/src/http.ts）。本服務目前不像 admin/platform 用絕對路徑
// import 公司 monorepo，但未來 sub-agent 執行邏輯（scratch/ 路徑操作等）
// 一樣可能拋出帶本機路徑的例外，這層防線先備好。
app.onError((err, c) => {
    console.error(`[aladdin-toolsmith http] unhandled error: ${ err instanceof Error ? (err.stack ?? err.message) : String(err) }`);
    return c.text('Internal Server Error', 500);
});

console.error(`[aladdin-toolsmith MCP] http server ready on 127.0.0.1:${ PORT }`);

export default {
    fetch: app.fetch,
    port: PORT,
    hostname: '127.0.0.1',
};
