#!/usr/bin/env bash
# login.sh — H17：agrabah 登入 skill 本體。H17 review 收尾（F1-F10 + 安全 review）
# 修過一輪，見本檔各段落內的對應說明與 handoffs/h17-review-fixup-report.md。
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
# 對 .mcp.json 裡「type 是 http、Authorization 已填入真實 Bearer token」的
# 每一筆 entry 各自呼叫一次對應的 POST .../login，逐筆回報成功/失敗/需要
# TOTP。這樣完全不需要額外的「環境選擇」channel，也不需要 Claude 在呼叫前
# 先用其他工具寫一個「目前環境」的暫存檔——.mcp.json 本身就是唯一事實來源，
# 且一次全部登入對「重新登入訊號出現時直接重跑本 skill」這個使用情境也更
# 省事（不用先確認是哪個環境過期）。
#
# TOTP 例外：TOTP 驗證碼無法從 .mcp.json／.env 取得，只能由企劃在對話裡當場
# 提供（不可預存，§4.2）。因為 entry point 必須 zero-args，Claude 取得驗證碼
# 後要用 Write 工具把它寫進本目錄下固定檔名 .totp-code.tmp（純文字、只有那
# 一組數字），再重跑這支 zero-arg 的 login.sh；腳本讀到這個檔案後立刻讀取
# 內容並刪除檔案（單次使用，不留存，符合「不可預存」的精神）。
#
# H17 review 收尾（F10）：dev/pre/evi 是三份互不相交的帳號名冊（各自獨立的
# agrabah 帳號與 TOTP secret），一組驗證碼在數學上不可能同時滿足兩個環境，
# 所以本腳本**一次只處理一個需要 TOTP 的環境**：迴圈仍然對每個環境各自嘗試
# 登入，但只對第一個回報 totpRequired 的環境給出完整的「請提供驗證碼」指示；
# 如果同一輪還有其他環境也需要 TOTP，只給一句簡短提示，請使用者先完成第一
# 個環境、之後再重跑一次處理下一個，不會把同一組驗證碼廣播打多個環境。
#
# Windows CRLF 地雷（plan.md §4.5 末段）：.env 若被記事本存成 CRLF，
# 逐行讀取時每一行尾巴會黏一個 \r，下面的逐行解析器會主動 strip 掉。
#
# 憑證安全（D3、AC3-AC5，H17 review 收尾 F3 追加）：
#   - **不使用 `source .env`**：`source` 把 `.env` 當 shell 腳本執行，密碼
#     含空白／`$`／反引號／`$(...)`／雙引號這類字元時，會被 shell 展開、
#     觸發 `unbound variable`，甚至把錯誤片段（可能含密碼）印到 stderr、
#     直接進入 Claude 對話紀錄——這正是 D4「密碼絕不能進對話紀錄」這個核心
#     目標被繞過的方式。改用下面的逐行純文字解析（只做字串裁切，不做任何
#     shell 展開／命令替換），`=` 後面整行原樣當成值，只 strip `\r`（CRLF）
#     與檔首可能出現的 UTF-8 BOM。
#   - 帳密只活在 shell/子行程的環境變數，不出現在任何指令列參數。
#   - 呼叫 agrabah 後台一律用 `curl --config -`：URL／header（含 Bearer
#     token）／body 全部透過 stdin 的設定檔餵給 curl，curl 本身收到的
#     command line 只有 `curl --config -`，`ps aux` 看不到任何密碼或 token。
#   - 全程不使用 -v／--trace／--trace-ascii（會把 Authorization header 印進
#     stderr，而 stderr 會回到 Claude 的對話紀錄），也不 echo 組好的
#     curl/config 內容，也不印任何可能夾帶檔案原文片段的例外訊息
#     （`.mcp.json` 解析失敗、curl 連線層級錯誤都只印固定文案）。
#   - 只回報登入結果（成功/失敗/需要 TOTP），JWT 留在 hosted server 端的
#     登入態容器裡，這支腳本從不印出 JWT。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KIT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
ENV_FILE="$KIT_ROOT/.env"
MCP_FILE="$KIT_ROOT/.mcp.json"
TOTP_FILE="$SCRIPT_DIR/.totp-code.tmp"

