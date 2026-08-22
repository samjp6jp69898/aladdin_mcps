#!/usr/bin/env bash
# upload.sh — H18：agrabah 上傳圖片 skill 本體（plan.md D5／§4.3／§4.5，H8 的
# POST /files 端點契約）。
#
# 硬性契約（見 ../../settings.json 的 _securityNote、H16 留下的契約提醒、
# 這個目錄下 SKILL.md）：Claude 呼叫這支腳本時，Bash 指令字串必須永遠逐字
# 等於
#   bash .claude/skills/upload-image/upload.sh
# 不吃任何命令列參數（zero-args；理由同 login.sh 檔頭——這份 kit 的 Bash
# allowlist 只能安全放行「指令內容從頭到尾固定不變」的呼叫，見
# ../../settings.json 的 _securityNote）。
#
# 兩個動態值（要上傳到哪個環境、本機圖片檔案路徑）無法塞進 zero-args 的
# 指令列，所以比照 login.sh 處理 TOTP 驗證碼的手法：Claude 呼叫這支腳本前，
# 先用 **Write 工具**把這兩個值分別寫進本目錄下兩個固定檔名的暫存檔：
#   .upload-env.tmp       — 純文字，只放 .mcp.json 裡的 server 別名
#                            （例如 aladdin-admin-dev），不含其他內容
#   .upload-filepath.tmp  — 純文字，只放本機圖片檔案的路徑，不含其他內容
# 本腳本一啟動就讀取＋立刻刪除這兩個檔案（單次使用，不留存，跟 login.sh 的
# .totp-code.tmp 同一種生命週期設計）。
#
# 為什麼「上傳到哪個環境」不能像 login.sh 那樣自動掃過 .mcp.json 全部環境
# 各打一輪：login 打的是「同一組帳密登入」，天然可以廣播；上傳圖片打的是
# 「這張圖要換到哪一款遊戲」，fileId 綁定「上傳當下用的那把 Bearer token
# 對應的 identity」（見 files.ts resolveFileIdForIdentity），如果自動廣播到
# 好幾個環境，使用者事後很難判斷該把哪一個環境回傳的 fileId 交給
# aladdin_admin_game_vendor_admin_create_or_update_game_vendor_game——而且這支 tool 呼叫的又是「使用者當下正在操作
# 的那個環境」的 MCP tool，兩者對不上就會白跑。因此上傳圖片刻意設計成
# 「一次操作、一個目標環境」，環境由呼叫端（Claude／使用者）明確指定，不用
# login.sh 那種「不需要你告訴它」的廣播設計。
#
# 憑證安全（比照 login.sh 已驗證過的手法，重新列一次差異點）：
#   - Bearer token 從 .mcp.json 讀取，skill 內不另存第二份 token 來源——
#     輪替 token 時只要改 .mcp.json 一個地方。**解析方式改用 node 的
#     JSON.parse（不是 jq）**：任務原始規格三次明講「用 jq」，但實測與
#     WebSearch 查證後確認 Git for Windows 標準安裝不保證內建 jq（MSYS2
#     官方 issue tracker、多篇技術文章、甚至 claude-code 官方 repo 都有真實
#     踩坑案例），這牴觸 plan.md D7「單一跨平台 kit、Git Bash 下可跑」的
#     前提——若依賴 jq，會讓沒裝 jq 的 Windows 企劃一開箱就對著
#     「jq: command not found」束手無策，而且是靜默失敗、非技術使用者完全
#     無法自行排除。login.sh 早在三輪審查中就用同樣理由選擇 node 而非 jq
#     （見 login.sh 檔頭），這裡改用同一套已驗證安全可靠、不需要額外安裝
#     任何東西的模式，不重新發明。
#   - token 不進 curl 的 argv：跟 login.sh 一樣用 `curl --config -`，
#     URL／header（含 Bearer token）／multipart 表單欄位全部透過 stdin 的
#     設定檔餵給 curl，`ps aux` 只看得到 `curl --config -`。
#   - 全程不使用 -v／--trace／--trace-ascii，也不 echo 組好的 curl/config
#     內容或組好的指令字串。
#   - 任何要印出來的訊息，動筆前都先確認過該變數不可能是憑證/token 片段
#     （401 一律用固定文案，不夾帶任何解析出來的內容——telegram-dispatcher
#     的 proxy 對所有上游 401 一律清空 body，見下面 node 區塊的說明）。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KIT_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
MCP_FILE="${KIT_ROOT}/.mcp.json"
ENV_TMP_FILE="${SCRIPT_DIR}/.upload-env.tmp"
FILEPATH_TMP_FILE="${SCRIPT_DIR}/.upload-filepath.tmp"

