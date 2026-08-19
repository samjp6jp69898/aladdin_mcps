#!/bin/zsh
# launchd wrapper：啟動 agrabah-platform hosted MCP server（bun run src/http.ts）。
#
# H13：只負責把這支腳本寫好、手動驗證能起能停，不執行 launchctl bootstrap，
# 不讓服務真的常駐上線（見 tasks.json H13 acceptance_criteria；正式常駐與
# 對外曝露是後續高風險 task 的範圍，需與使用者確認）。
#
# 環境變數來源：**不是** /Users/user/aladdin/.env（AGRABAH_* 系列目前不在那
# 裡）。README.md（../README.md:44-50）明文記載這幾個變數的唯一來源是根目錄
# .mcp.json 的 agrabah-platform server env（stdio 模式沿用至今），所以這裡
# 改用 jq 從 .mcp.json 現讀，不另外在 .env 開一份會漂移的第二份拷貝。
# 比照 telegram-dispatcher/launchd/run-server.sh 的手法：不用 dotenv、不自己
# 解析整份設定檔、值不印出來。
set -u
ALADDIN="/Users/user/aladdin"
MCP_JSON="$ALADDIN/.mcp.json"
SERVER_DIR="$ALADDIN/obsidian/mcps/agrabah-platform"
BUN="/Users/user/.bun/bin/bun"
JQ="/opt/homebrew/bin/jq"

AGRABAH_PLATFORM_API_URL=$("$JQ" -r '.mcpServers["agrabah-platform"].env.AGRABAH_PLATFORM_API_URL // empty' "$MCP_JSON")
export AGRABAH_PLATFORM_API_URL

# 監聽 port 明講掉，不依賴 http.ts 自己的預設值（8790）——理由同
# telegram-dispatcher/launchd/run-server.sh 對 PORT 的註解：兩處各自隱含同一個
# 預設值，未來任一邊改動容易悄悄漂移。
export AGRABAH_PLATFORM_HTTP_PORT=8790

# 刻意不匯出 AGRABAH_PLATFORM_USER / AGRABAH_PLATFORM_PASSWORD：理由同
# agrabah-admin/launchd/run-server.sh 的對應註解（hosted 登入流程屬 H5/H6/H7
# 範圍，尚未定案；本 task 只驗證服務起得來、/health 通）。

if [ -z "$AGRABAH_PLATFORM_API_URL" ]; then
  echo "ERROR: 無法從 $MCP_JSON 讀取 mcpServers.agrabah-platform.env.AGRABAH_PLATFORM_API_URL" >&2
  exit 1
fi

cd "$SERVER_DIR" || exit 1

# 最後一行用 exec（不是背景 &）：讓 bun 直接取代這個 shell 行程本身，
# launchd 送 SIGTERM 時才會真的殺到 bun，不會只殺掉外層 shell 留孤兒行程。
exec "$BUN" run src/http.ts
