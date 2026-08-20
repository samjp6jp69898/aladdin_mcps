# 部署到新機器（打包機）：完整操作手冊

> **這份文件的讀者是「在新機器上執行部署的 agent 或工程師」**。
> 照著做就能把整套 hosted MCP 服務搬到新機器並對外啟用，不需要理解開發歷程。
> 產生日期：2026-08-20（來源：H13/H15 實際部署與事故經驗）

---

## 0. 這套系統是什麼

三個常駐服務，讓沒有公司原始碼的企劃用 Claude 操作 agrabah 後台：

| 服務 | port | 說明 |
|---|---|---|
| `aladdin-admin` | 8789 | 系統管理後台 MCP server（dev 實例） |
| `aladdin-platform` | 8790 | 平台管理後台 MCP server（dev × PK 實例） |
| `telegram-dispatcher` | 8787 | 對外唯一入口，依路徑前綴分流到上面兩個；同時承載既有 Telegram bot |

對外經 ngrok tunnel（另一個 launchd job）→ 8787 → 前綴分流。

保留但**尚未常駐**的實例：admin-pre(8791)、admin-evi(8792)、toolsmith(8788)。

---

## 1. 前置條件（缺一不可，先全部確認）

```bash
# 1. bun（啟動腳本寫死這個路徑，沒有就先裝）
ls -l /Users/<USER>/.bun/bin/bun

# 2. jq（啟動腳本用它讀設定；Homebrew 路徑寫死在腳本裡）
ls -l /opt/homebrew/bin/jq

# 3. 兩個 repo
ls -d /Users/<USER>/aladdin/obsidian/mcps
ls -d /Users/<USER>/aladdin/telegram-dispatcher

# 4. node_modules（每個 server 目錄各自需要）
cd /Users/<USER>/aladdin/obsidian/mcps/aladdin-admin && bun install
cd ../aladdin-platform && bun install
cd /Users/<USER>/aladdin/telegram-dispatcher && bun install
```

> **注意**：啟動腳本裡的 `/Users/user/...`、`/opt/homebrew/bin/jq`、`/Users/user/.bun/bin/bun`
> 都是**寫死的絕對路徑**。換使用者名稱或用非 Homebrew 安裝，必須先改
> `launchd/run-server*.sh` 與 `launchd/*.plist`，否則服務起不來。

---

## 2. 兩個不進 git 的檔案（在新機器上「重新產生」，不要從舊機器複製）

> **重點**：這兩個檔案都是**環境專屬**的，新機器當成全新環境建立即可。
> 不需要、也不建議從舊機器搬——搬過來反而會讓兩台機器共用同一批憑證。

### 2.1 `/Users/<USER>/aladdin/.mcp.json`

**啟動腳本從這裡讀後台網址**（`run-server.sh` 用 jq 取值），沒有它服務會 fail-loud 退出。

範本在 repo 裡：**`mcps/_hosted-rollout/root-mcp.json.example`**

```bash
cp /Users/<USER>/aladdin/obsidian/mcps/_hosted-rollout/root-mcp.json.example \
   /Users/<USER>/aladdin/.mcp.json
# 然後編輯它：把 <USER> 換成實際使用者名稱、填入後台帳號密碼
```

填完驗證：

```bash
python3 -m json.tool /Users/<USER>/aladdin/.mcp.json > /dev/null && echo "JSON OK"
/opt/homebrew/bin/jq -r '.mcpServers["aladdin-admin"].env.ALADDIN_ADMIN_API_URL' /Users/<USER>/aladdin/.mcp.json
# 要印得出網址，印出 null 就是 key 名不對，服務會起不來
```

> **已知設計缺口（H28 待處理）**：hosted 服務的存活綁在這個「給 stdio 模式用的」設定區塊上。
> 有人清掉 `mcpServers.aladdin-admin` 這個 key，服務會在**下次重啟時**才死，當下沒有徵兆。
> 2026-08-20 的改名就踩過這個雷（key 還是舊的 `agrabah-admin`，服務起不來）。
> 部署後若服務起不來，**第一個要查的就是這裡的 key 名稱與 env 變數名是否對得上 `run-server.sh`**。

