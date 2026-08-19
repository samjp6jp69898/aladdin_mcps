#!/usr/bin/env bash
# login.sh — H17：agrabah 登入 skill 本體。
#
# 硬性契約（見 ../../settings.json 的 _securityNote 與這個目錄下 SKILL.md）：
# Claude 呼叫這支腳本時，Bash 指令字串必須永遠逐字等於
#   bash .claude/skills/login/login.sh
# 不吃任何命令列參數。所有動態值（帳密、Bearer token、要打哪個環境、選填的
# TOTP 驗證碼）一律由本腳本自己從 .env／.mcp.json 讀，或從下面說明的固定
# 暫存檔讀，絕不出現在呼叫這支腳本的指令列上。
#
# 多環境設計：一份 kit 的 .mcp.json 可能同時掛好幾個 agrabah-admin-<env> /
# agrabah-platform entry。本腳本不需要事先知道「這次要登入哪一個」——直接
# 對 .mcp.json 裡「type 是 http、Authorization 已填入真實 Bearer token（不是
# <YOUR_BEARER_TOKEN> 這種佔位符）」的每一筆 entry 各自呼叫一次對應的
# POST .../login，逐筆回報成功/失敗/需要 TOTP。這樣完全不需要額外的「環境
# 選擇」channel，也不需要 Claude 在呼叫前先用其他工具寫一個「目前環境」的
# 暫存檔——.mcp.json 本身就是唯一事實來源，且一次全部登入對「重新登入訊號
# 出現時直接重跑本 skill」這個使用情境也更省事（不用先確認是哪個環境過期）。
#
# TOTP 例外：TOTP 驗證碔無法從 .mcp.json／.env 取得，只能由企劃在對話裡當場
# 提供（不可預存，§4.2）。因為 entry point 必須 zero-args，Claude 取得驗證碼
# 後要用 Write 工具把它寫進本目錄下固定檔名 .totp-code.tmp（純文字、只有那
# 一組數字），再重跑這支 zero-arg 的 login.sh；腳本讀到這個檔案後立刻讀取
# 內容並刪除檔案（單次使用，不留存，符合「不可預存」的精神），把值當這一輪
# 每個需要 TOTP 的環境共用的驗證碼使用。平常沒有這個檔案時 totpCode 就是空
# 字串，不影響一般登入流程。
#
# Windows CRLF 地雷（plan.md §4.5 末段）：.env 若被記事本存成 CRLF，
# source 之後值尾巴會黏一個 \r，下面用 ${VAR%$'\r'} 主動 strip 掉，不假設
# 使用者一定用 LF 存檔。
#
# 憑證安全（D3、AC3-AC5）：
#   - 全程用 source 載入 .env（不是 cat），帳密只活在 shell/子行程的環境
#     變數，不出現在任何指令列參數。
#   - 呼叫 agrabah 後台一律用 `curl --config -`：URL／header（含 Bearer
#     token）／body 全部透過 stdin 的設定檔餵給 curl，curl 本身收到的
#     command line 只有 `curl --config -`，`ps aux` 看不到任何密碼或 token。
#   - 全程不使用 -v／--trace／--trace-ascii（會把 Authorization header 印進
#     stderr，而 stderr 會回到 Claude 的對話紀錄），也不 echo 組好的
#     curl/config 內容。
#   - 只回報登入結果（成功/失敗/需要 TOTP），JWT 留在 hosted server 端的
#     登入態容器裡，這支腳本從不印出 JWT。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KIT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
ENV_FILE="$KIT_ROOT/.env"
MCP_FILE="$KIT_ROOT/.mcp.json"
TOTP_FILE="$SCRIPT_DIR/.totp-code.tmp"

if [ ! -f "$ENV_FILE" ]; then
    echo "找不到 $ENV_FILE。請先執行「cp .env.example .env」，再打開 .env 填入你的 agrabah 帳號密碼。" >&2
    exit 1
fi
if [ ! -f "$MCP_FILE" ]; then
    echo "找不到 $MCP_FILE，這份 kit 不完整，請聯絡工程師重新提供。" >&2
    exit 1
fi