# H17 review 收尾（F9）：TOTP 暫存檔的讀取＋刪除放在所有可能提早 exit 的檢查
# 之前——不管後面是不是真的走得到打 agrabah 的那一步，只要這支腳本被呼叫過
# 一次，這個檔案就該被消耗掉一次，不留到下一次執行才被誤用（過期的驗證碼
# 本來就沒有意義；使用者若因為 .env 還沒填好而提早結束，之後補好 .env 重跑
# 時本來就該重新提供一組新的驗證碼）。
TOTP_CODE=""
if [ -f "$TOTP_FILE" ]; then
    TOTP_CODE="$(cat "$TOTP_FILE")"
    TOTP_CODE="${TOTP_CODE%$'\r'}"
    rm -f "$TOTP_FILE"
fi

if [ ! -f "$ENV_FILE" ]; then
    # H17 review 收尾追加發現：這裡刻意用 ${ENV_FILE} 加大括號，不能寫成裸的
    # $ENV_FILE——實測發現 macOS 內建 /bin/bash（3.2.57，非 Homebrew 那支較新
    # 版本）在 `set -u` 底下，如果變數名稱後面緊接著一個中文字元、中間沒有
    # 任何 ASCII 分隔字元（例如這裡原本的「$ENV_FILE。」），會把中文字（多
    # byte UTF-8）的部分位元組誤判成變數名稱的一部分，導致整行被讀成一個
    # 不存在的變數、直接觸發「unbound variable」把腳本真正想印的訊息整個
    # 蓋掉。這是這輪重測時另外發現、不在兩份 review 清單裡的真實 bug，加大
    # 括號明確界定變數名邊界後即可穩定重現修復（已用 macOS 系統 bash 3.2.57
    # 實測驗證），並已全域檢查過整支腳本沒有其他同樣寫法的地方。
    echo "找不到 ${ENV_FILE}。請先執行「cp .env.example .env」，再打開 .env 填入你的 agrabah 帳號密碼。" >&2
    exit 1
fi
if [ ! -f "$MCP_FILE" ]; then
    echo "找不到 ${MCP_FILE}，這份 kit 不完整，請聯絡工程師重新提供。" >&2
    exit 1
fi

# H17 review 收尾（F3）：逐行解析 .env，不執行 shell、不做任何展開——只找
# `AGRABAH_ADMIN_USER=`／`AGRABAH_ADMIN_PASSWORD=` 開頭的行，把 `=` 後面的
# 整段文字原樣當值。這樣密碼裡的空白／`$`／反引號／`$(...)`／雙引號都只是
# 普通字元，不會被當成 shell 語法解讀，也不會有任何錯誤訊息夾帶密碼片段的
# 風險（因為根本沒有執行的機會可以出錯）。
AGRABAH_ADMIN_USER=""
AGRABAH_ADMIN_PASSWORD=""
_first_line=1
while IFS= read -r _line || [ -n "$_line" ]; do
    if [ "$_first_line" = 1 ]; then
        # UTF-8 BOM（記事本「另存新檔」常見的編碼選項）只可能出現在檔案最
        # 開頭，把這三個位元組從第一行行首剝掉。
        _line="${_line#$'\xEF\xBB\xBF'}"
        _first_line=0
    fi
    _line="${_line%$'\r'}"
    case "$_line" in
        AGRABAH_ADMIN_USER=*)
            AGRABAH_ADMIN_USER="${_line#AGRABAH_ADMIN_USER=}"
            ;;
        AGRABAH_ADMIN_PASSWORD=*)
            AGRABAH_ADMIN_PASSWORD="${_line#AGRABAH_ADMIN_PASSWORD=}"
            ;;
    esac
done < "$ENV_FILE"
unset _line _first_line

if [ -z "$AGRABAH_ADMIN_USER" ] || [ -z "$AGRABAH_ADMIN_PASSWORD" ]; then
    echo "$ENV_FILE 裡 AGRABAH_ADMIN_USER／AGRABAH_ADMIN_PASSWORD 還沒填（或等號前後多了空白，導致這一行沒被辨識出來），請先填好帳號密碼再試一次。" >&2
    exit 1
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
} catch {
    // H17 review 收尾（安全 review 2a）：不印 err.message——Node 的 JSON 解析
    // 錯誤訊息常常會夾帶出錯位置附近的原始檔案內容片段，.mcp.json 裡緊鄰的
    // 內容可能就是 Bearer token，印出來等於把 token 片段洩漏進對話紀錄。
    console.error(`無法解析 ${mcpPath}，這份 kit 的設定檔可能已損毀，請聯絡工程師重新提供。`);
    process.exit(1);
}