# 進入點就先讀取＋刪除兩個暫存檔（單次使用），不管後面是不是真的走得到
# 打 /files 那一步——理由同 login.sh 對 .totp-code.tmp 的處理：不留到下一次
# 執行才被誤用。
UPLOAD_ENV=""
if [ -f "$ENV_TMP_FILE" ]; then
    UPLOAD_ENV="$(cat "$ENV_TMP_FILE")"
    UPLOAD_ENV="${UPLOAD_ENV%$'\r'}"
    rm -f "$ENV_TMP_FILE"
fi
UPLOAD_FILEPATH=""
if [ -f "$FILEPATH_TMP_FILE" ]; then
    UPLOAD_FILEPATH="$(cat "$FILEPATH_TMP_FILE")"
    UPLOAD_FILEPATH="${UPLOAD_FILEPATH%$'\r'}"
    rm -f "$FILEPATH_TMP_FILE"
fi

if [ -z "$UPLOAD_ENV" ] || [ -z "$UPLOAD_FILEPATH" ]; then
    echo "找不到要上傳的環境或檔案路徑。請先用 Write 工具把兩個值分別寫進 ${ENV_TMP_FILE} 與 ${FILEPATH_TMP_FILE}（各檔只放一行純文字），再重新呼叫這支腳本。" >&2
    exit 1
fi

if [ ! -f "$MCP_FILE" ]; then
    echo "找不到 ${MCP_FILE}，這份 kit 不完整，請聯絡工程師重新提供。" >&2
    exit 1
fi

# 2026-08-21 補強：正常情況下企劃是雙擊啟動器進來的，啟動器已經先檢查過
# Node.js；這裡是給「方式二：完全手動、不透過啟動器」直接進 Claude 對話的
# 情況兜底，避免直接摔進下面 `node -` 一行冷冰冰的 command not found。
if ! command -v node > /dev/null 2>&1; then
    echo "找不到 Node.js，上傳圖片功能需要它才能執行。請到 https://nodejs.org 下載安裝「LTS」版本，安裝完成後重新開一個終端機視窗再試一次。" >&2
    exit 1
fi

if [ ! -f "$UPLOAD_FILEPATH" ]; then
    echo "找不到檔案：${UPLOAD_FILEPATH}（請確認路徑正確、檔案存在）。" >&2
    exit 1
fi
if [ ! -s "$UPLOAD_FILEPATH" ]; then
    echo "檔案是空的：${UPLOAD_FILEPATH}。" >&2
    exit 1
fi
# curl 的 -F/--form「name=@path」語法裡，`;` 跟 `,` 是欄位修飾符（type=／
# filename=）的分隔符號，如果本機檔案路徑本身剛好含有這兩個字元，會被誤解析
# 成路徑的一部分被截斷或夾帶錯誤的修飾符，導致上傳失敗或行為不可預期。與其
# 嘗試一套沒有把握在所有 curl 版本／兩個平台都正確的跳脫寫法，直接明確拒絕
# 並請使用者把檔案移到/改名成不含這兩個字元的路徑，比較誠實可靠。
case "$UPLOAD_FILEPATH" in
    *';'*|*','*)
        echo "檔案路徑裡含有 ; 或 , 這兩個字元，可能導致上傳失敗，請先把檔案改名或搬到不含這兩個字元的路徑再試一次：${UPLOAD_FILEPATH}" >&2
        exit 1
        ;;
    *'"'*)
        echo "檔案路徑裡含有雙引號 \" 這個字元，會弄壞上傳指令對檔名的解析，請先把檔案改名或搬到不含雙引號的路徑再試一次：${UPLOAD_FILEPATH}" >&2
        exit 1
        ;;
    *$'\n'*|*$'\r'*)
        echo "檔案路徑裡含有換行字元，請確認 .upload-filepath.tmp 只放一行純文字路徑，不要多貼出換行：${UPLOAD_FILEPATH}" >&2
        exit 1
        ;;
