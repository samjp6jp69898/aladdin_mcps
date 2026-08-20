#!/bin/zsh
# launchd wrapper：啟動 aladdin-toolsmith http server（bun run src/http.ts）。
# 比照 telegram-dispatcher/launchd/run-server.sh 的手法：用 grep '^KEY=' 從
# 根目錄 .env 逐一匯出，不用 dotenv、不自己解析整份 .env、token 不出現在
# 這支腳本或 plist 明文裡。
#
# H22：只負責把這支腳本寫好並手動驗證能起服務/能停，不執行 launchctl
# bootstrap（正式常駐是未來 task 的範圍，屬需與使用者確認的曝露動作）。
set -u
ALADDIN="/Users/user/aladdin"
ENV_FILE="$ALADDIN/.env"
TOOLSMITH_DIR="$ALADDIN/obsidian/mcps/aladdin-toolsmith"
BUN="/Users/user/.bun/bin/bun"

TOOLSMITH_API_TOKEN=$(grep '^TOOLSMITH_API_TOKEN=' "$ENV_FILE" | cut -d= -f2- | tr -d '\r\n')
export TOOLSMITH_API_TOKEN
# 跟 http.ts 的預設值保持同一個明確值，不依賴它自己的 fallback（8788）——
# 明講掉，避免未來任一邊改動悄悄漂移。
export TOOLSMITH_HTTP_PORT=8788

if [ -z "$TOOLSMITH_API_TOKEN" ]; then
  echo "ERROR: 無法從 $ENV_FILE 讀取 TOOLSMITH_API_TOKEN" >&2
  exit 1
fi

cd "$TOOLSMITH_DIR" || exit 1

# 最後一行用 exec（不是背景 &）：讓 bun 直接取代這個 shell 行程本身，
# launchd 送 SIGTERM 時才會真的殺到 bun，不會只殺掉外層 shell 留孤兒行程。
exec "$BUN" run src/http.ts
