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

REM ── 檢查 1：Node.js 是否已安裝 ─────────────────────────────
REM login／upload-image 這兩個 skill 內部都是用 node 執行實際的登入／上傳
REM 邏輯（理由見 .claude\skills\login\login.sh 檔頭）。原本假設「Claude Code
REM 本身依賴 Node.js，所以 node 一定存在」，但 2026-08-21 實測發現不少企劃
REM 電腦上沒有另外裝 Node.js——這裡提早攔下來，壞在使用者看得懂中文的地方，
REM 而不是壞在對話裡說「幫我登入」時噴一句英文的 command not found。
REM where 只看 Windows 側的 PATH：WSL 裡裝過的 node/git 這裡看不到，而那
REM 正是要的行為——Claude Code 在 Windows 上走 Git Bash，不會用 WSL 裡的
REM 版本；文案裡有跟使用者講清楚，避免被誤會成腳本壞掉。
where node >nul 2>&1
if errorlevel 1 (
    echo   [X] 找不到 Node.js
    echo.
    echo   這份 kit 的登入與上傳圖片功能需要 Node.js 才能執行。
    echo.
    echo   已經幫你用瀏覽器打開 Node.js 官網，請下載安裝「LTS」版本，
    echo   安裝檔一路下一步到底即可，不需要額外設定。
    echo   （如果瀏覽器沒有打開，自己前往 https://nodejs.org 也可以。）
    echo.
    echo   如果你是在 WSL（Windows Subsystem for Linux）裡面裝的 Node.js，
    echo   這裡偵測不到是正常的——請直接在 Windows 本身（不是 WSL 裡面）
    echo   再裝一份：Claude Code 在 Windows 上是透過 Git Bash 執行指令，
    echo   不會用到 WSL 裡的版本。
    echo.
    echo   安裝完成後，請重新雙擊這個檔案。
    echo.
    start "" "https://nodejs.org"
    pause
    exit /b 1
)

REM ── 檢查 2：Git 是否已安裝 ─────────────────────────────
REM Claude 在 Windows 上執行指令一律透過 Git Bash（Git for Windows 的一部
REM 分，README「Windows 使用者注意」一節有講），沒裝的話登入／上傳這些
REM 功能都動不了——跟 Node.js 一樣提早攔下來，壞在使用者看得懂中文的地方。
where git >nul 2>&1
if errorlevel 1 (
    echo   [X] 找不到 Git
    echo.
    echo   Claude 在 Windows 上執行指令要靠 Git Bash，它是 Git for Windows
    echo   的一部分，沒裝的話這份 kit 沒辦法正常運作。
    echo.
    echo   已經幫你用瀏覽器打開 Git for Windows 下載頁，安裝檔一路下一步
    echo   到底即可，不需要額外設定。
    echo   （如果瀏覽器沒有打開，自己前往 https://git-scm.com/download/win 也可以。）
    echo.
    echo   如果你是在 WSL（Windows Subsystem for Linux）裡面裝的 Git，
    echo   這裡偵測不到是正常的——請直接在 Windows 本身（不是 WSL 裡面）
    echo   再裝一份：Claude Code 在 Windows 上是透過 Git Bash 執行指令，
    echo   不會用到 WSL 裡的版本。
    echo.
    echo   安裝完成後，請重新雙擊這個檔案。
    echo.
    start "" "https://git-scm.com/download/win"
    pause
    exit /b 1
)

REM ── 檢查 3：.env 是否已建立 ────────────────────────────────
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

REM ── 檢查 4：.mcp.json 是否存在 ─────────────────────────────
if not exist ".mcp.json" (
    echo   [X] 這份工具包不完整（缺少 .mcp.json）
    echo.
    echo   請聯絡工程師重新提供一份完整的工具包。
    echo.
    pause
    exit /b 1
)

