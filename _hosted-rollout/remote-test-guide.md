# 從另一台電腦測試 hosted MCP 握手

> H15 對外啟用驗收用。這份文件可以直接傳給要做測試的那台電腦。
> 產生日期：2026-08-20

---

## 那台電腦需要準備什麼

**幾乎什麼都不用。** 不需要 VPN、不需要 clone 任何 repo、不需要公司原始碼、不需要 `bun install`。
只要能上網，加上一個終端機（方式 A）或 Claude Code（方式 B）。

這正是這次要驗證的事：企劃拿到的就是這樣一台什麼都沒有的電腦。

---

## 你需要的兩個值

| 項目 | 值 |
|---|---|
| Admin（dev）MCP URL | `https://unrefreshing-trudy-subsequently.ngrok-free.dev/mcp-admin-dev/mcp` |
| Platform MCP URL | `https://unrefreshing-trudy-subsequently.ngrok-free.dev/mcp-platform/mcp` |
| Bearer token | `landon-remote-test`（admin 與 platform 各一把，**值不同**） |

### token 怎麼拿

在**工程師那台機器**（跑服務的那台）執行，把印出來的值手動帶到測試電腦：

```bash
# admin 用
python3 -c "import json;d=json.load(open('/Users/user/aladdin/obsidian/mcps/aladdin-admin/tokens.json'));print([t['token'] for t in d['tokens'] if t['id']=='landon-remote-test'][0])"

# platform 用
python3 -c "import json;d=json.load(open('/Users/user/aladdin/obsidian/mcps/aladdin-platform/tokens.json'));print([t['token'] for t in d['tokens'] if t['id']=='landon-remote-test'][0])"
```

兩把都是 43 字元。稽核 log 裡會顯示成「Landon 遠端測試」。

> **這是測試專用憑證，但等同一把可操作 dev 後台的鑰匙。** 別外流、別進 git、別貼進聊天室。
> 用完要收回：把 `tokens.json` 裡 `id` 為 `landon-remote-test` 的那筆刪掉存檔即可，立即生效不必重啟。
> （刪的時候請用「暫存檔 + mv」的方式，不要用 vim 就地存檔——理由見各 server README 的名冊維護規範。）

---

## 方式 A：只用 curl（最快，不必開 Claude Code）

把 `<TOKEN>` 換成上面查到的 admin token。

### A-1 完成 MCP 握手

```bash
curl -sS -X POST https://unrefreshing-trudy-subsequently.ngrok-free.dev/mcp-admin-dev/mcp \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"manual-test","version":"1.0"}}}'
```

**預期**：一段 JSON，含 `"name":"aladdin-admin"`、`protocolVersion`，以及一段中文 `instructions`。
看到就代表「公網 → ngrok → proxy → hosted server」整條鏈路通了。

### A-2 列出可用工具

```bash
curl -sS -X POST https://unrefreshing-trudy-subsequently.ngrok-free.dev/mcp-admin-dev/mcp \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
```

**預期**：列出 7 支 admin tool。

### A-3 platform 端同樣測一次

把網址換成 `/mcp-platform/mcp`、token 換成 platform 那把，重跑 A-1 與 A-2。
**預期**：`"name":"aladdin-platform"`，3 支 tool。

---

## 方式 B：在 Claude Code 裡真的用起來（模擬企劃視角）

1. 建一個**空資料夾**，例如 `~/aladdin-test`。裡面不需要任何公司原始碼。

2. 在資料夾裡建 `.mcp.json`：

```json
{
  "mcpServers": {
    "aladdin-admin-dev": {
      "type": "http",
      "url": "https://unrefreshing-trudy-subsequently.ngrok-free.dev/mcp-admin-dev/mcp",
      "headers": { "Authorization": "Bearer <ADMIN_TOKEN>" }
    },
    "aladdin-platform": {
      "type": "http",
      "url": "https://unrefreshing-trudy-subsequently.ngrok-free.dev/mcp-platform/mcp",
      "headers": { "Authorization": "Bearer <PLATFORM_TOKEN>" }
    }
  }
}
```

3. `chmod 600 .mcp.json`（裡面是等同帳號的憑證）。

4. 在該資料夾啟動 Claude Code，用 `/mcp` 確認兩個 server 都是 **connected**。

