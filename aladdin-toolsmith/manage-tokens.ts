/**
 * manage-tokens.ts — aladdin-toolsmith per-user token 名冊管理 CLI。
 *
 * toolsmith 是工程師工具（deploy-pipeline 的身分歸屬），不屬於企劃 starter
 * kit 的範圍（kit 範本刻意沒有 toolsmith 欄位，見 make-starter-kit.ts 檔頭），
 * 所以名冊管理不塞進 make-starter-kit.ts，而由這支獨立 CLI 負責——它是
 * tokens.json 的唯一寫入者（tg-monitor「Token 權限」頁經行程邊界呼叫這裡，
 * 不自己改 JSON）。
 *
 * 用法：
 *   bun manage-tokens.ts --issue  --id <id> --name <顯示名> [--quiet]   # 簽發並把設定發到 TG_KIT_ADMIN_CHAT_ID
 *   bun manage-tokens.ts --rotate --id <id> [--name <顯示名>] [--quiet] # 換新 token（舊的立即失效）並發 TG
 *   bun manage-tokens.ts --revoke --id <id>                             # 撤銷（立即生效）
 *   bun manage-tokens.ts --rename --id <id> --name <新顯示名>           # 只改 display_name（token 不變）
 *   bun manage-tokens.ts --list
 *
 * 紀律（沿用 make-starter-kit.ts）：
 * - 名冊 fail-closed、每個 request 現讀檔案（見 src/auth.ts 檔頭），寫入一律
 *   暫存檔 + rename 的 atomic 手法，絕不就地覆寫。這支腳本是 tokens.json 的
 *   唯一寫入者（issue/rotate/revoke/rename 全部經由它）——2026-08-26 起
 *   make-starter-kit.ts 會唯讀查閱這份名冊、把找到的條目併進 kit 的
 *   .mcp.json，但從不寫回，這個「唯一寫入者」不變。
 * - token 值絕不印到 stdout/stderr——交付走 tg-notify.sh 直送 kit 管理者
 *   （TG_KIT_ADMIN_CHAT_ID，即 Landon）的 Telegram，訊息含可直接轉交工程師
 *   的 .mcp.json 片段（跟 kit zip 走同一個私訊管道）。
 * - --quiet：跳過這則 TG 訊息（不影響名冊寫入）。供 tg-monitor「Token 權限」
 *   頁在此人「同時也有 kit 環境」時使用——那種情況下 make-starter-kit.ts 會
 *   把新核發/重簽的 token 唯讀併進重建後的 .mcp.json，隨 kit zip 一起送出，
 *   這裡就不用再單獨發一則「請手動貼進 .mcp.json」的訊息，避免同一個 token
 *   重複出現在兩則 TG 訊息裡。此人沒有任何 kit 環境時（純 toolsmith 名冊）
 *   不要傳這個旗標——那是唯一會通知到本人的管道。
 */
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';

const TOOLSMITH_DIR = dirname(new URL(import.meta.url).pathname);
const REGISTRY_PATH = join(TOOLSMITH_DIR, 'tokens.json');
// 對外 URL：telegram-dispatcher mcp-proxy.ts PROXY_ROUTES 的 '/toolsmith' → 8788。
const TOOLSMITH_URL = 'https://mcp.aladdin-assistant.cc/toolsmith/mcp';
const TG_NOTIFY_SCRIPT = '/Users/user/aladdin/obsidian/scripts/tg-notify.sh';
const ROOT_ENV_FILE = '/Users/user/aladdin/.env';

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

function loadRegistry(): RegistryFile {
    if (!existsSync(REGISTRY_PATH)) {
        throw new Error(`名冊檔不存在：${ REGISTRY_PATH }（部署設定問題，請先確認 toolsmith server 是否已正確部署）`);
    }
    const parsed: unknown = JSON.parse(readFileSync(REGISTRY_PATH, 'utf-8'));
    if (parsed === null || typeof parsed !== 'object' || !Array.isArray((parsed as RegistryFile).tokens)) {
        throw new Error(`名冊檔格式不對，缺少 tokens 陣列：${ REGISTRY_PATH }`);
    }
    return parsed as RegistryFile;
}

