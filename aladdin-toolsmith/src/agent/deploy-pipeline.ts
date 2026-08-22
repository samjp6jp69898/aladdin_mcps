/**
 * deploy-pipeline.ts — sub-agent 產出「成功」manifest 後的部署流程：把 output/
 * 底下的檔案套進正式目錄、跑結構性驗證，通過才 commit + push + reload；任一
 * 關卡沒過就整批回滾（正式目錄還原成套用前的狀態），不 commit、不 push、
 * 不 reload。
 *
 * 設計原則（延續 collect-output.ts 已建立的「不信任自我陳述」慣例）：
 *   - Gate A（決定性）：tsc --noEmit，比對套用前後的錯誤集合，只有「新增」的
 *     錯誤才算失敗——這個 codebase 本來就有既有型別債務，不能拿「有沒有錯誤」
 *     當標準（2026-08-20 修 edit_game.ts 時就是用這個方法驗證的）。
 *   - Gate B（獨立第二個 agent）：對抗性覆核，重新對抗性檢查一次，不信任原本
 *     寫 code 那個 sub-agent 自己在 manifest.verification 裡的自我陳述；這個
 *     agent 被要求同時完成四件事：核對 method-category-checklist.md 分類要求、
 *     核對 tool-naming-convention.md 命名規則、實際對 dev 打一次這支新/改過的
 *     tool、給出 PASS/FAIL 結論。
 *
 * git 操作一律用 manifest.files[] 精確列出的檔案路徑當 pathspec，絕不用
 * `git add -A`/`git add .`——obsidian 這個 repo 常態上會有其他工作階段正在
 * 進行中、尚未 commit 的異動，用萬用字元 add 會把不相干的東西一起掃進這次
 * 自動 commit。同理，部署前會先檢查這批目標檔案在正式目錄現況是否乾淨，不乾淨
 * 就直接中止，不猜測「應該沒關係」。
 *
 * 步驟順序刻意是 precondition → copy → tsc → adversarial → commit → reload →
 * push（reload 排在 push 之前）：commit 完成、驗證都通過後，先讓本地 dev 常駐
 * 服務真的用上新代碼（企劃打過去馬上就能用，這是這次功能的核心目標），push
 * 到 origin 失敗只影響 git 歷史的同步，不影響「企劃現在能不能用」，兩者解耦。
 */
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { AGENT_TIMEOUT_SECONDS, DEPLOY_CONCURRENCY_LIMIT, DEPLOY_NOTIFY_EMAIL, LAUNCHD_LABEL, OBSIDIAN_ROOT, REAL_DIR, TG_NOTIFY_SH } from '../const.ts';
import { createConcurrencyLimiter } from './concurrency-limiter.ts';

const execFileAsync = promisify(execFile);
const CLAUDE_BIN = '/Users/user/.local/bin/claude';

// 2026-08-20：generate_tool.ts 的研究/寫代碼名額開到 N=3 後新增的獨立鎖，跟
// generate_tool.ts 那把（CONCURRENCY_LIMIT）完全無關——這把只序列化「會動到
// 共用正式目錄與共用 obsidian git repo」的部署段落（precondition→copy→tsc→
// 對抗性覆核→commit→reload→push 整段，見 runDeployPipeline 內部對
// runDeployPipelineLocked 的包裝）。admin/platform 兩個 target 共用同一把鎖：
// 兩者雖然各自的 REAL_DIR 不同，但 git commit/push 操作的是同一個 obsidian
// repo 的同一個 index/HEAD，不能假設不同 target 之間互不影響。
const deployLock = createConcurrencyLimiter(DEPLOY_CONCURRENCY_LIMIT);

export interface ManifestFileEntry {
    path: string;
    action: string;
}