const servers = (mcp && typeof mcp === 'object' && mcp.mcpServers) || {};
const targets = [];
for (const [alias, cfg] of Object.entries(servers)) {
    if (!cfg || cfg.type !== 'http' || typeof cfg.url !== 'string') continue;

    const auth = cfg.headers && cfg.headers.Authorization;
    if (typeof auth !== 'string' || auth.trim().length === 0) {
        console.log(`[${alias}] 略過：.mcp.json 裡這筆設定沒有 Authorization header，請聯絡工程師確認。`);
        continue;
    }
    // H17 review 收尾（F8）：scheme 比對改成不分大小寫，並且對「格式看起來
    // 不對」與「格式對但 token 是空的/還是佔位符」給出不同、各自準確的訊息，
    // 不再對兩種情況都靜默 continue 或都講同一句話。
    const authTrimmed = auth.trim();
    const spaceIdx = authTrimmed.indexOf(' ');
    const scheme = spaceIdx >= 0 ? authTrimmed.slice(0, spaceIdx) : authTrimmed;
    const tokenPart = spaceIdx >= 0 ? authTrimmed.slice(spaceIdx + 1).trim() : '';
    if (scheme.toLowerCase() !== 'bearer') {
        console.log(`[${alias}] 略過：Authorization header 格式看起來不對（開頭應該是 "Bearer "，目前是 "${scheme}"），請聯絡工程師確認 .mcp.json。`);
        continue;
    }
    if (!tokenPart || tokenPart.startsWith('<')) {
        console.log(`[${alias}] 略過：Authorization header 裡沒有實際的 Bearer token（可能是空值，也可能還是 <YOUR_BEARER_TOKEN> 這種預留佔位符），請聯絡工程師確認 .mcp.json。`);
        continue;
    }
    if (!cfg.url.endsWith('/mcp')) {
        console.log(`[${alias}] 略過：url 不是預期的 .../mcp 格式，無法推導出登入端點。`);
        continue;
    }
    const loginUrl = cfg.url.slice(0, -'/mcp'.length) + '/login';
    targets.push({ alias, loginUrl, token: tokenPart });
}

if (targets.length === 0) {
    console.error('沒有找到任何可以登入的環境（.mcp.json 裡沒有任何已填好真實 Bearer token 的 http 型 server）。');
    process.exit(1);
}

