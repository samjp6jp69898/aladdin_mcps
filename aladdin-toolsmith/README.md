# aladdin-toolsmith MCP

企劃自助擴充 `aladdin-admin` / `aladdin-platform` 新 tool 的中介 MCP server。企劃用自己的 Claude Code 描述需求，本服務在工程師本機觸發一個具有原始碼權限的 agent 完成研究/實作/驗證，**通過結構性檢查（tsc）與獨立第二個 agent 的對抗性覆核後，自動部署進正式目錄、commit、push 到 origin main、重載 dev 常駐服務**——企劃全程看不到底層原始碼、也拿不到程式碼內容，只會收到部署結果或（需求不夠具體時）一輪澄清問題。

架構、決策脈絡見權威文件：
- `/Users/user/aladdin/obsidian/mcps/_hosted-rollout/plan.md`（D9：交付方式最初修訂為部署到 hosted server 並重載；2026-08-20 進一步定案為「本地部署 + commit + push + reload，不回傳程式碼」，見下方「部署管線」一節）。
- `/Users/user/.claude/plans/logical-jumping-cook.md`（toolsmith 原設計，Phase 1-5、7-8 除交付端外仍然有效）。

跟 `aladdin-admin`/`aladdin-platform` 兩支 stdio+hosted 雙進入點 MCP server 的關鍵差異：本服務**只有 http.ts、沒有 stdio.ts**（天生就是給遠端企劃用的 hosted 服務，工程師本機不需要另外用 stdio 方式跑它），也**不呼叫任何 agrabah RPC**（不 import genie/abu 的絕對路徑，`src/session.ts` 這層在本服務沒有對應物）。

## 現況

`aladdin_toolsmith_generate_tool` 已接上真正的執行邏輯（H23 完成，H24 端到端小範圍測試過一次），2026-08-20 進一步改成「本地部署，不回傳程式碼」的模式，並加入多輪澄清機制。目前已 `launchctl bootstrap`（label `com.aladdin.mcp-toolsmith-server`），port 8788 常駐，經 `telegram-dispatcher` 的 `/toolsmith` proxy route（8787，H14 就已加入）可從外部連到。

**認證**：2026-08-20 從單一共用 token 改成比照 aladdin-admin/aladdin-platform 的 per-user 名冊（`tokens.json`，格式與熱重載語意見 `auth.ts` 檔頭說明）——每個人各自一把 token，才能把 commit message、Telegram 通知、`aladdin_toolsmith_query_log` 的查詢結果都歸屬到人。

**sub-agent 逾時**：`AGENT_TIMEOUT_SECONDS`（`const.ts`）2026-08-20 從最初的保守起始值 600 秒調到 1800 秒——第一次真實端到端測試（requestId `76f29177...`）就實測撞牆逾時，研究＋寫代碼＋dev 驗證這個工作量對 600 秒明顯不夠，且 Gate B 對抗性覆核是用同一個常數的第二次獨立計時，工作量不比主要 sub-agent 少。

## 已支援 tool

| Tool | 說明 |
|---|---|
| `aladdin_toolsmith_generate_tool` | 輸入 `target`（`admin`/`platform`）、`request`（自然語言需求，10–4000 字，**用商業/選單語言描述即可，不需要呼叫端自己先查 API/method**）、`notes`（選填）。第一次呼叫不帶 `requestId`；若 sub-agent 查過原始碼後仍判斷有需要使用者拍板的業務決策，才回傳 `errorKind:"needs_clarification"` + `questions[]` + `requestId`，帶著同一個 `requestId` 與 `answers` 再呼叫一次即可續接，可能來回好幾輪。資訊足夠後 sub-agent 動手寫代碼並在 verify-workspace 副本上自我驗證，成功的話由 deploy-pipeline 接手：套進正式目錄 → tsc 檢查 → 獨立對抗性覆核 agent → commit → reload → push。全部通過回傳 `success:true` 的部署結果；任一關卡沒過就整批回滾，回傳失敗原因（不含程式碼內容）。 |
| `aladdin_toolsmith_query_log` | 查詢呼叫端自己（依 Bearer token 對應身分）觸發過的請求。不帶 `requestId`：列出自己的請求清單（最新在前）。帶 `requestId`：回傳該筆請求的完整細節（主要 sub-agent 的 log 尾段、deploy-pipeline 的 log 尾段、manifest.json、對抗性覆核結論），只能查自己的，查別人的一律回「找不到」。**不受 `generate_tool` 的併發鎖（研究/寫代碼 N=3、部署 N=1）影響**，隨時可查，即使當下有另一個請求正在跑或排隊。 |

