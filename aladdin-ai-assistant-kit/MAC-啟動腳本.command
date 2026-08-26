#!/bin/bash
# 開始使用-Mac.command — 給企劃雙擊執行的啟動器（macOS）
#
# 為什麼是 .command 而不是 .sh：macOS 的 Finder 只有 .command 副檔名會在
# 雙擊時用 Terminal 執行；.sh 預設是用文字編輯器打開。企劃不需要開 Terminal
# 自己打指令，這正是這支腳本存在的理由。
#
# 首次使用前，工程師（或企劃自己）要在終端機對這個檔案執行一次：
#   chmod +x "開始使用-Mac.command"
# 否則 Finder 會說「沒有執行權限」。這一步無法由腳本自己完成（雞生蛋問題），
# 已寫進 README 的安裝步驟。

# ╔══════════════════════════════════════════════════════════╗
# ║  如果這支腳本說「找不到 Claude」，在這裡填你電腦上的實際位置    ║
# ╚══════════════════════════════════════════════════════════╝
#
# 大部分人不需要改這裡——腳本會自動去找常見的安裝位置。
# 只有在你把 Claude 裝到非預設位置、而腳本又找不到時，才需要動它。
#
# 怎麼查自己的位置：打開「終端機」貼上這行按 Enter
#     which claude
# 把印出來的那一整行路徑，填進下面的引號中間，例如：
#     CLAUDE_PATH="/Users/你的名字/.local/bin/claude"
#
CLAUDE_PATH=""

# 切換到這支腳本所在的資料夾——雙擊執行時的工作目錄是使用者家目錄，
# 不是 kit 目錄，不切過去的話 Claude 會讀不到 .mcp.json 與 .claude/。
cd "$(dirname "$0")" || exit 1

echo ""
echo "  ┌─────────────────────────────────────────┐"
echo "  │   Aladdin AI 助理 — 啟動中                │"
echo "  └─────────────────────────────────────────┘"
echo ""

# ── 檢查 1：Node.js 是否已安裝 ─────────────────────────────
# login／upload-image 這兩個 skill 內部都是用 node 執行實際的登入／上傳
# 邏輯（理由見 .claude/skills/aladdin-mcp-login/login.sh 檔頭）。原本假設「Claude Code
# 本身依賴 Node.js，所以 node 一定存在」，但 2026-08-21 實測發現不少企劃
# 電腦上沒有另外裝 Node.js——這裡提早攔下來，壞在使用者看得懂中文的地方，
# 而不是壞在對話裡說「幫我登入」時噴一句英文的 command not found。
if ! command -v node > /dev/null 2>&1; then
    echo "  ❌ 找不到 Node.js"
    echo ""
    echo "  這份 kit 的登入與上傳圖片功能需要 Node.js 才能執行。"
    echo ""
    open "https://nodejs.org" 2>/dev/null
    echo "  已經幫你用瀏覽器打開 Node.js 官網，請下載安裝「LTS」版本，"
    echo "  安裝檔一路下一步到底即可，不需要額外設定。"
    echo "  （如果瀏覽器沒有打開，自己前往 https://nodejs.org 也可以。）"
    echo ""
    echo "  安裝完成後，請重新雙擊這個檔案。"
    echo ""
    echo "  按 Enter 關閉這個視窗。"
    read -r _
    exit 1
fi

# ── 檢查 2：Git 是否已安裝 ─────────────────────────────────
# 偵測用 command -v 而不是直接執行 git：command -v 只查 PATH、沒有任何副作
# 用；確認真的沒裝之後，才主動執行 xcode-select --install 幫使用者跳出
# macOS 官方的 Command Line Tools 圖形化安裝視窗（裡面就含 git），使用者
# 照著點「安裝」即可，不用自己開終端機打指令。這個指令是非同步的——跳出
# 視窗後立刻返回、不會卡住腳本；若 CLT 其實已裝過，它只會往 stderr 印一行
# 「已安裝」，導掉即可，exit code 不用管。
if ! command -v git > /dev/null 2>&1; then
    echo "  ❌ 找不到 Git"
    echo ""
    echo "  Claude 執行這份 kit 的功能需要 Git 才能正常運作。"
    echo ""
    xcode-select --install 2>/dev/null
    echo "  已經幫你跳出 macOS 官方的安裝視窗（Command Line Tools，裡面"
    echo "  就含 git），照視窗指示點「安裝」、等它跑完即可。"
    echo "  （如果沒有看到安裝視窗，到 https://git-scm.com 下載安裝也可以。）"
    echo ""
    echo "  安裝完成後，請重新雙擊這個檔案。"
    echo ""
    echo "  按 Enter 關閉這個視窗。"
    read -r _
    exit 1
