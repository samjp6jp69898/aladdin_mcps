# agrabah MCP servers — 架構、新增 tool 公版、安裝與連線

這份文件是所有 `mcps/agrabah-*` server 共用的規範。個別 server 的 README 只放專屬資訊（env 變數、tool 清單、已知限制），設計原則跟怎麼加新 tool 一律看這裡，避免每個 server 各寫一份會漂移。

目前有：

| Server | 對應後台 | 目錄 |
|---|---|---|
| `agrabah-admin` | admin（系統管理後台） | `mcps/agrabah-admin` |
| `agrabah-platform` | platform（平台管理後台） | `mcps/agrabah-platform` |

---

## 一、基礎架構

### 協定與 transport

MCP（Model Context Protocol）是 JSON-RPC 2.0 協定，定義 host（Claude Code）跟 server 之間怎麼溝通 tools/resources/prompts。我們只用 tools。

Transport 用 **stdio**：host 讀 `.mcp.json`，對每個 server 執行 `command` + `args`（+`env`）把它 spawn 成子行程，之後透過該行程的 stdin/stdout 傳收 JSON-RPC 訊息（純文字，一行一則）。**log 一律寫 stderr**——stdout 是協定專用管道，混進一行 log 會弄壞 JSON-RPC 解析。

握手流程：spawn → `initialize` 交換協定版本 → host 呼叫 `tools/list` 拿工具定義 → LLM 決定呼叫某工具時 host 送 `tools/call` → server 執行、回傳結果。

### Stateless 還是 stateful？

見上方對話說明，重點結論：**MCP server process 本身是 stateful**（記憶體常駐一份登入 token，process 生命週期內有效，重啟即重置）；**底層每個 HTTP request 是 stateless**（無 server-side session，純 Bearer token per-request）。

### 我們怎麼打進 agrabah dev server

不走 WebSocket，走 agrabah Gate 的純 HTTP `POST /api/:group/:service/:method`——這是 `genie/client` 在沒有 WS 連線時本來就會走的 fallback 路徑，不是自製的旁門左道。

**不重新定義任何 protobuf 型別或 RPC client**：直接以絕對路徑重用對應前端專案（`abu/admin` 或 `abu/platform`）已經 `rajah generate` 出來的 `src/generated/remote.gen.ts` + `types.gen.js`。`genie/client` 也用絕對路徑（`/Users/user/aladdin/genie/src/client/index.ts`）匯入到 canonical 原始檔，確保跟 `remote.gen.ts` 內部用的是同一個 `Client` class 實例（因為 `abu/admin(或 platform)/node_modules/genie` 底下每個檔案實際上是 symlink 指回這個唯一原始碼位置，Node/Bun 的 module cache 會把它們當成同一份）。這件事已用 spike script 實測驗證過，不是憑推理下定論。

### HTTP request 實際長怎樣（能不能用 Postman 測）

看 `genie/src/client/index.ts` 的 `Client.request()`（純 HTTP、非 WS 路徑）實際組裝方式：

```
POST {baseUrl}/api/{group}/{service}/{method}
headers: { Authorization: 'Bearer <jwt>', ...其他自訂 header }
body: <raw bytes>   ← 沒有明確設定 Content-Type
```

`body` 不是 JSON，是**兩層轉換後的二進位資料**：

1. 先把這支 method 的參數，依 rajah 生出的 protobuf schema（`types.gen.proto`）編碼成 protobuf bytes。
2. 再對整包 bytes 做一次 XOR 混淆：`buffer[i] ^= i % 128`（`Uint8ArrayEncodeDecode`，`genie/src/common/code_helper.ts:28-35`），條件是 `Client.encoded = true`（我們的 session.ts 有開）。

回應方向是反過來：拿到的 bytes 先 XOR 解碼，再 protobuf decode 成外層 `GenieResponse { errorCode, message, data(bytes) }`，而 `data` 本身**又是一層 protobuf bytes**，要再用該 method 專屬的回應型別 decode 一次才拿到真正的資料——是巢狀的兩層 protobuf，不是單層。

**能不能用 Postman 測**：技術上這條路是標準 HTTP POST，任何 HTTP client 理論上都能打；但實務上**不建議、也不好用**：

- Postman 新版有原生 Protobuf body 型態（餵 `.proto` schema 可以把類 JSON 輸入編碼成 protobuf bytes），這部分勉強能借 `types.gen.proto` 用。
- 但 XOR 這層 Postman 完全沒有原生支援，得自己寫 pre-request script 操作 raw bytes（Postman sandbox 對二進位操作本來就不太順手）。
- 回應要先 XOR 解碼、再拆兩層 protobuf decode（外層 `GenieResponse` + 內層真正的 response type），這種巢狀 decode postman 的內建 protobuf 檢視器不支援。