REM ── 找 Claude 桌面應用程式（GUI 版，不是 CLI）─────────────────
REM 官方文件沒有明確寫出 Windows 版桌面應用程式的安裝路徑，而且
REM %LOCALAPPDATA%\Microsoft\WindowsApps\ 這個資料夾同時是 Store app 跟
REM 許多 CLI 工具（含 Claude Code CLI）用 App Execution Alias 註冊執行
REM 檔的地方——Windows 檔名不分大小寫，光看「有沒有一個叫 Claude.exe 的
REM 檔案」分不出找到的究竟是桌面版還是 CLI（2026-08-26 已證實：舊版腳本
REM 只看路徑存在與否，實際抓到的是 CLI）。
REM
REM 改用 PE 檔頭的 Subsystem 欄位判斷：GUI 執行檔是 2
REM （IMAGE_SUBSYSTEM_WINDOWS_GUI），CLI／主控台程式是 3
REM （IMAGE_SUBSYSTEM_WINDOWS_CUI）。這個欄位在 PE32 與 PE32+（32/64 位元）
REM 都位在「Optional Header 起始位置 + 68 bytes」，Optional Header 起始
REM 位置又是「PE 簽章位置（存在檔案 offset 0x3C）+ 24 bytes」，兩者相加
REM 等於 PE 簽章位置 + 92 bytes——不管檔名或路徑是什麼，這樣才能確定抓到
REM 的真的是圖形介面程式。
set "SUBSYS_PS1=%TEMP%\aladdin-gui-subsystem-check.ps1"
(
    echo param^([string]$Path^)
    echo try {
    echo     $bytes = [IO.File]::ReadAllBytes^($Path^)
    echo     $peOffset = [BitConverter]::ToInt32^($bytes, 60^)
    echo     [BitConverter]::ToInt16^($bytes, $peOffset + 92^)
    echo } catch { -1 }
) > "%SUBSYS_PS1%"

REM 候選清單：先掃 PATH 上所有叫 Claude.exe 的檔案（涵蓋 WindowsApps 這種
REM alias 位置），再補上幾個常見的桌面版安裝猜測路徑當備援。每個候選都
REM 用上面的 PE 檢查，只認 Subsystem=2；是 CLI（3）就跳過、繼續找下一個。
set "GUI_APP="
set "FOUND_CLI_ONLY="

for /f "delims=" %%F in ('where Claude.exe 2^>nul') do call :CheckGuiCandidate "%%~F"
if not defined GUI_APP if exist "%LOCALAPPDATA%\Programs\Claude\Claude.exe" call :CheckGuiCandidate "%LOCALAPPDATA%\Programs\Claude\Claude.exe"
if not defined GUI_APP if exist "%PROGRAMFILES%\Claude\Claude.exe" call :CheckGuiCandidate "%PROGRAMFILES%\Claude\Claude.exe"

del "%SUBSYS_PS1%" >nul 2>&1

REM 把路徑複製到剪貼簿，等一下在 Claude 視窗裡「選擇資料夾」可以直接貼上
REM （clip 是 Windows 內建指令，不需要額外安裝）。
<nul set /p "=%KIT_PATH%" | clip

if defined GUI_APP (
    start "" "%GUI_APP%"
    echo   [OK] 已開啟 Claude，資料夾路徑已複製到剪貼簿，到「選擇資料夾」直接貼上即可。
) else if defined FOUND_CLI_ONLY (
    echo   [!] 只找到 Claude 的命令列（CLI）版本，沒找到桌面圖形介面版本
    echo.
    echo   這台電腦上偵測到的 Claude 是指令列工具，不是桌面應用程式。
    echo   如果你要的其實是指令列版本，請改用「Windows-啟動腳本.bat」
    echo   （不是這支 GUI 版）。
    echo.
    echo   如果你要的是桌面應用程式，請自己從「開始」選單搜尋「Claude」
    echo   並點開它，資料夾路徑已複製到剪貼簿，到「選擇資料夾」直接貼上即可
    echo   （如果還沒安裝，到 https://claude.com/download 下載安裝）。
    echo.
    pause
) else (
    echo   [!] 沒能自動找到 Claude 桌面應用程式的安裝位置
    echo.
    echo   請自己從「開始」選單搜尋「Claude」並點開它，資料夾路徑已複製到剪貼簿，
    echo   到「選擇資料夾」直接貼上即可
    echo   （如果還沒安裝，到 https://claude.com/download 下載安裝）。
    echo.
    pause
)

goto :eof

:CheckGuiCandidate
if defined GUI_APP goto :eof
set "CANDIDATE=%~1"
set "SUBSYS="
for /f %%S in ('powershell -NoProfile -ExecutionPolicy Bypass -File "%SUBSYS_PS1%" -Path "%CANDIDATE%" 2^>nul') do set "SUBSYS=%%S"
if "%SUBSYS%"=="2" (
    set "GUI_APP=%CANDIDATE%"
) else if "%SUBSYS%"=="3" (
    set "FOUND_CLI_ONLY=1"
)
goto :eof
