/**
 * check-sentinel-fields.ts — 決定性稽核：找出 MCP tool 建 rajah search 訊息時
 * 「漏帶哨兵值欄位」的缺陷。
 *
 * ## 這支腳本在防什麼
 *
 * MCP tool 用 `XxxSearch.create({ ... })` 建訊息時，**沒帶到的欄位會取 protobuf
 * 預設值**（數字 0、字串 ''、bool false）。若 agrabah 後端對該欄位的「不篩選 /
 * 全部」語意**不是** protobuf 預設值（常見是 `-1`，或 enum 的 `all = 99`），
 * 那個沒帶的欄位就會變成一個**真實的篩選條件**送出去——RPC 回 success、rows 卻
 * 被靜默縮小甚至變成空集合，沒有任何錯誤訊息可循。
 *
 * 真實出包（2026-09-02）：`aladdin_platform_game_vendor_platform_list_games`
 * 建 search 時漏帶 `displayTag` / `rebateTag`（後端 `displayTag === -1` 才是
 * 「全部」，0 是合法分類值「未知」），導致 VR 廠商（gameVendorId=29）在 pk-pre
 * 平台明明有 23 款啟用中的遊戲，tool 卻一律回 `rows: []`、`totalPage: 0`，
 * 企劃端完全看不出是查詢方式錯了還是資料真的沒有。
 *
 * ## 為什麼要用腳本，不是寫進檢查清單就好
 *
 * `method-category-checklist.md` 已經有「zod schema 必須對照 rajah model 全部
 * 欄位」這條，但那條的用意是「別漏掉可用的篩選條件」，讀的人不會意識到「漏帶
 * 等於多送一個錯誤條件」。這是靠人記得就會漏的類型，所以額外做成可重跑的
 * 決定性檢查——新增 tool 時跑一次，改動既有 tool 時跑一次，比對輸出即可。
 *
 * ## 做法（兩階段，都是從 source 現算，不吃任何快取或人工清單）
 *
 * 階段一：掃兩個 MCP server 的 `src/tools/*.ts`，找 `<Model>.create({...})` /
 *   `.fromObject({...})`，收集「tool 真的會建構的 model」與每個建構點實際帶了
 *   哪些 key。**清冊只針對這些 model 現算**——先限定範圍再去後端查，而不是把
 *   整個 agrabah 的 enum 比較都掃進來，否則清冊會被大量與篩選無關的分支邏輯
 *   （`if (edit.type === DownloadLinkTypeEnum.iosAppStoreApp)` 之類）淹沒。
 *
 * 階段二：掃 agrabah `src/servers/**\/*.ts`，用 method 簽名把區域變數對應回
 *   rajah model 型別（`async methodListGames(context, search: PlatformGameVendorGameEssentialSearch, ...)`），
 *   在該 method 內找 `search.<欄位> !== <哨兵>` 這類判斷，且**必須確認這個判斷
 *   真的在控制一個篩選條件**（附近有 `conditions.push` / `filterCondition +=` /
 *   `parameters.push` 這類套用動作，或寫成 `skip:` 形式的篩選開關）才收進清冊——
 *   單純的分支判斷不是哨兵。enum 形式的哨兵（`LoginDeviceEnum.all`）會回頭到
 *   rajah 解出真正數值——解出來是 0 的（如 `ActivityFlagUsedInEnum.all = 0`）
 *   代表「全部」剛好等於 protobuf 預設值，漏帶無害，直接剔除，不誤報。
 *
 * ## 偵測器二：zod schema 自己承認了哨兵值，卻沒設 default
 *
 * 階段二那條鏈只認得「後端 method 直接拿 search.x 跟哨兵比較」。2026-09-02 的掃描
 * 實測到它會漏掉一種：欄位經由 manager 間接傳遞才碰到哨兵判斷——
 * `list_agent_bet_records.ts` 的 `displayTag` 送進
 * `agent_report_manager.ts:2163`，在那裡當 overrides 蓋掉
 * `game_back_office_search_helper.ts:18` factory 原本鋪好的 `-1`，最後才在
 * `game_record_platform.ts:170` 被 `!== -1` 判斷到。跨三個檔案，靜態比對追不動。
 *
 * 補這個偵測器的依據是一個很好用的訊號：**這種 tool 的 zod `.describe()` 幾乎
 * 都已經寫了「-1=全部」**——寫的人知道有哨兵值，只是沒把它設成 `.default(-1)`，
 * 於是欄位省略時仍然落回 protobuf 的 0。所以只要找「`.optional()` + describe 裡
 * 提到 -1 或全部」就能抓到，完全不必追後端傳遞鏈。
 *
 * 侷限（誠實列出，不要把這支腳本當成充分條件）：
 * - 只認得後端寫成 `search.x !== SENTINEL` 這種**直接比較**的哨兵。若某支
 *   method 把判斷包進 helper 函式或用別的寫法表達同一語意，這裡掃不到——
 *   腳本是縮小漏網面，不是取代「讀後端實作」這一步。
 * - 只認得物件實字（object literal）形式的建構。若 tool 先組一個變數再傳進
 *   `create()`，這裡看不到它帶了哪些 key，會被歸進 SKIPPED 區塊要求人工確認，
 *   不會被靜默當成通過。
 * - 偵測器二只是啟發式：`.describe()` 沒提到哨兵值的欄位它也抓不到。兩個偵測器
 *   是互補的兜底，不是「跑過就保證沒有這類缺陷」。真正的把關仍然是新增 tool 時
 *   逐欄去讀後端怎麼判斷（method-category-checklist.md 第 2.5 節）。
 *
 * 用法：
 *   bun /Users/user/aladdin/aladdin_mcps/scripts/check-sentinel-fields.ts
 *   bun .../check-sentinel-fields.ts --inventory   # 只印哨兵值清冊
 *   bun .../check-sentinel-fields.ts --json        # 命中清單的機器可讀版本
 * 有命中時 exit code 1，乾淨時 exit 0。
 *
 * `--json` 給 aladdin-toolsmith 的 deploy-pipeline Gate A 消費（2026-09-02 加）：
 * 它會在套用檔案前後各跑一次，只有「baseline 沒有、套用後才出現」的命中才擋下
 * 部署——比照同一個 Gate 對 tsc 的做法，理由也一樣：不能拿「有沒有命中」當標準，
 * 否則某支不相干 tool 的既有問題會擋死一次跟它無關的部署。輸出是穩定排序的
 * key 陣列（不含行號等會隨無關改動漂移的欄位），好讓前後兩次的集合能精確相減。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const AGRABAH_SERVERS = '/Users/user/aladdin/agrabah/src/servers';
const RAJAH_SERVICES = '/Users/user/aladdin/rajah/services';
const TOOL_DIRS = [
    '/Users/user/aladdin/aladdin_mcps/aladdin-platform/src/tools',
    '/Users/user/aladdin/aladdin_mcps/aladdin-admin/src/tools',
];

/** protobuf 預設值的等價寫法：後端拿這些當「不篩選」的判斷基準時，漏帶欄位無害。 */
const DEFAULT_EQUIVALENT = new Set([ '0', "''", '""', '``', 'undefined', 'null', 'false', '[]' ]);

