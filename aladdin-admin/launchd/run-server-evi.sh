#!/bin/zsh
# launchd wrapper：啟動 aladdin-admin hosted MCP server 的 evi 實例
# （bun run src/http.ts，port 8792，獨立 tokens.evi.json 名冊）。
#
# H35：比照 H13 的 run-server.sh 骨架，同一份 src/http.ts 程式碼、只換 env
# 值——這就是 plan.md D13「日後只需新增一組設定值就能上線，不改程式碼」的
# 落實方式。只負責把這支腳本寫好、手動驗證能起能停，不執行 launchctl
# bootstrap（見 tasks.json H35 acceptance_criteria）。
#
# API URL：evi 後台網址（https://admin.godev2.com）由 tasks.json H35 明文
# 給定，/Users/user/aladdin/.env 目前沒有對應的 EVI_ADMIN_URL 變數（只有
# EVI_ADMIN_USER/PASS），故此處直接寫定字面值——不是偷懶跳過「現讀 .env」
# 慣例，是該變數確實不存在，寫死一個目前唯一已知的網址不構成之後新增
# uat/prod 時要改程式碼（那兩個環境會各自比照這支腳本再複製一份，見 D13）。
set -u
ALADDIN="/Users/user/aladdin"
SERVER_DIR="$ALADDIN/obsidian/mcps/aladdin-admin"
BUN="/Users/user/.bun/bin/bun"

export ALADDIN_ADMIN_API_URL="https://admin.godev2.com"

# 監聽 port：evi=8792（避開 toolsmith 8788 / admin-dev 8789 / platform-dev
# 8790 / pre 8791），明講掉不依賴 http.ts 的預設值，理由同 dev 版 run-server.sh。
export ALADDIN_ADMIN_HTTP_PORT=8792

# 獨立 tokens 名冊：不與 dev 的 tokens.json 共用，一個人被授權 dev 不該自動
# 獲得 evi 存取權（見 tasks.json H35 描述）。http.ts 的 ALADDIN_ADMIN_TOKENS_PATH
# override 機制自 H1/H3 起已支援，本檔不需改動任何程式碼。
export ALADDIN_ADMIN_TOKENS_PATH="$SERVER_DIR/tokens.evi.json"

# H32：獨立稽核 log 檔，不與 dev 的 logs/audit.jsonl 共用——三個環境的操作
# 混在同一個檔案會讓稽核追查搞不清楚是哪個環境的行為。audit_log.ts 的
# ALADDIN_ADMIN_AUDIT_LOG_PATH override 機制與 TOKENS_PATH 同一種慣例。
export ALADDIN_ADMIN_AUDIT_LOG_PATH="$SERVER_DIR/logs/audit.evi.jsonl"

# 刻意不匯出 ALADDIN_ADMIN_USER / ALADDIN_ADMIN_PASSWORD：理由同 dev 版
# run-server.sh——hosted 模式一律走 per-token 登入態 + POST /login，不在常駐
# 行程環境裡預先塞測試帳密。

cd "$SERVER_DIR" || exit 1

# 最後一行用 exec：讓 bun 取代這個 shell 行程本身，launchd 送 SIGTERM 時才會
# 真的殺到 bun，不會留孤兒行程（同 dev 版 run-server.sh 的理由）。
exec "$BUN" run src/http.ts