我們現在直接重用 `genie/client` + `remote.gen.ts`，本質上就是把上面這一整套手工步驟省掉——這也是為什麼選這條路而不是自己刻 HTTP client。如果真的想拿 Postman 驗證，比較實際的做法是先寫一支跟 MCP tool 邏輯一樣的小 bun script（比照 `abu/.claude/skills/test-method`），不透過 Postman。

---

## 二、新增一個 tool 的公版流程

新增/擴充任何一個 server 的能力，固定照這個順序做：

### 1. 查清楚目標 RPC method（不能猜）

用 `rajah-query` skill（或直接讀 `rajah/services/*.rajah`）確認：
- 完整簽名（參數/回傳型別）與 file:line。
- 掛在哪個 gate（admin 用 `GameVendorAdmin` 這類 `*Admin` service；platform 用 `*Platform` service）——**兩邊常常同名概念但是完全不同的 model**（例如 `GameVendorEssential` vs `PlatformGameVendorEssential`），不要假設共用。
- 有沒有 `@Type "Select:xxx"` 依賴——代表這個欄位必須是「後端既有清單裡的值」，不是任意字串/數字，要嘛額外加一支查詢 tool、要嘛在 description 裡講清楚限制（不要無聲放過，agent 會亂填）。
- 對應 agrabah 後端實作邏輯是不是真的等於「建立」語意（`id > 0` 判斷 create/update 是常見寫法，但不是每支都這樣——這次 `GameVendorPlatform.UpdateGameVendorGame` 就不是，見 `agrabah-platform` README）。
- **跨 server 的假設要實測驗證，不能只憑「看起來是同一張表」下結論**：曾經誤以為 admin 建立的場館 id 在 platform 端「直接可用」，實測才發現場館要先被 admin 呼叫 `UpdatePlatformGameVendorStatus` 啟用給特定 platform，否則 platform 端完全查不到（該 id 全域共用沒錯，但「哪些 platform 看得到」是另一張獨立關聯表）。寫進文件前先跑一次真實呼叫確認，不要只靠程式碼推論就斷言跨模組行為。

### 2. 檔案放哪裡：一個能力一個檔案

在對應 server 的 `src/tools/` 底下新增檔案，**檔名對應能力語意**（不是照搬 RPC method 英文名），例如 `list_vendor_games.ts`，不是全部塞進一支 `tools.ts`。`src/session.ts`（登入態 + `uploadFile`）、`src/const.ts`（rajah enum 對照表、錯誤碼等常數）、`src/mcp_result.ts`（回傳包裝）是共用基礎設施，業務邏輯不要往這三個檔案塞；反過來說，enum 對照表這類**兩個以上 tool 檔案會用到的常數，一定放 `const.ts`，不要每個 tool 檔案各自宣告一份**（曾經 `GAME_TAG_MAP`/`ACTIVE_STATUS_MAP` 這類 map 在多支 tool 裡重複定義過，容易漂移）。帳號/URL 這類環境設定不放 `const.ts`，一律只走 `.mcp.json` 的 `env`（`process.env.*`），程式碼裡不寫死任何 fallback 值。

### 3. 套用這個骨架

```ts
/**
 * tools/<capability_name>.ts — <mcp_tool_name>
 * rajah: <Service>.<Method>（<rajah 檔案路徑>:<行號>）
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { <NeededModel> } from '<abu/admin 或 abu/platform 的絕對路徑>/src/generated/types.gen.js';
import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult } from '../mcp_result.ts';
import { <NeededEnumMap> } from '../const.ts'; // enum 對照表/錯誤碼放這裡；只有這個 tool 用得到的一次性小常數才留在檔案內

export function register<CapabilityName>Tool(server: McpServer): void {
    server.registerTool(
        '<mcp_tool_name>',                // 命名慣例：agrabah_<admin|platform>_<動詞>_<名詞>
        {
            title: '...',
            description:
                '...清楚寫：呼叫的 rajah method、前提依賴（要先呼叫哪支才能拿到合法值）、' +
                '資料格式陷阱（例如某欄位是 ×10000 的整數）、已知限制（哪些欄位本 POC 沒做）。',
            inputSchema: {
                // 每個欄位都要有 .describe()，這是 agent 唯一能看到的操作說明
            },
        },
        async (input) => {
            const r = await withAutoRelogin(() => remote.<group>.<service>.<Method>(/* ...參數 */));
            if (r.failed) return asTextResult({ success: false, errorCode: r.errorCode, message: r.message });
            return asTextResult({ success: true, /* ... */ });
        },
    );
}
```