# shellcheck disable=SC1090
source "$ENV_FILE"

# Windows CRLF 地雷：strip 掉值尾巴可能黏著的 \r。
AGRABAH_ADMIN_USER="${AGRABAH_ADMIN_USER:-}"
AGRABAH_ADMIN_PASSWORD="${AGRABAH_ADMIN_PASSWORD:-}"
AGRABAH_ADMIN_USER="${AGRABAH_ADMIN_USER%$'\r'}"
AGRABAH_ADMIN_PASSWORD="${AGRABAH_ADMIN_PASSWORD%$'\r'}"

if [ -z "$AGRABAH_ADMIN_USER" ] || [ -z "$AGRABAH_ADMIN_PASSWORD" ]; then
    echo "$ENV_FILE 裡 AGRABAH_ADMIN_USER／AGRABAH_ADMIN_PASSWORD 還沒填，請先填好帳號密碼再試一次。" >&2
    exit 1
fi

TOTP_CODE=""
if [ -f "$TOTP_FILE" ]; then
    TOTP_CODE="$(cat "$TOTP_FILE")"
    TOTP_CODE="${TOTP_CODE%$'\r'}"
    rm -f "$TOTP_FILE"
fi

export AGRABAH_ADMIN_USER AGRABAH_ADMIN_PASSWORD TOTP_CODE MCP_FILE

# 實際的登入邏輯（解析 .mcp.json、逐環境組 curl config、判讀回應）交給 node
# 執行：Claude Code 本身依賴 Node.js 才能執行，所以 node 在 Mac／Windows
# Git Bash 環境下都可假設存在，不需要額外要求企劃安裝 jq 之類的工具
# （Windows 版 Git for Windows 不保證內建 jq）。
#
# 用 `node -` 從 stdin 讀腳本本體：這段 heredoc 只是固定的程式碼文字，帳密／
# token 全部在執行期從 process.env 讀，不會出現在 node 的 argv 裡。
node - <<'NODE_SCRIPT'
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const mcpPath = process.env.MCP_FILE;
const identifier = process.env.AGRABAH_ADMIN_USER;
const password = process.env.AGRABAH_ADMIN_PASSWORD;
const totpCode = process.env.TOTP_CODE || '';