interface SentinelEntry {
    model: string;
    field: string;
    sentinelText: string;
    sentinelValue: number | null;
    evidence: string;
}

function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (full.endsWith('.ts')) out.push(full);
    }
    return out;
}

/** 從 rajah 解出 `EnumName.member` 的實際數值；解不出來回 null（呼叫端保守視為哨兵）。 */
const enumCache = new Map<string, Map<string, number>>();
function resolveEnumValue(enumName: string, member: string): number | null {
    if (!enumCache.has(enumName)) {
        const members = new Map<string, number>();
        for (const file of readdirSync(RAJAH_SERVICES).filter(f => f.endsWith('.rajah'))) {
            const text = readFileSync(join(RAJAH_SERVICES, file), 'utf8');
            const m = new RegExp(`enum\\s+${ enumName }\\s*\\{([\\s\\S]*?)\\n\\}`).exec(text);
            if (!m) continue;
            for (const line of m[ 1 ].split('\n')) {
                const mm = /^\s*(\w+)\s*=\s*(-?\d+)/.exec(line);
                if (mm) members.set(mm[ 1 ], Number(mm[ 2 ]));
            }
            break;
        }
        enumCache.set(enumName, members);
    }
    const v = enumCache.get(enumName)!.get(member);
    return v === undefined ? null : v;
}

