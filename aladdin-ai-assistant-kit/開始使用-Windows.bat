@echo off
chcp 65001 > nul
setlocal enabledelayedexpansion
REM 開始使用-Windows.bat — 給企劃雙擊執行的啟動器（Windows）
REM
REM chcp 65001 是必要的：Windows 命令提示字元預設用 Big5(950)，直接輸出
REM UTF-8 中文會變亂碼。切成 UTF-8 代碼頁後中文才顯示得出來。
REM
REM 這支腳本刻意不用 PowerShell(.ps1)：Windows 預設的執行原則會擋下未簽署
REM 的 .ps1，企劃雙擊只會看到一段紅字錯誤。.bat 沒有這個限制。

cd /d "%~dp0"

echo.
echo   +-----------------------------------------+
echo   ^|   Aladdin AI 助理 — 啟動中                ^|
echo   +-----------------------------------------+
echo.

REM ── 檢查 1：Claude Code 是否已安裝 ──────────────────────────
where claude > nul 2>&1
if errorlevel 1 (
    echo   [X] 找不到 Claude Code
    echo.
    echo   請先安裝 Claude Code，安裝方式見這個資料夾裡的 README.md。
    echo   如果你已經安裝過但仍看到這個訊息，請聯絡工程師。
    echo.
    pause
    exit /b 1
)

REM ── 檢查 2：.env 是否已建立 ────────────────────────────────
if not exist ".env" (
    echo   [!] 還沒有設定你的帳號密碼
    echo.
    echo   請照這兩步做，然後再雙擊一次這個檔案：
    echo.
    echo     1. 把這個資料夾裡的 .env.example 複製一份，改名成 .env
    echo     2. 用記事本打開 .env，填入你登入後台的帳號密碼
    echo.
    echo   （.env.example 檔案裡有詳細說明，包含要填哪幾組。）
    echo.
    echo   注意：用記事本存檔時，如果下方有「編碼」選項請選 UTF-8。
    echo.
    pause
    exit /b 1
)

REM 檢查 .env 是否至少有一組非空的帳密（findstr 正規表示式，只看有沒有值）
findstr /R /C:"^[A-Z0-9_]*_USER=..*" /C:"^[A-Z0-9_]*_PASSWORD=..*" ".env" > nul 2>&1
if errorlevel 1 (
    echo   [!] .env 檔案裡的帳號密碼還是空的
    echo.
    echo   請打開 .env，把你被授權的那幾組欄位填上值再試一次。
    echo   （欄位很多是正常的，只要填你實際會用到的那幾組，其他留空。）
    echo.
    pause
    exit /b 1
)

REM ── 檢查 3：.mcp.json 是否存在 ─────────────────────────────
if not exist ".mcp.json" (
    echo   [X] 這份工具包不完整（缺少 .mcp.json）
    echo.
    echo   請聯絡工程師重新提供一份完整的工具包。
    echo.
    pause
    exit /b 1
)

echo   [OK] 設定檢查通過，正在開啟 Claude…
echo.
echo   -----------------------------------------
echo   開始後可以直接用中文說話，例如：
echo.
echo       幫我登入
echo       列出目前有哪些遊戲場館
echo.
echo   結束時輸入 /exit 或直接關閉視窗。
echo   -----------------------------------------
echo.

claude

REM Claude 結束後不要立刻關視窗，讓企劃看得到最後的訊息或錯誤
echo.
pause
