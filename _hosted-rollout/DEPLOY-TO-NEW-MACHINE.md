# 部署到新機器（打包機）：完整操作手冊

> **這份文件的讀者是「在新機器上執行部署的 agent 或工程師」**。
> 照著做就能把整套 hosted MCP 服務搬到新機器並對外啟用，不需要理解開發歷程。
> 產生日期：2026-08-20（來源：H13/H15 實際部署與事故經驗）

---

## 0. 這套系統是什麼，以及各服務怎麼串起來

讓沒有公司原始碼的企劃用 Claude 操作 agrabah 後台。**四個 launchd job，缺一不可**：

```
  企劃的電腦
      │  https://<tunnel domain>/mcp-admin-dev/mcp
      ▼
  ┌─────────────────────────────────────────────┐
  │ ngrok tunnel        （job: tg-dispatch-tunnel）│  ← 對外的門
  └─────────────────────────────────────────────┘
      │  轉到本機 127.0.0.1:8787
      ▼
  ┌─────────────────────────────────────────────┐
  │ telegram-dispatcher （job: tg-dispatch-server）│  ← 唯一入口 + 守衛
  │   :8787                                       │
  │   • 認證閘（有沒有帶 Authorization）            │
  │   • 流量限制、body 上限                        │
  │   • 回應正規化（防拓撲探測的均一 401）           │
  │   • 依路徑前綴分流 ↓                           │
  │   • 同時承載原本的 Telegram bot webhook        │
  └─────────────────────────────────────────────┘
      │                          │
      │ /mcp-admin-dev           │ /mcp-platform
      ▼                          ▼
  ┌──────────────────┐    ┌──────────────────┐
  │ aladdin-admin    │    │ aladdin-platform │   ← 只綁 127.0.0.1
  │   :8789          │    │   :8790          │      外面連不到
  │ (job: mcp-admin- │    │ (job: mcp-       │
  │  server)         │    │  platform-server)│
  └──────────────────┘    └──────────────────┘
      │                          │
      ▼                          ▼
   admin.alddev.com      pk-platform.alddev.com   ← 真正的後台
```

### 兩者的關係（常見疑問）

**MCP server 與 telegram-dispatcher 是必要依賴，不是各自獨立的東西。**

- 兩個 MCP server **只監聽 `127.0.0.1`**，外部網路連不到它們。企劃的請求一定要
  經過 dispatcher 才進得來——**只部署 MCP server 而不部署 dispatcher，企劃會完全連不上**。
- 所有安全機制都在 dispatcher 那一層：認證閘、rate limit、body 上限、以及讓
  「哪些環境存在」無法被外部探測的均一 401。MCP server 自己只做 Bearer 名冊比對。
- dispatcher 本來就是既有服務（Telegram bot），MCP proxy 是加掛上去的五條路由。
  **部署時不要為了 MCP 而動到它既有的 webhook 設定。**

### 路徑前綴對照

| 對外路徑前綴 | 轉發到 | 狀態 |
|---|---|---|
| `/mcp-admin-dev` | 8789 | 常駐中 |
| `/mcp-platform` | 8790 | 常駐中 |
| `/mcp-admin-pre` | 8791 | plist 已備妥，未 bootstrap |
| `/mcp-admin-evi` | 8792 | plist 已備妥，未 bootstrap |
| `/toolsmith` | 8788 | 未上線 |

未啟用的前綴打進來會拿到跟「前綴不存在」一模一樣的 401（刻意設計，見 §5 驗收第 5 項）。

---

## 1. 前置條件（缺一不可，先全部確認）

```bash
# 1. bun（啟動腳本寫死這個路徑，沒有就先裝）
ls -l /Users/<USER>/.bun/bin/bun

# 2. 一個 repo（obsidian）——telegram-dispatcher 已併入 obsidian repo，
#    打包機只需要 clone/pull 這一個 repo，不再需要獨立的 telegram-dispatcher repo
ls -d /Users/<USER>/aladdin/obsidian/mcps
ls -d /Users/<USER>/aladdin/obsidian/telegram-dispatcher

# 3. ngrok（對外 tunnel 用，需 3.x）
ngrok version

# 4. node_modules（每個 server 目錄各自需要）
cd /Users/<USER>/aladdin/obsidian/mcps/aladdin-admin && bun install
cd ../aladdin-platform && bun install
cd /Users/<USER>/aladdin/obsidian/telegram-dispatcher && bun install
mkdir -p /Users/<USER>/aladdin/obsidian/telegram-dispatcher/logs   # 不進 git，換機器要手動補
```