// curl config 檔案格式：反斜線與雙引號各自要轉義成 \\ 與 \"，避免密碼／
// token 裡剛好出現這兩種字元時弄壞設定檔語法。額外過濾掉 \r／\n——
// url／token 是直接原文插值進 config（不像 body 有經過 JSON.stringify 天然
// 跳脫換行），一個含有原始換行字元的 token 會被 curl 的 config 解析器當成
// 這行結束、下一行是新的設定指令，等於一種 config injection；理論上只有
// 工程師手滑把換行貼進 .mcp.json 才會發生，仍一併過濾做防禦。
const escapeForCurlConfig = s => String(s)
    .replace(/[\r\n]/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');

let anyFailure = false;
let anyTotp = false;
let totpAnnounced = false;

for (const { alias, loginUrl, token } of targets) {
    const body = JSON.stringify({ identifier, password, totpCode });
    const configLines = [
        `url = "${escapeForCurlConfig(loginUrl)}"`,
        `header = "Authorization: Bearer ${escapeForCurlConfig(token)}"`,
        `header = "Content-Type: application/json"`,
        `data = "${escapeForCurlConfig(body)}"`,
        `silent`,
        `show-error`,
        // H17 review 收尾（F6）：沒有 timeout 的話，一個半死的 ngrok tunnel
        // 會讓這個環境的 curl 呼叫無限期掛住，連帶拖累後面每個環境的結果、
        // 甚至可能讓 Claude Code Bash tool 自己的外部 timeout 把整個行程砍掉
        // （這樣前面已經跑完的環境結果也一起拿不到）。10 秒連線逾時、30 秒
        // 總逾時，足夠一般網路狀況但不會讓單一個掛住的環境拖垮全部。
        `connect-timeout = "10"`,
        `max-time = "30"`,
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
        // H17 review 收尾（安全 review 2b）：不印 result.stderr 原文——如果
        // 是 config 語法層級的錯誤，curl 有時會把出錯那一行的內容原樣回顯在
        // stderr，那一行可能就是帶著 token 的 header 設定。固定文案 + curl
        // 自己的 exit code（不含任何 config 內容），已經足夠讓使用者判斷
        // 「是不是網路問題」，不需要犧牲這個風險去換更細的除錯資訊。
        console.log(`[${alias}] 失敗：連線 agrabah 後台時發生連線層級錯誤（curl exit code ${result.status}，逾時或網路不通時常見）。請確認網路連線後再試一次；如果持續發生，請聯絡工程師。`);
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
        // H17 review 收尾（F1/F2/F4）：「需要 TOTP」這個情境已經改成 HTTP 200
        // 回應（見 agrabah-admin/agrabah-platform 的 http.ts），所以走到這裡、
        // body 解析不出來的狀況，不會再是 TOTP，只會是下面列的幾種基礎設施
        // 層級狀況——依 httpStatus 給對應的明確訊息，不要籠統地說「不是合法
        // JSON」：
        if (httpStatus === '401') {
            // telegram-dispatcher/server.ts 的既有安全設計：對所有上游 401
            // 一律正規化成空 body（防路徑探測的均一防線），所以這裡沒有更
            // 細的資訊可以給——誠實列出全部可能成因，不要武斷地說「最常見
            // 是哪一種」。
            console.log(`[${alias}] 失敗：登入被拒絕（HTTP 401）。這個狀態碼本身無法區分成因，可能是：` +
                '(1) .env 裡的 agrabah 帳號或密碼不正確；(2) 這份 kit 的 Bearer token 已失效或不在授權名冊裡；' +
                '(3) .mcp.json 裡這個環境的網址前綴設定有誤。請先確認 .env 帳密是否正確；' +
                '如果確定沒問題，請聯絡工程師確認 Bearer token 與 .mcp.json 設定。');
        } else if (httpStatus === '429') {
            // 這裡走到的 429 是 proxy 流量層 rate limit（純文字 body，跟
            // login_throttle.ts 那個有 JSON body 的帳號層節流是不同層，見上面
            // json.success 分支之後另一個 httpStatus === '429' 判斷）。
            console.log(`[${alias}] 失敗：請求過於頻繁（HTTP 429），請稍等一分鐘後再重試一次。`);
        } else if (httpStatus === '502') {
            console.log(`[${alias}] 失敗：後台服務目前無法連線（HTTP 502），請聯絡工程師確認服務狀態。`);
        } else {
            console.log(`[${alias}] 失敗：伺服器回應不是預期的格式（HTTP ${httpStatus}），請聯絡工程師。`);
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
        if (!totpAnnounced) {
            // H17 review 收尾（F10）：dev/pre/evi 是各自獨立的帳號名冊，一組
            // 驗證碼不可能同時滿足多個環境，所以只對第一個回報 totpRequired
            // 的環境給完整指示；其餘同一輪也需要 TOTP 的環境走下面的 else
            // 分支，只給簡短提示，避免廣播同一組碼造成混淆。
            totpAnnounced = true;
            console.log(`[${alias}] 需要 TOTP 動態驗證碼：帳號密碼正確，但這個環境要求輸入驗證碼才能完成登入。` +
                '請直接在對話裡把你 App 上目前顯示的 6 位數驗證碼告訴 Claude，Claude 會立刻幫你重新完成登入' +
                '（驗證碼通常只有約 30 秒的有效期，這是設計上刻意要求「當場輸入」、不會被預先存起來，屬於正常互動，不是 bug）。');
        } else {
            console.log(`[${alias}] 這個環境也需要 TOTP 動態驗證碼，但一次只處理一個環境——請先完成上面提到的環境，之後再重跑一次登入 skill 處理這個環境。`);
        }
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

// H17 review 收尾（F7）：exit code 語意重新設計，讓「真的失敗」跟「只是還
// 有待處理的 TOTP」可以被區分——有任何一個環境真正失敗優先回 1（即使同一輪
// 也有環境在等 TOTP，失敗這件事更需要被注意到）；沒有失敗但有環境在等 TOTP
// 回 2；全部成功回 0。
if (anyFailure) process.exit(1);
if (anyTotp) process.exit(2);
process.exit(0);
NODE_SCRIPT
