# i18n-lookup MCP Server

第一個練手 MCP server，把 `obsidian/skills/i18n-lookup` 的 5 個 sub-command 包成 MCP tool，提供 **stdio** 與 **Streamable HTTP** 兩種 transport。

## 結構

```
src/
├─ lookup.ts   # 從 i18n-lookup.ts 移植的純函式版（return 物件）
├─ tools.ts    # 註冊 5 個 MCP tool（共用於兩個 transport）
├─ stdio.ts    # stdio entry — Claude Code / Desktop 用這個
└─ http.ts     # HTTP entry — Streamable HTTP transport
```

提供的 tool：

| Tool name | 對應原 CLI |
|-----------|------------|
| `i18n_error` | `error <code>` |
| `i18n_enum` | `enum <EnumName> [valueName]` |
| `i18n_model` | `model <field-kebab>` |
| `i18n_key` | `key <section>.<keyName>` |
| `i18n_list_projects` | `list-projects` |

## 安裝

```bash
cd obsidian/mcps/i18n-lookup
bun install
```

## 啟動

### stdio（給 Claude Code 用）

```bash
bun run start:stdio
```

從 Claude Code 註冊：

```bash
claude mcp add i18n-lookup \
  --command bun \
  --args /Users/user/aladdin/obsidian/mcps/i18n-lookup/src/stdio.ts
```

驗證：在 Claude Code 內輸入 `/mcp` 應該能看到 `i18n-lookup` 與 5 個 tool。

### HTTP（給遠端 client 或 web UI）

```bash
PORT=3333 bun run start:http
# → [i18n-lookup MCP] HTTP listening on http://localhost:3333/mcp
```

從 Claude Code 註冊 HTTP transport：

```bash
claude mcp add i18n-lookup-http \
  --transport http \
  --url http://localhost:3333/mcp
```

## 手動驗證（不靠 client）

### stdio：餵 JSON-RPC

```bash
(
  printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}'
  printf '%s\n' '{"jsonrpc":"2.0","method":"notifications/initialized"}'
  printf '%s\n' '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
  printf '%s\n' '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"i18n_error","arguments":{"code":"211"}}}'
  sleep 0.3
) | bun src/stdio.ts
```

### HTTP：curl

注意 `Accept` header 要同時帶 `application/json` 與 `text/event-stream`（Streamable HTTP 規範要求）。

```bash
# 1. initialize
curl -s -X POST http://localhost:3333/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'

# 2. tools/list
curl -s -X POST http://localhost:3333/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'

# 3. tools/call
curl -s -X POST http://localhost:3333/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"i18n_error","arguments":{"code":"211"}}}'
```

### Inspector（GUI 驗證）

```bash
bun run inspect
# 會啟一個 browser，可視覺化點 tool、看 input schema、看回應
```

## MCP 入門快查

| 觀念 | 在這個 server 哪裡看 |
|------|---------------------|
| Tool 註冊 | `src/tools.ts` 的 `server.registerTool(name, config, handler)` |
| Input schema（Zod → JSON Schema 自動轉） | `inputSchema: { code: z.string()... }` |
| Tool 回傳格式 | `{ content: [{ type: 'text', text: ... }] }` |
| stdio transport | `src/stdio.ts` 的 `new StdioServerTransport()` |
| Streamable HTTP transport | `src/http.ts` 的 `new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })` |
| stateless 模式 | `sessionIdGenerator: undefined` + 每 request 一個新 server + transport |

## 跟原 CLI skill 的關係

`obsidian/skills/i18n-lookup/i18n-lookup.ts` **不動**。本 MCP server 是「雙檔並存」策略——獨立移植一份邏輯到 `src/lookup.ts`。

⚠️ **同步維護**：lago 的 base64+XOR-128 解密演算法兩邊都有；如果 `genie/src/common/code_helper.ts` 改動，**兩處都要同步更新**（原 CLI 也有同樣的 WARNING 標註）。

## 已知限制

- 純 stateless，不支援 session 上下文或 server → client push notification
- 沒做 auth；HTTP 模式僅供本機開發使用
- 結果用 JSON-stringified text 包進 `content[0].text`，client 拿到後要自己 `JSON.parse`。若日後 MCP `structuredContent` 規格穩定，可改用結構化回傳
