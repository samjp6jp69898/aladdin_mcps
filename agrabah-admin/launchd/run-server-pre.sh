#!/bin/zsh
# launchd wrapper：啟動 agrabah-admin hosted MCP server 的 pre(cqa) 實例
# （bun run src/http.ts，port 8791，獨立 tokens.pre.json 名冊）。
#
# H35：比照 H13 的 run-server.sh 骨架，同一份 src/http.ts 程式碼、只換 env
# 值——這就是 plan.md D13「日後只需新增一組設定值就能上線，不改程式碼」的
# 落實方式。只負責把這支腳本寫好、手動驗證能起能停，不執行 launchctl
# bootstrap（見 tasks.json H35 acceptance_criteria）。
#
# API URL 來源：/Users/user/aladdin/.env 的 CQA_ADMIN_URL（現讀，不寫死、
# 不另開一份會漂移的拷貝），比照 dev 版 run-server.sh 從 .mcp.json 現讀的
# 手法。pre 環境即企劃口中的 cqa（https://abu-admin.ald777.com），共用 CQA
# 測試站，非本 repo 專屬環境，本腳本不落地任何帳密。
set -u
ALADDIN="/Users/user/aladdin"
ENV_FILE="$ALADDIN/.env"
SERVER_DIR="$ALADDIN/obsidian/mcps/agrabah-admin"
BUN="/Users/user/.bun/bin/bun"

AGRABAH_ADMIN_API_URL=$(grep '^CQA_ADMIN_URL=' "$ENV_FILE" | head -1 | cut -d= -f2-)
export AGRABAH_ADMIN_API_URL

# 監聽 port：pre=8791（避開 toolsmith 8788 / admin-dev 8789 / platform-dev
# 8790），明講掉不依賴 http.ts 的預設值，理由同 dev 版 run-server.sh。
export AGRABAH_ADMIN_HTTP_PORT=8791

# 獨立 tokens 名冊：不與 dev 的 tokens.json 共用，一個人被授權 dev 不該自動
# 獲得 pre 存取權（見 tasks.json H35 描述）。http.ts 的 AGRABAH_ADMIN_TOKENS_PATH
# override 機制自 H1/H3 起已支援，本檔不需改動任何程式碼。
export AGRABAH_ADMIN_TOKENS_PATH="$SERVER_DIR/tokens.pre.json"

# H32：獨立稽核 log 檔，不與 dev 的 logs/audit.jsonl 共用——三個環境的操作
# 混在同一個檔案會讓稽核追查搞不清楚是哪個環境的行為。audit_log.ts 的
# AGRABAH_ADMIN_AUDIT_LOG_PATH override 機制與 TOKENS_PATH 同一種慣例。
export AGRABAH_ADMIN_AUDIT_LOG_PATH="$SERVER_DIR/logs/audit.pre.jsonl"

# 刻意不匯出 AGRABAH_ADMIN_USER / AGRABAH_ADMIN_PASSWORD：理由同 dev 版
# run-server.sh——hosted 模式一律走 per-token 登入態 + POST /login，不在常駐
# 行程環境裡預先塞測試帳密。

if [ -z "$AGRABAH_ADMIN_API_URL" ]; then
  echo "ERROR: 無法從 $ENV_FILE 讀取 CQA_ADMIN_URL" >&2
  exit 1
fi

cd "$SERVER_DIR" || exit 1

# 最後一行用 exec：讓 bun 取代這個 shell 行程本身，launchd 送 SIGTERM 時才會
#真的殺到 bun，不會留孤兒行程（同 dev 版 run-server.sh 的理由）。
exec "$BUN" run src/http.ts
