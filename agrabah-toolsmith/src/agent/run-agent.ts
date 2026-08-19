/**
 * run-agent.ts — 同步 await 觸發本機 sub-agent（不是 detached）。
 *
 * HTTP handler 要拿到結果才能回應，比照
 * /Users/user/aladdin/telegram-dispatcher/lib/pipeline-runner/claude-exec.ts
 * 的 execClaudeWithStdin 模式：完成訊號來自 execFileAsync 的 Promise
 * resolve/reject（child process 真正 exit 的事件驅動訊號），**不用
 * fs.watch、不用輪詢**。prompt 走 stdin，不走 argv（同一理由：避免 argv
 * ARG_MAX、避免例外訊息把 prompt 全文夾帶進錯誤訊息外洩）。
 *
 * 雙層 timeout：
 *   - 內層：bash `timeout ${AGENT_TIMEOUT_SECONDS}` 包住 `claude -p`，逾時
 *     送 SIGTERM，bash 以 124 結束（GNU coreutils timeout 慣例）。
 *   - bash trap EXIT：不管正常結束/被內層 timeout 殺/中途 crash，都呼叫
 *     write-fallback-manifest.ts；該腳本只在 manifest.json 不存在或是空檔案
 *     時才寫入 fallback（sub-agent 自己已正常寫出的話不覆蓋）。
 *   - 外層：Node 的 execFileAsync `timeout` 選項，只當保底
 *     （AGENT_TIMEOUT_SECONDS + 60 秒 margin）——理論上內層 bash timeout 一定
 *     先觸發、trap 一定先跑完，外層存在只是防止 bash/claude 兩者都失控時
 *     Node 這邊也跟著懸掛不結束。
 *
 * verify-workspace 由這裡（呼叫端）決定性地用 cp -R 準備好一份正式目錄的
 * 完整副本，不假手 sub-agent 自己執行 cp——結構性保證 sub-agent 一律從已經
 * 準備好的副本開始，不依賴它自己記得先 cp、也不依賴它 cp 對地方。
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { mkdirSync, chmodSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AGENT_TIMEOUT_SECONDS, SCRATCH_DIR, LOGS_DIR } from '../const.ts';
import { buildPrompt } from './prompt-builder.ts';

const execFileAsync = promisify(execFile);

// claude 必須用絕對路徑，禁止裸呼叫 `claude` 交給 PATH 解析：比照
// telegram-dispatcher/lib/pipeline-runner/demand-plan-pipeline.ts 已踩過的坑
// （PATH 解析在 spawn 鏈上不可靠，曾解析到已下架的舊版本，見該檔註解）。
const CLAUDE_BIN = '/Users/user/.local/bin/claude';

const WRITE_FALLBACK_MANIFEST_TS = fileURLToPath(new URL('./write-fallback-manifest.ts', import.meta.url));

const REAL_DIR: Record<'admin' | 'platform', string> = {
    admin: '/Users/user/aladdin/obsidian/mcps/agrabah-admin',
    platform: '/Users/user/aladdin/obsidian/mcps/agrabah-platform',
};

export interface RunAgentInput {
    target: 'admin' | 'platform';
    request: string;
    notes?: string;
}

export interface RunAgentOutput {
    requestId: string;
    scratchDir: string;
    manifestPath: string;
    outputDir: string;
    /** null 代表 exitCode 無法判定（理論上不會發生，execFileAsync 的
     * reject 一定帶 code；保留 null 只是型別上誠實反映極端情況）。 */
    exitCode: number | null;
    durationSeconds: number;
}

function ensureDirChmod700(path: string): void {
    // 建立目錄時明確 chmod 700：mkdirSync 的 mode 選項會被 umask 影響，不能
    // 保證最終權限，這裡建立後再明確 chmod 一次才是可靠的。對已存在的目錄
    // 呼叫同樣安全（mkdirSync recursive 對已存在路徑是 no-op，chmodSync 直接
    // 修正舊權限）。
    mkdirSync(path, { recursive: true });
    chmodSync(path, 0o700);
}

function appendLog(logPath: string, msg: string): void {
    appendFileSync(logPath, `${ new Date().toISOString() } ${ msg }\n`);
}