> **`jq` 已不再是前置條件**：啟動腳本原本用它從 `.mcp.json` 讀後台網址，現在網址由
> plist 的 `EnvironmentVariables` 提供，四支 `run-server*.sh` 都不再讀任何設定檔
> （`telegram-dispatcher` 的兩支腳本本來就沒用 jq）。

> **注意**：啟動腳本裡的 `/Users/user/...`、`/Users/user/.bun/bin/bun` 都是**寫死的
> 絕對路徑**。換使用者名稱必須先改 `launchd/run-server*.sh` 與 `launchd/*.plist`，
> 否則服務起不來。

---

## 2. 兩份要設定的東西：後台網址（在 plist 裡）與 Bearer 名冊（不進 git）

### 2.1 後台網址：確認 plist 的 `EnvironmentVariables`

**新機器「不需要」`/Users/<USER>/aladdin/.mcp.json`。** 啟動腳本唯一必需的設定值就是
後台網址，它由各服務**自己的 plist** 提供，四支 `run-server*.sh` 不再讀任何設定檔。
（唯一還會用到根目錄 `.mcp.json` 的情境是：工程師自己想在這台機器上用 **stdio 模式**
跑 MCP。那是個人開發需求，與 hosted 服務無關，範本見 `root-mcp.json.example`。）

新機器上要做的只是**確認 plist 裡的網址是這台機器要服務的環境**：

| plist（repo 正本） | 變數 | 現值 |
|---|---|---|
| `aladdin-admin/launchd/com.aladdin.mcp-admin-server.plist` | `ALADDIN_ADMIN_API_URL` | `https://admin.alddev.com`（dev） |
| `aladdin-admin/launchd/com.aladdin.mcp-admin-pre-server.plist` | `ALADDIN_ADMIN_API_URL` | `https://abu-admin.ald777.com`（pre／cqa） |
| `aladdin-admin/launchd/com.aladdin.mcp-admin-evi-server.plist` | `ALADDIN_ADMIN_API_URL` | `https://admin.godev2.com`（evi） |
| `aladdin-platform/launchd/com.aladdin.mcp-platform-server.plist` | `ALADDIN_PLATFORM_API_URL` | `https://pk-platform.alddev.com`（dev × PK） |

```bash
M=/Users/<USER>/aladdin/obsidian/mcps
plutil -extract EnvironmentVariables json -o - "$M/aladdin-admin/launchd/com.aladdin.mcp-admin-server.plist"
```

> **改 plist 之後不能只用 `kickstart`**——這是實測踩過的坑（2026-08-20）：
> `launchctl kickstart -k` 只重啟行程、**不會重新讀取 plist**，環境變數仍是舊的，
> 服務會帶著空的 `ALADDIN_ADMIN_API_URL` 啟動然後 fail-loud 退出。
>
> 正確流程是 **cp → bootout → bootstrap**：
> ```bash
> cp "$M/aladdin-admin/launchd/com.aladdin.mcp-admin-server.plist" ~/Library/LaunchAgents/
> launchctl bootout   gui/$(id -u)/com.aladdin.mcp-admin-server
> launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.aladdin.mcp-admin-server.plist
> ```
> **bootout 與 bootstrap 之間要留一點時間**：卸載尚未完成就 bootstrap 會得到
> `Bootstrap failed: 5: Input/output error`。遇到就再執行一次 bootstrap 即可。
>
> 對照：**只改了程式碼（`src/*.ts`）**時用 `kickstart -k` 就夠，不必 bootout。
> 判準是「有沒有動到 plist 內容」。
>
> 網址沒設或設成空字串時，服務會 fail-loud 退出（exit 1），err log 直接指名要去看哪一份 plist。

### 2.2 各 server 的 `tokens.json`（Bearer 名冊，不進 git）

> **重點**：名冊是**環境專屬**的，新機器當成全新環境建立即可。
> 不需要、也不建議從舊機器搬——搬過來反而會讓兩台機器共用同一批憑證。

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
| `ERROR: 環境變數 ALADDIN_ADMIN_API_URL 未設定或為空` | §2.1：`~/Library/LaunchAgents/` 那份 plist 的 `EnvironmentVariables` 沒有這個 key（常見於改了 repo 正本卻忘記重新 `cp`） |
| `名冊載入失敗，已進入拒絕所有請求狀態` | §2.2 的 tokens.json 不存在或格式錯 |
| 行程反覆重啟（`runs` 快速增加） | `KeepAlive=true` + 啟動即崩潰；看 err log 找真因 |
| port 被佔用 | `lsof -nP -i :8789` 找出佔用者 |