export interface DeployInput {
    target: 'admin' | 'platform';
    requestId: string;
    /** tokens.json 名冊唯一 id，2026-08-20 隨 toolsmith 從共用 token 改成
     * per-user 名冊一起加入，寫進 commit message 與 Telegram 通知供追溯。 */
    requestedBy: string;
    scratchDir: string;
    outputDir: string;
    files: ManifestFileEntry[];
    summary: string;
}

export interface DeployResult {
    success: boolean;
    stage: 'precondition' | 'copy' | 'tsc' | 'adversarial_review' | 'commit' | 'reload' | 'push' | 'done';
    message: string;
}

function realPathspecs(target: 'admin' | 'platform', files: ManifestFileEntry[]): string[] {
    // git 的 pathspec 要相對 OBSIDIAN_ROOT（-C 的基準），REAL_DIR 已經是
    // OBSIDIAN_ROOT 底下的絕對路徑，這裡轉成相對路徑：mcps/aladdin-{target}/<path>。
    return files.map((f) => `mcps/aladdin-${ target }/${ f.path }`);
}

function gitStatusShort(pathspecs: string[]): string {
    return execFileSync(
        'git', [ '-C', OBSIDIAN_ROOT, 'status', '--short', '--', ...pathspecs ],
        { encoding: 'utf8', timeout: 15_000 },
    );
}

/** 回傳 tsc --noEmit 的錯誤行集合（一行一個錯誤）；乾淨時回傳空集合。 */
function runTscErrors(dir: string): Set<string> {
    try {
        execFileSync(
            'bunx', [ 'tsc', '--noEmit', '-p', '.' ],
            { cwd: dir, encoding: 'utf8', timeout: 180_000, maxBuffer: 20 * 1024 * 1024 },
        );
        return new Set();
    } catch (err) {
        const e = err as { stdout?: string };
        const lines = (e.stdout ?? '').split('\n').filter((l) => l.includes(': error TS'));
        return new Set(lines);
    }
}

function rollback(pathspecs: string[]): void {
    // 對抗性 session review 抓到的真實 bug：commit 失敗這條路徑呼叫 rollback()
    // 時，`git add` 已經把新內容 stage 進 index 了，這時 `git checkout -- path`
    // （不帶 tree-ish）是拿 index 覆蓋 working tree，而 index 此刻等於 working
    // tree（都是新內容），checkout 會是 no-op——working tree 不會變回套用前的
    // 樣子，index 還留著 staged 但未 commit 的異動。tsc/copy 失敗這兩條路徑
    // 因為發生在 `git add` 之前、index 這時還等於 HEAD，原本的寫法沒問題；只有
    // commit 失敗這條特例會漏回滾。修法：checkout 之前先 `git reset -- path`
    // 把 index 退回 HEAD（不動 working tree），對「根本沒有 add 過」的呼叫路徑
    // 也是安全的 no-op，所以直接對所有呼叫路徑統一套用，不用分情況判斷。
    try {
        execFileSync('git', [ '-C', OBSIDIAN_ROOT, 'reset', '--', ...pathspecs ], { encoding: 'utf8', timeout: 15_000 });
    } catch {
        // 沒有東西被 add 過（tsc/copy 失敗這兩條路徑）時，reset 對這批 path
        // 本來就是 no-op，不當錯誤處理。
    }
    // 已被 git 追蹤的檔案：checkout 還原成套用前（HEAD）的內容。
    try {
        execFileSync('git', [ '-C', OBSIDIAN_ROOT, 'checkout', '--', ...pathspecs ], { encoding: 'utf8', timeout: 15_000 });
    } catch {
        // 若這批檔案全部是新檔案（不在 index/HEAD 裡），checkout 對它們是
        // no-op，不當作 rollback 失敗——下面 git clean 才是真正負責清掉新檔案
        // 的步驟。
    }
    // 新建的檔案 checkout 對它沒用（不在 index 裡），用 git clean -fd 只清這批
    // pathspec 底下的未追蹤檔案，不動 pathspec 之外的任何東西。
    try {
        execFileSync('git', [ '-C', OBSIDIAN_ROOT, 'clean', '-fd', '--', ...pathspecs ], { encoding: 'utf8', timeout: 15_000 });
    } catch {
        // 清不掉也不讓 rollback 本身拋例外中斷整個 deploy-pipeline 的錯誤回報。
    }
}

