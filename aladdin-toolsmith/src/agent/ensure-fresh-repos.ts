/**
 * ensure-fresh-repos.ts — 每次 generate_tool 執行前，把 sub-agent 研究用的
 * 來源 repo（agrabah/abu/rajah/lago）同步到 origin/main 最新狀態。
 *
 * 這四個路徑是全系統共用的單一份 checkout（不是 toolsmith 專屬——rajah-query
 * /method-call-graph 等 Source-First skill、create-mr 系列 worktree 都指向
 * 同一份路徑），sub-agent 靠 Source-First 原則直接讀這裡的原始碼；若落後
 * origin/main，研究出來的 method 簽名/欄位可能已經跟正式環境不一致，寫出來
 * 的新 tool 會是錯的——tsc gate 只比對型別、對抗性覆核只核對分類規則，兩者都
 * 不保證抓得到「語意上過時」這種錯誤，必須在研究開始前就把這個前提堵掉。
 *
 * 2026-08-21 使用者拍板：直接切這幾個共用路徑到 main（不是另建 toolsmith 專屬
 * 的唯讀副本），代價是連帶影響其他讀這幾個路徑的工具看到的版本——已知取捨，
 * 不是遺漏。
 *
 * 用專屬 N=1 鎖序列化（不是 tools/generate_tool.ts 的 CONCURRENCY_LIMIT 那把
 * N=3 研究鎖）：這裡會真的動到共用目錄的 working tree（checkout/pull），並發
 * 跑會互相踩到 git 的 index/HEAD，也避免同一批並發請求各自重複 fetch。
 *
 * 已知殘留風險（比照 collect-output.ts 檔頭說明同一種取捨，不是新問題）：若
 * 某個 sub-agent 正在讀這些目錄時，另一個並發請求剛好在這裡抓到新 commit 並
 * pull，working tree 檔案內容可能在對方讀取途中改變。目前選擇接受，不為此
 * 再加一層跨請求的讀寫鎖——跟現有「同 target 兩個並發部署互相干擾」是同一類
 * 已知且刻意不解的殘留風險。
 *
 * 2026-09-01 使用者拍板改為主動 reset（非遺漏，是明確裁示）：這台機器**不是
 * 工程師的日常開發機**，agrabah/abu/rajah/lago 這四份共用 checkout 純粹是給
 * Source-First 研究用的唯讀副本，不會有人在這裡手動改代碼、留下值得保護的
 * work-in-progress——2026-09-01 實測踩過一次：另一個自動化在 lago 跑了一次
 * bun install 產生的 lockfile 格式升級副作用，把 generate_tool 擋在
 * fail-closed 的 dirty 檢查上，一次無害的異動就讓整個請求（連研究都還沒開始）
 * 白白失敗。因此發現 dirty 時直接 `git reset --hard` + `git clean -fd`
 * 丟棄，不再中止——只有 reset/clean 這兩個動作本身失敗（例如磁碟權限異常）才
 * 算真正的基礎設施問題，繼續 fail-closed。
 *
 * fail-closed（reset/clean 之後）：fetch／checkout／pull 任一步失敗，整個
 * generate_tool 這次執行直接中止，不讓 sub-agent 帶著「不確定新不新鮮」的
 * 來源繼續研究/寫代碼。
 */

import { execFileSync } from 'node:child_process';
import { createConcurrencyLimiter } from './concurrency-limiter.ts';

export const SOURCE_REPOS = [
    '/Users/user/aladdin/agrabah',
    '/Users/user/aladdin/abu',
    '/Users/user/aladdin/rajah',
    '/Users/user/aladdin/lago',
] as const;

const GIT_TIMEOUT_MS = 30_000;

const freshnessLimiter = createConcurrencyLimiter(1);

export type FreshenResult =
    | { ok: true }
    | { ok: false; repo: string; step: 'dirty' | 'fetch' | 'checkout' | 'pull'; message: string };

function git(repo: string, args: string[]): string {
    return execFileSync('git', [ '-C', repo, ...args ], { encoding: 'utf8', timeout: GIT_TIMEOUT_MS }).trim();
}

function freshenOne(repo: string): FreshenResult {
    // 這台機器不是工程師日常開發機（見檔頭 2026-09-01 說明），這四個共用路徑
    // 出現未提交變更一律視為無人在意的殘留（例如某個自動化跑 bun install 產生
    // 的 lockfile 副作用），直接 reset + clean 丟棄再繼續，不中止整個請求。
    let dirty: string;
    try {
        dirty = git(repo, [ 'status', '--short' ]);
    } catch (err) {
        return { ok: false, repo, step: 'dirty', message: err instanceof Error ? err.message : String(err) };
    }
    if (dirty.length > 0) {
        try {
            git(repo, [ 'reset', '--hard' ]);
            git(repo, [ 'clean', '-fd' ]);
        } catch (err) {
            // reset/clean 本身失敗才是真正的基礎設施問題（例如磁碟權限異常），
            // 這種情況才 fail-closed 中止，不猜測、不硬闖。
            return {
                ok: false, repo, step: 'dirty',
                message: `working tree 有未提交變更（\n${ dirty }\n），嘗試 reset --hard + clean -fd 丟棄時失敗，需要人工檢查：${ err instanceof Error ? err.message : String(err) }`,
            };
        }
    }

    try {
        git(repo, [ 'fetch', 'origin', 'main' ]);
    } catch (err) {
        return { ok: false, repo, step: 'fetch', message: err instanceof Error ? err.message : String(err) };
    }

    try {
        const branch = git(repo, [ 'rev-parse', '--abbrev-ref', 'HEAD' ]);
        if (branch !== 'main') {
            git(repo, [ 'checkout', 'main' ]);
        }
    } catch (err) {
        return { ok: false, repo, step: 'checkout', message: err instanceof Error ? err.message : String(err) };
    }

    // --ff-only：main 是被 push 出來的正式分支，這裡不該、也不預期會有本地
    // 獨有的 commit 需要 merge——非 fast-forward 代表狀況超出預期（例如有人
    // 手動在這裡 commit 過），一樣 fail-closed，不自動 merge/rebase。
    try {
        git(repo, [ 'pull', '--ff-only' ]);
    } catch (err) {
        return { ok: false, repo, step: 'pull', message: err instanceof Error ? err.message : String(err) };
    }

    return { ok: true };
}

export async function ensureFreshSourceRepos(): Promise<FreshenResult> {
    await freshnessLimiter.acquire();
    try {
        for (const repo of SOURCE_REPOS) {
            const result = freshenOne(repo);
            if (!result.ok) return result;
        }
        return { ok: true };
    } finally {
        freshnessLimiter.release();
    }
}
