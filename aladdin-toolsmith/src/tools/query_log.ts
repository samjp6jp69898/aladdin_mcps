/**
 * tools/query_log.ts — aladdin_toolsmith_query_log
 *
 * 2026-08-20：跟 per-user token 名冊一起加的查詢工具——有了 requestedBy 之後，
 * 才能讓每個人只看到自己觸發過的請求，不是全部人共用一份看得到彼此的紀錄。
 *
 * 不帶 requestId：列出呼叫端自己觸發過的請求（掃 scratch/*\/conversation.json，
 * 依 requestedBy 過濾，最新的在前）。
 * 帶 requestId：回傳該筆請求的完整細節（conversation 狀態、主要 sub-agent 的
 * log 尾段、manifest.json、deploy.log 尾段、對抗性覆核 verdict）——只有這筆
 * 請求的 requestedBy 等於呼叫端自己時才給，不是自己的一律回「找不到」（跟
 * generate_tool.ts 續接澄清時同一套「不透露別人請求存在與否」的措辭）。
 *
 * 讀 log 檔一律只取尾段（見 MAX_LOG_CHARS），不是整份塞進回應——這個服務的
 * log 是給人快速確認狀態用的，不是拿來原樣搬運整份 log 檔案內容。
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { asTextResult } from '../mcp_result.ts';
import { SCRATCH_DIR, LOGS_DIR } from '../const.ts';
import { loadConversation, type ConversationState } from '../agent/conversation.ts';
import { getCurrentIdentity } from '../identity.ts';

const MAX_LOG_CHARS = 4000;

function tailFile(path: string): string | null {
    if (!existsSync(path)) return null;
    try {
        const content = readFileSync(path, 'utf8');
        return content.length > MAX_LOG_CHARS ? `…（已截斷，只顯示最後 ${ MAX_LOG_CHARS } 字）…\n${ content.slice(-MAX_LOG_CHARS) }` : content;
    } catch {
        return null;
    }
}

function listRequestIds(): string[] {
    try {
        return readdirSync(SCRATCH_DIR).filter(name => {
            try {
                return statSync(join(SCRATCH_DIR, name)).isDirectory();
            } catch {
                return false;
            }
        });
    } catch {
        return [];
    }
}

interface RequestSummary {
    requestId: string;
    target: 'admin' | 'platform';
    request: string;
    status: ConversationState['status'];
    finalResult?: ConversationState['finalResult'];
    completed: boolean;
    codingStarted: boolean;
    roundCount: number;
    createdAt: string;
    updatedAt: string;
}

function summarize(requestId: string, state: ConversationState): RequestSummary {
    return {
        requestId,
        target: state.target,
        request: state.request.length > 120 ? `${ state.request.slice(0, 120) }…` : state.request,
        status: state.status,
        finalResult: state.finalResult,
        completed: state.completed,
        codingStarted: state.codingStarted,
        roundCount: state.rounds.length,
        createdAt: state.createdAt,
        updatedAt: state.updatedAt,
    };
}

export function registerQueryLogTool(server: McpServer): void {
    server.registerTool(
        'aladdin_toolsmith_query_log',
        {
            title: 'Query your own aladdin_toolsmith_generate_tool request history',
            description:
                '查詢你自己(依 Bearer token 對應的身分)透過 aladdin_toolsmith_generate_tool ' +
                '發起過的請求。不帶 requestId：列出你自己的請求清單(最新在前，含現況——是否' +
                '還在澄清中、已結案、成功或失敗)。帶 requestId：回傳該筆請求的完整細節(主要 ' +
                'sub-agent 的 log 尾段、部署管線的 log 尾段、對抗性覆核結論)，只能查你自己觸發' +
                '的請求，查別人的一律回「找不到」(不透露那筆請求是否存在)。',
            inputSchema: {
                requestId: z.string().uuid().optional()
                    .describe('要查詳情的請求 id；不帶則列出你自己的請求清單。'),
            },
        },
        ({ requestId }) => {
            const identity = getCurrentIdentity() ?? 'unknown';

            if (requestId === undefined) {
                const summaries: RequestSummary[] = [];
                for (const id of listRequestIds()) {
                    const state = loadConversation(join(SCRATCH_DIR, id));
                    if (state === null || state.requestedBy !== identity) continue;
                    summaries.push(summarize(id, state));
                }
                summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
                return asTextResult({ success: true, requests: summaries });
            }

            const scratchDir = join(SCRATCH_DIR, requestId);
            const state = loadConversation(scratchDir);
            if (state === null || state.requestedBy !== identity) {
                return asTextResult({
                    success: false, errorKind: 'unknown_request_id',
                    message: `找不到 requestId=${ requestId } 對應的請求。`,
                });
            }

            return asTextResult({
                success: true,
                requestId,
                state,
                mainAgentLogTail: tailFile(join(LOGS_DIR, `${ requestId }.log`)),
                deployLogTail: tailFile(join(scratchDir, 'deploy.log')),
                manifest: (() => {
                    const p = join(scratchDir, 'manifest.json');
                    if (!existsSync(p)) return null;
                    try {
                        return JSON.parse(readFileSync(p, 'utf8'));
                    } catch {
                        return null;
                    }
                })(),
                adversarialVerdict: (() => {
                    const p = join(scratchDir, 'adversarial-verdict.json');
                    if (!existsSync(p)) return null;
                    try {
                        return JSON.parse(readFileSync(p, 'utf8'));
                    } catch {
                        return null;
                    }
                })(),
            });
        },
    );
}