/**
 * 判斷這個比較是不是真的在控制「要不要套用這個篩選條件」（而不是普通分支邏輯）。
 * 只認兩種形狀，其餘一律不收——寧可漏報也不要用誤報淹沒清冊：
 *
 *   1. `search.x !== SENTINEL` 且後面緊接著把條件套進查詢
 *      （`if (search.status !== -1) { conditions.push('status = ?') }`）。
 *      這是「等於哨兵就跳過篩選」的標準寫法。
 *   2. `search.x >= 0`（或 `> -1`）這種「負數才代表全部」的守衛
 *      （`audit_admin.ts:113` 的 `if (search.systemId >= 0)`，註解明寫
 *      「-1 = 全部，0 以上皆為合法 systemId（含 SystemIdEnum.core = 0）」）。
 *      這一型跟 `!==` 型一樣危險、寫法卻完全不同，是 2026-09-02 掃描時由
 *      獨立覆核發現本腳本原本抓不到而補上的。注意 `> 0` 不算——那代表 0
 *      本身就會跳過篩選，剛好等於 protobuf 預設值，漏帶無害。
 *   3. `EnumName[search.x] !== undefined` 這種「查得到就當成合法篩選值」的守衛
 *      （`information_back_office/services/common.ts:98`）。陷阱在於 protobuf
 *      的 `StatusEnum[0]` 是 `'unknown'`、**不是** undefined，所以漏帶的 0 會
 *      被當成真實條件 `status = 0` 送進 SQL；要跳過篩選得送一個不在 enum 裡的
 *      值（abu 用 `IGNORE_STATUS = -1`）。
 *   4. 寫成 `skip:` 欄位的篩選開關
 *      （`{ tag: search.displayTag, skip: search.displayTag === -1 }`），
 *      它的套用動作在更後面，用位置判斷不到，改認 `skip:` 這個關鍵字。
 *
 * 刻意**不收** `===` 形式的一般比較：實測會誤報——`game_vendor_admin.ts:178`
 * 的 `if (search.maintenanceStatus)` 是 truthy 外層守衛（漏帶＝不篩選，安全），
 * 裡面的 `search.maintenanceStatus === StatusEnum.enabled` 只是在選要組哪一段
 * SQL，不是決定要不要篩。
 */
