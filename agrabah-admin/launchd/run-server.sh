#!/bin/zsh
# launchd wrapper：啟動 agrabah-admin hosted MCP server（bun run src/http.ts）。
#
# H13 寫好、手動驗證能起能停；H15 已 launchctl bootstrap 常駐上線，並經
# telegram-dispatcher proxy 對外開放。這支腳本現在是常駐服務的實際進入點——
# 改完程式碼要 `launchctl kickstart -k gui/$(id -u)/com.aladdin.agrabah-admin-server`
# 讓 launchd 重啟；手動再跑一次本腳本會撞 EADDRINUSE（port 8789 已被常駐行程佔用），
# 且不會讓 launchd 底下那個行程跑到新碼。
#
# 環境變數來源：**不是** /Users/user/aladdin/.env（AGRABAH_* 系列目前不在那
# 裡）。README.md（../README.md:32-42）明文記載這幾個變數的唯一來源是根目錄
# .mcp.json 的 agrabah-admin server env（stdio 模式沿用至今），所以這裡改用
# jq 從 .mcp.json 現讀，不另外在 .env 開一份會漂移的第二份拷貝。
# 比照 telegram-dispatcher/launchd/run-server.sh 的手法：不用 dotenv、不自己
# 解析整份設定檔、值不印出來。
set -u
ALADDIN="/Users/user/aladdin"
MCP_JSON="$ALADDIN/.mcp.json"
SERVER_DIR="$ALADDIN/obsidian/mcps/agrabah-admin"
BUN="/Users/user/.bun/bin/bun"
JQ="/opt/homebrew/bin/jq"

AGRABAH_ADMIN_API_URL=$("$JQ" -r '.mcpServers["agrabah-admin"].env.AGRABAH_ADMIN_API_URL // empty' "$MCP_JSON")
export AGRABAH_ADMIN_API_URL

# 監聽 port 明講掉，不依賴 http.ts 自己的預設值（8789）——理由同
# telegram-dispatcher/launchd/run-server.sh 對 PORT 的註解：兩處各自隱含同一個
# 預設值，未來任一邊改動容易悄悄漂移。
export AGRABAH_ADMIN_HTTP_PORT=8789

# 刻意不匯出 AGRABAH_ADMIN_USER / AGRABAH_ADMIN_PASSWORD：hosted 模式的登入
# 流程（per-token 登入態、POST /login）屬於 H5/H6/H7 的範圍，尚未定案；本
# task 只驗證服務起得來、/health 通，不需要也不該提前把測試帳密塞進這支常駐
# 行程的環境（減少之後真的對外曝露時的憑證暴露面）。要測登入相關 tool 仍走
# stdio 模式（.mcp.json 已有完整帳密設定）。

if [ -z "$AGRABAH_ADMIN_API_URL" ]; then
  echo "ERROR: 無法從 $MCP_JSON 讀取 mcpServers.agrabah-admin.env.AGRABAH_ADMIN_API_URL" >&2
  exit 1
fi

cd "$SERVER_DIR" || exit 1

# 最後一行用 exec（不是背景 &）：讓 bun 直接取代這個 shell 行程本身，
# launchd 送 SIGTERM 時才會真的殺到 bun，不會只殺掉外層 shell 留孤兒行程。
exec "$BUN" run src/http.ts
