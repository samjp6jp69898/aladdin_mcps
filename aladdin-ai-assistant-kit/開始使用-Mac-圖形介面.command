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

# 切換到這支腳本所在的資料夾——雙擊執行時的工作目錄是使用者家目錄，
# 不是 kit 目錄。
cd "$(dirname "$0")" || exit 1
KIT_PATH="$(pwd)"

echo ""
echo "  ┌─────────────────────────────────────────┐"
echo "  │   Aladdin AI 助理 — 準備中                │"
echo "  └─────────────────────────────────────────┘"
echo ""

# ── 檢查 1：.env 是否已建立並填寫 ───────────────────────────────
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

# ── 檢查 2：.mcp.json 是否存在 ─────────────────────────────────
if [ ! -f .mcp.json ]; then
    echo "  ❌ 這份工具包不完整（缺少 .mcp.json）"
    echo ""
    echo "  請聯絡工程師重新提供一份完整的工具包。"
    echo ""
    echo "  按 Enter 關閉這個視窗。"
    read -r _
    exit 1
fi

# ── 檢查 3：檔案權限（憑證檔不該被其他使用者讀到）──────────────
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

echo "  ✅ 設定檢查通過，Claude 正在啟動…"
echo ""
echo "  ─────────────────────────────────────────"
echo "  接下來請在 Claude 視窗裡："
echo ""
echo "    1. 切到「Code」功能"
echo "    2. 點「選擇資料夾」"
echo "    3. 貼上這個路徑（已經幫你複製到剪貼簿，直接 Cmd+V）："
echo ""
echo "       $KIT_PATH"
echo ""
echo "  選好資料夾之後，直接用中文說話即可，例如："
echo ""
echo "      幫我登入"
echo "      列出目前有哪些遊戲場館"
echo ""
echo "  這個視窗接下來不需要了，可以直接關閉（不用按 Enter，直接關掉這個視窗即可）。"
echo "  ─────────────────────────────────────────"
echo ""
