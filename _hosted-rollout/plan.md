# Hosted MCP Rollout — 架構初稿（企劃自助使用 agrabah MCP 的完整方案）

> 狀態：初稿（2026-08-19 與使用者逐點討論收斂後拍板）。
> 本檔是後續 `tasks.json` 的唯一來源文件；task 拆解與執行進度以同目錄 `tasks.json` 為準，本檔只在架構決策變更時更新。
> 前身文件：`/Users/user/.claude/plans/logical-jumping-cook.md`（agrabah-toolsmith 原設計，本檔 D9 對其做出修訂，其餘未被修訂的設計細節仍然有效）。

## 1. 目標與背景

`agrabah-admin` / `agrabah-platform` 兩個 stdio MCP server（`obsidian/mcps/`，分支 `feature/agrabah-mcp-tools` 起）已完成並實測可用，但目前只有工程師本機能跑：stdio 模式依賴整套公司原始碼（`genie/`、`abu/admin`、`abu/platform` 的 generated 檔與 symlink node_modules）。

最終目標：讓**沒有任何公司原始碼**的企劃（非技術人員），用自己的 Claude Code 直接呼叫這些 tool 操作遊戲場館/遊戲管理，並能透過 `agrabah-toolsmith` 自助擴充新 tool。

## 2. 已拍板決策（含理由；編號供 tasks.json 引用）

| # | 決策 | 理由 / 備註 |
|---|------|-------------|
| D1 | 交付形態＝**hosted remote MCP**：admin/platform 各自以 Streamable HTTP transport 常駐工程師機器，企劃端零安裝、只填 URL + 個人 Bearer token | 企劃裝不起 stdio（需全套原始碼）；bun compile 發布 binary 被否決（每次新增 tool 要重打包重發布，與 toolsmith 即時自助擴充矛盾） |
| D2 | **每位企劃一把專屬 Bearer token**，server 端登入態以 token 為 key（`Map<bearerToken, 登入態>`），MCP transport 維持 stateless | agrabah 操作紀錄要能歸屬到人（共用帳號查不出是誰操作）；token 同時解決我方 log 的稽核歸屬；斷線重連不掉登入態 |
| D3 | **server 記憶體只留 agrabah JWT，不留企劃帳密**（安全性考量，使用者明確要求） | 帳密放企劃自己機器的 starter kit `.env`（本來就是他自己的帳號）；15 分鐘 JWT 過期由企劃端 skill 自動重登解決 |
| D4 | 登入走 **`POST /login` REST 端點**（同 Hono app、同 Bearer 認證），不走 MCP tool；企劃端 skill 指示 Claude 用 shell 從本地 `.env` 展開帳密打這個端點 | 密碼全程不進 LLM 對話紀錄（shell 變數展開），server 也不落地；MCP login tool 在 hosted 模式停用或僅保留 TOTP 互動情境 |
| D5 | 圖片上傳走**自家 `POST /files` 端點**（multipart，同 Bearer 認證）→ 回 `fileId`；圖片類 tool 參數由 `{code, filePath}` 改為 hosted 模式吃 `{code, fileId}` | R2 中轉被否決（多一套金鑰與生命週期管理；檔案終究要回到本機才能餵 agrabah `/upload`；遊戲圖示 <1MB 不吃 ngrok 頻寬）。stdio 模式（工程師本機）保留 filePath 路徑向後相容 |
| D6 | 企劃端標準環境＝**Claude Code 桌面版**（Mac/Windows）；claude.ai 聊天版（網頁/桌面 app）**明確列為不支援** | 查證（官方文件）：聊天版無 Bash 無法跑 curl、remote MCP 預設 OAuth 且自訂 Authorization header 無文件保證；Claude Code 桌面版與 CLI 能力等同（Bash / .mcp.json / skills / settings allowlist） |
| D7 | **單一份跨平台 starter kit**，不分 Mac/Windows 雙版本 | Claude Code 在 Windows 強制裝 Git for Windows、Bash tool 一律走 Git Bash（MSYS2），skill 的 bash 寫法原樣可跑；curl 兩平台皆內建可用 |
| D8 | `src/tools/` **維持扁平**（一個能力一個檔案），不做 server/service/method 分層 | 現量（各 5 支）不需要；tool 是 capability 不是 RPC method 的 1:1 鏡射（如 edit_game 一支串 5 個動作），method 當葉節點會誤導 |
| D9 | **toolsmith 交付方式修訂**：生成的 tool 不再「回傳 files[] 給企劃」（企劃沒環境可貼），改為**部署到工程師機器上的 hosted server** 並重載生效，全企劃立即可用 | 原計畫 `logical-jumping-cook.md:163` 自承的未解缺口在 hosted 架構下自然閉環。部署與重載的具體機制（自動 vs 工程師手動觸發）在對應 task 實作前與使用者確認 |
| D10 | **error code 不在 MCP 內硬編**（撤掉 `const.ts` 的 `LOGIN_REQUIRED_ERROR_CODE`、303 等魔術數字/語意註解），改 import rajah 對 abu 生成的 error 定義、把後端錯誤名稱（如 `gameVendorGameNotExists`）原樣透傳給 agent | agrabah/rajah 已有現成 error code 體系（i18n 也源於此）；錯誤名稱本身即有診斷性。實作前必須 source-first 查證生成檔的實際形態，不憑記憶 |
| D11 | **harness＝MCP server `instructions` + tool description，只做事實診斷，不引導跨後台操作**。現有 `onboard_vendor_game` description 中「303 → 改用 admin 的 create_game」一句要修掉，改為「回報使用者並停止，是否建立全新遊戲是另一個需要授權的決定」 | 企劃未必有（也不該有）admin 權限；agent 不得自行擴大任務範圍。權限硬防線＝agrabah 後端 `@Permission`（每人自己帳號）＋ admin/platform 兩台獨立發 token |
| D12 | 網路曝露沿用 toolsmith 原計畫手法：**不新開 tunnel**，`telegram-dispatcher/server.ts`（Hono，port 8787）加 path 分流 proxy，從一條擴為三條 | ngrok 免費額度已被 tg-dispatch 佔用；此屬修改正在跑的正式服務，實作 task 有專屬風險註記 |