### 2.2 各 server 的 `tokens.json`（Bearer 名冊）

**新機器一律產生全新的 token，不要從舊機器複製。** 理由有三個：

1. token 就是這套系統唯一的對外鑰匙，兩台機器共用同一批＝洩漏面加倍
2. 舊機器上那批多半是開發期的測試 token（`h6-test`、`h32-test-*` 之類），不該帶進正式環境
3. 新機器換了 tunnel domain 的話，舊 kit 本來就要重發，token 順便換掉沒有額外成本

**代價**：發過的 kit 會全部失效，要重新發一份給每個企劃（`.mcp.json` 裡的 token 值變了）。
所以順序是「先在新機器建好名冊 → 再產生 kit 發下去」，不要反過來。

```
mcps/aladdin-admin/tokens.json         # dev
mcps/aladdin-admin/tokens.pre.json     # pre（若要啟用 8791）
mcps/aladdin-admin/tokens.evi.json     # evi（若要啟用 8792）
mcps/aladdin-platform/tokens.json
```

格式：

```json
{
  "tokens": [
    {
      "id": "landon-remote-test",
      "token": "<43 字元 base64url>",
      "display_name": "Landon 遠端測試",
      "issued_at": "2026-08-20"
    }
  ]
}
```

產生一把新 token：

```bash
python3 -c "import secrets,base64;print(base64.urlsafe_b64encode(secrets.token_bytes(32)).decode().rstrip('='))"
```

> **名冊維護鐵則（M3 修復後）**：`auth.ts` 現在**每個 request 都重讀這個檔案**，
> 而且**任何異常一律 fail-closed**（檔案不存在／JSON 壞掉／單筆缺 `id` 或 `token`／`id` 或 `token` 重複
> → **該 server 的所有 token 一起失效**）。
> 所以修改名冊**一律用「暫存檔 + mv」**，不要用 vim 就地存檔：
> ```bash
> python3 ... > tokens.json.tmp && mv tokens.json.tmp tokens.json
> ```
> 就地覆寫的空窗期（檔案為空或半截）會讓所有使用者一起 401。改完務必驗證：
> ```bash
> python3 -m json.tool tokens.json > /dev/null && echo OK
> ```

---

## 3. 部署 launchd（照順序做）

### 3.1 複製 plist 到 LaunchAgents

**launchd 只認 `~/Library/LaunchAgents/`，不會讀 repo 裡的 plist。**

```bash
M=/Users/<USER>/aladdin/obsidian/mcps
cp "$M/aladdin-admin/launchd/com.aladdin.mcp-admin-server.plist"    ~/Library/LaunchAgents/
cp "$M/aladdin-platform/launchd/com.aladdin.mcp-platform-server.plist" ~/Library/LaunchAgents/

# 語法檢查（壞掉的 plist 會靜默不載入）
plutil -lint ~/Library/LaunchAgents/com.aladdin.mcp-*.plist
```

