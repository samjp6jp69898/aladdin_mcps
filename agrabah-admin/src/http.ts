#!/usr/bin/env bun
/**
 * http.ts — MCP server over Streamable HTTP transport（Hono），stateless。
 *
 * 第二個進入點，與 stdio.ts 並存，供 hosted 部署使用（企劃端經 tg-dispatcher
 * proxy 打這支常駐服務，不再是 host 直接 spawn 子行程）。tool 註冊完全共用
 * stdio.ts 同一套 registerAdminTools（tools/index.ts），本檔只負責傳輸層，
 * 不重寫任何 tool 程式碼。
 *
 * 契約（本檔 H1 拍板，H2 / 後續 task 沿用）：
 *   - 端點：POST|DELETE /mcp（MCP streamable HTTP，GET 見下方說明回 405）、
 *     GET /health、POST /login（H6 實作）、POST /files（H8 實作）。
 *   - 綁定 127.0.0.1：只有經 proxy（tg-dispatcher 三條分流）才到得了這支服務，
 *     Bun.serve 不指定 hostname 會綁 wildcard 讓整個區網可達，見 plan.md §3。
 *   - app.onError 只回通用訊息、完整例外只寫 stderr：session.ts 用絕對路徑
 *     import 公司 monorepo（/Users/user/aladdin/genie、abu/admin），未捕捉的
 *     堆疊會把目錄結構原樣吐給企劃端，比照 telegram-dispatcher/server.ts:51-57。
 *
 * 本 task（H1）只做傳輸層骨架：不加認證（H3 才做）、不改 session.ts（H5 才做）、
 * 不改任何 tool 檔案。
 *
 * stateless 模式下 WebStandardStreamableHTTPServerTransport 規定一個 transport
 * 只能處理一個 request（重用會丟例外，見 SDK
 * server/webStandardStreamableHttp.js 的 handleRequest：
 * `if (!this.sessionIdGenerator && this._hasHandledRequest) throw ...`），
 * 所以每個 request 都 new 一個 McpServer + transport。SDK 內附的 Hono 範例
 * （examples/server/honoWebStandardStreamableHttp.js）就是這樣做，但範例從不
 * close——我們跑的是常駐數週的 daemon，資源回收要自己顧：用
 * `enableJsonResponse: true`（回應是一次性 JSON，不開 SSE stream，
 * `handleRequest` resolve 時保證已無待處理狀態，不會有還在寫入的串流被提早
 * 切斷）並在 `handleRequest` resolve 後立刻 `server.close()`（其內部會連帶
 * close transport，見 SDK shared/protocol.js 的 `Server.close()` 呼叫
 * `this._transport?.close()`）。
 *
 * GET 不交給 transport 處理，直接回 405：stateless 模式下每個 request 各自
 * 獨立的 transport 彼此不相通，GET 開的 standalone SSE stream 本來就沒有任何
 * 跨 request 的通知好傳；但若真的讓 transport 開了這條 SSE stream，
 * `finally` 的 `server.close()` 會在回應送出前就把它切斷——用真正的 MCP SDK
 * client（`StreamableHTTPClientTransport`）實測驗證過：client 收到這種
 * 「送出 200 + text/event-stream 但立刻 EOF」的回應時，會判定連線意外中斷、
 * 以 1 秒間隔無限重連（`_scheduleReconnection` 每次都用固定 delay 重新呼叫，
 * 不會累積 attempt 次數觸發 maxRetries 上限），對一支常駐數週、多企劃併發的
 * daemon 是持續的無謂負載（每次重連都重新 new 一個 McpServer + 重新註冊 5 支
 * tool 的 zod schema，只為了立刻被丟棄）。SDK client 對 405 的處理方式相反：
 * 明確判定「server 沒有提供 GET SSE」，不排入重連（見 SDK
 * client/streamableHttp.js 的 GET 錯誤處理），所以直接回 405 才是讓 client
 * 靜下來的正確做法。
 */

import { Hono } from 'hono';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';

import { registerAdminTools } from './tools/index.ts';

const PORT = Number(process.env.AGRABAH_ADMIN_HTTP_PORT ?? 8789);

const app = new Hono();

// 帶 Origin header 的請求一律拒絕：我們的合法用戶端是 Claude Code，不是瀏覽器，
// 不會送 Origin；MCP streamable HTTP 規範要求驗證 Origin 防 DNS rebinding。
app.use('*', async (c, next) => {
    if (c.req.header('origin') !== undefined) {
        return c.text('Forbidden', 403);
    }
    await next();
});

// 不驗證任何東西，供 launchd / 監控探測；不透露服務身分（比照
// telegram-dispatcher/server.ts:68），因為經 proxy 後公網可達，回傳服務身分
// 等於向掃描者確認這後面有一個 agrabah 後台操作介面。
app.get('/health', c => c.json({ status: 'ok', uptime_seconds: Math.floor(process.uptime()) }));

// SDK 的 CallToolRequestSchema handler（mcp.js）對任何 tool 拋出的例外一律靜默接住，
// 只把 error.message 包成 isError:true 回給呼叫端，從不 log——這對「回應不外洩堆疊」
// 是好事，但代表 stderr 永遠看不到完整堆疊，維運者除錯時只有一行訊息可看。
// 這裡不改動任何 tools/*.ts（維持 D8 的 tool 檔案不重寫），改在 registerTool 外面包一層：
// 每支 tool 呼叫仍照原樣執行、原樣回傳/拋出，只是在拋出前先把完整堆疊寫進 stderr。
function withStderrStackLogging(server: McpServer): void {
    const originalRegisterTool = server.registerTool.bind(server);
    server.registerTool = ((name: string, config: unknown, handler: (...args: unknown[]) => unknown) => {
        const wrapped = async (...args: unknown[]) => {
            try {
                return await handler(...args);
            } catch (err) {
                console.error(`[agrabah-admin http] tool "${ name }" 拋出未預期例外：${ err instanceof Error ? (err.stack ?? err.message) : String(err) }`);
                throw err;
            }
        };
        return originalRegisterTool(name, config as never, wrapped as never);
    }) as typeof server.registerTool;
}

app.all('/mcp', async c => {
    // 見檔頭說明：stateless 模式下讓 transport 處理 GET 會開一條立刻被切斷的
    // 幽靈 SSE stream，導致 SDK client 無限重連。直接回 405，Allow 頭列出
    // 真正支援的方法。
    if (c.req.method === 'GET') {
        return c.text('Method Not Allowed', 405, { Allow: 'POST, DELETE' });
    }

    const server = new McpServer(
        { name: 'agrabah-admin', version: '0.2.0' },
        { capabilities: { tools: {} } },
    );
    withStderrStackLogging(server);
    registerAdminTools(server);

    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
    await server.connect(transport);
    try {
        return await transport.handleRequest(c.req.raw);
    } finally {
        await server.close();
    }
});

// 完整例外只寫 stderr、回應只給通用訊息：session.ts 用絕對路徑 import 公司
// monorepo，未捕捉的堆疊會把目錄結構原樣吐給企劃端，違背「企劃全程看不到底層
// 原始碼」的核心前提（比照 telegram-dispatcher/server.ts:51-57）。
app.onError((err, c) => {
    console.error(`[agrabah-admin http] unhandled error: ${ err instanceof Error ? (err.stack ?? err.message) : String(err) }`);
    return c.text('Internal Server Error', 500);
});

console.error(`[agrabah-admin MCP] http server ready on 127.0.0.1:${ PORT }`);

export default {
    fetch: app.fetch,
    port: PORT,
    hostname: '127.0.0.1',
};
