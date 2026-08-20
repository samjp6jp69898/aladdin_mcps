@echo off
chcp 65001 > nul
setlocal enabledelayedexpansion
REM 開始使用-Windows-圖形介面.bat — 給企劃雙擊執行的啟動器（Windows，開啟
REM Claude 桌面應用程式本身，不開 cmd 視窗跑 CLI）。
REM
REM 跟「開始使用-Windows.bat」的差異：那支是給習慣終端機的人用的，雙擊後
REM 會在 cmd 視窗裡跑命令列版 claude。這支是給完全不想碰終端機的人用的——
REM 雙擊後只做設定檢查，然後嘗試直接打開 Claude 這個應用程式本身（圖形
REM 介面），檢查完就結束。
REM
REM 已查證（2026-08-20）：Claude 桌面應用程式沒有提供任何命令列參數或
REM 協定可以指定「開啟後自動選定某個資料夾」，開啟後你仍然要自己在 app 裡
REM 點「選擇資料夾」——這是官方目前的限制。另外，Windows 版桌面應用程式的
REM 確切安裝路徑沒有查到官方文件明確寫出來（跟 macOS 的 /Applications/
REM 不一樣，Windows 沒有唯一慣例位置），下面會嘗試幾個常見的可能位置，
REM 都找不到的話會請你自己從「開始」選單打開，不會假裝成功。

cd /d "%~dp0"
set "KIT_PATH=%CD%"

echo.
echo   +-----------------------------------------+
echo   ^|   Aladdin AI 助理 — 準備中                ^|
echo   +-----------------------------------------+
echo.

REM ── 檢查 1：.env 是否已建立 ────────────────────────────────
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

REM ── 檢查 2：.mcp.json 是否存在 ─────────────────────────────
if not exist ".mcp.json" (
    echo   [X] 這份工具包不完整（缺少 .mcp.json）
    echo.
    echo   請聯絡工程師重新提供一份完整的工具包。
    echo.
    pause
    exit /b 1
)

REM ── 找 Claude 桌面應用程式（GUI 版，不是 CLI）─────────────────
REM 依序嘗試幾個可能的位置；官方文件沒有明確寫出 Windows 版桌面應用程式的
REM 安裝路徑，這裡列的是常見 Electron app 安裝慣例，不保證每台電腦都對。
set "GUI_APP="
if exist "%LOCALAPPDATA%\Microsoft\WindowsApps\Claude.exe" set "GUI_APP=%LOCALAPPDATA%\Microsoft\WindowsApps\Claude.exe"
if not defined GUI_APP if exist "%LOCALAPPDATA%\Programs\Claude\Claude.exe" set "GUI_APP=%LOCALAPPDATA%\Programs\Claude\Claude.exe"
if not defined GUI_APP if exist "%PROGRAMFILES%\Claude\Claude.exe" set "GUI_APP=%PROGRAMFILES%\Claude\Claude.exe"

REM 把路徑複製到剪貼簿，等一下在 Claude 視窗裡「選擇資料夾」可以直接貼上
REM （clip 是 Windows 內建指令，不需要額外安裝）。
<nul set /p "=%KIT_PATH%" | clip

if defined GUI_APP (
    start "" "%GUI_APP%"
    echo   [OK] 設定檢查通過，Claude 正在啟動…
) else (
    echo   [!] 沒能自動找到 Claude 桌面應用程式的安裝位置
    echo.
    echo   請自己從「開始」選單搜尋「Claude」並點開它
    echo   （如果還沒安裝，到 https://claude.com/download 下載安裝）。
)

echo.
echo   -----------------------------------------
echo   接下來請在 Claude 視窗裡：
echo.
echo     1. 切到「Code」功能
echo     2. 點「選擇資料夾」
echo     3. 貼上這個路徑（已經幫你複製到剪貼簿，直接 Ctrl+V）：
echo.
echo        %KIT_PATH%
echo.
echo   選好資料夾之後，直接用中文說話即可，例如：
echo.
echo       幫我登入
echo       列出目前有哪些遊戲場館
echo.
echo   這個視窗接下來不需要了，可以直接關閉。
echo   -----------------------------------------
echo.
pause