---

## 4. 部署 telegram-dispatcher 與對外 tunnel

**這一節不能跳過**：兩個 MCP server 只綁 `127.0.0.1`，沒有 dispatcher 就沒有任何
對外入口，企劃會完全連不上（見 §0 的架構圖）。

dispatcher 有自己的兩個 launchd job，都在 `/Users/<USER>/aladdin/obsidian/telegram-dispatcher/launchd/`：

| plist | 做什麼 |
|---|---|
| `com.aladdin.tg-dispatch-server.plist` | 跑 webhook server 與 MCP proxy（:8787） |
| `com.aladdin.tg-dispatch-tunnel.plist` | 跑 `ngrok http 8787 --url <domain> --inspect=false` |

### 4.1 前置：ngrok 與 authtoken

```bash
ngrok version          # 需要 3.x（現行腳本依 3.23.3 的語法撰寫）
ls -l ~/Library/Application\ Support/ngrok/ngrok.yml
```

> **authtoken 存在全域 `ngrok.yml`，不在 repo 裡**，換機器必須重新設定一次：
> ```bash
> ngrok config add-authtoken <你的 authtoken>
> ```
> 另外**保留的 domain 綁在 ngrok 帳號上**。新機器用同一個帳號才能用同一個 domain；
> 若要換 domain，見下方 §4.4。

### 4.2 dispatcher 自己的環境設定

`run-server.sh` 讀的其實是**根目錄的 `/Users/<USER>/aladdin/.env`**（不是
`telegram-dispatcher/.env`），裡面要有 Telegram bot token 等既有設定。**如果新機器
不需要 Telegram bot 功能、只要 MCP proxy**，仍然要讓 dispatcher 起得來；請先讀
`obsidian/telegram-dispatcher/README.md` 確認哪些 key 是必要的，缺少時 server 會在
啟動時報錯。

### 4.3 部署與啟動

```bash
T=/Users/<USER>/aladdin/obsidian/telegram-dispatcher
cp "$T/launchd/com.aladdin.tg-dispatch-server.plist" ~/Library/LaunchAgents/
cp "$T/launchd/com.aladdin.tg-dispatch-tunnel.plist" ~/Library/LaunchAgents/
plutil -lint ~/Library/LaunchAgents/com.aladdin.tg-dispatch-*.plist

launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.aladdin.tg-dispatch-server.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.aladdin.tg-dispatch-tunnel.plist

# 等 server 就緒（同 §3.3 的輪詢寫法）
for i in $(seq 1 90); do
  d=$(curl -sS -o /dev/null -m 2 -w '%{http_code}' http://127.0.0.1:8787/health 2>/dev/null || echo 000)
  [ "$d" = "200" ] && { echo "dispatcher 就緒（第 $i 次）"; break; }
  [ "$i" = "90" ] && echo "未就緒: $d"
done

# 確認 tunnel 真的連上（ngrok 本機 API）
curl -sS http://127.0.0.1:4040/api/tunnels | python3 -c \
  "import sys,json;[print(t['public_url'],'->',t['config']['addr']) for t in json.load(sys.stdin).get('tunnels',[])]"
```

**四個 job 都跑起來後應該長這樣**：

```bash
launchctl list | grep -i aladdin
# com.aladdin.mcp-admin-server
# com.aladdin.mcp-platform-server
# com.aladdin.tg-dispatch-server
# com.aladdin.tg-dispatch-tunnel
```

### 4.4 換 domain 時要改的地方

**ngrok domain 是寫死的**，出現在三個位置，改一個漏兩個服務就會壞：

```
obsidian/telegram-dispatcher/launchd/run-tunnel.sh:37   （TUNNEL_URL 常數）
mcps/aladdin-ai-assistant-kit/.claude/settings.json （allow 規則，逐字比對，改錯會讓企劃每次都跳權限確認）
mcps/aladdin-ai-assistant-kit/.mcp.json            （企劃連線的 URL）
```

改完 `run-tunnel.sh` 要 `launchctl kickstart -k gui/$(id -u)/com.aladdin.tg-dispatch-tunnel`。
**已發出去的 kit 全部要重發**（裡面的 URL 變了）。

> **Telegram bot 的 webhook 也綁在 domain 上**。如果新機器要繼續提供 bot 功能，
> 換 domain 後必須重新 `setWebhook`，否則 Telegram 會繼續往舊 domain 送。
> 做法見 `obsidian/telegram-dispatcher/README.md`。

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