寫入型（create/update）method 要照 `test-method` skill 的 SOP：呼叫前先讀既有資料當基準值（避免覆蓋掉沒打算改的欄位），成功後自動讀回驗證一次再回傳給 agent；有明確錯誤碼語意（例如母表不存在）要在 description 跟回傳的 `hint` 裡講清楚，不要讓 agent 自己瞎猜重試。

### 4. 掛進 `tools/index.ts`

```ts
import { register<CapabilityName>Tool } from './<capability_name>.ts';
// ...
export function register<Admin|Platform>Tools(server: McpServer): void {
    // ...既有的...
    register<CapabilityName>Tool(server);
}
```

### 5. 真的打一次 dev 驗證，不是紙上談兵

寫一支跟 `test-method` skill同款的 spike script（絕對路徑 import `session.ts` 同一套邏輯，或直接用 `@modelcontextprotocol/sdk` 的 `Client`/`StdioClientTransport` 透過 stdio 呼叫真正的 tool）跑一次，確認：
- 真的登入成功。
- 真的呼叫到後端、拿到真實資料，不是只看 TypeScript 編譯過。
- 有寫入行為的話，測完要清理/還原 dev 上的測試資料（用 delete/disable 類 method，沒有的話跟操作者說清楚哪筆資料留在 dev 需要人工處理）。

### 6. 更新該 server 的 README

補上新 tool 到「已支援 tool 清單」表格，以及任何新發現的已知限制。

---

## 三、安裝與連線

因為是 stdio transport，「安裝」＝「讓 host 能 spawn 這個子行程」，不是部署一個網路服務。

### 步驟

1. **取得程式碼**：`obsidian` 是獨立 git repo，`git pull` 拿到 `mcps/` 底下所有 server。
2. **裝依賴**：進目標 server 目錄跑一次
   ```bash
   cd /Users/user/aladdin/obsidian/mcps/<server-name>
   bun install
   ```
3. **註冊進 `.mcp.json`**（專案根目錄 `/Users/user/aladdin/.mcp.json`，或使用者層級設定皆可）：
   ```json
   "<server-name>": {
     "type": "stdio",
     "command": "bun",
     "args": ["/Users/user/aladdin/obsidian/mcps/<server-name>/src/stdio.ts"],
     "env": { "...": "...對應 server 的環境變數，見各自 README..." }
   }
   ```
   也可以用 CLI 代替手動編輯：
   ```bash
   claude mcp add <server-name> --command bun --args /Users/user/aladdin/obsidian/mcps/<server-name>/src/stdio.ts
   ```
4. **重啟 Claude Code**（或該 MCP client 重新載入 MCP 連線），host 才會重新讀 `.mcp.json` 並 spawn 新 server；新增/修改 `.mcp.json` 不會自動生效。

### 環境限制

- 每個人的 Claude Code 都各自 spawn 一份獨立子行程，帳密要自己在 `.mcp.json` 填一份——**這個架構天生不是多人共用同一個常駐服務**。這是刻意選擇：省掉認證/TLS/防火牆這些網路層問題，代價是不能共用登入態。
- 依賴 `abu/admin`、`abu/platform` 這兩個前端專案已經跑過 `bun install`（`node_modules/genie` 要存在且是可用的 symlink）——沒跑過的環境要先進對應前端專案裝一次。
- 依賴這些前端專案的 rajah 生成檔案（`src/generated/remote.gen.ts` 等）是最新的——如果 rajah 改了欄位但前端沒重新 generate，MCP 這邊會跟著讀到舊定義。

### 除錯

- MCP server 啟動失敗最常見原因：`AGRABAH_*_API_URL`/`AGRABAH_*_USER`/`AGRABAH_*_PASSWORD` 沒設（`session.ts` 會直接 throw，訊息很明確）。
- 想在不透過 Claude Code 的情況下手動驗證 server 正常，可以用 SDK 內建的 inspector：
  ```bash
  cd /Users/user/aladdin/obsidian/mcps/<server-name>
  bunx @modelcontextprotocol/inspector bun src/stdio.ts
  ```
  會開一個網頁 UI，可以手動呼叫每個 tool、看 request/response，不用真的接上 Claude Code。
