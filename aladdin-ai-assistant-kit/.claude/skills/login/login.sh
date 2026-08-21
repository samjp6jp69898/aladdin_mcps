#!/usr/bin/env bash
# login.sh — H17：agrabah 登入 skill 本體。經過數輪 review 收尾（F1-F10、
# 安全 review、N1/N2 等），細節見本檔各段落內的對應說明。
#
# 硬性契約（見 ../../settings.json 的 _securityNote 與這個目錄下 SKILL.md）：
# Claude 呼叫這支腳本時，Bash 指令字串必須永遠逐字等於
#   bash .claude/skills/login/login.sh
# 不吃任何命令列參數。所有動態值（帳密、Bearer token、要打哪個環境、選填的
# TOTP 驗證碼）一律由本腳本自己從 .env／.mcp.json 讀，或從下面說明的固定
# 暫存檔讀，絕不出現在呼叫這支腳本的指令列上。
#
# 多環境設計：一份 kit 的 .mcp.json 可能同時掛好幾個 aladdin-admin-<env> /
# aladdin-platform entry。本腳本不需要事先知道「這次要登入哪一個」——直接
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
# H17 review 收尾（F10，N1 補強）：dev/pre/evi 是三份互不相交的帳號名冊
# （各自獨立的 agrabah 帳號與 TOTP secret），一組驗證碼在數學上不可能同時
# 滿足兩個環境，所以本腳本**一次只處理一個需要 TOTP 的環境**：迴圈仍然對
# 每個環境各自嘗試登入，但只對第一個回報 totpRequired 的環境給出完整的
# 「請提供驗證碼」指示（同時把這個環境的別名記進 .totp-pending-alias.tmp）；
# 如果同一輪還有其他環境也需要 TOTP，只給一句簡短提示。使用者提供驗證碼後，
# 下一輪腳本會讀出這個暫存的別名，**只把驗證碼送給名字對得上的那個環境**，
# 其餘環境這一輪一律送空字串——不會因為疊代順序剛好先繞到別的環境，就把
# 這組碼誤送過去（那樣不但打錯環境，還會因為「錯誤的 TOTP 碼」被算成一次
# 真正的登入失敗，連帶誤觸節流）。
#
# Windows CRLF 地雷（plan.md §4.5 末段）：.env 若被記事本存成 CRLF，
# 逐行讀取時每一行尾巴會黏一個 \r，下面的逐行解析器會主動 strip 掉。
#
# 憑證安全（D3、AC3-AC5，H17 review 收尾 F3 追加）：
#   - **不使用 `source .env`**：`source` 把 `.env` 當 shell 腳本執行，密碼
#     含空白／`$`／反引號／`$(...)`／雙引號這類字元時，會被 shell 展開、
#     觸發 `unbound variable`，甚至把錯誤片段（可能含密碼）印到 stderr、
#     直接進入 Claude 對話紀錄——這正是 D4「密碼絕不能進對話紀錄」這個核心
#     目標被繞過的方式。改用逐行純文字解析（只做字串裁切，不做任何 shell
#     展開／命令替換），`=` 後面整行原樣當成值，只 strip `\r`（CRLF）與檔首
#     可能出現的 UTF-8 BOM。這段解析在下面的 node 區塊裡（見 D13 多環境帳密
#     那段註解），性質與原本的 bash 版逐行解析完全相同，只是換了執行語言。
#   - 帳密只在 node 行程的記憶體裡存在，不進環境變數、不出現在任何指令列
#     參數。（D13 之前的版本是 bash 解析完 `export` 給 node；改由 node 直接
#     讀檔之後，帳密連環境變數都不再經過，curl 子行程也不會繼承到它們。）
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
# H17 review 第三輪收尾（N1）：記錄「上一次公告需要 TOTP 的是哪個環境別名」。
# 見下面 node 區塊對 TOTP_PENDING_ALIAS 的說明。
TOTP_PENDING_ALIAS_FILE="$SCRIPT_DIR/.totp-pending-alias.tmp"

