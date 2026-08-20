/**
 * make-starter-kit.ts — H19：按企劃逐人產生 starter kit，預填個人 Bearer token。
 *
 * 用法：
 *   bun make-starter-kit.ts --id <企劃唯一id> --name <顯示名> [--grants admin-dev,platform-dev-pk] [--rotate]
 *   bun make-starter-kit.ts --list        # 列出兩份名冊目前已核發的 id/顯示名/核發時間（不含 token 值）
 *
 * ── id 是什麼 ──────────────────────────────────────────────────────────
 * --id 同時是 (1) token 名冊裡的唯一 id（H3 契約：程式當 key，不可重複、不可
 * 是顯示名）、(2) 輸出目錄名 dist/<id>/。建議用企劃的英文/拼音代稱（例如
 * chenmei），不要用中文或空白——名冊 id 與檔案系統路徑共用同一個值。
 *
 * ── 目前只能發哪些環境（v1 刻意限縮，見 tasks.json H38 risk_notes）───────
 * 只有 admin-dev（aladdin-admin-dev，8789）與 platform-dev-pk
 * （aladdin-platform，8790，目前 platform 唯一部署的環境）是真的端到端可用
 * 的環境——8791/8792（admin pre/evi）的 plist 雖然已備妥，但 tasks.json 已
 * 裁定「H38 prod 寫入閘門補強要排在任何接上 pre/evi/prod 的 task 之前」，
 * 這支產生器尊重那個裁定，故意不開放 pre/evi，避免在閘門補齊前就把這兩個
 * 環境的存取權發出去。要求這些環境會被明確拒絕（不是靜默忽略）。
 *
 * toolsmith（TOOLSMITH_API_TOKEN）也刻意不在這支產生器的範圍內：toolsmith
 * 尚未上線（H25/H26 待做），目前的 kit 範本裡完全沒有任何 toolsmith 欄位。
 * 等 toolsmith 上線、要把它加進這支產生器時，切記 tasks.json H19 AC 早就
 * 記錄的提醒：toolsmith 是「全員共用一把 token」（不像 admin/platform 一人
 * 一把），撤銷任一人需要輪替並重發「所有」kit——第一份含 toolsmith 的 kit
 * 發出去之前，這個不對稱必須先讓操作者看到明確提示。
 *
 * ── 重跑同一個 id 的行為（idempotent 契約，AC 要求明確定義）─────────────
 * 預設：**拒絕**。如果 --id 在任一目標名冊裡已存在、或 dist/<id>/ 已存在，
 * 直接印出既有紀錄（顯示名、核發時間）並以非 0 結束，不做任何修改。
 * 加 --rotate：**重新簽發**。對這次 --grants 指定的每個環境各自產生一把
 * 全新 token，取代名冊裡同一個 id 的舊條目（舊 token 立刻失效——名冊是
 * fail-closed、每個 request 現讀檔案，取代後下一個 request 就生效，不需要
 * 重啟任何服務），並整個重新產生 dist/<id>/ 目錄。
 * 注意：--rotate 只動這次 --grants 指定的環境；如果這個人先前被發過而這次
 * --grants 沒包含的環境，那個環境的舊 token 不會被動到，也不會被撤銷——
 * 用 --grants 縮小範圍不等於撤權，撤權要用專門的撤銷流程（H28）。
 *
 * ── 名冊寫入安全（踩坑第 6 點：暫存檔 + mv，絕不就地覆寫）───────────────
 * 名冊是 fail-closed 且每個 request 現讀檔案，就地覆寫（先清空再寫入）的
 * 空窗期會讓那份名冊在寫入期間對所有 token 一起 401。這支腳本一律先寫進
 * 同目錄下的暫存檔、驗證是合法 JSON 後，用 rename（同一個檔案系統內的
 * atomic 操作）蓋掉正本，讀者永遠只會看到「完全舊」或「完全新」，不會看到
 * 寫一半的狀態。
 *
 * ── token 交付 ────────────────────────────────────────────────────────
 * 這支腳本**不會**把 token 值印到終端機或任何 log——token 已經寫進
 * dist/<id>/.mcp.json，那份檔案本身就是交付物。AC 要求「印在終端供交付
 * 可以，但要在說明中提醒交付管道」；這裡選擇更保守的做法：完全不印，逼
 * 操作者去看檔案內容，降低 token 出現在終端機 scrollback／螢幕分享／
 * 終端機 log 裡的機會。**交付 dist/<id>/ 整個資料夾時，一律走公司內部
 * 認可的一對一私密管道（例如當面用隨身碟、或加密過的私訊），不要貼進
 * 任何群組、共用文件、或會被記錄存檔的頻道**——這份資料夾等同這個人的
 * 完整 agrabah 帳號（README 對企劃端也是這樣強調的）。
 */

