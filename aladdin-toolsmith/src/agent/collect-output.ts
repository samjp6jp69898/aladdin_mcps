/**
 * collect-output.ts — 讀 manifest.json + 逐檔讀 output/ 內容組回傳值，並做
 * spawn 前後的 git status --short 快照寫進 realDirsTouched。
 *
 * git status 快照手法借用
 * /Users/user/aladdin/telegram-dispatcher/lib/pipeline-runner/demand-plan-pipeline.ts
 * 的 snapshotMainRepos/diffMainReposSnapshot（複製邏輯重寫，不跨 repo
 * import）：只誠實揭露、不阻擋交付——logical-jumping-cook.md「已知風險」已
 * 明確列出並由使用者接受這個設計（verify-workspace 複製-驗證模式降低但不
 * 完全消除「碰到正式目錄」的風險，sub-agent 有完整 Bash 權限理論上仍可能
 * 不遵照指示動到正式目錄）。
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const OBSIDIAN_ROOT = '/Users/user/aladdin/obsidian';

/**
 * 2026-08-20（對抗性 session review 抓到的真實 bug）：這裡原本不分 target、
 * 兩個正式目錄一起比對，理由是「避免同時並行的其他 task（H6/H8 等）改動
 * obsidian 其他目錄時被誤判」——這在 N=1 時代（同一時間只有一個 toolsmith
 * 操作在跑）永遠安全。但 generate_tool.ts 改成非阻塞＋N=3 併發後，同一時間
 * 可能有請求 A 正處於研究階段（`snapshotRealDirs` 前後各拍一次，中間跨
 * `runAgent()` 整段、可能長達 1800 秒）、同時請求 B 合法地在跑
 * deploy-pipeline，對**另一個** target 的正式目錄做 copy/commit——A 的
 * after 快照如果剛好落在 B 的 commit 窗口內，兩份快照字串就會不同，A 會被
 * 誤判成「正式目錄被意外異動」而白跑一次，即使 A 自己的 sub-agent 完全沒
 * 碰正式目錄。
 *
 * 修法：只比對這次請求自己的 target pathspec，不要兩個都比——消除跨
 * target 的假陽性（最常見情況）。**殘留風險**：同一個 target 有兩個並發
 * 請求（一個在研究、一個同時在跑該 target 的部署）時，這個誤判仍然可能
 * 發生，因為 deploy-pipeline.ts 的 `deployLock` 只序列化「部署跟部署」，
 * 沒有跟研究階段的快照窗口互斥。已知、可接受的殘留風險，未來若同 target
 * 高併發成為常態需要重新處理，不在這次範圍內解決。
 */
function realDirPathspec(target: 'admin' | 'platform'): string {
    return `mcps/aladdin-${ target }`;
}

/** spawn 前/後個別呼叫一次（同一個 target）；回傳的字串直接拿去跟另一次的結果比對，字串不同即視為有變化。 */
export function snapshotRealDirs(target: 'admin' | 'platform'): string | null {
    try {
        return execFileSync(
            'git',
            [ '-C', OBSIDIAN_ROOT, 'status', '--short', '--', realDirPathspec(target) ],
            { encoding: 'utf8', timeout: 15_000 },
        );
    } catch {
        // 讀取失敗（理論上不太可能，obsidian 本身就是這個服務自己所在的
        // repo）不當作髒，避免誤報——見下方 realDirsTouched() 的 null 處理。
        return null;
    }
}

export function realDirsTouched(before: string | null, after: string | null): boolean {
    // null 代表快照當下讀取失敗，任一邊是 null 就沒有可信的比較基準，不判定
    // 為髒（寧可漏報一次真的很倒楣的情況，也不要對「單純讀不到」大驚小怪）。
    if (before === null || after === null) return false;
    return before !== after;
}

interface ManifestFileEntry {
    path: string;
    action: string;
}

interface Manifest {
    success: boolean;
    errorKind?: string;
    summary?: string;
    files?: ManifestFileEntry[];
    verification?: { ran: boolean; notes: string };
    warnings?: string[];
}

export interface CollectedFile extends ManifestFileEntry {
    content: string;
}

export interface CollectedOutput {
    success: boolean;
    requestId: string;
    errorKind?: string;
    summary: string;
    files: CollectedFile[];
    verification: { ran: boolean; notes: string };
    warnings: string[];
    realDirsTouched: boolean;
    durationSeconds: number;
}

export interface CollectOutputInput {
    requestId: string;
    manifestPath: string;
    outputDir: string;
    before: string | null;
    after: string | null;
    durationSeconds: number;
}

export function collectOutput(input: CollectOutputInput): CollectedOutput {
    const touched = realDirsTouched(input.before, input.after);

    let manifest: Manifest;
    try {
        const raw = readFileSync(input.manifestPath, 'utf8');
        manifest = JSON.parse(raw) as Manifest;
    } catch (err) {
        return {
            success: false,
            requestId: input.requestId,
            errorKind: 'manifest_unreadable',
            summary: `無法讀取或解析 manifest.json（${ input.manifestPath }）：${ err instanceof Error ? err.message : String(err) }`,
            files: [],
            verification: { ran: false, notes: '' },
            warnings: [],
            realDirsTouched: touched,
            durationSeconds: input.durationSeconds,
        };
    }

    const files: CollectedFile[] = [];
    const readWarnings: string[] = [];
    for (const entry of manifest.files ?? []) {
        const fullPath = join(input.outputDir, entry.path);
        try {
            const content = readFileSync(fullPath, 'utf8');
            files.push({ path: entry.path, action: entry.action, content });
        } catch (err) {
            readWarnings.push(
                `manifest 列出的檔案讀取失敗，已略過：${ entry.path }（${ err instanceof Error ? err.message : String(err) }）`,
            );
        }
    }

    return {
        success: manifest.success,
        requestId: input.requestId,
        errorKind: manifest.errorKind,
        summary: manifest.summary ?? '',
        files,
        verification: manifest.verification ?? { ran: false, notes: '' },
        warnings: [ ...(manifest.warnings ?? []), ...readWarnings ],
        realDirsTouched: touched,
        durationSeconds: input.durationSeconds,
    };
}