# H17 review 收尾（F9）：TOTP 暫存檔的讀取＋刪除放在所有可能提早 exit 的檢查
# 之前——不管後面是不是真的走得到打 agrabah 的那一步，只要這支腳本被呼叫過
# 一次，這個檔案就該被消耗掉一次，不留到下一次執行才被誤用（過期的驗證碼
# 本來就沒有意義；使用者若因為 .env 還沒填好而提早結束，之後補好 .env 重跑
# 時本來就該重新提供一組新的驗證碼）。兩個暫存檔（驗證碼本身＋它綁定的環境
# 別名）同一時間點一起消耗，生命週期完全一致。
TOTP_CODE=""
if [ -f "$TOTP_FILE" ]; then
    TOTP_CODE="$(cat "$TOTP_FILE")"
    TOTP_CODE="${TOTP_CODE%$'\r'}"
    rm -f "$TOTP_FILE"
fi
TOTP_PENDING_ALIAS=""
if [ -f "$TOTP_PENDING_ALIAS_FILE" ]; then
    TOTP_PENDING_ALIAS="$(cat "$TOTP_PENDING_ALIAS_FILE")"
    TOTP_PENDING_ALIAS="${TOTP_PENDING_ALIAS%$'\r'}"
    rm -f "$TOTP_PENDING_ALIAS_FILE"
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

# 2026-08-21 補強：正常情況下企劃是雙擊啟動器進來的，啟動器已經先檢查過
# Node.js；這裡是給「方式二：完全手動、不透過啟動器」直接進 Claude 對話的
# 情況兜底，避免直接摔進下面 `node -` 一行冷冰冰的 command not found。
if ! command -v node > /dev/null 2>&1; then
    echo "找不到 Node.js，登入功能需要它才能執行。請到 https://nodejs.org 下載安裝「LTS」版本，安裝完成後重新開一個終端機視窗再試一次。" >&2
    exit 1
fi

# D13 多環境帳密（本次改動）：`.env` 的逐行純文字解析整段移到下面的 node
# 區塊。原因是「哪些欄位要讀」不再是固定的兩個名字，而要依 `.mcp.json` 裡每
# 個 server 別名各自推導一組欄位名（別名含 `-`，shell 變數名不能有 `-`，在
# bash 3.2 又沒有 associative array 可以用來存「別名→帳密」的對應），在 node
# 裡用 Map 存是唯一乾淨的寫法。解析方式的安全性質完全不變：仍然是純文字比
# 對（split 行、找第一個 `=`、右邊原樣當值），沒有任何 eval／source／展開。
#
# 一個後台一組帳密，沒有共用欄位：後台是「環境 × 平台產品」兩個維度（dev 的
# PK 平台與 dev 的 6T 平台是兩個不同站台、不同帳號），任何「填一組就通用」的
# 設計在這種形狀下都只會把帳密送去錯的站台。
#
# 附帶好處：帳密不再需要 `export` 進環境變數就能傳給 node，node 直接讀檔，
# 所以帳密現在連環境變數都不經過，curl 子行程也不會繼承到它們。
export ENV_FILE MCP_FILE TOTP_CODE TOTP_PENDING_ALIAS TOTP_PENDING_ALIAS_FILE

# 實際的登入邏輯（解析 .mcp.json、逐環境組 curl config、判讀回應）交給 node
# 執行，不用 jq（Windows 版 Git for Windows 不保證內建 jq）。
#
# 【2026-08-21 更正】這裡原本假設「Claude Code 本身依賴 Node.js，所以 node
# 在 Mac／Windows Git Bash 環境下都可假設存在」——實測發現這個假設不成立，
# 不少企劃電腦上沒有另外裝 Node.js。改用 node 而非 jq 的理由本身依然成立
# （jq 在 Git for Windows 不保證內建），只是「node 一定存在」這個前提站不
# 住腳，因此在本檔與四支啟動器都補上明確的 Node.js 偵測與安裝指引，不再
# 靜默假設。
#
# 用 `node -` 從 stdin 讀腳本本體：這段 heredoc 只是固定的程式碼文字，帳密／
# token 全部在執行期從 process.env 讀，不會出現在 node 的 argv 裡。
node - <<'NODE_SCRIPT'
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const mcpPath = process.env.MCP_FILE;
const envPath = process.env.ENV_FILE;
const totpCode = process.env.TOTP_CODE || '';
const totpPendingAlias = process.env.TOTP_PENDING_ALIAS || '';
const totpPendingAliasFile = process.env.TOTP_PENDING_ALIAS_FILE;