/**
 * 對外唯一入口：先排隊拿到部署鎖（N=1，額度用盡就等，不回 busy），拿到才真的
 * 執行 runDeployPipelineLocked() 的 precondition→copy→tsc→…→push 整段，
 * finally 一律 release，不管成功/失敗/例外。
 */
export async function runDeployPipeline(input: DeployInput): Promise<DeployResult> {
    await deployLock.acquire();
    try {
        return await runDeployPipelineLocked(input);
    } finally {
        deployLock.release();
    }
}

async function runDeployPipelineLocked(input: DeployInput): Promise<DeployResult> {
    const { target, requestId, requestedBy, scratchDir, outputDir, files, summary } = input;
    const realDir = REAL_DIR[ target ];
    const pathspecs = realPathspecs(target, files);
    const logPath = join(scratchDir, 'deploy.log');
    const log = (msg: string): void => appendFileLog(logPath, msg);

    if (files.length === 0) {
        return { success: false, stage: 'precondition', message: 'manifest.files 是空陣列，沒有東西可以部署，視為異常，未執行任何動作。' };
    }

    // 1a. precondition：目前必須確實在 main 分支上——push 寫死 `origin main`，
    // 但 commit 動作本身是對「當下 HEAD 所在分支」操作，沒有這個檢查的話，
    // 若這個 repo 因為任何原因（人工操作、別的自動化）當下不在 main，commit
    // 會提交到錯的分支，push 卻仍然指定 main（會失敗或推錯內容），Telegram
    // 通知的成功/失敗判讀就會跟實際狀況對不上。
    const currentBranch = execFileSync('git', [ '-C', OBSIDIAN_ROOT, 'branch', '--show-current' ], { encoding: 'utf8', timeout: 15_000 }).trim();
    if (currentBranch !== 'main') {
        log(`precondition 失敗，目前不在 main 分支（現在是 ${ currentBranch || '(detached HEAD)' }）`);
        return {
            success: false,
            stage: 'precondition',
            message: `obsidian repo 目前不在 main 分支（現在是 ${ currentBranch || '(detached HEAD)' }），為避免 commit 到錯的分支，已中止部署，未動任何檔案，需要人工確認現況。`,
        };
    }

    // 1b. precondition：目標檔案在正式目錄現況必須乾淨，避免蓋掉別的工作階段
    // 尚未 commit 的異動。
    const dirtyBefore = gitStatusShort(pathspecs);
    if (dirtyBefore.trim().length > 0) {
        log(`precondition 失敗，目標檔案已有未提交異動:\n${ dirtyBefore }`);
        return {
            success: false,
            stage: 'precondition',
            message: `這次要更新的檔案在正式目錄已有未提交的異動（可能有別的工作階段正在改同一批檔案），為避免覆蓋，已中止部署，未動任何檔案。受影響檔案：\n${ dirtyBefore }`,
        };
    }

    // 2. Gate A 的 baseline：套用前先量一次 tsc 錯誤集合（這個 codebase 有既有
    // 型別債務，不能拿「有沒有錯誤」當標準，要拿「錯誤集合有沒有變大」當標準）。
    const baseline = runTscErrors(realDir);

    // 3. 套用：把 output/ 底下驗證通過的檔案複製進正式目錄。
    try {
        for (const f of files) {
            const src = join(outputDir, f.path);
            const dest = join(realDir, f.path);
            mkdirSync(dirname(dest), { recursive: true });
            copyFileSync(src, dest);
        }
    } catch (err) {
        log(`套用檔案失敗: ${ err instanceof Error ? err.message : String(err) }`);
        rollback(pathspecs);
        return { success: false, stage: 'copy', message: `套用檔案到正式目錄時失敗，已回滾：${ err instanceof Error ? err.message : String(err) }` };
    }

    // 4. Gate A：套用後再量一次，只有「baseline 沒有、套用後才出現」的錯誤才算數。
    const after = runTscErrors(realDir);
    const newErrors = [ ...after ].filter((e) => !baseline.has(e));
    if (newErrors.length > 0) {
        log(`tsc 出現新錯誤:\n${ newErrors.join('\n') }`);
        rollback(pathspecs);
        return { success: false, stage: 'tsc', message: `跑 tsc --noEmit 出現新的型別錯誤（既有型別債務不算，只擋新增的），已回滾：\n${ newErrors.join('\n') }` };
    }
    log('Gate A（tsc）通過，沒有新增型別錯誤');

    // 5. Gate B：獨立第二個 agent 對抗性覆核（含 method-category-checklist.md
    // 分類核對 + 實際對 dev 打一次）。
    const verdict = await runAdversarialVerifier({ target, requestId, scratchDir, files, summary });
    if (verdict.verdict !== 'PASS') {
        log(`Gate B（對抗性覆核）未通過: ${ verdict.reasoning }`);
        rollback(pathspecs);
        return { success: false, stage: 'adversarial_review', message: `對抗性覆核未通過，已回滾：\n${ verdict.reasoning }` };
    }
    log(`Gate B（對抗性覆核）通過: ${ verdict.reasoning }`);

    // 6. commit（兩個 gate 都過，這批檔案值得留下永久紀錄）。
    //
    // 2026-08-20（對抗性 session review 抓到的真實 bug，嚴重）：`git commit`
    // 原本沒帶 pathspec——`git add` 有帶 pathspec 沒錯，但 `git commit -m msg`
    // 不帶 pathspec 時 commit 的是**當下整個 index 的內容**，不是只有剛剛
    // add 進去的那幾個檔案。obsidian 這個 repo 常態上會有其他工程師 session
    // 手上正 staged 著自己還沒 commit 的東西（precondition 只檢查「這次要
    // 部署的目標檔案」乾不乾淨，完全不檢查 git index 整體乾不乾淨），這個
    // 空窗期如果剛好有人 `git add` 了不相干的東西、同時這裡的部署走到 commit
    // 這一步，那些不相干的檔案會被一起打包進 toolsmith 的自動 commit、直接
    // push 到 origin/main。修法：`git commit` 也帶上同一批 pathspec——這個
    // 語法下 commit 只吃這批 pathspec 對應的當下內容，不管 index 裡還 staged
    // 著什麼別的東西，不會把它們一起掃進來。
    try {
        execFileSync('git', [ '-C', OBSIDIAN_ROOT, 'add', '--', ...pathspecs ], { encoding: 'utf8', timeout: 15_000 });
        execFileSync(
            'git', [ '-C', OBSIDIAN_ROOT, 'commit', '-m', `toolsmith: ${ summary }\n\nrequestId=${ requestId } target=${ target } requestedBy=${ requestedBy }`, '--', ...pathspecs ],
            { encoding: 'utf8', timeout: 15_000 },
        );
    } catch (err) {
        log(`commit 失敗: ${ err instanceof Error ? err.message : String(err) }`);
        rollback(pathspecs);
        return { success: false, stage: 'commit', message: `git commit 失敗，已回滾：${ err instanceof Error ? err.message : String(err) }` };
    }
    log('commit 完成');

    // 7+8. reload 與 push 是兩件互不依賴的事（一個是「本地服務有沒有生效」，
    // 一個是「git 歷史有沒有同步到遠端」），對抗性 session review 抓到原本寫法
    // 是 reload 失敗直接 return、根本不會嘗試 push，違背這裡本來要的「兩者
    // 解耦」——改成各自獨立 try/catch，一個失敗不擋另一個，最後把兩邊結果合併
    // 成一則訊息回報。
    let reloadError: string | null = null;
    try {
        const uid = execFileSync('id', [ '-u' ], { encoding: 'utf8' }).trim();
        execFileSync('launchctl', [ 'kickstart', '-k', `gui/${ uid }/${ LAUNCHD_LABEL[ target ] }` ], { encoding: 'utf8', timeout: 15_000 });
        log('reload 完成');
    } catch (err) {
        reloadError = err instanceof Error ? err.message : String(err);
        log(`reload 失敗（不影響是否嘗試 push）: ${ reloadError }`);
    }

    let pushError: string | null = null;
    try {
        execFileSync('git', [ '-C', OBSIDIAN_ROOT, 'push', 'origin', 'main' ], { encoding: 'utf8', timeout: 60_000 });
        log('push 完成');
    } catch (err) {
        pushError = err instanceof Error ? err.message : String(err);
        log(`push 失敗（commit 已留在本地，不自動 reset；不影響 reload 是否已成功）: ${ pushError }`);
    }

    // commit 已經完成、tsc 與對抗性覆核都通過，不論 reload/push 各自成不成功，
    // 代碼本身是好的，不回滾——剩下的都是「需要人工處理某個環節」的狀況。
    // 只要走到這裡（commit 已落地），就算「企劃真的做出一個新工具了」，發一則
    // Telegram 通知——只涵蓋成功情境，Gate A/B 沒過被整批回滾的失敗情況不通知
    // （2026-08-20 使用者決定的範圍；要不要連失敗也通知是後續可以再談的獨立決定）。
    if (reloadError === null && pushError === null) {
        notifyDeployed({ target, requestId, requestedBy, summary, reloadOk: true, pushOk: true });
        return { success: true, stage: 'done', message: `已部署上線、重載 dev 常駐服務、push 到 origin/main。${ summary }` };
    }
    const parts: string[] = [ `已 commit（代碼已通過驗證），但：` ];
    if (reloadError !== null) parts.push(`- reload 失敗，需要人工重啟 ${ LAUNCHD_LABEL[ target ] }：${ reloadError }`);
    else parts.push(`- reload 成功，本地 dev 常駐服務已生效`);
    if (pushError !== null) parts.push(`- push 到 origin/main 失敗，commit 留在本地需要人工推送：${ pushError }`);
    else parts.push(`- push 成功，已同步到 origin/main`);
    notifyDeployed({ target, requestId, requestedBy, summary, reloadOk: reloadError === null, pushOk: pushError === null });
    return { success: reloadError === null, stage: reloadError !== null ? 'reload' : 'push', message: parts.join('\n') };
}

