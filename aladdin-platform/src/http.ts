#!/usr/bin/env bun
/**
 * http.ts — MCP server over Streamable HTTP transport（Hono），stateless。
 *
 * 第二個進入點，與 stdio.ts 並存，供 hosted 部署使用（企劃端經 tg-dispatcher
 * proxy 打這支常駐服務，不再是 host 直接 spawn 子行程）。tool 註冊完全共用
 * stdio.ts 同一套 registerPlatformTools（tools/index.ts），本檔只負責傳輸層，
 * 不重寫任何 tool 程式碼。
 *
 * 契約（H1 在 aladdin-admin/src/http.ts 拍板，本檔沿用）：
 *   - 端點：POST|DELETE /mcp（MCP streamable HTTP，GET 見下方說明回 405）、
 *     GET /health、POST /login（H6 實作）、POST /files（H8 實作）。
 *   - 綁定 127.0.0.1：只有經 proxy（tg-dispatcher 三條分流）才到得了這支服務，
 *     Bun.serve 不指定 hostname 會綁 wildcard 讓整個區網可達，見 plan.md §3。
 *   - app.onError 只回通用訊息、完整例外只寫 stderr：session.ts 用絕對路徑
 *     import 公司 monorepo（/Users/user/aladdin/genie、abu/platform），未捕捉的
 *     堆疊會把目錄結構原樣吐給企劃端，比照 telegram-dispatcher/server.ts:51-57。
 *
 * H2 只做傳輸層骨架，不改 session.ts（H5 才做）、不改任何 tool 檔案；H4 補上
 * 了本檔的認證層（見下面「Bearer 認證」那條，./auth.ts 是 H3 在
 * aladdin-admin/src/auth.ts 定型契約的原樣複製）。
 *
 * Bearer 認證（H3 拍板、H4 套用）：掛在 /health 以外所有路徑，token 名冊為
 * 獨立 JSON 檔、現讀 + mtime 快取，撤銷/新增 token 不需重啟行程。platform
 * 的名冊檔（tokens.json）與 admin 的是分開的兩份，互不相交，這就是「platform
 * token 打不進 admin、admin token 打不進 platform」的權限隔離依據（D11）。
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
 * `finally` 的 `server.close()` 會在回應送出前就把它切斷——H1 用真正的 MCP SDK
 * client（`StreamableHTTPClientTransport`）實測驗證過：client 收到這種
 * 「送出 200 + text/event-stream 但立刻 EOF」的回應時，會判定連線意外中斷、
 * 以 1 秒間隔無限重連（`_scheduleReconnection` 每次都用固定 delay 重新呼叫，
 * 不會累積 attempt 次數觸發 maxRetries 上限），對一支常駐數週、多企劃併發的
 * daemon 是持續的無謂負載（每次重連都重新 new 一個 McpServer + 重新註冊 4 支
 * tool 的 zod schema，只為了立刻被丟棄）。SDK client 對 405 的處理方式相反：
 * 明確判定「server 沒有提供 GET SSE」，不排入重連（見 SDK
 * client/streamableHttp.js 的 GET 錯誤處理），所以直接回 405 才是讓 client
 * 靜下來的正確做法。這個修法本檔原樣沿用，不重蹈覆轍。
 */

import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';

import { registerPlatformTools } from './tools/index.ts';
import { buildPlatformInstructions } from './instructions.ts';
import { createBearerAuthGuard, getIdentity, getDisplayName, type AuthVariables } from './auth.ts';
import { login, runWithIdentity, IS_PROD, ProdConfirmRequiredError, ReloginRequiredError } from './session.ts';
import { asReloginRequiredResult } from './mcp_result.ts';
import { checkThrottle, recordFailure, recordSuccess } from './login_throttle.ts';
import { AgrabahErrorCodeEnum } from '/Users/user/aladdin/abu/platform/src/generated/remote.gen.ts';
import { saveUploadedFile } from './files.ts';
import {
    runWithAuditAccumulator,
    setAuditResult,
    setAuditTool,
    setAuditLoginIdentifier,
    logAuthenticatedRequest,
    summarizeToolOutcome,
} from './audit_log.ts';

const PORT = Number(process.env.ALADDIN_PLATFORM_HTTP_PORT ?? 8790);