// ── .env 逐行純文字解析（D13） ────────────────────────────────────────────
// 只做字串裁切：split 出每一行，找第一個 `=`，左邊當欄位名、右邊整段原樣當
// 值。密碼裡的空白／`$`／反引號／`$(...)`／雙引號／單引號全都只是普通字元。
// 絕不 source／eval／做任何形式的展開，也絕不把任何值印出來（下面所有錯誤
// 訊息一律只提欄位「名字」）。
let envText;
try {
    envText = fs.readFileSync(envPath, 'utf8');
} catch {
    // 不印例外訊息原文，理由同下面 .mcp.json 那段：例外訊息可能夾帶檔案內容。
    console.error(`無法讀取 ${envPath}，請確認這個檔案存在、而且你這個使用者帳號有讀取權限。`);
    process.exit(1);
}
// 用 Map 而不是物件字面量：欄位名直接來自檔案內容，物件會讓 `__proto__`
// 這種名字撞進原型鏈，Map 沒有這個問題。
const envFields = new Map();
{
    let text = envText;
    // UTF-8 BOM（記事本「另存新檔」常見的編碼選項）只可能出現在檔案最開頭。
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    for (let line of text.split('\n')) {
        // Windows CRLF：記事本存出的檔案每一行尾巴會多一個 \r。
        if (line.endsWith('\r')) line = line.slice(0, -1);
        if (line === '' || line.startsWith('#')) continue;
        const eq = line.indexOf('=');
        if (eq <= 0) continue;
        const name = line.slice(0, eq);
        // 欄位名必須是乾淨的英數底線；等號前面多了空白（「FOO = bar」）這種
        // 寫法一律不辨識——跟改動前的 bash 版逐行解析行為一致，.env.example
        // 也已經明確提醒過這個地雷。
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue;
        envFields.set(name, line.slice(eq + 1));
    }
}
const envValue = name => envFields.get(name) || '';

// 欄位名一律由 .mcp.json 的 server 別名「機械轉換」而來：非英數字元換成底線、
// 轉大寫，再加 _USER／_PASSWORD。
//   aladdin-admin-dev        → ALADDIN_ADMIN_DEV_USER／..._PASSWORD
//   aladdin-platform-dev-pk  → ALADDIN_PLATFORM_DEV_PK_USER／..._PASSWORD
//   aladdin-platform-dev-6t  → ALADDIN_PLATFORM_DEV_6T_USER／..._PASSWORD
//
// 這裡刻意**不維護任何「有哪些環境／哪些平台」的清單**。後台實際上是「環境 ×
// 平台產品」兩個維度（光 dev 一個環境底下就有 MAIN／TEST／FF／PK／NY／6T…
// 十幾個平台，各自是不同站台、不同帳號），列舉法遲早會漏；純機械轉換則是
// .mcp.json 新增任何別名都自動支援，不必再動這支腳本。
const fieldPrefix = alias => alias.replace(/[^A-Za-z0-9]/g, '_').toUpperCase();

