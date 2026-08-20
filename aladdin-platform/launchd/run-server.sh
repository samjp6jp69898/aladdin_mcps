#!/bin/zsh
# launchd wrapper：啟動 aladdin-platform hosted MCP server（bun run src/http.ts）。
#
# H13 寫好、手動驗證能起能停；H15 已 launchctl bootstrap 常駐上線，並經
# telegram-dispatcher proxy 對外開放。這支腳本現在是常駐服務的實際進入點——
# 改完程式碼要 `launchctl kickstart -k gui/$(id -u)/com.aladdin.mcp-platform-server`
# 讓 launchd 重啟；手動再跑一次本腳本會撞 EADDRINUSE（port 8790 已被常駐行程佔用），
# 且不會讓 launchd 底下那個行程跑到新碼。
#
# 後台網址來源：**plist 的 EnvironmentVariables**（同目錄
# com.aladdin.mcp-platform-server.plist，launchd 實際讀的是 ~/Library/LaunchAgents/
# 底下那份拷貝）。本腳本不再讀任何設定檔。
#
# 原本（H13）是用 jq 從根目錄 .mcp.json 現讀，理由是「不另開一份會漂移的第二份
# 拷貝」。**不要改回去**：.mcp.json 的 mcpServers 區塊是給工程師在自己機器上跑
# stdio 模式用的，常駐服務的存活不該綁在它身上——有人順手清掉那個 key，服務會
# 在「下次重啟時」才死、當下毫無徵兆（2026-08-20 改名時真的踩過）。而且部署到
# 新機器時，這會逼對方準備一份打包機根本用不到、卻含帳密的檔案。plist 只放網
# 址，不放帳密（理由見下方註解）。
set -u
ALADDIN="/Users/user/aladdin"
SERVER_DIR="$ALADDIN/obsidian/mcps/aladdin-platform"
BUN="/Users/user/.bun/bin/bun"

# 監聽 port 明講掉，不依賴 http.ts 自己的預設值（8790）——理由同
# telegram-dispatcher/launchd/run-server.sh 對 PORT 的註解：兩處各自隱含同一個
# 預設值，未來任一邊改動容易悄悄漂移。
export ALADDIN_PLATFORM_HTTP_PORT=8790

# 刻意不匯出 ALADDIN_PLATFORM_USER / ALADDIN_PLATFORM_PASSWORD：理由同
# aladdin-admin/launchd/run-server.sh 的對應註解（hosted 登入流程屬 H5/H6/H7
# 範圍，尚未定案；本 task 只驗證服務起得來、/health 通）。

if [ -z "${ALADDIN_PLATFORM_API_URL:-}" ]; then
  echo "ERROR: 環境變數 ALADDIN_PLATFORM_API_URL 未設定或為空。請檢查 plist 的 EnvironmentVariables 是否有 ALADDIN_PLATFORM_API_URL：正本在 $SERVER_DIR/launchd/com.aladdin.mcp-platform-server.plist，但 launchd 讀的是 ~/Library/LaunchAgents/com.aladdin.mcp-platform-server.plist——改完正本要重新 cp 過去，然後 bootout + bootstrap（只用 kickstart 不會重讀 plist）。" >&2
  exit 1
fi

# out/err log 輪替：稽核 log（audit.jsonl，見 ../src/audit_log.ts）已有 10MB
# 輪替，但 plist 的 StandardOutPath/StandardErrorPath 完全沒有。搭配
# KeepAlive=true，若服務啟動即崩潰會進入重啟迴圈（launchd 有 10 秒 throttle
# 但會持續嘗試），每次重啟都會重新執行本腳本、寫一份新的堆疊——磁碟緊張時
# 有機會把磁碟灌爆，連帶拖垮同機的 tg-dispatch 正式服務。選在這裡（每次
# launchd 呼叫本腳本、即每次重啟時）檢查並輪替，剛好搭上「唯有反覆重啟才
# 真的會把磁碟寫爆」這個具體風險場景，不需要 newsyslog（寫 /etc/newsyslog.d/
# 需要 sudo）、也不需要新增外部依賴。
#
# 用 copy+truncate 而不是 mv：launchd 在 spawn 本行程「之前」就已經用路徑
# 重導向開好 StandardOutPath/StandardErrorPath 的 fd 了（本腳本自己的 stdout/
# stderr 此刻就已經綁在那個 fd 上）——這與 audit_log.ts 檔頭解釋的原理相同：
# fd 綁定的是 inode 不是路徑，若改用 mv 把檔案搬走，之後任何寫入（含本腳本
# 剩餘的輸出、之後 exec 進來的 bun）仍會落在被搬走的舊檔上，原路徑上再也
# 不會有新內容——實際上完全沒有輪替到。copy+truncate 保留原 inode（只清空
# 內容），既有 fd 的後續 write() 才會正確從空檔案繼續寫。只留一份歷史
# （`.1`，覆蓋更早的 `.1`），比照 audit_log.ts 的既有輪替慣例。
LOG_DIR="$SERVER_DIR/logs"
LOG_MAX_BYTES=$((10 * 1024 * 1024)) # 10MB，比照 audit_log.ts 的既有輪替門檻
for LOG_FILE in "$LOG_DIR/launchd-server.out.log" "$LOG_DIR/launchd-server.err.log"; do
  if [ -f "$LOG_FILE" ]; then
    SIZE=$(stat -f%z "$LOG_FILE" 2>/dev/null || echo 0)
    if [ "$SIZE" -gt "$LOG_MAX_BYTES" ]; then
      cp -f "$LOG_FILE" "$LOG_FILE.1" && : > "$LOG_FILE"
    fi
  fi
done

cd "$SERVER_DIR" || exit 1

# 最後一行用 exec（不是背景 &）：讓 bun 直接取代這個 shell 行程本身，
# launchd 送 SIGTERM 時才會真的殺到 bun，不會只殺掉外層 shell 留孤兒行程。
exec "$BUN" run src/http.ts
