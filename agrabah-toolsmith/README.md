# agrabah-toolsmith MCP（骨架階段）

企劃自助擴充 `agrabah-admin` / `agrabah-platform` 新 tool 的中介 MCP server。企劃用自己的 Claude Code 描述需求，本服務應在工程師本機觸發一個具有原始碼權限的 agent 完成研究/實作/驗證，讓企劃全程看不到底層原始碼。

架構、決策脈絡見權威文件：
- `/Users/user/aladdin/obsidian/mcps/_hosted-rollout/plan.md`（D9：交付方式修訂為部署到 hosted server 並重載，取代原計畫的「回傳 files[] 給企劃」）。
- `/Users/user/.claude/plans/logical-jumping-cook.md`（toolsmith 原設計，Phase 1-5、7-8 除交付端外仍然有效）。

跟 `agrabah-admin`/`agrabah-platform` 兩支 stdio+hosted 雙進入點 MCP server 的關鍵差異：本服務**只有 http.ts、沒有 stdio.ts**（天生就是給遠端企劃用的 hosted 服務，工程師本機不需要另外用 stdio 方式跑它），也**不呼叫任何 agrabah RPC**（不 import genie/abu 的絕對路徑，`src/session.ts` 這層在本服務沒有對應物）。

## 現況（H22：服務骨架）

只做傳輸層骨架與認證，**`agrabah_toolsmith_generate_tool` 目前一律回傳固定假資料**，不會觸發任何本機 sub-agent、不會讀寫 `scratch/`。真正的 spawn 邏輯（`agent/run-agent.ts`、`prompt-builder.ts`、`agent/concurrency-limiter.ts`、`collect-output.ts`，見 `logical-jumping-cook.md` 第 3 節）是未來 task 的範圍。

## 已支援 tool

| Tool | 說明 |
|---|---|
| `agrabah_toolsmith_generate_tool` | 輸入 `target`（`admin`/`platform`）、`request`（自然語言需求，10–4000 字）、`notes`（選填）；**目前回傳固定假資料**，`success: true` 但 `files: []`、`verification.ran: false` |

## src/ 結構

```
src/
  http.ts             — MCP entry point（唯一進入點；Hono + WebStandardStreamableHTTPServerTransport，stateless）
  auth.ts             — Bearer 認證 middleware（單一共用 token，見下方「認證」）
  const.ts            — sub-agent timeout / 併發上限 / scratch/logs 路徑常數（H22 尚未被消費）
  mcp_result.ts       — MCP tool 回傳值包裝
  tools/
    index.ts            — 聚合所有 register*Tool
    generate_tool.ts     — agrabah_toolsmith_generate_tool（骨架階段回傳假資料）
```

## 環境變數

| 變數 | 說明 |
|---|---|
| `TOOLSMITH_API_TOKEN` | Bearer 認證用的共用 token，存於根目錄 `/Users/user/aladdin/.env`，**不進 git**。產生方式：`bun -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` |
| `TOOLSMITH_HTTP_PORT` | 選填，預設 `8788`（`launchd/run-server.sh` 明確設定為 8788，不依賴此預設值） |

## 認證（與 admin/platform 刻意不同）

`agrabah-admin`/`agrabah-platform` 走 D2「每位企劃一把專屬 Bearer token」的 JSON 名冊機制（`H3` 拍板）。本服務依 `logical-jumping-cook.md` 第 4 節的既有拍板，**多企劃先共用一把 token**（預期用量小，不做 per-user 管理）——這是刻意的差異，不是遺漏。認證邏輯見 `src/auth.ts`：`timingSafeEqual` 常數時間比對，只掛在 `/mcp`，`/health` 不驗證。

## 安裝與啟動

```bash
cd /Users/user/aladdin/obsidian/mcps/agrabah-toolsmith
bun install
bun src/http.ts   # 或 bun run start:http
```

啟動後監聽 `127.0.0.1:8788`（**刻意不綁 wildcard**：這是一個「送一段自然語言就會 spawn 一個 `bypassPermissions` agent」的端點且全員共用單一 token，絕不該在區網上可達）。

```bash
curl -s localhost:8788/health
# {"status":"ok","uptime_seconds":123}
```

## 本機部署（launchd，骨架階段：只手動跑，不 bootstrap）

```bash
# 手動跑（開發/除錯用，會一直佔用這個 terminal，Ctrl-C 停止）
zsh /Users/user/aladdin/obsidian/mcps/agrabah-toolsmith/launchd/run-server.sh
```

正式常駐（**本階段不執行**，留給正式上線的 task）：launchd 只認 `~/Library/LaunchAgents/` 底下的檔案，不會直接讀 repo 裡的 plist，部署時要先複製一份過去（比照 `/Users/user/aladdin/telegram-dispatcher/README.md:32-68` 的既有慣例）：

```bash
cp /Users/user/aladdin/obsidian/mcps/agrabah-toolsmith/launchd/com.aladdin.agrabah-toolsmith-server.plist \
   ~/Library/LaunchAgents/

launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.aladdin.agrabah-toolsmith-server.plist
# 停止：
launchctl bootout gui/$(id -u)/com.aladdin.agrabah-toolsmith-server
```

log 檔位置：`logs/launchd-server.{out,err}.log`（gitignored）。

## scratch/ 與 logs/

- `scratch/` — 未來 sub-agent 的工作區（每個 request 一個子目錄，`verify-workspace/` + `output/` + `manifest.json`），不自動清理，已 gitignore。H22 階段沒有任何程式碼會寫入這個目錄。
- `logs/` — launchd 常駐產生的 stdout/stderr log，已 gitignore。

## 已知限制（骨架階段，如實列出）

- `agrabah_toolsmith_generate_tool` 回傳固定假資料，不代表任何檔案已被生成。
- 全企劃共用同一把 token，沒有 per-user 撤銷機制。
- 尚未接上 `/toolsmith/*` 的 proxy route（見 `plan.md` D12），目前只能本機直連 `127.0.0.1:8788` 測試。
- `logical-jumping-cook.md`「已知風險」節列出的 prompt injection、`bypassPermissions`、N=1 併發、長連線 timeout 等風險，在 sub-agent 執行邏輯實作前尚未真正發生，但綁定 `127.0.0.1` 與共用 token 的認證層已先就位。