let mcp;
try {
    mcp = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
} catch (err) {
    console.error(`無法解析 ${mcpPath}：${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
}

const servers = (mcp && typeof mcp === 'object' && mcp.mcpServers) || {};
const targets = [];
for (const [alias, cfg] of Object.entries(servers)) {
    if (!cfg || cfg.type !== 'http' || typeof cfg.url !== 'string') continue;
    const auth = cfg.headers && cfg.headers.Authorization;
    if (typeof auth !== 'string' || !auth.startsWith('Bearer ')) continue;
    const token = auth.slice('Bearer '.length).trim();
    if (!token || token.startsWith('<')) {
        console.log(`[${alias}] 略過：Bearer token 還是預留佔位符，尚未由工程師填入真實值。`);
        continue;
    }
    if (!cfg.url.endsWith('/mcp')) {
        console.log(`[${alias}] 略過：url 不是預期的 .../mcp 格式，無法推導出登入端點。`);
        continue;
    }
    const loginUrl = cfg.url.slice(0, -'/mcp'.length) + '/login';
    targets.push({ alias, loginUrl, token });
}

if (targets.length === 0) {
    console.error('沒有找到任何可以登入的環境（.mcp.json 裡沒有任何已填好真實 Bearer token 的 http 型 server）。');
    process.exit(1);
}

// curl config 檔案格式：反斜線與雙引號各自要轉義成 \\ 與 \"，避免密碼／
// token 裡剛好出現這兩種字元時弄壞設定檔語法。
const escapeForCurlConfig = s => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

let anyFailure = false;
let anyTotp = false;

for (const { alias, loginUrl, token } of targets) {
    const body = JSON.stringify({ identifier, password, totpCode });
    const configLines = [
        `url = "${escapeForCurlConfig(loginUrl)}"`,
        `header = "Authorization: Bearer ${escapeForCurlConfig(token)}"`,
        `header = "Content-Type: application/json"`,
        `data = "${escapeForCurlConfig(body)}"`,
        `silent`,
        `show-error`,
        `write-out = "\\nHTTPSTATUS:%{http_code}"`,
    ];
    const config = configLines.join('\n') + '\n';

    // 全程不加 -v／--trace／--trace-ascii：那些旗標會把 Authorization header
    // 完整印到 stderr。config 內容只透過子行程 stdin 傳遞，curl 收到的
    // command line 只有 ['--config', '-']，argv 裡沒有任何密碼或 token。
    const result = spawnSync('curl', ['--config', '-'], { input: config, encoding: 'utf8' });

    if (result.error) {
        console.log(`[${alias}] 失敗：無法執行 curl（${result.error.message}）`);
        anyFailure = true;
        continue;
    }
    if (result.status !== 0) {
        console.log(`[${alias}] 失敗：curl 連線錯誤（exit code ${result.status}）：${(result.stderr || '').trim()}`);
        anyFailure = true;
        continue;
    }

    const stdout = result.stdout || '';
    const marker = stdout.lastIndexOf('HTTPSTATUS:');
    const httpBody = marker >= 0 ? stdout.slice(0, marker) : stdout;
    const httpStatus = marker >= 0 ? stdout.slice(marker + 'HTTPSTATUS:'.length).trim() : '(未知)';

    let json;
    try {
        json = JSON.parse(httpBody);
    } catch {
        // 對外的 tg-dispatch proxy 對所有 401 一律正規化成「401 + 空 body」
        // （telegram-dispatcher/server.ts 的既有安全設計：路徑存在但認證失敗，
        // 與完全沒有這條路徑的 catch-all 401 表現要完全一致，外部探測者不能
        // 靠 401 的 body 差異判斷路徑是否存在）——這不是這支腳本的錯，而是
        // 帳密錯誤／Bearer token 失效這兩種情況，經 proxy 轉發後都會變成沒有
        // body 可解析的 401。用一句清楚涵蓋這兩種可能成因的訊息取代「回應不是
        // 合法 JSON」，避免使用者誤以為系統壞掉。
        if (httpStatus === '401') {
            console.log(`[${alias}] 失敗：登入被拒絕（HTTP 401）。最常見的原因是 .env 裡的 agrabah 帳號或密碼打錯，` +
                '也可能是這份 kit 的 Bearer token 已失效。請先確認 .env 帳密無誤；如果確定帳密沒問題，請聯絡工程師確認你的 Bearer token 狀態。');
        } else {
            console.log(`[${alias}] 失敗：伺服器回應不是合法 JSON（HTTP ${httpStatus}）`);
        }
        anyFailure = true;
        continue;
    }

    if (json.success === true) {
        const totpHint = json.mustBindTotp
            ? '（提醒：這個帳號尚未綁定 TOTP，agrabah 後台介面可能會要求你另外去綁定，這跟這次登入無關。）'
            : '';
        console.log(`[${alias}] 登入成功${totpHint}`);
        continue;
    }

    if (json.totpRequired === true) {
        anyTotp = true;
        console.log(`[${alias}] 需要 TOTP 動態驗證碼：帳號密碼正確，但這個環境要求輸入驗證碼才能完成登入。` +
            '請直接在對話裡把你 App 上目前顯示的 6 位數驗證碼告訴 Claude，Claude 會立刻幫你重新完成登入' +
            '（驗證碼通常只有約 30 秒的有效期，這是設計上刻意要求「當場輸入」、不會被預先存起來，屬於正常互動，不是 bug）。');
        continue;
    }

    if (httpStatus === '429') {
        console.log(`[${alias}] 失敗：${json.message || '登入嘗試失敗次數過多，請稍後再試'}`);
        anyFailure = true;
        continue;
    }

    console.log(`[${alias}] 失敗：${json.message || '帳號或密碼錯誤'}（errorName=${json.errorName || '未知'}）`);
    anyFailure = true;
}

if (anyTotp) process.exit(2);
if (anyFailure) process.exit(1);
process.exit(0);
NODE_SCRIPT
