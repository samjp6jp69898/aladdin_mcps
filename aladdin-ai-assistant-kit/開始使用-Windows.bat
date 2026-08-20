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

REM ╔══════════════════════════════════════════════════════════╗
REM ║  如果這支腳本說「找不到 Claude」，在這裡填你電腦上的實際位置    ║
REM ╚══════════════════════════════════════════════════════════╝
REM
REM 大部分人不需要改這裡——腳本會自動去找常見的安裝位置。
REM 只有在你把 Claude 裝到非預設位置、而腳本又找不到時，才需要動它。
REM
REM 怎麼查自己的位置：按 Win+R 打 cmd 按 Enter，貼上這行按 Enter
REM     where claude
REM 把印出來的那一整行路徑，填進下面等號後面（不要加引號），例如：
REM     set "CLAUDE_PATH=C:\Users\你的名字\AppData\Local\Programs\claude\claude.exe"
REM
set "CLAUDE_PATH="

cd /d "%~dp0"

echo.
echo   +-----------------------------------------+
echo   ^|   Aladdin AI 助理 — 啟動中                ^|
echo   +-----------------------------------------+
echo.

REM ── 檢查 1：找出 Claude 在這台電腦上的位置 ───────────────────
set "CLAUDE_BIN="

if defined CLAUDE_PATH (
    if exist "%CLAUDE_PATH%" (
        set "CLAUDE_BIN=%CLAUDE_PATH%"
    ) else (
        echo   [!] 你在檔案開頭填的 Claude 路徑不存在：
        echo       %CLAUDE_PATH%
        echo.
        echo   請開 cmd 執行 where claude 查出正確路徑，再填一次。
        echo.
        pause
        exit /b 1
    )
) else (
    for /f "delims=" %%i in ('where claude 2^>nul') do (
        if not defined CLAUDE_BIN set "CLAUDE_BIN=%%i"
    )
)

if not defined CLAUDE_BIN (
    if exist "%LOCALAPPDATA%\Programs\claude\claude.exe" set "CLAUDE_BIN=%LOCALAPPDATA%\Programs\claude\claude.exe"
)

if not defined CLAUDE_BIN (
    echo   [X] 找不到 Claude
    echo.
    echo   可能是還沒安裝，或裝在這支腳本沒找過的位置。
    echo.
    echo   【如果你還沒安裝】安裝方式見這個資料夾裡的 README.md。
    echo.
    echo   【如果你已經裝好了】請照這兩步告訴這支腳本它在哪：
    echo      1. 按 Win+R 打 cmd 按 Enter，貼上這行：  where claude
    echo      2. 把印出來的路徑，填進這個檔案開頭的 set "CLAUDE_PATH=" 等號後面
    echo.
    echo   （用記事本打開「開始使用-Windows.bat」就能看到那一行，
    echo     它在檔案最上方、有一個框起來的說明。）
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

"%CLAUDE_BIN%"

REM Claude 結束後不要立刻關視窗，讓企劃看得到最後的訊息或錯誤
echo.
pause