/**
 * 部署成功（commit 已落地）後發一則 Telegram 通知，沿用既有的
 * scripts/tg-notify.sh（fire-and-forget，內部一律 exit 0）。這裡仍包一層
 * try/catch 純防禦——不能讓通知這種錦上添花的動作反過來讓整個 deploy-pipeline
 * 拋例外、影響已經算好的部署結果。
 *
 * 2026-08-20：toolsmith 改成 per-user token 名冊後，訊息內文加了
 * requestedBy（tokens.json 唯一 id），讓收件人知道是誰觸發的部署；但收件人
 * 本身目前仍固定發給 DEPLOY_NOTIFY_EMAIL（見 const.ts），不是動態發給
 * requestedBy 本人——tokens.json 沒有存 email/chat_id，要做到「發給觸發者
 * 本人」需要額外建立 identity→email 對照，這次範圍不含，先留給之後有多個
 * 註冊身分、且真的需要各自收通知時再做。
 */
function notifyDeployed(input: { target: 'admin' | 'platform'; requestId: string; requestedBy: string; summary: string; reloadOk: boolean; pushOk: boolean }): void {
    const { target, requestId, requestedBy, summary, reloadOk, pushOk } = input;
    const text = `[toolsmith] ${ requestedBy } 透過 aladdin_toolsmith_generate_tool 部署了一支新/改過的 aladdin-${ target } tool。\n` +
        `摘要：${ summary }\n` +
        `reload：${ reloadOk ? '成功' : '失敗，需人工處理' }／push：${ pushOk ? '成功' : '失敗，需人工處理' }\n` +
        `requestId=${ requestId }`;
    try {
        execFileSync('bash', [ TG_NOTIFY_SH, '--email', DEPLOY_NOTIFY_EMAIL, '--text', text ], { encoding: 'utf8', timeout: 30_000 });
    } catch {
        // tg-notify.sh 設計上一律 exit 0，理論上不會走到這裡；萬一環境異常
        // （例如 bash 本身找不到）也不讓通知失敗拖垮部署結果的回報。
    }
}