/** 暫存檔 + rename：絕不就地覆寫正在被 fail-closed 認證邏輯即時讀取的名冊檔。 */
function writeRegistryAtomic(registry: RegistryFile): void {
    const serialized = JSON.stringify(registry, null, 2) + '\n';
    JSON.parse(serialized); // 寫入前驗證，避免序列化意外讓全體 401
    const tmpPath = `${ REGISTRY_PATH }.tmp-${ process.pid }-${ randomBytes(4).toString('hex') }`;
    writeFileSync(tmpPath, serialized, 'utf-8');
    renameSync(tmpPath, REGISTRY_PATH);
}

function readKitAdminChatId(): string {
    const line = readFileSync(ROOT_ENV_FILE, 'utf8').split('\n').find(l => l.startsWith('TG_KIT_ADMIN_CHAT_ID='));
    const v = line ? line.slice('TG_KIT_ADMIN_CHAT_ID='.length).trim() : '';
    if (!v) throw new Error(`.env 缺 TG_KIT_ADMIN_CHAT_ID（${ ROOT_ENV_FILE }）`);
    return v;
}

/** tg-notify.sh 紀律：一律 exit 0、結果印一行，成功與否看輸出是否為 TG_SENT。 */
function sendViaTgNotify(text: string): void {
    const out = execFileSync('bash', [ TG_NOTIFY_SCRIPT, '--chat-id', readKitAdminChatId(), '--text', text ], {
        encoding: 'utf8',
        timeout: 60_000,
    }).trim();
    if (!out.startsWith('TG_SENT')) throw new Error(`tg-notify.sh 發送失敗：${ out }`);
    console.log(out);
}

function buildDeliveryText(action: '簽發' | '重簽', entry: TokenRegistryEntry): string {
    return [
        `toolsmith token 已${ action }：${ entry.id }（${ entry.display_name }）${ action === '重簽' ? '，舊 token 已失效' : '' }。`,
        '請把以下設定轉交本人，貼進他自己的 .mcp.json 的 mcpServers 底下：',
        '',
        JSON.stringify({
            'aladdin-toolsmith': {
                type: 'http',
                url: TOOLSMITH_URL,
                headers: { Authorization: `Bearer ${ entry.token }` },
            },
        }, null, 2),
        '',
        '注意：這把 token 等同他在 toolsmith 的身分（部署 commit、Telegram 通知都會歸屬到他），',
        '只能一對一私訊轉交，不要貼進群組、共用文件或會存檔的頻道。',
    ].join('\n');
}

function printUsageAndExit(code: number): never {
    console.error(`用法：
  bun manage-tokens.ts --issue  --id <id> --name <顯示名>   # 簽發並把設定發到 TG_KIT_ADMIN_CHAT_ID
  bun manage-tokens.ts --rotate --id <id> [--name <顯示名>] # 換新 token（舊的立即失效）並發 TG
  bun manage-tokens.ts --revoke --id <id>                   # 撤銷（立即生效）
  bun manage-tokens.ts --rename --id <id> --name <新顯示名> # 只改 display_name（token 不變）
  bun manage-tokens.ts --list`);
    process.exit(code);
}

