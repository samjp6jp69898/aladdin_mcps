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
 *   - Bearer 認證（H3 拍板，見 ./auth.ts）：掛在 /health 以外所有路徑，token
 *     名冊為獨立 JSON 檔、現讀 + mtime 快取，撤銷/新增 token 不需重啟行程。
 *
 * H1 只做傳輸層骨架，不改 session.ts（H5 才做）、不改任何 tool 檔案；H3 補上
 * 了本檔的認證層（見上面 Bearer 認證那條）。
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
import { createBearerAuthGuard, getIdentity, type AuthVariables } from './auth.ts';
import { login, runWithIdentity } from './session.ts';
import { checkThrottle, recordFailure, recordSuccess } from './login_throttle.ts';
import { TOTP_NEEDED_ERROR_CODE } from './const.ts';

const PORT = Number(process.env.AGRABAH_ADMIN_HTTP_PORT ?? 8789);

// H3 拍板：token 名冊是獨立 JSON 檔（不放 .env），預設落在本 package 根目錄、
// 已被 obsidian repo .gitignore 排除。可用環境變數覆蓋（測試/未來多環境用）。
// 格式與熱重載語意見 ./auth.ts 檔頭註解。
const TOKENS_PATH = process.env.AGRABAH_ADMIN_TOKENS_PATH
    ?? new URL('../tokens.json', import.meta.url).pathname;

const app = new Hono<{ Variables: AuthVariables }>();

// 帶 Origin header 的請求一律拒絕：我們的合法用戶端是 Claude Code，不是瀏覽器，
// 不會送 Origin；MCP streamable HTTP 規範要求驗證 Origin 防 DNS rebinding。
app.use('*', async (c, next) => {
    if (c.req.header('origin') !== undefined) {
        return c.text('Forbidden', 403);
    }
    await next();
});

// Bearer 認證：刻意註冊在下面所有 route（含 /health）之前。Hono 依「註冊
// 順序」把匹配的 middleware/route 組成一條鏈，一個 route handler 提前
// return（不呼叫 next()）就會讓後面才註冊的 app.use('*', ...) 完全不會被
// 執行到——若把這個 middleware 放在 route 定義之後，任何寫在它前面的新
// route（例如 H6/H8 為了跟 /health 放在一起而順手加在這行之上的 /login）
// 會直接繞過認證，且完全不會報錯，是最不容易在 review 時被發現的認證破洞。
// 註冊在最前面則不論未來新 route 寫在檔案裡的哪個位置都一定會先經過這裡。
// 只有 /health 例外（供 launchd/監控探測，經 proxy 後公網可達，見下方
// /health handler 的說明），例外邏輯就在這個 middleware 內部判斷，不依賴
// 任何其他 route 的註冊順序。
const bearerAuthGuard = createBearerAuthGuard(TOKENS_PATH);
app.use('*', async (c, next) => {
    if (c.req.path === '/health') {
        return next();
    }
    return bearerAuthGuard(c, next);
});

// 不驗證任何東西，供 launchd / 監控探測；不透露服務身分（比照
// telegram-dispatcher/server.ts:68），因為經 proxy 後公網可達，回傳服務身分
// 等於向掃描者確認這後面有一個 agrabah 後台操作介面。GET /health 不驗證是
// 上面 Bearer middleware 內部的路徑排除決定的，不是因為這個 route 寫在
// middleware 之前——調整這個 handler 在檔案裡的位置不影響它是否需要認證。
app.get('/health', c => c.json({ status: 'ok', uptime_seconds: Math.floor(process.uptime()) }));

