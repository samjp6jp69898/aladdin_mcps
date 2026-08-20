/**
 * const.ts — 共用常數：sub-agent timeout、併發上限、scratch/logs 路徑、正式目錄
 * 對照表、launchd label。
 *
 * 由 agent/run-agent.ts（spawn 主要 sub-agent）與 agent/deploy-pipeline.ts
 * （套用/驗證/commit/reload）共用消費，避免兩處各自維護一份容易漂移。timeout/
 * 併發上限的數值最早依 /Users/user/.claude/plans/logical-jumping-cook.md 第 3
 * 節「觸發本地 agent」的建議值定義。
 */
import { fileURLToPath } from 'node:url';

// 內層 bash `timeout ${AGENT_TIMEOUT_SECONDS}` wrap `claude -p`，逾時送 SIGTERM。
// logical-jumping-cook.md 原始建議「600 秒起」是骨架階段（H22，回固定假資料、
// 不會觸發真正 sub-agent）訂的保守起始值。2026-08-20 第一次真實端到端測試
// （requestId 76f29177...）實測：光是主要 sub-agent 的研究＋寫代碼＋dev 驗證
// 這一階段就在 600 秒內逼近上限，且 deploy-pipeline.ts 的 Gate B 對抗性覆核是
// 用同一個常數的**第二次獨立 600 秒**（讀 diff＋核對 method-category-checklist
// 分類要求＋自己再對 dev 打一次），工作量不比主要 sub-agent 少。調大到 1800 秒
// （30 分鐘）給兩邊都留足夠餘裕，兩個 sub-agent 各自獨立計時，不共用同一個
// budget（一次部署最長理論上限約 primary 1800s + Gate B 1800s + tsc/copy 這些
// 決定性步驟的數十秒，不是加總後才逾時）。
export const AGENT_TIMEOUT_SECONDS = 1800;

// 併發上限 N=3：同時最多 3 個請求的「研究＋寫代碼」階段（run-agent.ts 的
// verify-workspace 副本）在跑，額度用盡時在 concurrency-limiter.ts 的佇列裡
// 排隊等，輪到自己再繼續——2026-08-20 從「立刻回 busy、不排隊」的 N=1 改過來，
// 見 tools/generate_tool.ts。這個階段 per-requestId 用獨立的 verify-workspace
// 複製，互相隔離，開到 N=3 沒有共用狀態的競態疑慮。
export const CONCURRENCY_LIMIT = 3;

// 部署階段（agent/deploy-pipeline.ts 的 precondition→copy→tsc→對抗性覆核→
// commit→reload→push 整段）維持 N=1，用獨立的一把鎖（不是 CONCURRENCY_LIMIT
// 那把，是 deploy-pipeline.ts 自己 module-level 建立的另一個 limiter 實例）
// 序列化執行——即使外層研究/寫代碼開到 3 個並行，這段仍一次只有一個在跑。
// 原因：這段直接讀寫共用的正式目錄（REAL_DIR[target]）跟同一個 obsidian git
// repo，admin/platform 兩個 target 也共用同一個 repo 的 git index/HEAD，不能
// 假設「不同 target 就互不影響」——git commit/push 這段不管 target 是不是
// 同一個都必須序列化，否則兩個並行部署各自的 precondition 檢查（git status
// 乾淨）跟它自己的 copy/commit 之間，可能被另一個插進來的 commit 打亂時序。
export const DEPLOY_CONCURRENCY_LIMIT = 1;

// scratch/{requestId}/ 是 sub-agent 的工作區（verify-workspace + output + manifest.json），
// logs/ 存服務本身的執行紀錄；兩者皆已加入 .gitignore，不自動清理（見各自目錄）。
export const SCRATCH_DIR = fileURLToPath(new URL('../scratch/', import.meta.url));
export const LOGS_DIR = fileURLToPath(new URL('../logs/', import.meta.url));

// obsidian 是 toolsmith 自己所在的 git repo，也是 aladdin-admin/aladdin-platform
// 正式目錄的所在 repo——deploy-pipeline.ts 的 git add/commit/push 都以這個路徑
// 為 `-C` 基準，pathspec 一律寫成相對這個路徑的相對路徑。
export const OBSIDIAN_ROOT = '/Users/user/aladdin/obsidian';

// run-agent.ts（cp -R 準備 verify-workspace 副本）與 deploy-pipeline.ts（套用
// 驗證通過的檔案、跑 tsc、git add）共用同一份正式目錄對照表，避免兩處各自維護
// 一份容易漂移。
export const REAL_DIR: Record<'admin' | 'platform', string> = {
    admin: `${ OBSIDIAN_ROOT }/mcps/aladdin-admin`,
    platform: `${ OBSIDIAN_ROOT }/mcps/aladdin-platform`,
};

// 部署成功後 deploy-pipeline.ts 用 `launchctl kickstart -k gui/$(id -u)/<label>`
// 重載對應的 dev 常駐服務（見各自 README「launchd 常駐骨架」一節）。只涵蓋
// dev——pre/evi 目前不是 launchd 常駐管理，不在自動重載範圍內。
export const LAUNCHD_LABEL: Record<'admin' | 'platform', string> = {
    admin: 'com.aladdin.mcp-admin-server',
    platform: 'com.aladdin.mcp-platform-server',
};

// 2026-08-20：deploy-pipeline.ts 部署成功（commit 落地）後發 Telegram 通知用，
// 沿用既有的 scripts/tg-notify.sh（fire-and-forget，內部一律 exit 0，不會讓
// pipeline 中斷）。收件人查 tech-users.csv，實測確認 pkh_samjp6jp69898@photons.com.tw
// （Landon 在該名冊登記的 email，非本 session 對話裡識別用的 claudea@photons.com.tw
// ——那個信箱不在名冊裡，會回 TG_SKIP_NOT_TECH）能正確解析出 chat_id 並送達。
export const TG_NOTIFY_SH = '/Users/user/aladdin/scripts/tg-notify.sh';
export const DEPLOY_NOTIFY_EMAIL = 'pkh_samjp6jp69898@photons.com.tw';
