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
 * fail-closed：任何一步（有未提交變更／fetch／checkout／pull）失敗，整個
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
    // 有未提交變更代表可能有人正在這個共用路徑手動工作——絕不能自動切分支/
    // pull 蓋過去，直接中止讓工程師自己處理，這是唯一會讓這個函式回傳失敗但
    // 「不是基礎設施問題」的分支，訊息措辭要能讓人一眼看出原因。
    let dirty: string;
    try {
        dirty = git(repo, [ 'status', '--short' ]);
    } catch (err) {
        return { ok: false, repo, step: 'dirty', message: err instanceof Error ? err.message : String(err) };
    }
    if (dirty.length > 0) {
        return {
            ok: false, repo, step: 'dirty',
            message: `working tree 有未提交變更，可能有人正在這個共用路徑手動工作，拒絕自動切換分支/pull：\n${ dirty }`,
        };
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