export async function runAgent(input: RunAgentInput): Promise<RunAgentOutput> {
    const requestId = randomUUID();
    const scratchDir = join(SCRATCH_DIR, requestId);
    const verifyWorkspaceParent = join(scratchDir, 'verify-workspace');
    const verifyWorkspaceDir = join(verifyWorkspaceParent, `agrabah-${ input.target }`);
    const outputParent = join(scratchDir, 'output');
    const outputDir = join(outputParent, `agrabah-${ input.target }`);
    const manifestPath = join(scratchDir, 'manifest.json');
    const logPath = join(LOGS_DIR, `${ requestId }.log`);

    // 頂層 SCRATCH_DIR/LOGS_DIR 也要各自明確 chmod 700，不能只靠 mkdirSync
    // recursive 建立時「順便」建出來的中繼目錄——recursive:true 只保證目錄
    // 存在，中繼目錄的權限仍是預設值（受 umask 影響，實測會是 755）。
    ensureDirChmod700(SCRATCH_DIR);
    ensureDirChmod700(LOGS_DIR);
    ensureDirChmod700(scratchDir);
    ensureDirChmod700(verifyWorkspaceParent);
    ensureDirChmod700(outputParent);

    appendLog(
        logPath,
        `requestId=${ requestId } target=${ input.target } requestLength=${ input.request.length } ` +
        `notesLength=${ input.notes?.length ?? 0 } — 開始準備 verify-workspace`,
    );

    // cp -R src dest：dest 事先不能存在，否則會變成 dest/agrabah-{target}/...
    // 的巢狀結構，所以只 mkdir 到 verify-workspace/ 這一層（上面已做），不要
    // 先建立 verifyWorkspaceDir（agrabah-{target}）本身。
    //
    // 這一步發生在下面雙層 timeout 的保護範圍之外（bash wrapper 這時還沒
    // spawn，內層/外層 timeout 都還沒開始計時）——review 抓到的真實問題：
    // 若 cp -R 本身卡住（磁碟/檔案系統異常），runAgent() 的 Promise 永遠不會
    // resolve/reject，generate_tool.ts 的 finally { limiter.release() } 也
    // 永遠不會執行，N=1 的併發名額會被永久卡死。這裡明確給 cp -R 自己一個
    // 上限（120 秒，對含 node_modules 的目錄綽綽有餘），逾時視為這次請求
    // 失敗、往上拋例外讓 finally 正常 release。
    await execFileAsync('cp', [ '-R', REAL_DIR[ input.target ], verifyWorkspaceDir ], { timeout: 120_000 });

    const prompt = buildPrompt({
        target: input.target,
        request: input.request,
        notes: input.notes,
        scratchDir,
        verifyWorkspaceDir,
        outputDir,
        manifestPath,
    });

    // 沿用 telegram-dispatcher/lib/pipeline-runner/spawn-create-mr.ts 的既有
    // 模式：EXIT trap 用單引號包住整段 trap body 以延遲 $? 求值（trap 觸發時
    // 才重新解析執行，不是註冊當下）。trap body 本身只呼叫一支獨立 TS 腳本
    // （見 write-fallback-manifest.ts 檔頭註解），避免在 bash 裡手刻 JSON
    // 字面值撞上單引號巢狀衝突。
    const wrapperScript = `
trap '
  EC=$?
  bun ${ WRITE_FALLBACK_MANIFEST_TS } "${ manifestPath }" "$EC"
' EXIT
timeout ${ AGENT_TIMEOUT_SECONDS } ${ CLAUDE_BIN } -p --model sonnet --permission-mode bypassPermissions --output-format json
`;

    const startedAt = Date.now();
    let exitCode: number | null = 0;
    try {
        const promise = execFileAsync('bash', [ '-c', wrapperScript ], {
            encoding: 'utf8',
            maxBuffer: 20 * 1024 * 1024,
            // 外層保底：內層 bash `timeout ${AGENT_TIMEOUT_SECONDS}` 一定先
            // 觸發，這裡多留 60 秒 margin 讓 trap 有時間跑完 write-fallback-
            // manifest.ts。
            timeout: (AGENT_TIMEOUT_SECONDS + 60) * 1000,
            cwd: scratchDir,
        });
        // .child 是 Node child_process.execFile 的 util.promisify.custom 實作
        // 保證會提供的底層 ChildProcess，resolve 前就能拿到、寫入 stdin——
        // 沿用 telegram-dispatcher/lib/pipeline-runner/claude-exec.ts 的手法。
        const child = (promise as unknown as { child: import('node:child_process').ChildProcess }).child;
        child.stdin?.end(prompt);

        const { stdout, stderr } = await promise;
        exitCode = 0;
        appendLog(
            logPath,
            `requestId=${ requestId } 正常結束\nstdout(head 2000)=${ stdout.slice(0, 2000) }\nstderr(head 2000)=${ stderr.slice(0, 2000) }`,
        );
    } catch (err) {
        const e = err as NodeJS.ErrnoException & { code?: number; killed?: boolean; signal?: string; stdout?: string; stderr?: string };
        exitCode = typeof e.code === 'number' ? e.code : null;
        appendLog(
            logPath,
            `requestId=${ requestId } 以非零結束 code=${ exitCode } killed=${ e.killed } signal=${ e.signal }\n` +
            `stderr(head 2000)=${ (e.stderr ?? '').slice(0, 2000) }`,
        );
    }

    const durationSeconds = Math.round((Date.now() - startedAt) / 1000);
    appendLog(logPath, `requestId=${ requestId } 結束，exitCode=${ exitCode } durationSeconds=${ durationSeconds }`);

    return { requestId, scratchDir, manifestPath, outputDir, exitCode, durationSeconds };
}