import { randomBytes, timingSafeEqual } from 'node:crypto';
import {
    existsSync,
    mkdirSync,
    readFileSync,
    renameSync,
    rmSync,
    writeFileSync,
    copyFileSync,
    chmodSync,
    readdirSync,
    statSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { parseArgs } from 'node:util';

const KIT_DIR = dirname(new URL(import.meta.url).pathname);
const DISPATCH_DOMAIN = 'https://unrefreshing-trudy-subsequently.ngrok-free.dev';

interface GrantConfig {
    /** .mcp.json 裡的 server 別名。 */
    alias: string;
    /** 這個環境的 token 名冊絕對路徑。 */
    registryPath: string;
    /** 對外 URL 的路徑前綴（見 telegram-dispatcher/lib/webhook-server/mcp-proxy.ts 的 PROXY_ROUTES）。 */
    urlPrefix: string;
}

// 只列真的端到端可用的環境。新增一項前，先確認：(1) 對應 launchd job 真的
// bootstrap 了（launchctl list | grep aladdin）、(2) mcp-proxy.ts 的
// PROXY_ROUTES 裡有對應前綴、(3) 沒有被 tasks.json 的既有裁定擋著（目前
// pre/evi 被 H38 擋）。
const ALLOWED_GRANTS: Record<string, GrantConfig> = {
    'admin-dev': {
        alias: 'aladdin-admin-dev',
        registryPath: join(KIT_DIR, '..', 'aladdin-admin', 'tokens.json'),
        urlPrefix: '/mcp-admin-dev',
    },
    'platform-dev-pk': {
        // 真人實測發現的 bug（2026-08-20）：alias 曾經是舊版 'aladdin-platform'
        // （H16 時代「platform 目前只有一個環境、不分 dev/pre/evi」的設計），
        // 但 .env.example 早就已經改成「環境 × 平台產品」欄位命名
        // （ALADDIN_PLATFORM_DEV_PK_USER/_PASSWORD，H15 真人驗收後的修法），
        // 兩邊沒有同步。login.sh 是從 .mcp.json 的 server 別名機械推導 .env
        // 欄位名（見該檔 fieldPrefix()），別名是 'aladdin-platform' 時推導出
        // 來的欄位是 ALADDIN_PLATFORM_USER/_PASSWORD——.env.example 裡根本
        // 沒有這兩個欄位，導致登入 skill 對 platform 這個環境永遠回報「找不到
        // 帳號密碼」，即使企劃確實填了 ALADDIN_PLATFORM_DEV_PK_*。改成
        // 'aladdin-platform-dev-pk' 後機械推導才會對上 .env.example 實際
        // 列出的欄位名。
        alias: 'aladdin-platform-dev-pk',
        registryPath: join(KIT_DIR, '..', 'aladdin-platform', 'tokens.json'),
        urlPrefix: '/mcp-platform',
    },
};

const DEFAULT_GRANTS = ['admin-dev', 'platform-dev-pk'];

// 已知存在、但目前刻意不開放的環境名字——請求到這些名字時要給「為什麼不行」
// 的明確理由，跟「打錯字/根本不存在的名字」分開講。
const BLOCKED_GRANTS: Record<string, string> = {
    'admin-pre': 'H38（prod 寫入閘門補強）尚未完成，tasks.json 已裁定這必須排在任何接上 pre/evi/prod 的 task 之前。',
    'admin-evi': 'H38（prod 寫入閘門補強）尚未完成，tasks.json 已裁定這必須排在任何接上 pre/evi/prod 的 task 之前。',
    'admin-uat': '.env.example 裡雖然預留了 UAT 欄位，但這個環境目前根本沒有部署對應的 hosted server（沒有 plist、沒有名冊檔），不是「被擋」而是「還不存在」。',
    'platform-dev-6t': 'platform 目前只部署了 dev×PK 一個實例（沒有對應的名冊檔/launchd job），dev×6T 尚未存在。',
    'platform-pre-pk': '同上，pre 環境的 platform 尚未部署，且 pre 亦受 H38 閘門限制。',
    'platform-pre-6t': '同上。',
    'platform-evi-6t': '同上，evi 環境的 platform 尚未部署，且 evi 亦受 H38 閘門限制。',
};

const ID_PATTERN = /^[a-z][a-z0-9_-]{1,31}$/;

interface TokenRegistryEntry {
    id: string;
    token: string;
    display_name: string;
    issued_at: string;
}

interface RegistryFile {
    tokens: TokenRegistryEntry[];
}

function loadRegistryFile(path: string): RegistryFile {
    if (!existsSync(path)) {
        // 名冊檔本身理論上應該一直存在（H3 部署時就建立好）；真的不存在是
        // 設定錯誤而非「這個人還沒被發過」，明確報錯比靜默當成空名冊安全。
        throw new Error(`名冊檔不存在：${ path }（這是部署設定問題，不是這個人第一次被發放，請先確認 hosted server 是否已正確部署）`);
    }
    const raw = readFileSync(path, 'utf-8');
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (err) {
        throw new Error(`名冊檔不是合法 JSON：${ path }（${ (err as Error).message }）`);
    }
    if (parsed === null || typeof parsed !== 'object' || !Array.isArray((parsed as RegistryFile).tokens)) {
        throw new Error(`名冊檔格式不對，缺少 tokens 陣列：${ path }`);
    }
    return parsed as RegistryFile;
}

/** 暫存檔 + rename：絕不就地覆寫正在被 fail-closed 認證邏輯即時讀取的名冊檔。 */
function writeRegistryFileAtomic(path: string, registry: RegistryFile): void {
    const serialized = JSON.stringify(registry, null, 2) + '\n';
    // 寫完立刻重新解析一次，確認真的是合法 JSON 才 rename 過去——避免任何
    // 序列化階段的意外（理論上不會發生，但代價是讓所有人一起 401，值得多這一步）。
    JSON.parse(serialized);
    const tmpPath = `${ path }.tmp-${ process.pid }-${ randomBytes(4).toString('hex') }`;
    writeFileSync(tmpPath, serialized, 'utf-8');
    renameSync(tmpPath, path);
}

function findEntry(registry: RegistryFile, id: string): TokenRegistryEntry | undefined {
    return registry.tokens.find(t => t.id === id);
}

function generateToken(): string {
    return randomBytes(32).toString('base64url');
}

// ── 靜態檔案清單：白名單，不是黑名單。新增任何要一起發給企劃的檔案，
// 必須先確認裡面完全不含公司原始碼路徑/其他人的 token/帳密，再加進這裡。──
const STATIC_FILES = [
    'README.md',
    'CLAUDE.md',
    '.env.example',
    '.gitattributes',
    '.gitignore',
    '.claude/settings.json',
    '.claude/skills/login/SKILL.md',
    '.claude/skills/login/login.sh',
    '.claude/skills/upload-image/SKILL.md',
    '.claude/skills/upload-image/upload.sh',
    '開始使用-Mac.command',
    '開始使用-Windows.bat',
    '開始使用-Mac-圖形介面.command',
    '開始使用-Windows-圖形介面.bat',
];

const EXECUTABLE_FILES = new Set([
    '.claude/skills/login/login.sh',
    '.claude/skills/upload-image/upload.sh',
    '開始使用-Mac.command',
    '開始使用-Mac-圖形介面.command',
]);

function copyStaticFiles(destDir: string): void {
    for (const rel of STATIC_FILES) {
        const src = join(KIT_DIR, rel);
        if (!existsSync(src)) {
            throw new Error(`kit 範本缺少檔案：${ rel }（STATIC_FILES 清單跟範本目錄不同步，請檢查）`);
        }
        const dest = join(destDir, rel);
        mkdirSync(dirname(dest), { recursive: true });
        copyFileSync(src, dest);
        if (EXECUTABLE_FILES.has(rel)) {
            chmodSync(dest, 0o755);
        }
    }
}

function buildMcpJson(grants: string[], token: string | ((grant: string) => string)): object {
    const mcpServers: Record<string, unknown> = {};
    for (const grant of grants) {
        const cfg = ALLOWED_GRANTS[grant];
        const t = typeof token === 'function' ? token(grant) : token;
        mcpServers[cfg.alias] = {
            type: 'http',
            url: `${ DISPATCH_DOMAIN }${ cfg.urlPrefix }/mcp`,
            headers: { Authorization: `Bearer ${ t }` },
        };
    }
    // 刻意不輸出 _howToAddMoreEnvironments 這類說明 key：Claude Code 讀
    // .mcp.json 時是否容忍未知頂層欄位沒有被驗證過（見 .mcp.json.example
    // 檔頭的風險記錄），與其冒險，不如讓實際發給企劃的檔案只含
    // mcpServers——需要「怎麼手動加環境」的說明時，工程師去看
    // .mcp.json.example（範本，engineer 用）即可，企劃本來就不需要自己編輯。
    return { mcpServers };
}

function printUsageAndExit(code: number): never {
    console.error(`用法：
  bun make-starter-kit.ts --id <企劃唯一id> --name <顯示名> [--grants ${ Object.keys(ALLOWED_GRANTS).join(',') }] [--rotate]
  bun make-starter-kit.ts --list

目前支援的 --grants（預設兩個都給，可用逗號分隔指定子集）：
${ Object.entries(ALLOWED_GRANTS).map(([k, v]) => `  ${ k } → ${ v.alias }（${ v.urlPrefix }）`).join('\n') }
`);
    process.exit(code);
}

function cmdList(): void {
    for (const [grant, cfg] of Object.entries(ALLOWED_GRANTS)) {
        console.log(`\n=== ${ grant }（${ cfg.registryPath }） ===`);
        const registry = loadRegistryFile(cfg.registryPath);
        if (registry.tokens.length === 0) {
            console.log('  （空）');
            continue;
        }
        for (const entry of registry.tokens) {
            console.log(`  ${ entry.id }\t${ entry.display_name }\t核發於 ${ entry.issued_at }`);
        }
    }
}

function main(): void {
    const { values } = parseArgs({
        options: {
            id: { type: 'string' },
            name: { type: 'string' },
            grants: { type: 'string' },
            rotate: { type: 'boolean', default: false },
            list: { type: 'boolean', default: false },
            help: { type: 'boolean', default: false },
        },
    });

    if (values.help) printUsageAndExit(0);
    if (values.list) {
        cmdList();
        return;
    }

    const id = values.id;
    const displayName = values.name;
    if (!id || !displayName) {
        console.error('缺少 --id 或 --name。\n');
        printUsageAndExit(1);
    }
    if (!ID_PATTERN.test(id)) {
        console.error(`--id "${ id }" 不合法：只能小寫英數字/連字號/底線，2-32 字元，且必須以小寫英文字母開頭（同時當名冊 id 與輸出目錄名，不能用中文或空白）。`);
        process.exit(1);
    }

    // 去重：--grants admin-dev,admin-dev 這種輸入不該讓同一個環境的 token
    // 被重複簽發兩次（結果雖然不錯——最後寫進名冊的就是最後一次生成的那把
    // ——但白白多產生一把不會被用到的 token、多寫一次名冊，沒有意義）。
    const requestedGrants = [...new Set(values.grants ? values.grants.split(',').map(s => s.trim()).filter(Boolean) : DEFAULT_GRANTS)];
    if (requestedGrants.length === 0) {
        console.error('--grants 不能是空字串。');
        process.exit(1);
    }
    for (const g of requestedGrants) {
        if (g in BLOCKED_GRANTS) {
            console.error(`「${ g }」目前不開放：${ BLOCKED_GRANTS[g] }`);
            process.exit(1);
        }
        if (!(g in ALLOWED_GRANTS)) {
            console.error(`「${ g }」不是合法的 grant 名稱。目前支援：${ Object.keys(ALLOWED_GRANTS).join(', ') }`);
            process.exit(1);
        }
    }

    const rotate = values.rotate === true;
    const distDir = join(KIT_DIR, 'dist', id);

    // ── 第一階段：只檢查，不寫入任何東西（要嘛整批成功、要嘛整批不動）───
    const existingByGrant: Record<string, TokenRegistryEntry | undefined> = {};
    for (const g of requestedGrants) {
        const registry = loadRegistryFile(ALLOWED_GRANTS[g].registryPath);
        existingByGrant[g] = findEntry(registry, id);
    }
    const anyExists = Object.values(existingByGrant).some(Boolean) || existsSync(distDir);
    if (anyExists && !rotate) {
        console.error(`id "${ id }" 已經存在，本次不做任何修改：`);
        for (const [g, entry] of Object.entries(existingByGrant)) {
            if (entry) console.error(`  ${ g }：display_name=${ entry.display_name }，核發於 ${ entry.issued_at }`);
        }
        if (existsSync(distDir)) console.error(`  dist 目錄已存在：${ distDir }`);
        console.error('\n如果是要重新簽發（換一把新 token、舊的立刻失效），請加 --rotate 重跑一次。');
        process.exit(1);
    }

    // ── 第二階段：實際寫入 ─────────────────────────────────────────────
    const issuedAt = new Date().toISOString();
    const tokensByGrant: Record<string, string> = {};

    for (const g of requestedGrants) {
        const cfg = ALLOWED_GRANTS[g];
        const registry = loadRegistryFile(cfg.registryPath);
        const token = generateToken();
        tokensByGrant[g] = token;
        const newEntry: TokenRegistryEntry = { id, token, display_name: displayName, issued_at: issuedAt };
        const idx = registry.tokens.findIndex(t => t.id === id);
        if (idx >= 0) {
            registry.tokens[idx] = newEntry; // rotate：整筆取代，舊 token 從此不在名冊裡
        } else {
            registry.tokens.push(newEntry);
        }
        writeRegistryFileAtomic(cfg.registryPath, registry);
        console.log(`[${ g }] 名冊已更新（${ cfg.registryPath }）`);
    }

    // review 發現的真實缺陷（h19-review-correctness）：--rotate 只重簽這次
    // --grants 指定的環境是對的（名冊層面「縮小範圍不等於撤權」），但如果
    // dist/ 輸出也只用 requestedGrants 重建，會讓「這個人先前被發過、這次
    // 沒重新指定」的環境從交付出去的 .mcp.json 裡憑空消失——即使那個環境
    // 的 token 在名冊裡明明還活著、還沒被撤銷。結果是工程師照著標準流程
    // （整個資料夾轉交企劃）操作，會不小心讓企劃手上的 kit 少一個他理論上
    // 仍有權限的環境。修法：輸出前重新掃過**全部** ALLOWED_GRANTS 的名冊，
    // 只要這個 id 在裡面有條目就一併納入 .mcp.json——這次剛簽的環境用新
    // token，沒被這次觸及、名冊裡本來就有的環境用它現有的 token（不變動
    // 那份名冊，只是把既有的值也放進這次的交付物）。
    const allGrantsForId: string[] = [];
    const tokensForOutput: Record<string, string> = { ...tokensByGrant };
    for (const g of Object.keys(ALLOWED_GRANTS)) {
        if (g in tokensByGrant) {
            allGrantsForId.push(g); // 這次剛簽發/重簽的，一定要含進去
            continue;
        }
        const registry = loadRegistryFile(ALLOWED_GRANTS[g].registryPath);
        const entry = findEntry(registry, id);
        if (entry) {
            allGrantsForId.push(g);
            tokensForOutput[g] = entry.token;
        }
    }

    if (existsSync(distDir)) rmSync(distDir, { recursive: true, force: true });
    mkdirSync(distDir, { recursive: true });
    copyStaticFiles(distDir);

    const mcpJson = buildMcpJson(allGrantsForId, g => tokensForOutput[g]);
    const mcpJsonPath = join(distDir, '.mcp.json');
    writeFileSync(mcpJsonPath, JSON.stringify(mcpJson, null, 2) + '\n', 'utf-8');
    chmodSync(mcpJsonPath, 0o600);
    // 重新解析一次驗證輸出真的是合法 JSON（AC：jq . 通過）。
    JSON.parse(readFileSync(mcpJsonPath, 'utf-8'));

    console.log(`\n完成：${ distDir }`);
    console.log(`這次簽發/重簽：${ requestedGrants.map(g => ALLOWED_GRANTS[g].alias).join('、') }`);
    if (allGrantsForId.length > requestedGrants.length) {
        const carriedOver = allGrantsForId.filter(g => !requestedGrants.includes(g));
        console.log(`一併帶入既有（本次未重簽、名冊裡仍有效）：${ carriedOver.map(g => ALLOWED_GRANTS[g].alias).join('、') }`);
    }
    console.log(`本次輸出的 .mcp.json 完整涵蓋：${ allGrantsForId.map(g => ALLOWED_GRANTS[g].alias).join('、') }`);
    console.log('\n下一步：把整個資料夾透過一對一私密管道交給企劃（不要貼群組/共用文件/會存檔的頻道——');
    console.log('這個資料夾等同這個人的完整 agrabah 帳號）。企劃安裝步驟見資料夾內 README.md。');
    if (rotate) {
        console.log('\n這是 --rotate：本次指定的環境舊 token 已從名冊移除、立刻失效，之前發出去的舊 kit 現在對這些環境打不通了，記得回收。');
    }
}

main();