5. 直接用中文下指令，例如：**「列出目前有哪些遊戲場館」**。

### 第一次呼叫 tool 大機率會要求登入（正常，不是壞掉）

hosted 模式下每個 token 各自維護後台登入態，服務重啟就會清空（今天剛重啟過）。
若 Claude 回報「登入態失效 / HOSTED_RELOGIN_REQUIRED」，手動打一次：

```bash
curl -sS -X POST https://unrefreshing-trudy-subsequently.ngrok-free.dev/mcp-admin-dev/login \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"identifier":"<帳號>","password":"<密碼>"}'
```

帳密就是 dev 後台那組；若後端要求動態驗證碼，body 再加 `"totpCode":"123456"`。
正式分發給企劃的 kit 會附登入 skill 自動處理這一步，不用自己打 curl。

> **注意**：agrabah 後端是「同帳號單一活躍 session」。你在這裡登入，會讓其他 identity
> （例如工程師機器上測試用的 `h32-test-a`）手上的 JWT 失效。這是後端行為、不是 bug。

---

## 出問題時怎麼判斷

> **重要**：2026-08-20 修掉了一個資訊洩漏問題，現在**所有認證失敗一律回 401 空回應**，
> 不再用不同狀態碼區分原因。這是刻意的——避免沒有 token 的人靠回應差異摸出哪些服務存在。
> 代價是 401 現在同時代表四件事。

| 現象 | 意義 |
|---|---|
| **401（空回應）** | 四種可能，逐一排除：token 不對 / 沒帶 Authorization header / 網址前綴打錯 / **該環境的後端沒在跑** |
| 連不上、逾時 | 工程師那台機器睡眠、斷網，或 ngrok tunnel 掉了 |
| 429 | 觸發流量限制（每條路徑每分鐘 30 次），等一分鐘再試 |
| **405** | **正常。** `GET /mcp` 本來就該回 405，MCP client 靠它判定「沒有 GET SSE」 |
| 回應說「登入態失效」 | 正常，照上面 `/login` 重登 |

目前**只有** `/mcp-admin-dev` 與 `/mcp-platform` 兩條路徑有後端在跑。
`mcp-admin-pre`、`mcp-admin-evi`、`toolsmith` 尚未上線，打了會拿到跟 token 錯誤一模一樣的 401。

### 想確認整條線路通不通

打 proxy 自己的健康檢查（不需要 token、不透露任何服務身分）：

```bash
curl -s https://unrefreshing-trudy-subsequently.ngrok-free.dev/health
# 預期：{"status":"ok","uptime_seconds":…}
```

這條回 200 但 MCP 路徑回 401 → 問題出在 token 或網址前綴，不是線路。

---

## 這次測試的獨特價值：稽核 log

從另一台電腦打進來的每一次請求都會記進
`mcps/aladdin-admin/logs/audit.jsonl`（platform 同理），內容包含：

- 身分（`identity`，會顯示為「Landon 遠端測試」）
- 時間、呼叫哪支 tool、成功或失敗、來源 IP

但**不含 token、JWT 或密碼**。

這是同機測試無法取代的驗證項目（H15 的 AC10）。**測完請通知工程師撈 log 確認歸屬正確。**

---

## 緊急停用（在工程師那台機器執行）

```bash
# 停單一服務
launchctl bootout gui/$(id -u)/com.aladdin.mcp-admin-server
launchctl bootout gui/$(id -u)/com.aladdin.mcp-platform-server

# 最快、最確定的整體對外下線：停掉 ngrok，公網入口立即消失
launchctl bootout gui/$(id -u)/com.aladdin.tg-dispatch-tunnel
```

撤銷單一 token：從對應 `tokens.json` 刪掉那筆條目存檔即可**立即生效、不需重啟**。

---

## 已知限制

- 服務由 launchd 常駐管理，但屬於 LaunchAgent（`gui/` domain）：**重開機後要等工程師登入桌面 session 才會自動拉起**，不是開機就起。
- 工程師那台機器必須保持開機、不斷網、不睡眠，否則測試端直接連線失敗。
- 對外流量經 ngrok，TLS 在 ngrok 邊緣終止——`/login` 的帳密與所有 token 在 ngrok 伺服器上是明文。目前僅涉及 dev 環境，已列入風險紀錄。
