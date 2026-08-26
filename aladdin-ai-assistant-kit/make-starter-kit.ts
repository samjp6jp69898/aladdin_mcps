/**
 * make-starter-kit.ts — H19：按企劃逐人產生 starter kit，預填個人 Bearer token。
 *
 * 用法：
 *   bun make-starter-kit.ts --id <企劃唯一id> --name <顯示名> [--grants admin-dev,platform-dev-pk|all] [--rotate]
 *   bun make-starter-kit.ts --list        # 列出兩份名冊目前已核發的 id/顯示名/核發時間（不含 token 值）
 *   bun make-starter-kit.ts --revoke --id <id> --grants env1,env2|all   # 撤銷指定環境的 token（立即生效）
 *   bun make-starter-kit.ts --rename --id <id> --name <新顯示名>        # 只改 display_name（token 不變，不需重新交付）
 *
 * ── id 是什麼 ──────────────────────────────────────────────────────────
 * --id 同時是 (1) token 名冊裡的唯一 id（H3 契約：程式當 key，不可重複、不可
 * 是顯示名）、(2) 輸出目錄名 dist/<id>/。建議用企劃的英文/拼音代稱（例如
 * chenmei），不要用中文或空白——名冊 id 與檔案系統路徑共用同一個值。
 *
 * ── 目前只能發哪些環境 ──────────────────────────────────────────────
 * admin-dev（8789）、platform-dev-pk（8790）、admin-pre（8791）、admin-evi
 * （8792）是真的端到端可用的環境。pre/evi 原本被 tasks.json 的裁定「H38 prod
 * 寫入閘門補強要排在任何接上 pre/evi/prod 的 task 之前」擋著；H38 已完成
 * （狀態 done），2026-08-20 使用者確認後解鎖，並已 launchctl bootstrap 兩個
 * 環境的常駐服務（見 mcps/aladdin-admin/README.md「支援環境清單」）。
 * uat/prod 仍未部署——這兩個環境目前連真實後台網址都沒有，要求會被明確拒絕
 * （不是靜默忽略）。
 *
 * toolsmith（2026-08-26 起併入輸出，唯讀）：toolsmith 已上線，且改用跟
 * admin/platform 一樣「一人一把」的名冊格式（/Users/user/aladdin/obsidian/
 * mcps/aladdin-toolsmith/tokens.json），原本「全員共用一把 token」的疑慮已
 * 不成立。toolsmith 名冊的**唯一寫入者**仍是 manage-tokens.ts（核發/重簽/
 * 撤銷都經由它）——這支腳本只唯讀查閱那份名冊，把找到的條目併進輸出的
 * `.mcp.json`（見 mergeToolsmithGrant()），從不寫回那份名冊。id 不在 toolsmith
 * 名冊裡時，輸出的 `.mcp.json` 就是沒有這個 server，跟以前一樣。
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
 * 用 --grants 縮小範圍不等於撤權，撤權用 --revoke（見下）。
 *
 * ── 撤銷（--revoke，2026-08-26 加入；tg-monitor「Token 權限」頁也走這裡）──
 * --revoke --id <id> --grants <envs|all>：把該 id 從指定環境的名冊移除。
 * --grants 必填、不給預設值，避免誤撤。名冊 fail-closed、每個 request 現讀
 * 檔案，移除後下一個 request 就 401，不需重啟任何服務。撤完重掃全部名冊：
 * 還有存活環境就重建 dist/<id>/（.mcp.json 只含仍有效的 token，對齊
 * h19-review-correctness「dist 必須反映名冊現況」的既有結論）；一個不剩就
 * 整個刪除 dist/<id>/（裡面只剩死 token，留著沒有意義還多一份外洩面）。
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
// 2026-08-22：改用 Cloudflare Tunnel 取代 ngrok（使用者裁定，H28 risk_notes (12) 收斂）。
const DISPATCH_DOMAIN = 'https://mcp.aladdin-assistant.cc';

// toolsmith 名冊——manage-tokens.ts 的唯一寫入者，這裡只唯讀查閱（見檔頭說明）。
const TOOLSMITH_REGISTRY_PATH = join(KIT_DIR, '..', 'aladdin-toolsmith', 'tokens.json');
const TOOLSMITH_URL_PREFIX = '/toolsmith';

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
// PROXY_ROUTES 裡有對應前綴、(3) 沒有被 tasks.json 的既有裁定擋著。
const ALLOWED_GRANTS: Record<string, GrantConfig> = {
    'admin-dev': {
        alias: 'aladdin-admin-dev',
        registryPath: join(KIT_DIR, '..', 'aladdin-admin', 'tokens.json'),
        urlPrefix: '/mcp-admin-dev',
    },
    // 2026-08-20：H38（prod 寫入閘門補強）已完成，H35 的 pre/evi 手動驗證通過後
    // 一直未 bootstrap 的擋門理由不再成立，使用者確認後解鎖並已 launchctl
    // bootstrap 兩個環境的常駐服務（見 mcps/aladdin-admin/README.md「支援環境
    // 清單」與「launchd 常駐骨架」兩節）。
    'admin-pre': {
        alias: 'aladdin-admin-pre',
        registryPath: join(KIT_DIR, '..', 'aladdin-admin', 'tokens.pre.json'),
        urlPrefix: '/mcp-admin-pre',
    },
    'admin-evi': {
        alias: 'aladdin-admin-evi',
        registryPath: join(KIT_DIR, '..', 'aladdin-admin', 'tokens.evi.json'),
        urlPrefix: '/mcp-admin-evi',
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
    'admin-uat': '.env.example 裡雖然預留了 UAT 欄位，但這個環境目前根本沒有部署對應的 hosted server（沒有 plist、沒有名冊檔、也沒有真實後台網址），不是「被擋」而是「還不存在」。',
    'admin-prod': '目前沒有真實 prod 後台網址，這個環境根本沒有部署對應的 hosted server。即使部署了，寫入類 tool 仍會被 session.ts 的 assertProdConfirmed 要求明確 confirm 參數——那是伺服器端的既有機制，跟這支產生器發不發 kit 是兩件事。',
    'platform-dev-6t': 'platform 目前只部署了 dev×PK 一個實例（沒有對應的名冊檔/launchd job），dev×6T 尚未存在。',
    'platform-pre-pk': 'pre 環境的 platform 尚未部署（沒有 plist、沒有名冊檔）。',
    'platform-pre-6t': '同上。',
    'platform-evi-6t': 'evi 環境的 platform 尚未部署（沒有 plist、沒有名冊檔）。',
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
    '.claude/skills/aladdin-mcp-login/SKILL.md',
    '.claude/skills/aladdin-mcp-login/login.sh',
    '.claude/skills/upload-image/SKILL.md',
    '.claude/skills/upload-image/upload.sh',
    'MAC-啟動腳本.command',
    'Windows-啟動腳本.bat',
    'MAC-GUI-啟動腳本.command',
    'Windows-GUI-啟動腳本.bat',
];

const EXECUTABLE_FILES = new Set([
    '.claude/skills/aladdin-mcp-login/login.sh',
    '.claude/skills/upload-image/upload.sh',
    'MAC-啟動腳本.command',
    'MAC-GUI-啟動腳本.command',
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

/**
 * 唯讀查閱 toolsmith 名冊，找到這個 id 的條目就併進 mcpServers；找不到就
 * 什麼都不做（不新增、不報錯——沒有 toolsmith 權限的人本來就不該有這個
 * server）。名冊檔本身不存在（toolsmith server 尚未部署的機器）時也視為
 * 找不到，不擋 kit 產生。從不寫回這份名冊，寫入永遠是 manage-tokens.ts 的事。
 */
