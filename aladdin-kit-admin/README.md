# aladdin-kit-admin MCP

工程師本機專用、**stdio-only**（沒有 http.ts）的 MCP server：把 `../aladdin-ai-assistant-kit/make-starter-kit.ts`
包成兩支 tool，讓你在自己的 Claude Code 裡用自然語言核發/查詢企劃 starter kit，不用每次手動打
`bun make-starter-kit.ts ...`。這支 server 只做「呼叫那支腳本」，不重寫 token 簽發邏輯（見
`src/spawn_kit_script.ts` 檔頭說明）。

**只給你自己用，絕對不要把它變成 hosted 服務、也絕對不要掛進任何會交給企劃的 kit**——它的 tool
本質是核發一個人的完整 agrabah 帳號權限，跟 `aladdin-admin`/`aladdin-platform` 給企劃用的業務 tool
不是同一個信任等級。詳見 `src/stdio.ts` 檔頭。

## 已支援 tool

| Tool | 說明 |
|---|---|
| `aladdin_kit_issue` | 核發（或 `rotate=true` 重新簽發）一份 kit。`id`/`name` 必填，`grants` 留空預設給 `admin-dev` + 所有已部署的 `platform-dev-*`（目前是 `platform-dev-pk`），並在這個 id 還沒有 toolsmith 條目時一併核發 toolsmith；`admin-pre`/`admin-evi` 不會因留空而自動帶到，要明確在 `grants` 裡指定（明確指定 `grants` 也不會連帶核發 toolsmith）。 |
| `aladdin_kit_list` | 列出兩份 token 名冊目前已核發的 id / 顯示名 / 核發時間，不含 token 值。 |

## 安裝與連線

```bash
cd /Users/user/aladdin/aladdin_mcps/aladdin-kit-admin
bun install
```

註冊進根目錄 `/Users/user/aladdin/.mcp.json`（已經加好，通常不需要手動再跑一次）：

```json
"aladdin-kit-admin": {
  "type": "stdio",
  "command": "bun",
  "args": [ "/Users/user/aladdin/aladdin_mcps/aladdin-kit-admin/src/stdio.ts" ]
}
```

不需要任何 `env`——腳本路徑與 KIT_DIR 都是寫死的絕對路徑（跟 `make-starter-kit.ts` 本身的慣例一致）。
改完 `.mcp.json` 要重啟 Claude Code 才會生效。

## 目前支援哪些環境

跟 `make-starter-kit.ts` 完全一致（見該檔 `ALLOWED_GRANTS`/`BLOCKED_GRANTS` 註解）：`admin-dev`、
`platform-dev-pk`、`admin-pre`、`admin-evi` 四個都已部署常駐、可以核發（2026-08-20：pre/evi 在
H35 端到端驗證過可行後，因 H38 尚未完成而暫緩開放；H38 完成後經使用者確認解鎖，並已
`launchctl bootstrap` 成常駐服務）。差別只在於**留空 `grants` 時的預設值**——2026-08-27 起預設給
`admin-dev` + 所有已部署的 `platform-dev-*`（目前是 `platform-dev-pk`；之後新平台環境上線會自動
跟著涵蓋，不用回來改預設值），並一併核發 toolsmith（若這個 id 還沒有）。`admin-pre`/`admin-evi`
一定要明確指定才會核發，不會因為留空就自動帶到。`admin-uat`/`admin-prod` 仍未開放：這兩個環境連
真實後台網址都還沒拿到，根本沒有部署，不是程式碼刻意擋著。

要新增下一個環境（例如未來 uat/prod 有真實網址了）：除了改這支 server 的 `ALLOWED_GRANT_VALUES`
（`src/tools/issue.ts`），還要先在 `make-starter-kit.ts` 那邊的 `ALLOWED_GRANTS`/`BLOCKED_GRANTS`
加好對應設定並完成部署（plist、tokens 名冊、proxy 路由），兩邊必須同步改，不要只改一邊。

## 已知限制

- `aladdin_kit_issue`/`aladdin_kit_list` 是同步 spawn 子行程等結果（`execFileSync`，30 秒 timeout），
  跟直接跑腳本的等待時間一樣，沒有加速核發本身，只是省去手動組 CLI 參數的步驟。
- 錯誤訊息原樣把腳本的 stderr 回傳給呼叫端（可能是 Claude 自己），沒有額外包裝成更友善的文案——
  這是刻意的：腳本本身的錯誤訊息（id 已存在、grant 被擋的理由等）已經寫得夠明確，重新包裝一層有
  漂移風險。