esac

# H18 review B1：正式路徑一律經 tg-dispatcher proxy，proxy 的 body 上限固定
# 1MB，超限時刻意回應「401 空 body」而不是 413（防路徑探測側信道的設計，見
# telegram-dispatcher/server.ts，不會改）。若不在本機先擋，1MB~3MB 的合法
# 圖片（例如遊戲橫幅圖，常態尺寸）會直接撞上這個 401，而下面 node 段落的
# 401 分支原本會把它誤診成「token 失效」，導致企劃跟工程師都被導向錯誤的
# 排查方向。門檻抓 1000000 bytes 而非 1048576，替 multipart boundary/表頭
# 留一點餘裕。
FILE_BYTES="$(wc -c < "$UPLOAD_FILEPATH" | tr -d '[:space:]')"
if [ "$FILE_BYTES" -gt 1000000 ]; then
    echo "圖片太大（${FILE_BYTES} bytes，目前上限約 1MB）。這是大小的問題，不是這張圖本身的問題——換一張圖不會有幫助，請先把圖片壓縮或縮小尺寸再試一次。" >&2
    exit 1
fi

export MCP_FILE UPLOAD_FILEPATH UPLOAD_ENV

# 從 .mcp.json 解析目標環境的 url／Bearer token，到實際組 curl config、呼叫
# curl、判讀回應，全部交給 node 執行——理由同 login.sh：改用 node 而非 jq
# 是因為 jq 在 Git for Windows 不保證內建（見
# 檔頭說明）；用 `node -` 從 stdin 讀腳本本體，token 全部在執行期從
# process.env／解析出的 .mcp.json 內容取得，不會出現在 node 的 argv 裡。
node - <<'NODE_SCRIPT'
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const mcpPath = process.env.MCP_FILE;
const envAlias = process.env.UPLOAD_ENV;
const filePath = process.env.UPLOAD_FILEPATH;

let mcp;
try {
    mcp = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
} catch {
    // 同 login.sh：不印錯誤訊息原文——JSON 解析錯誤訊息常常夾帶出錯位置
    // 附近的原始檔案內容片段，.mcp.json 裡緊鄰的內容可能就是 Bearer token。
    console.error(`無法解析 ${mcpPath}，這份 kit 的設定檔可能已損毀，請聯絡工程師重新提供。`);
    process.exit(1);
}

const servers = (mcp && typeof mcp === 'object' && mcp.mcpServers) || {};
const cfg = servers[envAlias];

if (!cfg) {
    const available = Object.keys(servers).join('、') || '（沒有任何環境）';
    console.error(`找不到環境「${envAlias}」。這份 kit 的 .mcp.json 裡已設定的環境有：${available}。請確認要上傳到哪個環境，環境別名要跟 .mcp.json 裡的 server 別名完全一致。`);
    process.exit(1);
}
if (cfg.type !== 'http' || typeof cfg.url !== 'string') {
    console.error(`環境「${envAlias}」在 .mcp.json 裡的設定格式不對（不是 http 型、或沒有 url），請聯絡工程師確認 .mcp.json。`);
    process.exit(1);
}
if (!cfg.url.endsWith('/mcp')) {
    console.error(`環境「${envAlias}」的 url 不是預期的 .../mcp 格式，無法推導出上傳端點。`);
    process.exit(1);
}

// H17 review 收尾（F8/N2）教訓：不分大小寫比對 scheme，且訊息固定文案、
// 絕不把 scheme 或 token 內容印出來——真實 Bearer token 不含空白，若漏打
// 「Bearer 」前綴，粗心的訊息會把整把 token 原樣印進對話紀錄。
const auth = cfg.headers && cfg.headers.Authorization;
const authTrimmed = typeof auth === 'string' ? auth.trim() : '';
const spaceIdx = authTrimmed.indexOf(' ');
const scheme = spaceIdx >= 0 ? authTrimmed.slice(0, spaceIdx) : authTrimmed;
const tokenPart = spaceIdx >= 0 ? authTrimmed.slice(spaceIdx + 1).trim() : '';
if (!authTrimmed || scheme.toLowerCase() !== 'bearer') {
    console.error(`環境「${envAlias}」在 .mcp.json 裡沒有設定好 Authorization header（應該以 "Bearer " 開頭），請聯絡工程師確認 .mcp.json。`);
    process.exit(1);
}
if (!tokenPart || tokenPart.startsWith('<')) {
    console.error(`環境「${envAlias}」在 .mcp.json 裡的 Bearer token 是空值或還是預留佔位符，請聯絡工程師確認 .mcp.json。`);
    process.exit(1);
}

