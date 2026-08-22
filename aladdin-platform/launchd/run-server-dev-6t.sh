#!/bin/zsh
# launchd wrapper：啟動 aladdin-platform hosted MCP server 的 dev×6T 實例
# （bun run src/http.ts，port 8793，獨立 tokens.dev-6t.json 名冊）。
#
# 比照 aladdin-admin/launchd/run-server-pre.sh 的骨架，同一份 src/http.ts
# 程式碼、只換 env 值——plan.md D13「日後只需新增一組設定值就能上線，不改
# 程式碼」在 platform 端的落實。dev×PK（run-server.sh，port 8790）是既有現役
# 部署，本檔不動它，只新增這個平行的 6T 產品實例。
#
# 後台網址來源：**plist 的 EnvironmentVariables**（同目錄
# com.aladdin.mcp-platform-dev-6t-server.plist，launchd 實際讀的是
# ~/Library/LaunchAgents/ 底下那份拷貝）。本腳本不讀任何設定檔。
set -u
ALADDIN="/Users/user/aladdin"
SERVER_DIR="$ALADDIN/obsidian/mcps/aladdin-platform"
BUN="/Users/user/.bun/bin/bun"

# 監聽 port：dev-6t=8793（避開 toolsmith 8788 / admin-dev 8789 /
# platform-dev-pk 8790 / admin-pre 8791 / admin-evi 8792），明講掉不依賴
# http.ts 的預設值，理由同既有 run-server*.sh。
export ALADDIN_PLATFORM_HTTP_PORT=8793

# 獨立 tokens 名冊：不與 dev×PK 的 tokens.json 共用，一個人被授權 dev×PK 不該
# 自動獲得 dev×6T 存取權（比照 admin pre/evi 的隔離慣例）。http.ts 的
# ALADDIN_PLATFORM_TOKENS_PATH override 機制已支援，本檔不需改動任何程式碼。
export ALADDIN_PLATFORM_TOKENS_PATH="$SERVER_DIR/tokens.dev-6t.json"

# 獨立稽核 log 檔，不與 dev×PK 的 logs/audit.jsonl 共用——不同環境/產品的
# 操作混在同一個檔案會讓稽核追查搞不清楚是哪一份實例的行為。
export ALADDIN_PLATFORM_AUDIT_LOG_PATH="$SERVER_DIR/logs/audit.dev-6t.jsonl"

# 刻意不匯出 ALADDIN_PLATFORM_USER / ALADDIN_PLATFORM_PASSWORD：hosted 模式
# 一律走 per-token 登入態 + POST /login，不在常駐行程環境裡預先塞測試帳密。

if [ -z "${ALADDIN_PLATFORM_API_URL:-}" ]; then
  echo "ERROR: 環境變數 ALADDIN_PLATFORM_API_URL 未設定或為空。請檢查 plist 的 EnvironmentVariables 是否有 ALADDIN_PLATFORM_API_URL：正本在 $SERVER_DIR/launchd/com.aladdin.mcp-platform-dev-6t-server.plist，但 launchd 讀的是 ~/Library/LaunchAgents/com.aladdin.mcp-platform-dev-6t-server.plist——改完正本要重新 cp 過去，然後 bootout + bootstrap（只用 kickstart 不會重讀 plist）。" >&2
  exit 1
fi

# out/err log 輪替：比照 run-server.sh 的既有慣例（10MB 門檻、copy+truncate
# 保留 fd 綁定的 inode）。
LOG_DIR="$SERVER_DIR/logs"
LOG_MAX_BYTES=$((10 * 1024 * 1024))
for LOG_FILE in "$LOG_DIR/launchd-dev-6t-server.out.log" "$LOG_DIR/launchd-dev-6t-server.err.log"; do
  if [ -f "$LOG_FILE" ]; then
    SIZE=$(stat -f%z "$LOG_FILE" 2>/dev/null || echo 0)
    if [ "$SIZE" -gt "$LOG_MAX_BYTES" ]; then
      cp -f "$LOG_FILE" "$LOG_FILE.1" && : > "$LOG_FILE"
    fi
  fi
done

cd "$SERVER_DIR" || exit 1

# 最後一行用 exec：讓 bun 取代這個 shell 行程本身，launchd 送 SIGTERM 時才會
# 真的殺到 bun，不會留孤兒行程。
exec "$BUN" run src/http.ts