## 部署管線（`agent/deploy-pipeline.ts`）

sub-agent 產出「成功」manifest 後，不會把 `output/` 底下的檔案內容回傳給企劃，而是交給決定性的部署流程接手，依序：

1. **precondition**：(a) 確認目前在 `main` 分支；(b) `fetch` 後只在「這次要部署的目標檔案在 `origin/main` 真的有本地沒有的新異動」時，才把 obsidian repo 本身 `merge --ff-only` 同步到 `origin/main`（跟 `ensure-fresh-repos.ts` 對 agrabah/abu/rajah/lago 四個研究來源 repo 做的事對稱，補的是部署目標本身這一側；刻意不是無條件同步整個 repo，避免跟這次部署無關的遠端異動連帶擋住不相干的部署）——目標檔案落後又同步失敗（本地分岔/會覆蓋本地未提交檔案）時直接中止；(c) 檢查這次要更新的檔案在正式目錄現況是否乾淨（git status 乾淨），不乾淨（可能有別的工作階段正在改同一批檔案）就直接中止。三關都過才進下一步。
2. **copy**：把 `output/` 底下的檔案複製進正式目錄。
3. **tsc gate**（決定性）：比對套用前後的 `tsc --noEmit` 錯誤集合，只有「新增」的錯誤才算失敗——這個 codebase 有既有型別債務，不能拿「有沒有錯誤」當標準。
4. **對抗性覆核**（獨立第二個 `claude -p --permission-mode bypassPermissions` sub-agent，不信任原作者的自我陳述）：核對 `method-category-checklist.md` 的分類要求、核對 `tool-naming-convention.md` 的命名規則、實際對 dev 打一次新/改過的 tool、給出 `PASS`/`FAIL` 結論。
5. 兩關都過才 **commit**（`git add` 一律用精確檔案路徑，不用 `-A`）→ **reload**（`launchctl kickstart`）與 **push**（直接推 `origin main`）各自獨立 try/catch，一個失敗不擋另一個嘗試（不是連續依賴關係——「本地服務有沒有生效」跟「git 歷史有沒有同步到遠端」是兩件事）。
6. 任一 gate（precondition/tsc/對抗性覆核）沒過：`git checkout` + `git clean` 回滾正式目錄到套用前的狀態，不 commit、不 push、不 reload，回傳結構化失敗原因。commit 一旦落地（不論 reload/push 各自成不成功）都算「部署成功」，會發一則 Telegram 通知（沿用 `scripts/tg-notify.sh`，收件人查 `tech-users.csv`）——目前只涵蓋成功情境，gate 沒過被回滾的失敗情況不通知。

## 多輪澄清（`agent/conversation.ts`）

`run-agent.ts` 本身是同步 await 的一次性 `claude -p` 呼叫，沒有中途介入機制；多輪澄清靠「同一個 `requestId` 觸發第二次 sub-agent spawn，並把累積的問答記錄餵進新的 prompt」模擬，狀態外部化存在 `scratch/{requestId}/conversation.json`（不怕 process 重啟遺失）。sub-agent 依 prompt「第 0 步」指示：動手寫代碼前先評估資訊夠不夠，不夠就直接寫 `manifest.json` 的 `errorKind:"needs_clarification"` 並停下，不邊猜邊寫——因為這次代碼寫錯會直接自動上線，沒有工程師會再看一遍。

## src/ 結構