// H3 拍板、H4 沿用：token 名冊是獨立 JSON 檔（不放 .env），預設落在本 package
// 根目錄、已被 obsidian repo .gitignore 排除。可用環境變數覆蓋（測試/未來多
// 環境用）。格式與熱重載語意見 ./auth.ts 檔頭註解。這份名冊與
// aladdin-admin/tokens.json 是分開的兩份檔案，互不相交（D11 權限隔離）。
const TOKENS_PATH = process.env.ALADDIN_PLATFORM_TOKENS_PATH
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
// route（例如未來為了跟 /health 放在一起而順手加在這行之上的新端點）會直接
// 繞過認證，且完全不會報錯，是最不容易在 review 時被發現的認證破洞。註冊在
// 最前面則不論未來新 route 寫在檔案裡的哪個位置都一定會先經過這裡。只有
// /health 例外（供 launchd/監控探測，經 proxy 後公網可達，見下方 /health
// handler 的說明），例外邏輯就在這個 middleware 內部判斷，不依賴任何其他
// route 的註冊順序。
const bearerAuthGuard = createBearerAuthGuard(TOKENS_PATH);
app.use('*', async (c, next) => {
    if (c.req.path === '/health') {
        return next();
    }
    return bearerAuthGuard(c, next);
});

/**
 * H32 稽核 log：掛在 Bearer 認證之後、所有 route 之前，/health 同樣例外（不算
 * 「通過認證的請求」，這支端點本來就不驗證任何東西）。對每個通過認證的
 * request 在整段處理完成後（含 route handler 拋例外的路徑，見 finally）寫
 * 恰好一行；method/path/耗時/來源 IP 在這層就能取得，identity（顯示名）由
 * 上面的 Bearer middleware 剛剛 c.set() 好；tool 名稱、業務結果、/login 用的
 * agrabah identifier 這幾個欄位深處的 handler 才知道，用 audit_log.ts 的
 * AsyncLocalStorage 累積物件回填（runWithAuditAccumulator 包住整個
 * downstream 呼叫鏈，比照 session.ts 的 runWithIdentity 同一種手法，兩個
 * ALS context 各自獨立可以同時巢狀）。
 */
app.use('*', async (c, next) => {
    if (c.req.path === '/health') {
        return next();
    }
    const startedAtMs = performance.now();
    const identity = getDisplayName(c);
    await runWithAuditAccumulator(async () => {
        try {
            await next();
        } finally {
            logAuthenticatedRequest(c, identity, startedAtMs);
        }
    });
});

// 不驗證任何東西，供 launchd / 監控探測；不透露服務身分（比照
// telegram-dispatcher/server.ts:68），因為經 proxy 後公網可達，回傳服務身分
// 等於向掃描者確認這後面有一個 agrabah 後台操作介面。GET /health 不驗證是
// 上面 Bearer middleware 內部的路徑排除決定的，不是因為這個 route 寫在
// middleware 之前——調整這個 handler 在檔案裡的位置不影響它是否需要認證。
app.get('/health', c => c.json({ status: 'ok', uptime_seconds: Math.floor(process.uptime()) }));

/**
 * POST /login — H6，設計理由與 admin 端逐字相同，完整說明見
 * obsidian/mcps/aladdin-admin/src/http.ts 同一段註解（為何是 REST 不是 MCP
 * tool、identifier/password 生命週期、帳號層節流 AC7）。
 */