const filesUrl = cfg.url.slice(0, -'/mcp'.length) + '/files';

// 反斜線與雙引號各自轉義成 \\ 與 \"，並過濾 \r／\n（同 login.sh 的
// escapeForCurlConfig：避免值裡剛好出現這兩種字元弄壞 config 語法，也避免
// 內含換行字元的值被 curl 的 config 解析器當成新的一行設定指令）。
const escapeForCurlConfig = s => String(s)
    .replace(/[\r\n]/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');

const configLines = [
    `url = "${escapeForCurlConfig(filesUrl)}"`,
    `header = "Authorization: Bearer ${escapeForCurlConfig(tokenPart)}"`,
    // 刻意不手動加 Content-Type header：-F/form 語法會讓 curl 自己產生正確
    // 的 multipart/form-data boundary，手動覆蓋反而會弄壞 body 格式。
    // 欄位名固定是 "file"（H8 端點契約唯一認得的欄位名）。
    `form = "file=@${escapeForCurlConfig(filePath)}"`,
    `silent`,
    `show-error`,
    // H17 review 收尾（F6）同款教訓：沒有 timeout 的話一個半死的 ngrok
    // tunnel 會讓這次呼叫無限期掛住，甚至讓 Claude Code Bash tool 自己的
    // 外部 timeout 把整個行程砍掉、完全零輸出。圖片檔案比 JSON 登入 body
    // 大一些，max-time 給比 login.sh 更寬裕的 60 秒。
    `connect-timeout = "10"`,
    `max-time = "60"`,
    `write-out = "\\nHTTPSTATUS:%{http_code}"`,
];
const config = configLines.join('\n') + '\n';

// 全程不加 -v／--trace／--trace-ascii；config 內容只透過子行程 stdin 傳遞，
// curl 收到的 command line 只有 ['--config', '-']，argv 裡沒有任何 token。
const result = spawnSync('curl', ['--config', '-'], { input: config, encoding: 'utf8' });

if (result.error) {
    console.log(`失敗：無法執行 curl（${result.error.message}）`);
    process.exit(1);
}
if (result.status !== 0) {
    // 同 login.sh：不印 result.stderr 原文——config 語法層級錯誤時 curl 有
    // 時會把出錯那一行內容原樣回顯到 stderr，那一行可能就是帶著 token 的
    // header 設定。固定文案 + curl 自己的 exit code 已足夠判斷是否為網路問題。
    console.log(`失敗：連線 agrabah 後台時發生連線層級錯誤（curl exit code ${result.status}，逾時或網路不通時常見）。請確認網路連線後再試一次；如果持續發生，請聯絡工程師。`);
    process.exit(1);
}

const stdout = result.stdout || '';
const marker = stdout.lastIndexOf('HTTPSTATUS:');
const httpBody = marker >= 0 ? stdout.slice(0, marker) : stdout;
const httpStatus = marker >= 0 ? stdout.slice(marker + 'HTTPSTATUS:'.length).trim() : '(未知)';

let json;
try {
    json = JSON.parse(httpBody);
} catch {
    // telegram-dispatcher/server.ts 的既有安全設計：對所有上游 401 一律
    // 正規化成空 body（防路徑探測的均一防線，同 login.sh 的說明），proxy
    // 自己的 429（流量層 rate limit）跟 502（後端未啟動/連線失敗）也都是
    // 純文字 body、不是 JSON，走到這裡都屬於預期內、依 httpStatus 給對應
    // 的明確訊息，不做籠統的「格式不對」。
    if (httpStatus === '401') {
        console.log(`失敗：上傳被拒絕（HTTP 401）。這個狀態碼本身無法區分成因，可能是：` +
            '(0) 圖片實際大小（含 multipart 表單開銷）仍超過約 1MB 的傳輸上限——bash 階段已先做過大小檢查，但這仍是到達這裡最常見的殘餘成因，請試著把圖片壓縮或縮小尺寸再試一次；' +
            '(1) 這份 kit 裡這個環境的 Bearer token 已失效或不在授權名冊裡；' +
            '(2) .mcp.json 裡這個環境的網址前綴設定有誤。請先重跑登入 skill 確認這個環境仍能正常登入；' +
            '如果確定沒問題，請聯絡工程師確認 Bearer token 與 .mcp.json 設定。');
    } else if (httpStatus === '413') {
        // 正式路徑一律經 tg-dispatcher proxy，proxy 對超限一律回 401 空 body
        // （見上面 401 分支），不會產生 413——這個分支在正式路徑上不會被
        // 觸發。保留它是因為 hosted server 自己（aladdin-admin/src/http.ts）
        // 也有一道 bodyLimit 會回 413，只是正式路徑目前一定先卡在 proxy 那
        // 一層；未來若有不經 proxy、直連 hosted server 的路徑，這裡才會用到。
        console.log(`失敗：檔案大小超過上限（HTTP 413）。請換一張更小的圖片再試一次，不要重複嘗試同一張圖。`);
    } else if (httpStatus === '429') {
        console.log(`失敗：請求過於頻繁（HTTP 429），請稍等一分鐘後再試一次。`);
    } else if (httpStatus === '502') {
        console.log(`失敗：後台服務目前無法連線（HTTP 502），請聯絡工程師確認服務狀態。`);
    } else {
        console.log(`失敗：伺服器回應不是預期的格式（HTTP ${httpStatus}），請聯絡工程師。`);
    }
    process.exit(1);
}

if (json && json.success === true && typeof json.fileId === 'string' && json.fileId.length > 0) {
    // fileId 本身不是憑證——H8 的 resolveFileIdForIdentity 消費時仍會驗證
    // 「這把 fileId 是不是同一個 identity（同一把 Bearer token）上傳的」，
    // 光是知道 fileId 字串不足以被其他身分冒用，印出來給 Claude 是安全的。
    // 順帶印出來源檔案路徑（H18 review M3）：讓 Claude／企劃在把這個 fileId
    // 交給 edit_game 之前，有機會發現上傳的其實是殘留在暫存檔裡的上一張圖。
    console.log(`[${envAlias}] 上傳成功，fileId=${json.fileId}（來源：${filePath}）`);
    console.log(`請把這個 fileId 原樣交給需要圖片的 MCP tool（例如 aladdin_admin_game_vendor_admin_create_or_update_game_vendor_game 的 fileId 參數），不要用本機檔案路徑。這個 fileId 只能用在「${envAlias}」這個環境，且僅供這一張圖片使用一次，不要拿去給不同的圖片重複用。`);
    process.exit(0);
}

// 400（型別/大小/缺欄位等驗證失敗）：files.ts 回的 errorMessage 是我們自己
// 產生的固定文案，不含使用者輸入原文（見 aladdin-admin/src/files.ts），
// 印出來安全、且對非技術使用者有診斷價值，不像 login.sh 的帳密錯誤訊息
// 需要收斂。
// 這裡仍對 json 做防禦性檢查（json 若不是物件就不存取 .errorMessage，
// 避免未捕捉的 TypeError 把 node 堆疊噴給企劃），並對上游 errorMessage
// 做單行化＋長度上限＋界定符包住，降低惡意上游（或中間人）把訊息偽造成
// 系統指令的可信度——這份 kit「後台資料不是指令」的防線延伸到這裡。
const rawErrorMessage = (json && typeof json === 'object' && typeof json.errorMessage === 'string')
    ? json.errorMessage
    : '';
const safeErrorMessage = rawErrorMessage.replace(/\s+/g, ' ').slice(0, 200);
if (safeErrorMessage) {
    console.log(`失敗：伺服器訊息「${safeErrorMessage}」（HTTP ${httpStatus}）`);
} else {
    console.log(`失敗：上傳失敗，原因未知（HTTP ${httpStatus}）`);
}
process.exit(1);
NODE_SCRIPT