## 3. 目標架構

```
企劃 Claude Code 桌面版（Mac/Win；只有 starter kit，零原始碼）
  │  .mcp.json: URL + 個人 Bearer token（headers）
  │  .env: 企劃自己的 agrabah 帳密（只在企劃機器）
  │  skills: 登入（shell→POST /login，密碼不進對話）、上傳圖片（curl→POST /files→fileId）
  ▼
https://<tg-dispatch 既有 domain>/
  ├── /mcp-admin/*     → localhost:8789  agrabah-admin    hosted（Hono + Streamable HTTP, stateless）
  ├── /mcp-platform/*  → localhost:8790  agrabah-platform hosted（同上）
  └── /toolsmith/*     → localhost:8788  agrabah-toolsmith（原計畫，交付端改 D9）
       （telegram-dispatcher server.ts proxy 分流；TG webhook guard 不得覆蓋這三條）
  ▼
各 hosted server 內部：
  - Bearer 認證 middleware（timingSafeEqual；token→企劃身分；per-token 登入態 Map，僅存 agrabah JWT）
  - POST /login（REST）/ POST /files（multipart→fileId）/ GET /health
  - MCP tools：沿用現有 src/tools/*（扁平），stdio.ts 與 http.ts 雙進入點共用同一組 tool 註冊
  ▼
agrabah Gate（dev）HTTP /api/:group/:service/:method（protobuf+XOR，經 genie client，現有 session.ts 機制）
```

## 4. 各元件設計要點

### 4.1 hosted 化（agrabah-admin / agrabah-platform 各自）

- 在 `stdio.ts` 旁新增 `http.ts` 進入點：Hono + `WebStandardStreamableHTTPServerTransport`（stateless，`sessionIdGenerator` 留空），同一個 `McpServer` 註冊流程共用，tools 程式碼不重寫。
- `session.ts` 從單例登入態改為 per-Bearer-token 的登入態容器；stdio 模式退化為單一隱含身分（env 帳密），行為向後相容。
- `withAutoRelogin`：hosted 模式下 JWT 過期且無帳密可重登 → 回明確「請重新登入」訊號（配合企劃端登入 skill 自動重跑）；stdio 模式維持現行 env 帳密自動重登。
- launchd 常駐（plist + run-server.sh），比照 toolsmith 原計畫的部署骨架。

### 4.2 認證與帳號

- 個人 Bearer token 簽發/輪替/撤銷：`.env` 或專用檔管理 token→企劃名單；發放流程配合 starter kit 產生器（見 4.5）。
- `POST /login` body 帶 agrabah 帳密（TLS 內傳輸）→ server 用該憑證打 `Auth.Login` → JWT 存進該 token 的登入態 → 帳密即丟。
- TOTP：`Auth.Login` 要求動態驗證碼時回明確錯誤，由企劃端當場提供（不可預存）。

### 4.3 檔案上傳

- `POST /files`：multipart 收檔 → 存工程師機器暫存目錄（含配額/清理策略）→ 回 `fileId`。
- 圖片類 tool（`edit_game`、`onboard_vendor_game`）參數擴充：`{code, fileId}`（hosted）與 `{code, filePath}`（stdio 本機）並存，實作時擇一機制（union 或模式判斷）。
- 上傳後餵 agrabah `/upload` 的既有 `uploadFile()` 機制不變。

### 4.4 error code 與 harness（D10/D11）

- Source-first 查證 rajah 對 abu 生成的 error 定義形態（`abu/{admin,platform}/src/generated/` 下實際檔案；查證不憑記憶），MCP 改 import 生成定義。
- `withAutoRelogin` 判斷「未登入」改用生成 enum，撤魔術數字。
- 兩個 server 補 MCP `instructions`（工作流程前提、失敗語意），逐支 tool description 審一遍：只留事實診斷，撤跨後台操作引導（含 303 那句）。

### 4.5 Starter kit（重要交付物）