function main(): void {
    const { values } = parseArgs({
        options: {
            id: { type: 'string' },
            name: { type: 'string' },
            issue: { type: 'boolean', default: false },
            rotate: { type: 'boolean', default: false },
            revoke: { type: 'boolean', default: false },
            rename: { type: 'boolean', default: false },
            list: { type: 'boolean', default: false },
            help: { type: 'boolean', default: false },
            quiet: { type: 'boolean', default: false },
        },
    });

    if (values.help) printUsageAndExit(0);

    if (values.list) {
        const registry = loadRegistry();
        if (registry.tokens.length === 0) {
            console.log('（名冊為空）');
            return;
        }
        for (const t of registry.tokens) {
            console.log(`${ t.id }\t${ t.display_name }\t核發於 ${ t.issued_at }`);
        }
        return;
    }

    const modes = [ 'issue', 'rotate', 'revoke', 'rename' ].filter(m => values[m as 'issue'] === true);
    if (modes.length !== 1) {
        console.error('必須指定恰好一種操作：--issue / --rotate / --revoke / --rename / --list。\n');
        printUsageAndExit(1);
    }
    const mode = modes[0];

    const id = values.id;
    if (!id) {
        console.error('缺少 --id。\n');
        printUsageAndExit(1);
    }
    if (!ID_PATTERN.test(id)) {
        console.error(`--id "${ id }" 不合法：只能小寫英數字/連字號/底線，2-32 字元，且必須以小寫英文字母開頭。`);
        process.exit(1);
    }

    const registry = loadRegistry();
    const idx = registry.tokens.findIndex(t => t.id === id);

    if (mode === 'issue') {
        if (!values.name) {
            console.error('--issue 需要 --name（顯示名）。');
            process.exit(1);
        }
        if (idx >= 0) {
            console.error(`id "${ id }" 已存在（display_name=${ registry.tokens[idx].display_name }，核發於 ${ registry.tokens[idx].issued_at }），本次不做任何修改。要換新 token 請用 --rotate。`);
            process.exit(1);
        }
        const entry: TokenRegistryEntry = {
            id,
            token: randomBytes(32).toString('base64url'),
            display_name: values.name,
            issued_at: new Date().toISOString(),
        };
        registry.tokens.push(entry);
        writeRegistryAtomic(registry);
        console.log(`[toolsmith] 名冊已更新（${ REGISTRY_PATH }）`);
        if (values.quiet) {
            console.log(`完成：toolsmith token 已簽發（--quiet，未另發 TG 訊息，token 不落地、不印出）。`);
        } else {
            sendViaTgNotify(buildDeliveryText('簽發', entry));
            console.log(`完成：toolsmith token 已簽發並發到 kit 管理者 TG（token 不落地、不印出）。`);
        }
        return;
    }

    if (idx < 0) {
        console.error(`id "${ id }" 不存在於 toolsmith 名冊，本次不做任何修改。`);
        process.exit(1);
    }

    if (mode === 'rotate') {
        const entry: TokenRegistryEntry = {
            id,
            token: randomBytes(32).toString('base64url'),
            display_name: values.name ?? registry.tokens[idx].display_name,
            issued_at: new Date().toISOString(),
        };
        registry.tokens[idx] = entry;
        writeRegistryAtomic(registry);
        console.log(`[toolsmith] 名冊已更新（${ REGISTRY_PATH }），舊 token 立即失效`);
        if (values.quiet) {
            console.log(`完成：toolsmith token 已重簽（--quiet，未另發 TG 訊息，token 不落地、不印出）。`);
        } else {
            sendViaTgNotify(buildDeliveryText('重簽', entry));
            console.log(`完成：toolsmith token 已重簽並發到 kit 管理者 TG（token 不落地、不印出）。`);
        }
        return;
    }

    if (mode === 'revoke') {
        registry.tokens.splice(idx, 1);
        writeRegistryAtomic(registry);
        console.log(`[toolsmith] 已撤銷（${ REGISTRY_PATH }）。撤銷即刻生效：名冊 fail-closed、每個 request 現讀檔案，下一個 request 起 401。`);
        return;
    }

    // rename
    if (!values.name) {
        console.error('--rename 需要 --name（新的顯示名）。');
        process.exit(1);
    }
    registry.tokens[idx].display_name = values.name;
    writeRegistryAtomic(registry);
    console.log(`[toolsmith] display_name 已改為「${ values.name }」（token 與核發時間不變）。`);
}

main();