function mergeToolsmithGrant(mcpServers: Record<string, unknown>, id: string): void {
    if (!existsSync(TOOLSMITH_REGISTRY_PATH)) return;
    const entry = findEntry(loadRegistryFile(TOOLSMITH_REGISTRY_PATH), id);
    if (!entry) return;
    mcpServers['aladdin-toolsmith'] = {
        type: 'http',
        url: `${ DISPATCH_DOMAIN }${ TOOLSMITH_URL_PREFIX }/mcp`,
        headers: { Authorization: `Bearer ${ entry.token }` },
    };
}

function printUsageAndExit(code: number): never {
    console.error(`用法：
  bun make-starter-kit.ts --id <企劃唯一id> --name <顯示名> [--grants ${ Object.keys(ALLOWED_GRANTS).join(',') }|all] [--rotate]
  bun make-starter-kit.ts --revoke --id <id> --grants <envs|all>   # 撤銷指定環境的 token（立即生效）
  bun make-starter-kit.ts --rename --id <id> --name <新顯示名>      # 只改 display_name（token 不變）
  bun make-starter-kit.ts --rebuild --id <id>                       # 不核發/重簽任何 token，只重組 .mcp.json（例如撈最新 toolsmith token）
  bun make-starter-kit.ts --list

目前支援的 --grants（預設給 ${ DEFAULT_GRANTS.join(' + ') }，可用逗號分隔指定子集；all = 全部）：
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

/**
 * --rename：把 id 在所有名冊裡的 display_name 換掉。token 與 issued_at 完全
 * 不動（display_name 只供人類閱讀，不參與認證），dist/<id>/ 的 .mcp.json 也
 * 不含顯示名，所以不需要重建、不需要重新交付。
 */
function cmdRename(id: string, newName: string): void {
    const updated: string[] = [];
    for (const g of Object.keys(ALLOWED_GRANTS)) {
        const cfg = ALLOWED_GRANTS[g];
        const registry = loadRegistryFile(cfg.registryPath);
        const entry = findEntry(registry, id);
        if (!entry) continue;
        entry.display_name = newName;
        writeRegistryFileAtomic(cfg.registryPath, registry);
        updated.push(g);
        console.log(`[${ g }] display_name 已更新（${ cfg.registryPath }）`);
    }
    if (updated.length === 0) {
        console.error(`id "${ id }" 不存在於任何名冊，本次不做任何修改。`);
        process.exit(1);
    }
    console.log(`\n完成：id "${ id }" 的 display_name 已改為「${ newName }」（${ updated.join('、') }）。token 與核發時間不變，不需要重新交付 kit。`);
}

/** --revoke：把 id 從指定環境的名冊移除，並讓 dist/<id>/ 對齊名冊現況（見檔頭說明）。 */
function cmdRevoke(id: string, requestedGrants: string[]): void {
    // ── 第一階段：只檢查，不寫入 ──────────────────────────────────────
    const toRemove: string[] = [];
    for (const g of requestedGrants) {
        const registry = loadRegistryFile(ALLOWED_GRANTS[g].registryPath);
        if (findEntry(registry, id)) toRemove.push(g);
    }
    if (toRemove.length === 0) {
        console.error(`id "${ id }" 在指定環境（${ requestedGrants.join(', ') }）的名冊裡都沒有條目，本次不做任何修改。`);
        process.exit(1);
    }

    // ── 第二階段：逐名冊移除（atomic 寫入；fail-closed 名冊即時生效）───
    for (const g of toRemove) {
        const cfg = ALLOWED_GRANTS[g];
        const registry = loadRegistryFile(cfg.registryPath);
        registry.tokens = registry.tokens.filter(t => t.id !== id);
        writeRegistryFileAtomic(cfg.registryPath, registry);
        console.log(`[${ g }] 已撤銷（${ cfg.registryPath }）`);
    }

    // 重掃全部名冊決定 dist/<id>/ 去留：還有存活環境就重建（.mcp.json 只含
    // 仍有效 token）；一個不剩就整個移除。
    const remaining: string[] = [];
    const tokensForOutput: Record<string, string> = {};
    for (const g of Object.keys(ALLOWED_GRANTS)) {
        const entry = findEntry(loadRegistryFile(ALLOWED_GRANTS[g].registryPath), id);
        if (entry) {
            remaining.push(g);
            tokensForOutput[g] = entry.token;
        }
    }
    // toolsmith 是唯讀併入（見檔頭說明），不算在 ALLOWED_GRANTS 的 remaining
    // 裡，但決定「dist/<id>/ 該整個刪掉還是重建」時要一併考慮——這個人的 kit
    // 環境全數被撤，不代表他的 toolsmith 權限也沒了，刪掉 dist 會連帶讓已經
    // 併進去的 toolsmith 設定一起消失。
    const hasToolsmith = existsSync(TOOLSMITH_REGISTRY_PATH) && !!findEntry(loadRegistryFile(TOOLSMITH_REGISTRY_PATH), id);
    const distDir = join(KIT_DIR, 'dist', id);
    if (remaining.length === 0 && !hasToolsmith) {
        if (existsSync(distDir)) rmSync(distDir, { recursive: true, force: true });
        console.log(`\nid "${ id }" 已無任何環境權限，dist/${ id }/ 已一併移除。`);
    } else if (remaining.length === 0) {
        // kit 環境全數被撤，但仍有 toolsmith：保留 dist/，重建成只含 toolsmith
        // 的 .mcp.json，不整個刪掉。
        if (existsSync(distDir)) rmSync(distDir, { recursive: true, force: true });
        mkdirSync(distDir, { recursive: true });
        copyStaticFiles(distDir);
        const mcpJsonPath = join(distDir, '.mcp.json');
        const mcpJson = buildMcpJson(remaining, g => tokensForOutput[g]) as { mcpServers: Record<string, unknown> };
        mergeToolsmithGrant(mcpJson.mcpServers, id);
        writeFileSync(mcpJsonPath, JSON.stringify(mcpJson, null, 2) + '\n', 'utf-8');
        chmodSync(mcpJsonPath, 0o600);
        JSON.parse(readFileSync(mcpJsonPath, 'utf-8'));
        console.log(`\nid "${ id }" 已無任何 kit 環境，但仍有 toolsmith 權限：dist/${ id }/ 已重建，只含 aladdin-toolsmith。`);
    } else if (existsSync(distDir)) {
        rmSync(distDir, { recursive: true, force: true });
        mkdirSync(distDir, { recursive: true });
        copyStaticFiles(distDir);
        const mcpJsonPath = join(distDir, '.mcp.json');
        const mcpJson = buildMcpJson(remaining, g => tokensForOutput[g]) as { mcpServers: Record<string, unknown> };
        mergeToolsmithGrant(mcpJson.mcpServers, id);
        writeFileSync(mcpJsonPath, JSON.stringify(mcpJson, null, 2) + '\n', 'utf-8');
        chmodSync(mcpJsonPath, 0o600);
        JSON.parse(readFileSync(mcpJsonPath, 'utf-8'));
        console.log(`\ndist/${ id }/ 已重建，僅含仍有效環境：${ remaining.join('、') }。對方手上的舊 kit 仍含被撤環境的死 token，記得把更新後的 kit 重新交付。`);
    } else {
        console.log(`\n仍有效環境：${ remaining.join('、') }（dist/${ id }/ 不存在，未重建）。`);
    }
    console.log('撤銷即刻生效：名冊 fail-closed、每個 request 現讀檔案，被撤環境的舊 token 下一個 request 起 401。');
}

/**
 * --rebuild：不核發、不重簽任何 kit 環境的 token，只是把「這個 id 目前在
 * 各名冊（含唯讀併入的 toolsmith）裡實際有效的一切」重新組成 dist/<id>/
 * .mcp.json 覆蓋輸出。用途：manage-tokens.ts 核發/重簽 toolsmith 之後，
 * 用這個指令把新的 toolsmith token 併進這個人既有的 kit 交付物，不需要
 * 連帶重簽任何一個 kit 環境。
 */
function cmdRebuild(id: string): void {
    const allGrantsForId: string[] = [];
    const tokensForOutput: Record<string, string> = {};
    for (const g of Object.keys(ALLOWED_GRANTS)) {
        const entry = findEntry(loadRegistryFile(ALLOWED_GRANTS[g].registryPath), id);
        if (entry) {
            allGrantsForId.push(g);
            tokensForOutput[g] = entry.token;
        }
    }
    const hasToolsmith = existsSync(TOOLSMITH_REGISTRY_PATH) && !!findEntry(loadRegistryFile(TOOLSMITH_REGISTRY_PATH), id);
    if (allGrantsForId.length === 0 && !hasToolsmith) {
        console.error(`id "${ id }" 在任何 kit 環境或 toolsmith 名冊都沒有條目，無法重建。`);
        process.exit(1);
    }

    const distDir = join(KIT_DIR, 'dist', id);
    if (existsSync(distDir)) rmSync(distDir, { recursive: true, force: true });
    mkdirSync(distDir, { recursive: true });
    copyStaticFiles(distDir);

    const mcpJson = buildMcpJson(allGrantsForId, g => tokensForOutput[g]) as { mcpServers: Record<string, unknown> };
    mergeToolsmithGrant(mcpJson.mcpServers, id);
    const mcpJsonPath = join(distDir, '.mcp.json');
    writeFileSync(mcpJsonPath, JSON.stringify(mcpJson, null, 2) + '\n', 'utf-8');
    chmodSync(mcpJsonPath, 0o600);
    JSON.parse(readFileSync(mcpJsonPath, 'utf-8'));

    console.log(`\ndist/${ id }/ 已重建（未核發/重簽任何 token，只是把名冊現況重新組成 .mcp.json）：${ [...allGrantsForId.map(g => ALLOWED_GRANTS[g].alias), ...(hasToolsmith ? ['aladdin-toolsmith'] : [])].join('、') }`);
}

function main(): void {
    const { values } = parseArgs({
        options: {
            id: { type: 'string' },
            name: { type: 'string' },
            grants: { type: 'string' },
            rotate: { type: 'boolean', default: false },
            revoke: { type: 'boolean', default: false },
            rename: { type: 'boolean', default: false },
            rebuild: { type: 'boolean', default: false },
            list: { type: 'boolean', default: false },
            help: { type: 'boolean', default: false },
        },
    });

    if (values.help) printUsageAndExit(0);
    if (values.list) {
        cmdList();
        return;
    }
    if (values.rebuild === true) {
        if (!values.id) {
            console.error('--rebuild 需要 --id。\n');
            printUsageAndExit(1);
        }
        cmdRebuild(values.id);
        return;
    }

    const revoke = values.revoke === true;
    const id = values.id;
    const displayName = values.name;
    if (!id || (!revoke && !displayName)) {
        console.error(revoke ? '缺少 --id。\n' : '缺少 --id 或 --name。\n');
        printUsageAndExit(1);
    }
    if (!ID_PATTERN.test(id)) {
        console.error(`--id "${ id }" 不合法：只能小寫英數字/連字號/底線，2-32 字元，且必須以小寫英文字母開頭（同時當名冊 id 與輸出目錄名，不能用中文或空白）。`);
        process.exit(1);
    }

    if (values.rename === true) {
        if (!displayName) {
            console.error('--rename 需要 --name（新的顯示名）。\n');
            printUsageAndExit(1);
        }
        cmdRename(id, displayName);
        return;
    }

    // 去重：--grants admin-dev,admin-dev 這種輸入不該讓同一個環境的 token
    // 被重複簽發兩次（結果雖然不錯——最後寫進名冊的就是最後一次生成的那把
    // ——但白白多產生一把不會被用到的 token、多寫一次名冊，沒有意義）。
    // `all` 捷徑：展開成 ALLOWED_GRANTS 全部；可與其他名字混寫，展開後照樣去重。
    const rawGrants = values.grants ? values.grants.split(',').map(s => s.trim()).filter(Boolean) : DEFAULT_GRANTS;
    const requestedGrants = [...new Set(rawGrants.flatMap(g => g.toLowerCase() === 'all' ? Object.keys(ALLOWED_GRANTS) : [g]))];
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

    if (revoke) {
        if (!values.grants) {
            console.error('--revoke 必須明確指定 --grants（要撤哪些環境；all = 全部），不提供預設值以免誤撤。');
            process.exit(1);
        }
        cmdRevoke(id, requestedGrants);
        return;
    }
    if (!displayName) {
        // 理論上到不了（前面已擋），這裡只為了讓後續型別收斂成 string。
        console.error('缺少 --name。\n');
        printUsageAndExit(1);
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

    const mcpJson = buildMcpJson(allGrantsForId, g => tokensForOutput[g]) as { mcpServers: Record<string, unknown> };
    mergeToolsmithGrant(mcpJson.mcpServers, id);
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
