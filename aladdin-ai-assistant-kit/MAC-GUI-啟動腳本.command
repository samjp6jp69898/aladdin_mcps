#!/bin/bash
# 開始使用-Mac-圖形介面.command — 給企劃雙擊執行的啟動器（macOS，開啟 Claude
# 桌面應用程式本身，不開終端機）。
#
# 跟「開始使用-Mac.command」的差異：那支是給習慣終端機的人用的，雙擊後會
# 開一個終端機視窗、在裡面跑命令列版 claude。這支是給完全不想碰終端機的人
# 用的——雙擊後只做設定檢查，然後直接打開 Claude 這個應用程式本身（圖形
# 介面），檢查完就結束，不會佔用一個終端機視窗。
#
# 已查證（2026-08-20）：Claude 桌面應用程式沒有提供任何命令列參數或
# URL scheme 可以指定「開啟後自動選定某個資料夾」，開啟後你仍然要自己在
# app 裡點「選擇資料夾」——這是官方目前的限制，不是這支腳本沒做好。
# 這支腳本能幫的，就是先確認好設定沒有問題、打開 app、並把資料夾路徑準備好
# 讓你直接貼上，省去自己找路徑的麻煩。
#
# 首次使用前，工程師（或企劃自己）要在終端機對這個檔案執行一次：
#   chmod +x "開始使用-Mac-圖形介面.command"
# （make-starter-kit.ts 產生 kit 時已經自動設好這個權限，正常情況下你不需要
# 自己做這一步；只有在你自己重新複製這個檔案之類的情況權限才可能被重設。）
#
# 成功打開 Claude 之後自動關閉這個終端機視窗：macOS 的 Terminal.app 預設
# 不會因為腳本執行完就自動關視窗（要留給使用者看輸出），這裡改用 AppleScript
# 主動關掉——用「這個腳本自己所在的 tty」精確比對要關的視窗/分頁，不是抓
# 「最前面那個視窗」（使用者可能同時開好幾個 Terminal 視窗，抓錯會關掉別人
# 正在用的東西）。真的失敗（例如使用者把 .command 的預設開啟程式改成別的
# 終端機模擬器，不是 Terminal.app）就安靜放棄，視窗留著讓使用者自己關，
# 不影響其他功能——這不是關鍵路徑，失敗要優雅降級，不能讓整支腳本因此報錯。
close_this_terminal_window() {
    local my_tty
    my_tty="$(tty 2>/dev/null)"
    # tty 指令在沒有控制終端機時是印出字面字串「not a tty」（不是空字串）
    # 並回傳非 0——只檢查空字串接不住這種情況，改成確認開頭真的是
    # /dev/ 這種裝置路徑格式，才是真的拿到一個 tty。
    case "$my_tty" in
        /dev/*) ;;
        *) return ;;
    esac
    # 用 & 丟到背景後立刻讓這支腳本自己結束（成功路徑最後一行就是呼叫這個
    # function，之後沒有其他指令了）：等 osascript 真的執行到「關閉視窗」
    # 那一刻，這個 shell 已經跑完、不再是「有行程還在跑」的狀態，Terminal
    # 才不會跳出「這個視窗還有工作在執行，確定要關閉嗎」的確認對話框
    # （那個對話框會讓「自動關閉」變成還是要使用者手動點一下，等於沒做到）。
    osascript >/dev/null 2>&1 <<EOF &
tell application "Terminal"
    repeat with w in windows
        repeat with t in tabs of w
            if tty of t is "$my_tty" then
                close w
            end if
        end repeat
    end repeat
end tell
EOF
}

# 切換到這支腳本所在的資料夾——雙擊執行時的工作目錄是使用者家目錄，
# 不是 kit 目錄。
cd "$(dirname "$0")" || exit 1
KIT_PATH="$(pwd)"

echo ""
echo "  ┌─────────────────────────────────────────┐"
echo "  │   Aladdin AI 助理 — 準備中                │"
echo "  └─────────────────────────────────────────┘"
echo ""

# ── 檢查 1：Node.js 是否已安裝 ─────────────────────────────────
# login／upload-image 這兩個 skill 內部都是用 node 執行實際的登入／上傳
# 邏輯（理由見 .claude/skills/login/login.sh 檔頭）。原本假設「Claude Code
# 本身依賴 Node.js，所以 node 一定存在」，但 2026-08-21 實測發現不少企劃
# 電腦上沒有另外裝 Node.js——這裡提早攔下來，壞在使用者看得懂中文的地方，
# 而不是壞在對話裡說「幫我登入」時噴一句英文的 command not found。
if ! command -v node > /dev/null 2>&1; then
    echo "  ❌ 找不到 Node.js"
    echo ""
    echo "  這份 kit 的登入與上傳圖片功能需要 Node.js 才能執行。"
    echo ""
    echo "  請到 https://nodejs.org 下載安裝「LTS」版本，安裝檔一路下一步"
    echo "  到底即可，不需要額外設定。"
    echo ""
    echo "  安裝完成後，請重新雙擊這個檔案。"
    echo ""
    echo "  按 Enter 關閉這個視窗。"
    read -r _
    exit 1
fi

# ── 檢查 2：.env 是否已建立並填寫 ───────────────────────────────
if [ ! -f .env ]; then
    echo "  ⚠️  還沒有設定你的帳號密碼"
    echo ""
    echo "  請照這兩步做，然後再雙擊一次這個檔案："
    echo ""
    echo "    1. 把這個資料夾裡的 .env.example 複製一份，改名成 .env"
    echo "    2. 用文字編輯器打開 .env，填入你登入後台的帳號密碼"
    echo ""
    echo "  （.env.example 檔案裡有詳細說明，包含要填哪幾組。）"
    echo ""
    echo "  按 Enter 關閉這個視窗。"
    read -r _
    exit 1
fi

if ! grep -qE '^[A-Z0-9_]+_(USER|PASSWORD)=.+' .env 2>/dev/null; then
    echo "  ⚠️  .env 檔案裡的帳號密碼還是空的"
    echo ""
    echo "  請打開 .env，把你被授權的那幾組欄位填上值再試一次。"
    echo "  （欄位很多是正常的，只要填你實際會用到的那幾組，其他留空。）"
    echo ""
    echo "  按 Enter 關閉這個視窗。"
    read -r _
    exit 1
fi

# ── 檢查 3：.mcp.json 是否存在 ─────────────────────────────────
if [ ! -f .mcp.json ]; then
    echo "  ❌ 這份工具包不完整（缺少 .mcp.json）"
    echo ""
    echo "  請聯絡工程師重新提供一份完整的工具包。"
    echo ""
    echo "  按 Enter 關閉這個視窗。"
    read -r _
    exit 1
fi

# ── 檢查 4：檔案權限（憑證檔不該被其他使用者讀到）──────────────
for f in .env .mcp.json; do
    perm="$(stat -f '%Lp' "$f" 2>/dev/null)"
    if [ -n "$perm" ] && [ "$perm" != "600" ]; then
        chmod 600 "$f" 2>/dev/null && \
          echo "  🔒 已把 $f 的權限收緊成只有你能讀取"
    fi
done

# ── 開啟 Claude 桌面應用程式本身 ────────────────────────────────
# open -a "Claude" 靠 macOS Launch Services 用應用程式名稱找 app，不需要
# 知道它裝在 /Applications/ 還是 ~/Applications/ 底下的確切路徑。
if ! open -a "Claude" 2>/dev/null; then
    echo "  ❌ 找不到 Claude 桌面應用程式"
    echo ""
    echo "  可能還沒安裝。請到 https://claude.com/download 下載安裝，"
    echo "  裝好後再雙擊一次這個檔案。"
    echo ""
    echo "  （如果你確定已經裝了但還是看到這行，也可以直接從 Launchpad"
    echo "  或應用程式資料夾手動打開 Claude，不一定要靠這支腳本。）"
    echo ""
    echo "  按 Enter 關閉這個視窗。"
    read -r _
    exit 1
fi

# 順手把路徑複製到剪貼簿，等一下在 Claude 視窗裡「選擇資料夾」可以直接貼上
# （macOS 內建 pbcopy，不需要額外安裝任何東西）。
echo -n "$KIT_PATH" | pbcopy 2>/dev/null

echo "  ✅ 已開啟 Claude，資料夾路徑已複製到剪貼簿，到「選擇資料夾」直接貼上即可。"
close_this_terminal_window