app.post('/login', async c => {
    const identity = getIdentity(c);

    const throttle = checkThrottle(identity);
    if (!throttle.allowed) {
        setAuditResult('error:throttled');
        return c.json(
            { success: false, message: `登入嘗試失敗次數過多，請於約 ${ throttle.retryAfterSeconds } 秒後再試` },
            429,
        );
    }

    let body: unknown;
    try {
        body = await c.req.json();
    } catch {
        setAuditResult('error:bad_json');
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
        setAuditResult('error:missing_fields');
        return c.json({ success: false, message: '缺少 identifier 或 password' }, 400);
    }

    try {
        const result = await runWithIdentity(identity, () => login({ identifier, password, totpCode }));

        if (!result.success) {
            const totpRequired = result.errorCode === AgrabahErrorCodeEnum.totpNeeded;
            // 帳密其實正確、只是後端還要求 TOTP，不算一次「登入失敗」（帳密沒被猜錯），
            // 不計入節流，否則企劃在多輪 TOTP 互動中可能因為單純還沒輸入驗證碼就被鎖住。
            if (!totpRequired) recordFailure(identity);
            setAuditResult(`error:${ result.errorCode }`);
            console.error(`[aladdin-platform http] /login 失敗：identity=${ identity } agrabahIdentifier=${ identifier } errorCode=${ result.errorCode }`);
            return c.json(
                {
                    success: false,
                    errorCode: result.errorCode,
                    errorName: AgrabahErrorCodeEnum[ result.errorCode ] ?? '(未知錯誤碼)',
                    message: result.message,
                    totpRequired,
                },
                // H17 review 收尾：totpRequired 這個情境刻意回 200，不是 401，理由與
                // aladdin-admin/src/http.ts 對應段落完全相同（telegram-dispatcher/
                // server.ts 對所有上游 401 一律正規化成空 body，會讓 totpRequired 欄位
                // 經 proxy 轉發後永遠到不了企劃端的登入 skill）。
                totpRequired ? 200 : 401,
            );
        }

        recordSuccess(identity);
        // H32：結構化稽核紀錄同時帶 identity（外層 middleware 已附上）與這次使用
        // 的 agrabah identifier，不含密碼；下面這行 console.error 是既有的
        // 純文字補充說明，兩者並存。
        setAuditResult('success');
        setAuditLoginIdentifier(identifier);
        console.error(`[aladdin-platform http] /login 成功：identity=${ identity } agrabahIdentifier=${ identifier }`);
        return c.json({ success: true, message: result.message, identity, mustBindTotp: result.mustBindTotp });
    } catch (err) {
        recordFailure(identity);
        setAuditResult('error:unexpected_exception');
        console.error(`[aladdin-platform http] /login 呼叫 agrabah 時發生未預期例外：identity=${ identity } ${ err instanceof Error ? err.message : String(err) }`);
        return c.json({ success: false, message: '登入時發生未預期錯誤' }, 500);
    }
});

/**
 * POST /files — H8，設計理由與 admin 端逐字相同，完整說明見
 * obsidian/mcps/aladdin-admin/src/http.ts 同一段註解與 ./files.ts 檔頭
 * （multipart 收檔 → 存暫存目錄 → 回 fileId；bodyLimit 只是餘裕檢查，真正
 * 的大小裁決在 saveUploadedFile() 內用實際 bytes 長度判斷；刻意不讀取
 * file.name，落地檔名一律由 saveUploadedFile() 產生）。
 */
app.post(
    '/files',
    bodyLimit({
        maxSize: 4 * 1024 * 1024, // files.ts 預設單檔上限 3MB + multipart overhead 餘裕
        onError: c => c.json({ success: false, errorMessage: '檔案大小超過上限' }, 413),
    }),
    async c => {
        const identity = getIdentity(c);

        let body: Record<string, string | File>;
        try {
            body = await c.req.parseBody();
        } catch {
            setAuditResult('error:bad_multipart');
            return c.json({ success: false, errorMessage: '無法解析 multipart body' }, 400);
        }

        const file = body['file'];
        if (!(file instanceof File)) {
            setAuditResult('error:missing_file_field');
            return c.json({ success: false, errorMessage: '缺少 file 欄位（multipart/form-data，欄位名須為 file）' }, 400);
        }

        const bytes = new Uint8Array(await file.arrayBuffer());
        const result = saveUploadedFile(identity, bytes);
        if (!result.success) {
            setAuditResult(`error:${ result.errorMessage }`);
            return c.json({ success: false, errorMessage: result.errorMessage }, 400);
        }

        setAuditResult('success');
        return c.json({ success: true, fileId: result.fileId });
    },
);