function looksLikeFilterGuard(body: string, matchIndex: number, matchText: string): boolean {
    if (/skip\s*:/.test(body.slice(Math.max(0, matchIndex - 60), matchIndex + matchText.length + 5))) return true;
    if (!matchText.includes('!==')) return false;
    const ahead = body.slice(matchIndex, matchIndex + 400);
    return /conditions\.push|filterCondition\s*\+=|parameters\.push|whereClause|\.andWhere\(|\.where\(/.test(ahead);
}

/** 階段二：只針對 tool 真的會建構的 model，從 agrabah 後端實作現算哨兵值清冊。 */
function buildInventory(wantedModels: Set<string>): SentinelEntry[] {
    const entries: SentinelEntry[] = [];
    const seen = new Set<string>();

    for (const file of walk(AGRABAH_SERVERS)) {
        const text = readFileSync(file, 'utf8');
        const lines = text.split('\n');

        // 找每支 method 的簽名與其涵蓋的行範圍（到下一支 method 為止）。
        const methodRe = /async\s+method(\w+)\s*\(([\s\S]*?)\)\s*:\s*Promise/g;
        const methods: Array<{ name: string; params: string; startLine: number; endLine: number }> = [];
        let m: RegExpExecArray | null;
        while ((m = methodRe.exec(text)) !== null) {
            const startLine = text.slice(0, m.index).split('\n').length;
            methods.push({ name: m[ 1 ], params: m[ 2 ], startLine, endLine: lines.length });
        }
        for (let i = 0; i < methods.length - 1; i++) methods[ i ].endLine = methods[ i + 1 ].startLine - 1;

        for (const method of methods) {
            // 參數名 → rajah model 型別（只收 PascalCase 的具名型別）。
            const varTypes = new Map<string, string>();
            for (const p of method.params.split(',')) {
                const pm = /(\w+)\s*:\s*([A-Z]\w+)/.exec(p.trim());
                if (pm) varTypes.set(pm[ 1 ], pm[ 2 ]);
            }
            if (varTypes.size === 0) continue;

            const body = lines.slice(method.startLine - 1, method.endLine).join('\n');
            // `EnumName[search.x] !== undefined`：查得到 enum 成員就當合法篩選值。
            // protobuf 預設 0 在多數 enum 裡是有定義的（`StatusEnum[0] = 'unknown'`），
            // 所以漏帶會變成真實條件，要跳過得送不在 enum 裡的值（慣例 -1）。
            const enumIndexRe = /([A-Z]\w+)\[\s*(\w+)\.(\w+)\s*\]\s*!==\s*undefined/g;
            let ei: RegExpExecArray | null;
            while ((ei = enumIndexRe.exec(body)) !== null) {
                const [ , enumName, varName2, field2 ] = ei;
                const model2 = varTypes.get(varName2);
                if (!model2 || !wantedModels.has(model2)) continue;
                if (resolveEnumValue(enumName, 'unknown') !== 0 && resolveEnumValue(enumName, 'none') !== 0) continue;
                const key2 = `${ model2 }.${ field2 }`;
                if (seen.has(key2)) continue;
                seen.add(key2);
                const lineNo2 = method.startLine - 1 + body.slice(0, ei.index).split('\n').length;
                entries.push({
                    model: model2, field: field2, sentinelText: `不在 ${ enumName } 裡的值（慣例 -1）`, sentinelValue: -1,
                    evidence: `${ file.replace('/Users/user/aladdin/', '') }:${ lineNo2 }`,
                });
            }

            const cmpRe = /(\w+)\.(\w+)\s*(!==|===|>=|>)\s*([A-Za-z0-9_.\-]+)/g;
            let c: RegExpExecArray | null;
            while ((c = cmpRe.exec(body)) !== null) {
                const [ , varName, field, op, rhs ] = c;
                const model = varTypes.get(varName);
                if (!model || !wantedModels.has(model)) continue;

                // `>= 0` / `> -1`：負數才是「全部」，protobuf 預設的 0 會被當成
                // 合法篩選值 —— 跟 `!== -1` 同類的危險寫法，只是形狀不同。
                // `> 0` 則相反：0 就會跳過篩選，漏帶無害，不收。
                if (op === '>=' || op === '>') {
                    const isDangerous = (op === '>=' && rhs === '0') || (op === '>' && rhs === '-1');
                    if (!isDangerous) continue;
                    if (!/conditions\.push|filterCondition\s*\+=|parameters\.push|whereClause|\.andWhere\(|\.where\(/.test(body.slice(c.index, c.index + 400))) continue;
                    const key0 = `${ model }.${ field }`;
                    if (seen.has(key0)) continue;
                    seen.add(key0);
                    const lineNo0 = method.startLine - 1 + body.slice(0, c.index).split('\n').length;
                    entries.push({
                        model, field, sentinelText: '-1（負數）', sentinelValue: -1,
                        evidence: `${ file.replace('/Users/user/aladdin/', '') }:${ lineNo0 }`,
                    });
                    continue;
                }

                if (DEFAULT_EQUIVALENT.has(rhs)) continue;
                if (!looksLikeFilterGuard(body, c.index, c[ 0 ])) continue;

                // enum 形式的哨兵：解出實際數值，等於 0 代表「全部」就是 protobuf
                // 預設值，漏帶無害，不算命中。
                let sentinelValue: number | null = null;
                const enumMatch = /^([A-Z]\w+)\.(\w+)$/.exec(rhs);
                if (enumMatch) {
                    sentinelValue = resolveEnumValue(enumMatch[ 1 ], enumMatch[ 2 ]);
                    if (sentinelValue === 0) continue;
                    if (sentinelValue === null) continue; // 解不出來的不猜，避免大量誤報
                } else if (/^-?\d+$/.test(rhs)) {
                    sentinelValue = Number(rhs);
                    if (sentinelValue === 0) continue;
                } else {
                    continue; // 比對對象是另一個變數（如 search.userId !== userId），不是哨兵
                }

                const key = `${ model }.${ field }`;
                if (seen.has(key)) continue;
                seen.add(key);

                const lineNo = method.startLine - 1 + body.slice(0, c.index).split('\n').length;
                entries.push({
                    model, field, sentinelText: rhs, sentinelValue,
                    evidence: `${ file.replace('/Users/user/aladdin/', '') }:${ lineNo }`,
                });
            }
        }
    }
    return entries.sort((a, b) => `${ a.model }.${ a.field }`.localeCompare(`${ b.model }.${ b.field }`));
}

interface Finding {
    toolFile: string;
    model: string;
    missing: SentinelEntry[];
    setKeys: string[];
}

interface Construction {
    toolFile: string;
    model: string;
    setKeys: string[];
}

/** 階段一：收集 MCP tool 裡所有 `<Model>.create({...})` / `.fromObject({...})` 建構點。 */
function collectConstructions(): { constructions: Construction[]; skipped: string[] } {
    const constructions: Construction[] = [];
    const skipped: string[] = [];
    for (const dir of TOOL_DIRS) {
        for (const file of readdirSync(dir).filter(f => f.endsWith('.ts') && f !== 'index.ts')) {
            const full = join(dir, file);
            const text = readFileSync(full, 'utf8');
            const rel = full.replace('/Users/user/aladdin/aladdin_mcps/', '');

            const litRe = /(\w+)\.(?:create|fromObject)\(\s*\{([\s\S]*?)\}\s*\)/g;
            let m: RegExpExecArray | null;
            while ((m = litRe.exec(text)) !== null) {
                const setKeys = [ ...m[ 2 ].matchAll(/(?:^|[,{\s])(\w+)\s*[:,]/g) ].map(x => x[ 1 ]);
                constructions.push({ toolFile: rel, model: m[ 1 ], setKeys });
            }
            // 非物件實字形式（先組變數再傳進去）：掃不到帶了哪些 key，列出來要求人工確認。
            const varRe = /(\w+)\.(?:create|fromObject)\(\s*(?!\{)(\w+)/g;
            while ((m = varRe.exec(text)) !== null) skipped.push(`${ rel } — ${ m[ 1 ] }.create(${ m[ 2 ] })`);
        }
    }
    return { constructions, skipped };
}

/** 階段三：比對建構點與清冊。 */
function scanTools(inventory: SentinelEntry[]): { findings: Finding[]; skipped: string[] } {
    const byModel = new Map<string, SentinelEntry[]>();
    for (const e of inventory) {
        if (!byModel.has(e.model)) byModel.set(e.model, []);
        byModel.get(e.model)!.push(e);
    }

    const { constructions, skipped } = collectConstructions();
    const findings: Finding[] = [];

    for (const c of constructions) {
        const needed = byModel.get(c.model);
        if (!needed) continue;
        const missing = needed.filter(e => !c.setKeys.includes(e.field));
        if (missing.length > 0) findings.push({ toolFile: c.toolFile, model: c.model, missing, setKeys: c.setKeys });
    }

    return { findings, skipped };
}

interface SchemaFinding {
    toolFile: string;
    field: string;
    describeText: string;
}

/**
 * 偵測器二：zod schema 用了 `.optional()`（沒有 `.default(...)`），但同一行的
 * `.describe()` 自己就寫著「-1」或「全部」——寫的人知道有哨兵值卻沒把它設成預設，
 * 欄位省略時仍會落回 protobuf 的 0。
 */
function scanSchemas(): SchemaFinding[] {
    const out: SchemaFinding[] = [];
    for (const dir of TOOL_DIRS) {
        for (const file of readdirSync(dir).filter(f => f.endsWith('.ts') && f !== 'index.ts')) {
            const full = join(dir, file);
            const text = readFileSync(full, 'utf8');
            for (const line of text.split('\n')) {
                if (!line.includes('.optional()') || line.includes('.default(')) continue;
                const m = /^\s*(\w+)\s*:\s*z\..*\.describe\(\s*'([^']*)'/.exec(line);
                if (!m) continue;
                // 判準刻意收緊成「describe 裡明寫 -1，且同時提到全部/不篩選」。
                // 只看「全部」兩個字會大量誤報：很多欄位的契約本來就是「0 或省略
                // ＝全部」（例如 `brandId：0 或省略為全部`），那種漏帶完全無害；
                // 也會掃到 sortOrder 這種根本不是篩選條件的欄位。明寫 -1 才是
                // 「作者知道有哨兵值」的可靠訊號。
                if (!/-1/.test(m[ 2 ])) continue;
                if (!/全部|不篩選/.test(m[ 2 ])) continue;
                // zod 層是 .optional()，但建構點自己用 `?? -1` 補上哨兵值的，
                // 實際行為正確，不算命中（`list_all_brands.ts:80` 的
                // `tag: tag ?? -1` 就是這個形狀）。
                if (new RegExp(`${ m[ 1 ] }\\s*:\\s*\\w+\\s*\\?\\?\\s*-1`).test(text)) continue;
                out.push({ toolFile: full.replace('/Users/user/aladdin/aladdin_mcps/', ''), field: m[ 1 ], describeText: m[ 2 ] });
            }
        }
    }
    return out;
}

const wantedModels = new Set(collectConstructions().constructions.map(c => c.model));
const inventory = buildInventory(wantedModels);

if (process.argv.includes('--inventory')) {
    console.log('# 哨兵值清冊（後端「不篩選」語意 ≠ protobuf 預設值的欄位）\n');
    for (const e of inventory) {
        console.log(`${ e.model }.${ e.field }  →  不篩選 = ${ e.sentinelText }（${ e.sentinelValue }）   ${ e.evidence }`);
    }
    console.log(`\n共 ${ inventory.length } 個欄位。`);
    process.exit(0);
}

const { findings, skipped } = scanTools(inventory);
const schemaFindingsForJson = scanSchemas();

if (process.argv.includes('--json')) {
    // 穩定 key：只用「哪個檔案、哪個 model、哪個欄位」，不含行號或訊息文字——
    // 這幾項才是「同一個缺陷」的身分，行號會因為上面加了幾行註解就變動，
    // 那樣 baseline 與套用後的集合會對不起來、把無關改動誤判成新缺陷。
    const keys = [
        ...findings.flatMap(f => f.missing.map(e => `construct|${ f.toolFile }|${ f.model }|${ e.field }`)),
        ...schemaFindingsForJson.map(f => `schema|${ f.toolFile }|${ f.field }`),
    ].sort();
    console.log(JSON.stringify(keys));
    process.exit(0);
}

console.log(`tool 建構的 rajah model：${ wantedModels.size } 種`);
console.log(`其中含哨兵值欄位：${ inventory.length } 個（掃 agrabah 後端現算）`);
console.log(`檢查建構點：${ TOOL_DIRS.length } 個 tool 目錄\n`);

if (findings.length === 0) {
    console.log('✅ 沒有命中：所有建構點都帶齊了哨兵值欄位。');
} else {
    console.log(`❌ 命中 ${ findings.length } 處：\n`);
    for (const f of findings) {
        console.log(`${ f.toolFile }`);
        console.log(`  建構 ${ f.model }，實際帶了：${ f.setKeys.join(', ') || '(無)' }`);
        for (const e of f.missing) {
            console.log(`  漏帶 ${ e.field } —— 後端「全部」= ${ e.sentinelText }（${ e.sentinelValue }），漏帶會被當成篩「0」`);
            console.log(`       證據：${ e.evidence }`);
        }
        console.log('');
    }
}

const schemaFindings = schemaFindingsForJson;
if (schemaFindings.length > 0) {
    console.log(`\n❌ 偵測器二命中 ${ schemaFindings.length } 處（zod 用 .optional()，但 describe 自己寫了哨兵值）：\n`);
    for (const f of schemaFindings) {
        console.log(`${ f.toolFile }`);
        console.log(`  欄位 ${ f.field } —— describe 寫著「${ f.describeText }」，卻是 .optional() 沒有 .default()`);
        console.log(`  省略時會落回 protobuf 預設 0；若 0 是合法值就會被當成真實篩選條件。`);
        console.log(`  修法：改成 .default(<哨兵值>)，或確認這個欄位的 0 在後端確實代表「不篩選」後，在 describe 裡寫清楚。\n`);
    }
} else {
    console.log('\n✅ 偵測器二沒有命中。');
}

const inventoryModels = new Set(inventory.map(e => e.model));
const relevantSkipped = [ ...new Set(skipped) ].filter(s => [ ...inventoryModels ].some(m => s.includes(`${ m }.create`)));
if (relevantSkipped.length > 0) {
    console.log(`\n⚠️  以下建構點含哨兵值欄位、但不是物件實字，腳本判斷不了帶了哪些欄位，需人工確認：`);
    for (const s of relevantSkipped) console.log(`  ${ s }`);
}

process.exit(findings.length > 0 || schemaFindings.length > 0 ? 1 : 0);