// 一個後台一組帳密，沒有共用／fallback 欄位：各後台是互不相通的帳號名冊，
// 「沒填就是沒填」比「悄悄拿別的環境的帳密去試」安全——後者不但打錯環境，
// 失敗還會被 agrabah 的帳號層節流記一次（連續 5 次鎖 5 分鐘）。
//
// 同理，一組只填了一半時也直接當錯誤、不送出請求：那次登入必定失敗，唯一的
// 效果就是白白消耗一次節流額度。
const resolveCredentials = alias => {
    const prefix = fieldPrefix(alias);
    const userField = `${prefix}_USER`;
    const passwordField = `${prefix}_PASSWORD`;

    // 別名開頭若是數字，推導出來的欄位名（例如 6T_PLATFORM_USER）不是合法的
    // 欄位名，上面的解析器會直接略過那一行——使用者不管怎麼填都不會生效。
    // 與其讓他對著一個永遠填不好的欄位名鬼打牆，不如明講這是設定問題。
    if (!/^[A-Za-z_]/.test(prefix)) {
        return {
            ok: false,
            filled: false,
            message: `.mcp.json 裡這個環境的名字是數字開頭，推導不出合法的 .env 欄位名，` +
                `這份 kit 的設定需要調整，請聯絡工程師。`,
        };
    }

    const user = envValue(userField);
    const password = envValue(passwordField);

    if (user !== '' && password !== '') {
        return { ok: true, filled: true, identifier: user, password };
    }

    if (user === '' && password === '') {
        return {
            ok: false,
            filled: false,
            message: `.env 裡找不到這個環境的帳號密碼——請填 ${userField} 與 ${passwordField} 這兩個欄位。` +
                `（欄位名的規則是把 .mcp.json 裡的環境名字轉大寫、減號換底線，再加 _USER／_PASSWORD。` +
                `每個後台都有自己的一組欄位，不會共用，也沒有「填一組就通用」的欄位。）`,
        };
    }

    const missingField = user === '' ? userField : passwordField;
    return {
        ok: false,
        filled: true,
        message: `.env 裡這個環境的 ${missingField} 沒有填，但同一組的另一個欄位已經填了。` +
            `${userField} 與 ${passwordField} 必須成對填寫。` +
            `（為了不讓一次註定失敗的登入被記進帳號層節流，這個環境這次不會發出登入請求。）`,
    };
};
// ──────────────────────────────────────────────────────────────────────────

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
    //
    // H17 review 第三輪收尾（N2，安全 review 抓到的第二個真實洩漏路徑）：
    // 絕對不能把 scheme 這個值印進訊息——真實 Bearer token 不含空白，若
    // 工程師貼 .mcp.json 時漏打「Bearer 」前綴，authTrimmed 裡就不會有空白，
    // `scheme` 會等於整把 token（`indexOf(' ')` 找不到空白時 `scheme` 落到
    // else 分支＝整個字串）。原本的訊息「目前是 "${scheme}"」會把完整、
    // 可直接使用的憑證原樣印進對話紀錄，比同一輪修過的 2a（只洩漏約 20 字元
    // 視窗）嚴重得多。訊息固定文案、不做任何變數插值，對非技術企劃來說
    // 「目前是什麼」本來就沒有診斷價值，只有洩漏風險。
    const authTrimmed = auth.trim();
    const spaceIdx = authTrimmed.indexOf(' ');
    const scheme = spaceIdx >= 0 ? authTrimmed.slice(0, spaceIdx) : authTrimmed;
    const tokenPart = spaceIdx >= 0 ? authTrimmed.slice(spaceIdx + 1).trim() : '';
    if (scheme.toLowerCase() !== 'bearer') {
        console.log(`[${alias}] 略過：Authorization header 格式看起來不對（應該以 "Bearer " 開頭），請聯絡工程師確認 .mcp.json。`);
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

// D13：每個環境各自解出自己那組帳密。缺欄位改成「這個環境跳過、其他環境
// 照跑」（改動前是任一欄位沒填就整支 exit 1），因為多環境情境下，某個環境
// 沒填帳密不該連帶擋掉其他已經填好的環境。
//
// 取捨：per-environment 錯誤在最常見的「.env 剛 cp 出來、整個沒填」情境下，
// 會對每個環境各印一次幾乎一樣的長訊息，對非技術企劃反而更難讀。所以這裡
// 保留一條前置的整體判斷——如果一個帳密欄位都沒填到，就一次把整份清單交代
// 完並結束；只有在「至少填了一部分、但某些環境仍解不出帳密」時，才逐環境
// 報告（那時每個環境缺的欄位名確實不同，值得分開講）。
const resolutions = targets.map(t => ({ target: t, cred: resolveCredentials(t.alias) }));
if (!resolutions.some(r => r.cred.filled)) {
    // 一個欄位都沒填到（最常見的情況：.env 才剛從 .env.example 複製出來）。
    // 這時逐環境各印一次長訊息只會洗版，改成一次把「你的 kit 有哪幾個後台、
    // 每個要填哪兩個欄位」整理成清單交代完。
    const lines = targets.map(t => {
        const prefix = fieldPrefix(t.alias);
        return `  ${t.alias}\n      ${prefix}_USER\n      ${prefix}_PASSWORD`;
    });
    console.error(`${envPath} 裡還沒填任何帳號密碼（也可能是等號前後多了空白，導致那一行沒被辨識出來）。\n` +
        `你的 .mcp.json 裡有下面這幾個後台，每一個都要填自己的那一組（各後台帳號互不相通，沒有共用欄位）：\n` +
        `${lines.join('\n')}\n` +
        `詳細說明見 .env.example 的註解。`);
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

// H17 review 第三輪收尾（N1，正確性 review 抓到的 BLOCKER）：先前的版本只用
// totpAnnounced 控制「印出來的訊息」，但送去 curl 的 request body 全部共用
// 同一個 totpCode 變數——如果同一輪有兩個以上環境都需要 TOTP，使用者只為
// 其中一個提供的驗證碼會被原封不動廣播去打其他環境，造成：(1) 該環境被
// 消耗一次不是使用者要求的登入嘗試；(2) 錯誤的 TOTP 碼不算 totpNeeded（見
// http.ts `totpRequired = errorCode === totpNeeded`），會被 `recordFailure`
// 計入節流，等於企劃每完成一個環境的 TOTP、就替其他還在等待的環境各記一次
// 失敗，多環境 kit 跑兩三輪可能誤觸節流鎖住、且完全沒有線索可查。
//
// 修法：把「這組驗證碼是給哪個環境用的」用 .totp-pending-alias.tmp 這個
// 固定暫存檔跟驗證碼本身綁在一起（見上面 bash 區塊，兩者同時讀取＋刪除、
// 生命週期一致）。只有 alias 與這個記錄相符的目標，才會在下面迴圈中真的
// 把 totpCode 帶進 request body；其餘目標一律送出空字串（agrabah 後端對
// 不需要 TOTP 的帳號本來就會忽略這個欄位，送空字串完全無害；若那個環境
// 剛好也需要 TOTP，空字串會讓它照原本的邏輯回報「需要 TOTP」，不算失敗、
// 不觸發節流）。
//
// 如果找不到對得上的暫存檔（例如使用者手動建立 .totp-code.tmp、或上一輪
// 的暫存檔已經因為某種原因遺失）：不要用「反正就送給第一個遇到、真的需要
// TOTP 的環境」這種看似合理的猜測邏輯頂替——那樣在多環境情境下一樣可能猜
// 錯目標、一樣會把碼送到並非使用者原本針對的環境。安全的作法是這一輪乾脆
// 不套用這組碼到任何環境（下面用 `totpCodeConsumed` 初始值直接鎖死），並在
// 迴圈跑完後告知使用者，讓他們照 SKILL.md 的正常流程（先看公告訊息、再
// 提供驗證碼）重來一次——這個退化流程理論上不該在正常使用下發生，因為每次
// 公告需要 TOTP 時都會同步寫入這個暫存檔。
const pendingAliasValid = totpPendingAlias !== '' && targets.some(t => t.alias === totpPendingAlias);
let totpCodeConsumed = totpCode === '' || !pendingAliasValid;

for (const { target, cred } of resolutions) {
    const { alias, loginUrl, token } = target;

    // 帳密解不出來：只跳過這一個環境，不影響其他環境。訊息只提欄位「名字」，
    // 不會回顯任何欄位的值。
    if (!cred.ok) {
        console.log(`[${alias}] 略過：${cred.message}`);
        anyFailure = true;
        continue;
    }

    const totpCodeToSend = (!totpCodeConsumed && alias === totpPendingAlias) ? totpCode : '';
    if (totpCodeToSend !== '') totpCodeConsumed = true;
    const body = JSON.stringify({ identifier: cred.identifier, password: cred.password, totpCode: totpCodeToSend });
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
        // 回應（見 aladdin-admin/aladdin-platform 的 http.ts），所以走到這裡、
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
            // H17 review 第三輪收尾（N1）：把這個 alias 記進暫存檔，讓使用者
            // 之後提供的驗證碼在下一輪能精準綁定回這個環境，不會被下一輪
            // 迴圈的疊代順序誤套用到別的環境。每次公告都覆寫（配合上面
            // 「進入腳本就先讀取＋刪除」的單次消耗設計），所以永遠反映
            // 「最近一次公告的是哪個環境」。
            fs.writeFileSync(totpPendingAliasFile, alias, 'utf8');
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

// H17 review 第三輪收尾（N1）：提供了驗證碼，但找不到這組碼對應的環境
// （多半是暫存的綁定紀錄遺失，理論上不該在正常使用下發生）——誠實告知，
// 不要默默把這組碼丟掉又不講。
if (totpCode !== '' && !pendingAliasValid) {
    console.log('提供了 TOTP 驗證碼，但找不到這組碼對應的環境（可能是上一輪的暫存狀態遺失），這次沒有套用到任何環境。' +
        '若某個環境仍顯示需要 TOTP，請依提示重新提供一次驗證碼。');
}

// H17 review 收尾（F7）：exit code 語意重新設計，讓「真的失敗」跟「只是還
// 有待處理的 TOTP」可以被區分——有任何一個環境真正失敗優先回 1（即使同一輪
// 也有環境在等 TOTP，失敗這件事更需要被注意到）；沒有失敗但有環境在等 TOTP
// 回 2；全部成功回 0。
if (anyFailure) process.exit(1);
if (anyTotp) process.exit(2);
process.exit(0);
NODE_SCRIPT