```
src/
  http.ts             — MCP entry point（唯一進入點；Hono + WebStandardStreamableHTTPServerTransport，stateless）
  auth.ts             — Bearer 認證 middleware（單一共用 token，見下方「認證」）
  const.ts            — sub-agent timeout / 併發上限 / scratch/logs 路徑 / OBSIDIAN_ROOT / REAL_DIR / LAUNCHD_LABEL
  mcp_result.ts       — MCP tool 回傳值包裝
  agent/
    conversation.ts     — 多輪澄清對話狀態管理（scratch/{requestId}/conversation.json）
    run-agent.ts         — spawn 主要 sub-agent（研究/實作/驗證），吃外部傳入的 requestId/scratchDir/state
    prompt-builder.ts    — 組主要 sub-agent 的 prompt（含「第 0 步」澄清判斷邏輯）
    deploy-pipeline.ts   — 部署管線：copy → tsc → 對抗性覆核 agent → commit → reload → push
    collect-output.ts    — 正式目錄 git status 快照（防禦性檢查 sub-agent 有沒有意外碰到正式目錄）
    concurrency-limiter.ts — 併發號誌工廠：generate_tool.ts 的研究/寫代碼名額（N=3，額度用盡排隊）與 deploy-pipeline.ts 的部署序列化鎖（N=1，各自獨立一份）
    write-fallback-manifest.ts — bash EXIT trap 呼叫，sub-agent 沒寫出 manifest 時補一份 fallback
  tools/
    index.ts            — 聚合所有 register*Tool
    generate_tool.ts     — aladdin_toolsmith_generate_tool，orchestrate 上面所有模組
```

## 環境變數

| 變數 | 說明 |
|---|---|
| `TOOLSMITH_API_TOKEN` | Bearer 認證用的共用 token，存於根目錄 `/Users/user/aladdin/.env`，**不進 git**。產生方式：`bun -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` |
| `TOOLSMITH_HTTP_PORT` | 選填，預設 `8788`（`launchd/run-server.sh` 明確設定為 8788，不依賴此預設值） |

## 認證（與 admin/platform 刻意不同）

`aladdin-admin`/`aladdin-platform` 走 D2「每位企劃一把專屬 Bearer token」的 JSON 名冊機制（`H3` 拍板）。本服務依 `logical-jumping-cook.md` 第 4 節的既有拍板，**多企劃先共用一把 token**（預期用量小，不做 per-user 管理）——這是刻意的差異，不是遺漏。認證邏輯見 `src/auth.ts`：`timingSafeEqual` 常數時間比對，只掛在 `/mcp`，`/health` 不驗證。

## 安裝與啟動

```bash
cd /Users/user/aladdin/obsidian/mcps/aladdin-toolsmith
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
zsh /Users/user/aladdin/obsidian/mcps/aladdin-toolsmith/launchd/run-server.sh
```

正式常駐（**本階段不執行**，留給正式上線的 task）：launchd 只認 `~/Library/LaunchAgents/` 底下的檔案，不會直接讀 repo 裡的 plist，部署時要先複製一份過去（比照 `/Users/user/aladdin/telegram-dispatcher/README.md:32-68` 的既有慣例）：

```bash
cp /Users/user/aladdin/obsidian/mcps/aladdin-toolsmith/launchd/com.aladdin.mcp-toolsmith-server.plist \
   ~/Library/LaunchAgents/

launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.aladdin.mcp-toolsmith-server.plist
# 停止：
launchctl bootout gui/$(id -u)/com.aladdin.mcp-toolsmith-server
```

log 檔位置：`logs/launchd-server.{out,err}.log`（gitignored）。

## scratch/ 與 logs/

- `scratch/` — 未來 sub-agent 的工作區（每個 request 一個子目錄，`verify-workspace/` + `output/` + `manifest.json`），不自動清理，已 gitignore。H22 階段沒有任何程式碼會寫入這個目錄。
- `logs/` — launchd 常駐產生的 stdout/stderr log，已 gitignore。

## 已知限制（骨架階段，如實列出）

- `aladdin_toolsmith_generate_tool` 回傳固定假資料，不代表任何檔案已被生成。
- 全企劃共用同一把 token，沒有 per-user 撤銷機制。
- 尚未接上 `/toolsmith/*` 的 proxy route（見 `plan.md` D12），目前只能本機直連 `127.0.0.1:8788` 測試。
- `logical-jumping-cook.md`「已知風險」節列出的 prompt injection、`bypassPermissions`、併發（現為研究/寫代碼 N=3、部署 N=1）、長連線 timeout 等風險，在 sub-agent 執行邏輯實作前尚未真正發生，但綁定 `127.0.0.1` 與共用 token 的認證層已先就位。