### 3.2 bootstrap

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.aladdin.mcp-admin-server.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.aladdin.mcp-platform-server.plist
launchctl list | grep -i aladdin
```

### 3.3 等待就緒（**用輪詢，不要用固定 sleep**）

```bash
for i in $(seq 1 90); do
  a=$(curl -sS -o /dev/null -m 2 -w '%{http_code}' http://127.0.0.1:8789/health 2>/dev/null || echo 000)
  p=$(curl -sS -o /dev/null -m 2 -w '%{http_code}' http://127.0.0.1:8790/health 2>/dev/null || echo 000)
  [ "$a" = "200" ] && [ "$p" = "200" ] && { echo "就緒（第 $i 次）"; break; }
  [ "$i" = "90" ] && echo "未就緒: admin=$a platform=$p"
done
```

> **輪詢迴圈一定要有間隔判斷**：連線被拒會**立即**返回，沒有間隔的話 90 次可能在一秒內跑完，
> 你會誤判成「服務起不來」。實際上 2026-08-20 就發生過這個誤判。

### 3.4 起不來時怎麼查

```bash
tail -20 $M/aladdin-admin/logs/launchd-server.err.log
launchctl print gui/$(id -u)/com.aladdin.mcp-admin-server | grep -E 'state|last exit|runs'
```

常見原因，依機率排序：

| 症狀 | 原因 |
|---|---|
| `ERROR: 無法從 .../.mcp.json 讀取 mcpServers.aladdin-admin.env.ALADDIN_ADMIN_API_URL` | §2.1 的 key 名或 env 變數名不符 |
| `名冊載入失敗，已進入拒絕所有請求狀態` | §2.2 的 tokens.json 不存在或格式錯 |
| 行程反覆重啟（`runs` 快速增加） | `KeepAlive=true` + 啟動即崩潰；看 err log 找真因 |
| port 被佔用 | `lsof -nP -i :8789` 找出佔用者 |

---

## 4. 對外 tunnel

`telegram-dispatcher` 有自己的兩個 launchd job（server + ngrok tunnel），部署方式見
`/Users/<USER>/aladdin/telegram-dispatcher/README.md:32-68`。

**ngrok domain 是寫死的**，出現在這些地方（換 domain 要全部改）：

```
telegram-dispatcher/launchd/run-tunnel.sh          （TUNNEL_URL 常數）
mcps/aladdin-ai-assistant-kit/.claude/settings.json （allow 規則，逐字比對）
mcps/aladdin-ai-assistant-kit/.mcp.json            （企劃連線的 URL）
```

> **已知風險（H28）**：ngrok 官方文件現在寫免費方案不提供 static domain，但現有 reserved domain
> 仍在運作——代表這個 domain 隨時可能被政策收回。Cloudflare Tunnel 的遷移評估報告見
> `scratchpad/cloudflare-tunnel-eval.md`（結論：有條件遷移；CF 解決出口 IP 洩漏但同樣終止 TLS）。

---

## 5. 驗收（部署完成後逐項確認）

```bash
D=https://<你的 tunnel domain>
T=$(python3 -c "import json;d=json.load(open('$M/aladdin-admin/tokens.json'));print(d['tokens'][0]['token'])")

# 1. 本機健康
curl -s http://127.0.0.1:8789/health   # {"status":"ok",...}
curl -s http://127.0.0.1:8790/health

# 2. 對外握手（應回 serverInfo.name = aladdin-admin）
curl -sS -X POST $D/mcp-admin-dev/mcp \
  -H "Authorization: Bearer $T" -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"deploy-check","version":"1.0"}}}'

# 3. tool 清單（admin 應有 8 支、platform 3 支）
curl -sS -X POST $D/mcp-admin-dev/mcp -H "Authorization: Bearer $T" \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'

# 4. 無 token 必須 401
curl -sS -o /dev/null -w '%{http_code}\n' -X POST $D/mcp-admin-dev/mcp \
  -H 'Content-Type: application/json' -d '{}'

# 5. 探測防線：所有前綴（含不存在的）都必須回一模一樣的 401 空 body
for p in mcp-admin-dev mcp-platform mcp-admin-pre nonexistent-prefix; do
  curl -sS -o /dev/null -w "$p -> %{http_code} bytes=%{size_download}\n" \
    -H 'Authorization: Bearer FAKE' $D/$p/health
done

# 6. GET /mcp 必須回 405（不是 401）——MCP client 靠它判定沒有 GET SSE
curl -sS -o /dev/null -w '%{http_code}\n' $D/mcp-admin-dev/mcp -H "Authorization: Bearer $T"

