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

# 切換到這支腳本所在的資料夾——雙擊執行時的工作目錄是使用者家目錄，
# 不是 kit 目錄，不切過去的話 Claude 會讀不到 .mcp.json 與 .claude/。
cd "$(dirname "$0")" || exit 1

echo ""
echo "  ┌─────────────────────────────────────────┐"
echo "  │   Aladdin AI 助理 — 啟動中                │"
echo "  └─────────────────────────────────────────┘"
echo ""

# ── 檢查 1：Claude Code 是否已安裝 ──────────────────────────
if ! command -v claude > /dev/null 2>&1; then
    echo "  ❌ 找不到 Claude Code"
    echo ""
    echo "  請先安裝 Claude Code，安裝方式見這個資料夾裡的 README.md。"
    echo "  如果你已經安裝過但仍看到這個訊息，請聯絡工程師。"
    echo ""
    echo "  按 Enter 關閉這個視窗。"
    read -r _
    exit 1
fi

# ── 檢查 2：.env 是否已建立並填寫 ───────────────────────────
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

# ── 檢查 3：.mcp.json 是否存在 ─────────────────────────────
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

exec claude