/**
 * POST /login — H6，plan.md D4 與 §4.2。REST 而非 MCP tool：密碼全程不能進
 * LLM 對話紀錄（企劃端 skill 用 shell 從本地 .env 展開帳密直接 curl 這支），
 * server 也不落地帳密（D3）。掛在上面的 Bearer middleware 之後，所以與
 * /mcp 用同一套認證：沒有合法 Bearer token 進不到這裡。
 *
 * identifier/password 只活在這個 handler 的區域變數（含解構出來的 body 值），
 * 全程未寫進任何 module-level 變數、Map，也不會被任何長生命週期 closure
 * 捕獲——這支函式 return 之後就可以被 GC 回收，比照 session.ts 的 login()
 * 對 D3 的同一套處理方式。任何失敗路徑的 log／回應都只帶 identity（H3 名冊
 * id）與 agrabah errorCode，絕不帶 identifier 以外的帳密欄位、絕不帶
 * message 以外的例外堆疊。
 *
 * 帳號層節流（AC7）：呼叫 agrabah 之前先檢查這個 Bearer 身分是否仍在冷卻期，
 * 冷卻中直接擋下、完全不打 agrabah（避免我方變成暴力破解 agrabah 帳號的
 * 跳板）；成功登入後計數歸零。
 */
app.post('/login', async c => {
    const identity = getIdentity(c);

    const throttle = checkThrottle(identity);
    if (!throttle.allowed) {
        return c.json(
            { success: false, message: `登入嘗試失敗次數過多，請於約 ${ throttle.retryAfterSeconds } 秒後再試` },
            429,
        );
    }

    let body: unknown;
    try {
        body = await c.req.json();
    } catch {
        return c.json({ success: false, message: 'request body 需為合法 JSON' }, 400);
    }

    const identifier = typeof (body as Record<string, unknown>)?.identifier === 'string'
        ? (body as Record<string, string>).identifier
        : undefined;
    const password = typeof (body as Record<string, unknown>)?.password === 'string'
        ? (body as Record<string, string>).password
        : undefined;
    const totpCode = typeof (body as Record<string, unknown>)?.totpCode === 'string'
        ? (body as Record<string, string>).totpCode
        : undefined;

    if (!identifier || !password) {
        return c.json({ success: false, message: '缺少 identifier 或 password' }, 400);
    }

    try {
        const result = await runWithIdentity(identity, () => login({ identifier, password, totpCode }));

        if (!result.success) {
            const totpRequired = result.errorCode === TOTP_NEEDED_ERROR_CODE;
            // 帳密其實正確、只是後端還要求 TOTP，不算一次「登入失敗」（帳密沒被猜錯），
            // 不計入節流，否則企劃在多輪 TOTP 互動中可能因為單純還沒輸入驗證碼就被鎖住。
            if (!totpRequired) recordFailure(identity);
            console.error(`[agrabah-admin http] /login 失敗：identity=${ identity } agrabahIdentifier=${ identifier } errorCode=${ result.errorCode }`);
            return c.json(
                { success: false, errorCode: result.errorCode, message: result.message, totpRequired },
                401,
            );
        }

        recordSuccess(identity);
        // 供未來 H32 稽核 log 沿用（與 Bearer 身分並列，使我方 log 與 agrabah 後端 log 對得起來）；
        // 這一行只含 identity 與這次使用的 agrabah identifier，不含密碼。
        console.error(`[agrabah-admin http] /login 成功：identity=${ identity } agrabahIdentifier=${ identifier }`);
        return c.json({ success: true, message: result.message, identity, mustBindTotp: result.mustBindTotp });
    } catch (err) {
        recordFailure(identity);
        console.error(`[agrabah-admin http] /login 呼叫 agrabah 時發生未預期例外：identity=${ identity } ${ err instanceof Error ? err.message : String(err) }`);
        return c.json({ success: false, message: '登入時發生未預期錯誤' }, 500);
    }
});

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

    // H5：把這個 request 通過 Bearer middleware 解出的身分（H3 名冊唯一 id）
    // 灌進 session.ts 的 AsyncLocalStorage，讓這次 request 觸發的所有 tool
    // handler（含它們呼叫的 remote.*）都能透過該身分讀到自己的 JWT、不會
    // 讀到別的企劃的——見 session.ts 的 runWithIdentity() 檔頭說明。整段
    // McpServer 建立、tool 註冊、handleRequest、close 都包在同一個
    // identity context 內，確保沒有任何一步漏在外面。
    return runWithIdentity(getIdentity(c), async () => {
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
