/**
 * identity.ts — 用 AsyncLocalStorage 把「這個 request 屬於哪位企劃/同事」從
 * http.ts 的 Bearer 認證結果，橋接到 tools/generate_tool.ts 的 handler。
 *
 * 為什麼需要這層橋接，不能直接把 identity 當參數傳給 tool handler：MCP SDK 的
 * `server.registerTool(name, config, handler)` 是註冊一支跨所有 request 共用
 * 的 handler，handler 簽名裡沒有「這次 HTTP request 的 Hono context」這個欄位
 * 可以拿——這跟 aladdin-admin/src/session.ts 要解決的問題完全一樣，這裡是它的
 * 簡化版：admin 需要在 ALS 裡存整包 JWT session 狀態（供 `remote.*` 呼叫用），
 * toolsmith 目前不呼叫任何 agrabah RPC，只需要存一個字串（identity id），所以
 * 沒有照抄 admin 那份的複雜度，只留這裡真正需要的部分。
 */

import { AsyncLocalStorage } from 'node:async_hooks';

const identityStorage = new AsyncLocalStorage<string>();

/** http.ts 的 /mcp handler 用這個包住整段 McpServer 建立/處理/關閉，讓範圍內
 * 觸發的所有 tool handler 都能透過 getCurrentIdentity() 讀到同一個 identity。 */
export function runWithIdentity<T>(identity: string, fn: () => Promise<T>): Promise<T> {
    return identityStorage.run(identity, fn);
}

/**
 * tools/generate_tool.ts 用這個讀出「這次呼叫是誰觸發的」（tokens.json 的
 * 唯一 id，不是顯示名）。理論上只會在 runWithIdentity() 範圍內被呼叫；範圍外
 * 呼叫回傳 undefined 由呼叫端自行決定要不要當異常處理，不在這裡拋例外。
 *
 * **在 fire-and-forget 背景任務裡呼叫是安全的，已實測驗證，不是憑推理判斷**
 * （2026-08-20 對抗性 session review：兩支獨立 minimal-repro 腳本，其中一支
 * 明確模擬「外層 handler 已經 return、背景任務才跑到自己的 await 後半段、且
 * 同時有兩個不同 identity 的並發任務交錯執行」，identity 全程正確、互不污染）。
 * Node 的 AsyncLocalStorage 依「建立 Promise 當下是否處於 run() 的同步呼叫
 * 範圍內」建立因果鏈，不依賴外層 handler 有沒有 return、有沒有 server.close()。
 *
 * 目前實際上 generate_tool.ts 的 processInBackground()／run-agent.ts／
 * deploy-pipeline.ts 都**沒有**再呼叫這個函式——identity 在同步驗證階段就
 * 解析成 `state.requestedBy` 字串傳下去，背景任務不依賴 ALS 存活。上面這段
 * 安全性結論是為了未來如果有人想在背景任務裡直接呼叫這個函式時，不用重新
 * 緊張一次、也不用重新驗證一次。
 */
export function getCurrentIdentity(): string | undefined {
    return identityStorage.getStore();
}