function appendFileLog(logPath: string, msg: string): void {
    writeFileSync(logPath, `${ new Date().toISOString() } ${ msg }\n`, { flag: 'a' });
}

interface VerifierVerdict {
    verdict: 'PASS' | 'FAIL';
    reasoning: string;
}

/**
 * 獨立 spawn 第二個 `claude -p --permission-mode bypassPermissions` sub-agent，
 * 沿用跟 run-agent.ts 完全一樣的 spawn 機制（prompt 走 stdin，逾時保護），
 * 差別只在這次的任務是覆核、不是實作，也不吃 EXIT trap fallback manifest
 * （沒寫出 verdict 檔案一律當 FAIL，不需要區分「逾時」跟「忘記寫」）。
 */
async function runAdversarialVerifier(input: {
    target: 'admin' | 'platform'; requestId: string; scratchDir: string; files: ManifestFileEntry[]; summary: string;
}): Promise<VerifierVerdict> {
    const { target, requestId, scratchDir, files, summary } = input;
    const realDir = REAL_DIR[ target ];
    const verdictPath = join(scratchDir, 'adversarial-verdict.json');

    const prompt = `你是獨立的第二個 agent，任務是對抗性覆核另一個 agent 剛完成、且已經套用進正式目錄的
一支 MCP tool 新增/修改。你不是原作者，不要預設它是對的——你的目標是盡力找出問題，
不是背書；這是自動化部署管線的最後一道把關，過了就直接 commit+push+上線，沒有工程師
會再看一遍，所以請認真對待，不要為了讓流程走完而放水。

## 這次改動
target: aladdin-${ target }（正式目錄，已套用套用後的現況：${ realDir }）
requestId: ${ requestId }
原作者自陳摘要：${ summary }
改動的檔案：${ files.map((f) => `${ f.action } ${ f.path }`).join('、') }

## 你要做的事（依序，缺一不可）

1. 讀 ${ realDir } 裡上面列出的檔案（已經是套用後的正式目錄現況，不是副本，你看到的
   就是準備要上線的東西）。
2. 對照 rajah/services/*.rajah 找到它包裝的實際 RPC method，確認簽名、參數、回傳型別
   真的對得上這支 tool 的實作，不是憑印象猜。
3. **必讀** /Users/user/aladdin/obsidian/mcps/method-category-checklist.md，判斷這支
   method 屬於哪個分類，逐條核對這次改動有沒有滿足該分類列出的強制檢查項——尤其是
   清單類（有沒有處理「資料超過一頁」）、Upsert/CreateOrUpdate 類（有沒有先讀現值
   再合併）、業務鍵間接定位更新類（有沒有掃描到底而不是寫死小分頁）這幾個高風險
   分類，不能只看有沒有語法錯誤。
4. **核對 tool 命名**：對照 /Users/user/aladdin/obsidian/mcps/tool-naming-convention.md，
   確認 \`server.registerTool()\` 第一個參數真的是 \`<server>_<service>_<method>\`
   （各自 snake_case，service/method 是第 2 步查證到的真實 rajah 名稱）——常見缺陷
   是原作者自己另外想了一個動詞_名詞式的名字、或該檔「兩支不同 tool 撞名」一節適用
   卻仍分成兩支各自加字尾。命名不合規則視為本次覆核的一項缺陷，在結論中明確指出。
5. **實際對 dev 環境打一次這支新/改過的 tool**（例如
   \`cd ${ realDir } && bunx @modelcontextprotocol/inspector bun src/stdio.ts\`，
   或比照該 server README「除錯」一節寫一支 spike script）——確認真的能登入、真的
   呼叫到後端拿到真實資料，不是只看程式碼推論、也不是只信任原作者 manifest 裡的
   自我陳述。如果這是寫入型呼叫，記得驗證完清理/還原 dev 上的測試資料。
   **重要**：這個時間點對應的 launchd 常駐服務（\`${ LAUNCHD_LABEL[ target ] }\`）
   還沒被重載，跑的仍是套用前的舊代碼——絕對不要用「打常駐服務目前對外的連線」
   這種方式驗證（例如透過 telegram-dispatcher 的 proxy route 或直接打常駐服務
   監聽的 port），那樣測到的其實是舊代碼，你會產生假通過。一定要自己另外重新
   spawn 一個新的 process（像上面的 \`bun src/stdio.ts\`）直接讀 ${ realDir }
   當下的檔案內容，才是真的在測套用後的新代碼。
6. 給出結論。

## 輸出（唯一交付物）
把結論寫進 ${ verdictPath }（合法 JSON，只有這兩個欄位）：
{
  "verdict": "PASS" 或 "FAIL",
  "reasoning": "具體說明你檢查了什麼、發現了什麼、為什麼下這個結論——如果是 FAIL，
                要講清楚具體是哪個檢查項沒過、或哪次實測失敗；如果是 PASS，也要
                具體列出你驗證過的項目，不能只寫『看起來沒問題』"
}
**沒有充分把握就傾向給 FAIL**，不要因為想讓流程順利跑完而放水。這是你唯一的交付
檔案——不要修改 ${ realDir } 以外的任何檔案，也不要修改 ${ realDir } 本身（你只負責
覆核，不負責改代碼；發現問題就寫進 reasoning，交給呼叫端回滾，不要自己動手改）。`;

    const wrapperScript = `timeout ${ AGENT_TIMEOUT_SECONDS } ${ CLAUDE_BIN } -p --model sonnet --permission-mode bypassPermissions --output-format json`;

    try {
        const promise = execFileAsync('bash', [ '-c', wrapperScript ], {
            encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, timeout: (AGENT_TIMEOUT_SECONDS + 60) * 1000, cwd: scratchDir,
        });
        const child = (promise as unknown as { child: import('node:child_process').ChildProcess }).child;
        child.stdin?.end(prompt);
        await promise;
    } catch {
        // 逾時/crash：底下讀 verdictPath 會因檔案不存在落到 FAIL 分支，這裡不用
        // 額外處理——跟 run-agent.ts 的 fallback manifest 機制不同，覆核 agent
        // 沒寫出結論本來就該視為沒通過，不需要區分原因。
    }

    if (!existsSync(verdictPath)) {
        return { verdict: 'FAIL', reasoning: '對抗性覆核 agent 沒有寫出 verdict 檔案（可能逾時或中途失敗），保守判定為 FAIL。' };
    }
    try {
        const raw = JSON.parse(readFileSync(verdictPath, 'utf8')) as VerifierVerdict;
        if (raw.verdict !== 'PASS' && raw.verdict !== 'FAIL') throw new Error('verdict 欄位不是 PASS/FAIL');
        return raw;
    } catch (err) {
        return { verdict: 'FAIL', reasoning: `verdict 檔案格式不合法，保守判定為 FAIL：${ err instanceof Error ? err.message : String(err) }` };
    }
}