fi

# ── 檢查 3：找出 Claude 在這台電腦上的位置 ───────────────────
# 順序：使用者在檔案開頭填的路徑 → PATH 裡的 claude → 幾個常見安裝位置。
# 每台電腦的安裝位置可能不同（官方安裝、Homebrew、手動放置各有去處），
# 所以不寫死單一路徑。
CLAUDE_BIN=""

if [ -n "$CLAUDE_PATH" ]; then
    if [ -x "$CLAUDE_PATH" ]; then
        CLAUDE_BIN="$CLAUDE_PATH"
    else
        echo "  ⚠️  你在檔案開頭填的 Claude 路徑不存在或不能執行："
        echo "      ${CLAUDE_PATH}"
        echo ""
        echo "  請在終端機執行 which claude 查出正確路徑，再填一次。"
        echo ""
        echo "  按 Enter 關閉這個視窗。"
        read -r _
        exit 1
    fi
elif command -v claude > /dev/null 2>&1; then
    CLAUDE_BIN="$(command -v claude)"
else
    for candidate in \
        "$HOME/.local/bin/claude" \
        "$HOME/.claude/local/claude" \
        "/opt/homebrew/bin/claude" \
        "/usr/local/bin/claude"
    do
        if [ -x "$candidate" ]; then
            CLAUDE_BIN="$candidate"
            break
        fi
    done
fi

if [ -z "$CLAUDE_BIN" ]; then
    echo "  ❌ 找不到 Claude"
    echo ""
    echo "  可能是還沒安裝，或裝在這支腳本沒找過的位置。"
    echo ""
    echo "  【如果你還沒安裝】安裝方式見這個資料夾裡的 README.md。"
    echo ""
    echo "  【如果你已經裝好了】請照這兩步告訴這支腳本它在哪："
    echo "     1. 打開「終端機」，貼上這行按 Enter：  which claude"
    echo "     2. 把印出來的路徑，填進這個檔案開頭的 CLAUDE_PATH=\"\" 引號中間"
    echo ""
    echo "  （用文字編輯器打開「開始使用-Mac.command」就能看到那一行，"
    echo "    它在檔案最上方、有一個框起來的說明。）"
    echo ""
    echo "  按 Enter 關閉這個視窗。"
    read -r _
    exit 1
fi

# ── 檢查 4：.env 是否已建立並填寫 ───────────────────────────
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

# 檢查 .env 是否至少有一組非空的帳密（只看有沒有值，不讀取內容）
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

# ── 檢查 5：.mcp.json 是否存在 ─────────────────────────────
if [ ! -f .mcp.json ]; then
    echo "  ❌ 這份工具包不完整（缺少 .mcp.json）"
    echo ""
    echo "  請聯絡工程師重新提供一份完整的工具包。"
    echo ""
    echo "  按 Enter 關閉這個視窗。"
    read -r _
    exit 1
fi

# ── 檢查 6：檔案權限（憑證檔不該被其他使用者讀到）──────────────
for f in .env .mcp.json; do
    perm="$(stat -f '%Lp' "$f" 2>/dev/null)"
    if [ -n "$perm" ] && [ "$perm" != "600" ]; then
        chmod 600 "$f" 2>/dev/null && \
          echo "  🔒 已把 $f 的權限收緊成只有你能讀取"
    fi
done

echo "  ✅ 設定檢查通過，正在開啟 Claude…"
echo ""
echo "  ─────────────────────────────────────────"
echo "  開始後可以直接用中文說話，例如："
echo ""
echo "      幫我登入"
echo "      列出目前有哪些遊戲場館"
echo ""
echo "  結束時輸入 /exit 或直接關閉視窗。"
echo "  ─────────────────────────────────────────"
echo ""

exec "$CLAUDE_BIN"