// SDK 的 CallToolRequestSchema handler（mcp.js）對任何 tool 拋出的例外一律靜默接住，
// 只把 error.message 包成 isError:true 回給呼叫端，從不 log——這對「回應不外洩堆疊」
// 是好事，但代表 stderr 永遠看不到完整堆疊，維運者除錯時只有一行訊息可看。
// 這裡不改動任何 tools/*.ts（維持 D8 的 tool 檔案不重寫），改在 registerTool 外面包一層：
// 每支 tool 呼叫仍照原樣執行、原樣回傳/拋出，只是在拋出前先把完整堆疊寫進 stderr
// （唯一的例外是「需要重新登入」這個預期狀態，改回 tool result 不上拋，見下方 catch）。
//
// H32：同一個掛勾點也是唯一拿得到「目前是哪支 tool 在跑」的地方（MCP SDK 內部
// 路由，我們不重新解析 JSON-RPC body），順便把 tool 名稱與結果回填進這個
// request 的稽核累積物件（見 audit_log.ts 的 setAuditTool）——外層的稽核
// middleware 會在整個 /mcp request 處理完後讀出來寫成一行。
export function withStderrStackLogging(server: McpServer): void {
    const originalRegisterTool = server.registerTool.bind(server);
    server.registerTool = ((name: string, config: unknown, handler: (...args: unknown[]) => unknown) => {
        const wrapped = async (...args: unknown[]) => {
            try {
                const result = await handler(...args);
                setAuditTool(name, summarizeToolOutcome(result));
                return result;
            } catch (err) {
                // 「需要重新登入」（session.ts 的 ReloginRequiredError）是預期中的業務狀態，
                // 不是未預期例外——企劃只是還沒對這個後台登入而已。這條路徑**不往上拋**，
                // 改回一個正常的 tool result：例外一旦上拋，MCP SDK 會把它變成 JSON-RPC
                // 層的錯誤，企劃端的 Claude Code 解讀成傳輸問題、畫面只顯示「連線失敗」，
                // 那句寫得很清楚的重登訊號根本沒機會被看到（真實使用者測試中發生過）。
                // 稽核記專屬的 error:relogin_required 與 error:exception 區分開，維運端才
                // 分得出「程式壞了」與「使用者還沒登入」；stderr 只留可追蹤的一行、不印
                // 堆疊（預期狀態的堆疊是噪音，會淹沒真正的例外）。
                if (err instanceof ReloginRequiredError) {
                    setAuditTool(name, 'error:relogin_required');
                    console.error(`[aladdin-platform http] tool "${ name }" 因登入態失效中止：${ err.message }`);
                    return asReloginRequiredResult();
                }
                // H38：confirm 閘門攔截是預期中的業務行為，不是「未預期例外」——比照 admin 端，
                // 稽核 log 記成專屬的 error:prod_confirm_required，見
                // obsidian/mcps/aladdin-admin/src/http.ts 同一段註解。
                const isProdConfirmGate = err instanceof ProdConfirmRequiredError;
                setAuditTool(name, isProdConfirmGate ? 'error:prod_confirm_required' : 'error:exception');
                const label = isProdConfirmGate ? '被 prod confirm 閘門擋下' : '拋出未預期例外';
                console.error(`[aladdin-platform http] tool "${ name }" ${ label }：${ err instanceof Error ? (err.stack ?? err.message) : String(err) }`);
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

    // H5：把這個 request 通過 Bearer middleware 解出的身分（H3/H4 名冊唯一
    // id）灌進 session.ts 的 AsyncLocalStorage，讓這次 request 觸發的所有
    // tool handler（含它們呼叫的 remote.*）都能透過該身分讀到自己的 JWT、
    // 不會讀到別的企劃的——見 session.ts 的 runWithIdentity() 檔頭說明。
    // 整段 McpServer 建立、tool 註冊、handleRequest、close 都包在同一個
    // identity context 內，確保沒有任何一步漏在外面。
    return runWithIdentity(getIdentity(c), async () => {
        // H38：instructions 依這個行程的 IS_PROD 動態組字，比照 admin 端（H12），見
        // instructions.ts。
        const server = new McpServer(
            { name: 'aladdin-platform', version: '0.1.0' },
            { capabilities: { tools: {} }, instructions: buildPlatformInstructions(IS_PROD) },
        );
        withStderrStackLogging(server);
        registerPlatformTools(server, 'hosted');

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
    console.error(`[aladdin-platform http] unhandled error: ${ err instanceof Error ? (err.stack ?? err.message) : String(err) }`);
    return c.text('Internal Server Error', 500);
});

// H38：讓「這個實例的 prod confirm 閘門是否生效」成為開機即可肉眼確認的事實，比照
// admin 端（H36 review 收尾），見 obsidian/mcps/aladdin-admin/src/http.ts 同一段註解。
console.error(`[aladdin-platform MCP] prod 寫入閘門：${ IS_PROD ? '啟用（ALADDIN_PLATFORM_IS_PROD=true）' : '停用（非 prod 實例）' }`);
console.error(`[aladdin-platform MCP] http server ready on 127.0.0.1:${ PORT }`);

export default {
    fetch: app.fetch,
    port: PORT,
    hostname: '127.0.0.1',
};