```
starter-kit/                      # 零公司原始碼；make-starter-kit 腳本按企劃逐人產生（預填個人 token）
├── README.md                     # 安裝手冊，Mac / Windows 分節（Win：首啟依提示裝 Git for Windows）
├── CLAUDE.md                     # 使用手冊：能做哪些事、怎麼開口、不猜 id、權限不足/母表沒遊戲 → 回報工程師
├── .mcp.json                     # remote MCP URL + 個人 Bearer token（預填）
├── .env                          # agrabah 帳密（企劃自填，僅留本機）
└── .claude/
    ├── settings.json             # allowlist 對我們 domain 的 curl（上傳/登入不跳權限彈窗）
    └── skills/
        ├── <登入 skill>          # source .env → POST /login；strip \r（Windows CRLF 地雷）；過期自動重跑
        └── <上傳圖片 skill>      # curl -F → fileId；token 從 .mcp.json jq 取得（單一事實來源）
```

- Windows 已知地雷：`.env` 被記事本存成 CRLF → `source` 後值尾黏 `\r`；登入指令主動 strip、範本以 LF 提供。路徑格式交給 Claude 自行處理，skill 不硬編路徑。

### 4.6 toolsmith（沿用原計畫 + D9 修訂）

- 原計畫 `logical-jumping-cook.md` 的 Phase 1-5、7-8（骨架/認證/部署/併發/sub-agent 執行/文件）照舊；Phase 6 的 proxy route 併入 D12 的三條分流。
- 交付端修訂（D9）：`collect-output` 之後新增「部署到 hosted server + 重載」環節；自動 vs 手動觸發，對應 task 實作前與使用者確認。

## 5. 非目標（本輪不做）

- claude.ai 聊天版（網頁/桌面）支援與任何 base64 降級路徑。
- R2 / 雲端儲存中轉。
- toolsmith 生成程式碼的自動化審查/人工核准關卡（使用者已於原計畫明確決定不做並接受風險）。
- production 環境（一切僅 dev；帳密/URL 均為 dev 測試站）。

## 6. 已知風險（承接原計畫 + 新增）

- 原計畫風險清單（`logical-jumping-cook.md`「已知風險」節）全數仍然成立（prompt injection、bypassPermissions、單機單點、N=1 併發、長連線 timeout 等）。
- 修改 `telegram-dispatcher/server.ts` 是動正式在跑的服務：middleware 順序（TG webhook guard 不得攔到三條新 route）、重啟後必須實測 TG bot 既有功能（如認領一張測試單）。
- hosted 化後 admin/platform server 對外可達：Bearer token 洩漏＝可操作 dev 後台，輪替程序要寫進文件。
- D9 自動部署生成 tool 到 hosted server：壞 tool 會影響所有企劃（原計畫只影響拿到檔案的那個人）——此為新增風險，於對應 task 與使用者確認部署機制時一併討論。
- `POST /files` 暫存目錄需清理策略，否則長期堆積。

## 7. 粗略階段順序（tasks.json 拆解的參考骨架，非正式 task 清單）

1. **P1 hosted 骨架**：admin/platform 各加 `http.ts`（Hono + Streamable HTTP + /health），本機 curl / inspector 驗證 MCP 握手。
2. **P2 認證與登入態**：Bearer middleware、per-token 登入態、`POST /login`、撤單例 session；stdio 相容性回歸。
3. **P3 檔案上傳**：`POST /files` → fileId、圖片 tool 參數擴充、端到端真傳一張圖驗證。
4. **P4 error code / harness**：D10 查證與改造、D11 instructions 與 description 修訂。
5. **P5 網路曝露**：tg-dispatch proxy 三條分流（高風險 task，動手前與使用者確認）、launchd 常駐。
6. **P6 starter kit**：kit 內容、兩支 skill、make-starter-kit 產生器、Mac/Windows 實機驗證（至少 Windows 一次真實走通）。
7. **P7 toolsmith**：原計畫 Phase 1-5 + D9 修訂交付端 + 文件。
8. **P8 文件與收尾**：mcps/README.md 更新（hosted 章節、stdio/hosted 差異）、token 輪替程序、風險清單落文件。

## 8. 流程規則（沿用 telegram-dispatcher 慣例）

- 每個 task 標 `done` 前：逐條對照 `acceptance_criteria` ＋ 派至少 3 個 review agents 檢驗 ＋ **實際跑起來測試**（不能只憑程式碼審查判定完成）。
- 會動正式服務（tg-dispatch）、真實 Notion、真實對外曝露的高風險 task：測試方式先與使用者討論，不單方面決定。
- `tasks.json` schema 比照 `/Users/user/aladdin/telegram-dispatcher/tasks.json`（`project/description/created_at/updated_at/changelog/architecture_summary/modules/prerequisites_done/tasks[]`；task 欄位 `id/module/title/status/depends_on/description/acceptance_criteria/risk_notes/suggested_agent`）。
- 所有 commit 留在 `feature/agrabah-hosted-mcp` 分支；不 push、不動 `main`。