# 7. 稽核 log 有紀錄且無憑證
tail -3 $M/aladdin-admin/logs/audit.jsonl
grep -cE 'eyJ|[Bb]earer|password' $M/aladdin-admin/logs/audit.jsonl   # 必須是 0
```

**重啟自動拉起實測**（值得做一次）：

```bash
kill -9 $(launchctl list | awk '$3=="com.aladdin.mcp-admin-server"{print $1}')
# 然後用 §3.3 的輪詢確認它自己回來、且 PID 換新
```

---

## 6. 日常維運

```bash
# 改了程式碼要生效（不要手動跑 bun，會撞 EADDRINUSE，而且 launchd 那個行程仍是舊碼）
launchctl kickstart -k gui/$(id -u)/com.aladdin.mcp-admin-server

# 停單一服務
launchctl bootout gui/$(id -u)/com.aladdin.mcp-admin-server

# 最快、最確定的整體對外下線（停 ngrok，公網入口立即消失）
launchctl bootout gui/$(id -u)/com.aladdin.tg-dispatch-tunnel

# 撤銷某人的 token：從 tokens.json 移除該筆條目（用暫存檔+mv），立即生效不需重啟
```

> **緊急止血優先用 `bootout tg-dispatch-tunnel`**，不要用刪名冊檔的方式——
> 刪檔雖然現在是 fail-closed（安全的一邊），但停 tunnel 更快也更確定。

---

## 7. 這台機器必須維持的狀態

- **開機、不斷網、不睡眠**。任一條不滿足，企劃端直接連線失敗。
- **重開機後不會自動啟動**：兩個 job 是 LaunchAgent（`gui/` domain），要等**使用者登入桌面 session**
  才會被拉起（機器未開 FileVault、未設自動登入時，會停在登入畫面）。
  這與既有的 tg-dispatch 兩個 job 是相同結構，屬同級行為。
  若要真正做到「開機即服務」，需要改成 LaunchDaemon（`system/` domain）或設定自動登入——**這是尚未做的決定**。
- **磁碟**：`tmp-uploads/` 有 24 小時保留期的自動清理（含重啟後的孤兒檔掃描），
  launchd log 超過 10MB 會自動輪替（保留一份 `.1`）。但仍建議定期看一下磁碟餘量。

---

## 8. 給企劃的 kit 怎麼產生

公版在 `mcps/aladdin-ai-assistant-kit/`（`.mcp.json` 是佔位符）。手動產生一份可用的：

1. 複製整個目錄（排除 `node_modules`）
2. 改 `.mcp.json`：填入該企劃被授權的環境 entry 與各自的 Bearer token
3. **server 別名必須與 `.env.example` 的欄位名對得上**——`login.sh` 用機械轉換
   （別名轉大寫、非英數換底線、加 `_USER`/`_PASSWORD`）：
   ```
   aladdin-admin-dev        → ALADDIN_ADMIN_DEV_USER / _PASSWORD
   aladdin-platform-dev-pk  → ALADDIN_PLATFORM_DEV_PK_USER / _PASSWORD
   ```
4. 企劃自己 `cp .env.example .env` 填帳密、`chmod 600 .env .mcp.json`

> H19（`make-starter-kit` 產生器）會把上述步驟自動化，目前尚未實作。

---

## 9. 已知限制與待辦

| 項目 | 狀態 |
|---|---|
| pre(8791)/evi(8792)/toolsmith(8788) | 啟動腳本與 plist 已備妥，未 bootstrap |
| platform 多實例（6T、pre、evi） | `.env.example` 已列欄位，但只有 dev×PK 有實例在跑 |
| 重開機需登入桌面才拉起 | 未決定是否改 LaunchDaemon |
| token 無到期機制 | 唯一失效方式是人工刪條目（H28） |
| 稽核 log 用 display_name 而非唯一 id | 兩人同名時歸屬會失效（H28） |
| `.mcp.json`（kit 內）被 git tracked | `.gitignore` 對已追蹤檔無效，填真 token 後可能誤 commit（H19） |
| ngrok domain 可能被政策收回 | 見 §4（H28） |

完整清單見 `tasks.json` 的 H28 `risk_notes`。
