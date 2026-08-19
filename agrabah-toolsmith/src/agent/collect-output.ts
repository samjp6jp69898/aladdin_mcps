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
// 只關注這兩個正式目錄（logical-jumping-cook.md 明講「絕對不要修改
// obsidian/mcps/agrabah-admin 與 agrabah-platform 正式目錄」），不是整個
// obsidian repo——避免同時並行的其他 task（H6/H8 等）改動 obsidian 其他
// 目錄時被誤判成這次請求碰了正式目錄。
const REAL_DIR_PATHSPECS = [ 'mcps/agrabah-admin', 'mcps/agrabah-platform' ];

/** spawn 前/後個別呼叫一次；回傳的字串直接拿去跟另一次的結果比對，字串不同即視為有變化。 */
export function snapshotRealDirs(): string | null {
    try {
        return execFileSync(
            'git',
            [ '-C', OBSIDIAN_ROOT, 'status', '--short', '--', ...REAL_DIR_PATHSPECS ],
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
