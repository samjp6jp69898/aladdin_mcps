/**
 * const.ts — 共用常數：sub-agent timeout、併發上限、scratch/logs 路徑。
 *
 * H22（本檔）只做服務骨架，這些數值目前尚未被任何程式碼消費——真正 spawn
 * sub-agent 的執行邏輯（agent/run-agent.ts、concurrency-limiter.ts 等）是
 * 未來 task 的範圍。數值依 /Users/user/.claude/plans/logical-jumping-cook.md
 * 第 3 節「觸發本地 agent」的建議值先定義好，避免未來 task 各自猜一個。
 */
import { fileURLToPath } from 'node:url';

// 內層 bash `timeout ${AGENT_TIMEOUT_SECONDS}` wrap `claude -p`，逾時送 SIGTERM。
// logical-jumping-cook.md：「建議 600 秒起」。
export const AGENT_TIMEOUT_SECONDS = 600;

// 併發上限 N=1：任一時刻只服務一個請求，其餘立即回 busy，不排隊、不讓連線懸掛。
export const CONCURRENCY_LIMIT = 1;

// scratch/{requestId}/ 是 sub-agent 的工作區（verify-workspace + output + manifest.json），
// logs/ 存服務本身的執行紀錄；兩者皆已加入 .gitignore，不自動清理（見各自目錄）。
export const SCRATCH_DIR = fileURLToPath(new URL('../scratch/', import.meta.url));
export const LOGS_DIR = fileURLToPath(new URL('../logs/', import.meta.url));
