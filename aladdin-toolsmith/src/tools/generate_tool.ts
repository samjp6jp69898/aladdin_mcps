/**
 * tools/generate_tool.ts — aladdin_toolsmith_generate_tool
 *
 * 刻意用 aladdin_toolsmith_* 前綴跟既有 aladdin_<admin|platform>_<動詞>_<名詞>
 * （呼叫 RPC 用）區分開，見 /Users/user/.claude/plans/logical-jumping-cook.md
 * 第 2 節。
 *
 * H23-H25 + 2026-08-20 非阻塞化：
 *
 * **為什麼要非阻塞**：整條流程（研究＋寫代碼＋tsc＋對抗性覆核＋commit/reload/
 * push）可能長達 20-40 分鐘，遠超過大多數 MCP client 自己的 tool-call 逾時
 * 預設值（實測案例：requestId `76f29177...`/`679ad821...`，server 端還在正常
 * 跑，呼叫端的 Claude Code 卻已經自己放棄等待、回報使用者「逾時」）。這不是
 * server 端的 bug，是「HTTP 請求整個生命週期綁死一次完整流程」這個同步阻塞
 * 設計本身的問題——同步等待再久都無法讓呼叫端的 client 逾時設定變長。
 *
 * **新流程**：
 *   1. handler 只做快速的同步驗證（欄位齊全、requestId 存在且是自己的、
 *      有沒有 pending 的問題等）——這些檢查本來就很快，不需要非阻塞化。
 *   2. 驗證通過後，把 state.status 設成 'queued'/'researching' 存檔，接著
 *      **不 await** 呼叫 processInBackground()（讓它在背景繼續跑），立刻
 *      回傳 `{success:true, status:'accepted', requestId}` 給呼叫端。
 *   3. processInBackground() 內部才是原本那一整串邏輯：acquire 名額（N=3，
 *      額度用盡在這裡排隊，不影響已經回應完的呼叫端）→ runAgent → 依 manifest
 *      分流 → 成功則呼叫 deploy-pipeline → 把每個階段的進度/終局結果寫回
 *      conversation.json 的 status/finalResult 欄位。
 *   4. 呼叫端改用 aladdin_toolsmith_query_log（不受這裡的併發鎖影響，隨時能
 *      查）輪詢進度，不用再原地等一次 HTTP 往返撐過整個流程。
 *
 * AsyncLocalStorage 身分傳遞（identity.ts）在這個設計下依然正確：
 * processInBackground() 是在 http.ts 的 runWithIdentity() callback 同步範圍內
 * 呼叫的（只是不 await 它的 Promise），Node 的 AsyncLocalStorage 依非同步呼叫
 * 因果鏈追蹤 context，不依賴外層 handler 是否已經 return，所以背景任務全程
 * 都讀得到正確的 identity，不受 HTTP response 已經送出、甚至 McpServer 已經
 * close 的影響（背景任務不依賴 c/server/transport 這些跟本次 HTTP request
 * 綁定的物件，純粹是獨立的 child_process/fs 操作）。
 */

import { existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { asTextResult } from '../mcp_result.ts';
import { CONCURRENCY_LIMIT, SCRATCH_DIR } from '../const.ts';
import { createConcurrencyLimiter } from '../agent/concurrency-limiter.ts';
import { runAgent } from '../agent/run-agent.ts';
import { loadConversation, saveConversation, type ConversationState } from '../agent/conversation.ts';
import { runDeployPipeline, type ManifestFileEntry } from '../agent/deploy-pipeline.ts';
import { snapshotRealDirs, realDirsTouched } from '../agent/collect-output.ts';
import { getCurrentIdentity } from '../identity.ts';

// 這把鎖只涵蓋「研究＋寫代碼」這段（per-requestId 隔離的 verify-workspace，
// 開到 N=3 安全），現在搬進 processInBackground() 內部使用，不再卡在會立刻
// 回應呼叫端的同步路徑上。部署階段（git 操作）另外有 deploy-pipeline.ts
// 自己的 N=1 鎖，見該檔。
const limiter = createConcurrencyLimiter(CONCURRENCY_LIMIT);

interface SubAgentManifest {
    success: boolean;
    errorKind?: string;
    summary?: string;
    files?: ManifestFileEntry[];
    verification?: { ran: boolean; notes: string };
    warnings?: string[];
    questions?: string[];
}

function readManifest(manifestPath: string): SubAgentManifest {
    if (!existsSync(manifestPath)) {
        return { success: false, errorKind: 'manifest_missing', summary: 'sub-agent 沒有寫出 manifest.json，且 EXIT trap 的 fallback 也沒生效，這是意外狀況。' };
    }
    try {
        return JSON.parse(readFileSync(manifestPath, 'utf8')) as SubAgentManifest;
    } catch (err) {
        return { success: false, errorKind: 'manifest_unreadable', summary: `manifest.json 無法解析：${ err instanceof Error ? err.message : String(err) }` };
    }
}

/**
 * 背景處理：不被任何呼叫端 await，靠 conversation.json 的 status/finalResult
 * 欄位對外揭露進度與結果。任何一步拋出的例外都要在這裡被接住並寫回
 * status:'failed'——這是唯一的交接訊號，跟 sub-agent 的 manifest.json 同一個
 * 設計哲學：沒寫清楚就等於卡死在某個中繼狀態，query_log 會一直顯示「還在跑」
 * 但其實早就死透了，這比明確回報失敗更難排查。
 */
async function processInBackground(requestId: string, scratchDir: string, state: ConversationState): Promise<void> {
    try {
        await limiter.acquire();
        try {
            state.status = 'researching';
            saveConversation(scratchDir, state);

            // sub-agent 依 prompt 指示只能寫 scratchDir 底下，理論上不會碰到正式
            // 目錄——但它是 bypassPermissions 執行、對整個 monorepo 有完整讀寫
            // 權限，prompt 層約束擋不住蓄意或失手繞過，這裡用 git status 快照做
            // 結構性防禦（沿用既有的 collect-output.ts 邏輯，不重新發明）：spawn
            // 前後各拍一次，有差異就是意外訊號，直接中止、不進 deploy-pipeline。
            // **只比對 state.target 這一個 target 的正式目錄**（collect-output.ts
            // 2026-08-20 對抗性 review 修正）：N=3 併發下，若這裡兩個 target 都比，
            // 另一個 target 同時合法跑 deploy-pipeline 的 commit 會讓這次快照
            // 誤判成「被意外異動」——只鎖定自己的 target 可以消除這個跨 target
            // 假陽性（同 target 兩個並發請求互相干擾是已知殘留風險，見
            // collect-output.ts 檔頭說明）。
            const beforeSnapshot = snapshotRealDirs(state.target);
            const agentResult = await runAgent({ requestId, scratchDir, state });
            const afterSnapshot = snapshotRealDirs(state.target);
            if (realDirsTouched(beforeSnapshot, afterSnapshot)) {
                state.completed = true;
                state.status = 'failed';
                state.finalResult = {
                    success: false, errorKind: 'real_dir_touched_unexpectedly',
                    message: 'sub-agent 執行期間偵測到正式目錄（aladdin-admin/aladdin-platform）被意外異動，這不應該發生，已中止、未進入部署流程，需要工程師人工檢查現況。',
                };
                saveConversation(scratchDir, state);
                return;
            }

            const manifest = readManifest(agentResult.manifestPath);

            if (manifest.success === false && manifest.errorKind === 'needs_clarification') {
                const questions = manifest.questions !== undefined && manifest.questions.length > 0
                    ? manifest.questions
                    : [ '（agent 標記需要澄清但沒有列出具體問題，這是意外狀況，建議直接聯絡工程師查看 log）' ];
                state.rounds.push({ questions });
                state.status = 'needs_clarification';
                saveConversation(scratchDir, state);
                return;
            }

            // 不論後面成功或失敗，這個 requestId 的澄清階段都結束了——要嘛已經
            // 在寫代碼並跑完部署流程，要嘛 sub-agent 自己整個失敗，兩種情況都
            // 不再接受續接。
            state.codingStarted = true;

            if (manifest.success !== true) {
                state.completed = true;
                state.status = 'failed';
                state.finalResult = {
                    success: false, errorKind: manifest.errorKind ?? 'agent_failed',
                    message: manifest.summary ?? 'sub-agent 未能完成任務，詳情請洽工程師查看 log。',
                    warnings: manifest.warnings ?? [],
                };
                saveConversation(scratchDir, state);
                return;
            }

            if (manifest.files === undefined || manifest.files.length === 0) {
                state.completed = true;
                state.status = 'failed';
                state.finalResult = { success: false, errorKind: 'no_files', message: 'sub-agent 回報成功但沒有任何檔案產出，視為異常，未執行部署。' };
                saveConversation(scratchDir, state);
                return;
            }

            state.status = 'deploying';
            saveConversation(scratchDir, state);

            const deployResult = await runDeployPipeline({
                target: state.target,
                requestId,
                requestedBy: state.requestedBy,
                scratchDir,
                outputDir: agentResult.outputDir,
                files: manifest.files,
                summary: manifest.summary ?? '',
            });

            state.completed = true;
            state.status = deployResult.success ? 'done' : 'failed';
            state.finalResult = { success: deployResult.success, stage: deployResult.stage, message: deployResult.message };
            saveConversation(scratchDir, state);
        } finally {
            limiter.release();
        }
    } catch (err) {
        // 保底：上面任何一步意外拋出未被接住的例外（理論上不該發生，但這是
        // 背景任務，沒有呼叫端在等著看 stack trace），一律落到明確的 failed
        // 狀態，不要讓 conversation.json 卡在某個中繼 status 裡看起來像還在跑。
        state.completed = true;
        state.status = 'failed';
        state.finalResult = {
            success: false, errorKind: 'unexpected_exception',
            message: `背景處理發生未預期例外：${ err instanceof Error ? (err.stack ?? err.message) : String(err) }`,
        };
        try {
            saveConversation(scratchDir, state);
        } catch {
            // 連存檔都失敗（磁碟異常等級的問題）就真的無能為力了，靠 stderr 留痕。
            console.error(`[aladdin-toolsmith generate_tool] requestId=${ requestId } 背景處理失敗且無法寫回狀態：${ err instanceof Error ? err.message : String(err) }`);
        }
    }
}

export function registerGenerateToolTool(server: McpServer): void {
    server.registerTool(
        'aladdin_toolsmith_generate_tool',
        {
            title: 'Generate a new aladdin-admin / aladdin-platform tool (async)',
            description:
                '用自然語言描述想要 aladdin-admin 或 aladdin-platform 新增/擴充的「業務能力」' +
                '（例如某個後台選單頁面的查詢/新增/編輯功能），**用商業/選單語言描述就好，' +
                '不需要你（呼叫端）自己先去查 rajah method、API 路徑、或任何原始碼細節，也不需要' +
                '在呼叫本工具前先反問使用者「有沒有 API」——這正是本工具內部會自動做的事**：會在' +
                '工程師本機觸發一個具有原始碼權限的 agent，從 rajah/services 與後端實作裡自行定位' +
                '對應的 method，完成研究與實作，通過 tsc 檢查與獨立對抗性覆核 agent 的把關後，' +
                '自動部署進正式目錄、commit、push 到 main、重載 dev 常駐服務。' +
                '**這支工具是非同步的：呼叫後幾乎立刻回應（`status:"accepted"`），不會讓你等整個' +
                '流程跑完**（研究+寫代碼+驗證+部署整條下來可能長達 20-40 分鐘，遠超過大部分 MCP ' +
                'client 自己的 tool-call 逾時預設值，同步等待會導致你的 client 自己先放棄）。收到' +
                '`status:"accepted"` 後，用 `aladdin_toolsmith_query_log`（帶同一個 requestId）' +
                '輪詢進度與最終結果，不需要、也不應該對這支工具本身重複呼叫來等結果。' +
                '真正該回頭問使用者的，只有「這個技術上有兩種以上不同實作方式、選錯會做出不是他要' +
                '的東西」這種需要使用者拍板的業務決策（例如要不要含分頁篩選、失敗時的訊息格式）——' +
                '不是「這支 API 存不存在」這種呼叫端或使用者都不可能知道、只有讀原始碼才查得到的' +
                '技術細節，那律屬於本工具內部 sub-agent 的研究範圍，不要先幫使用者過濾掉。' +
                '若 sub-agent 查過原始碼後判斷真的需要這種業務層面的澄清，用 `aladdin_toolsmith_' +
                'query_log` 查到 `status:"needs_clarification"` 時，帶著同一個 requestId 與 ' +
                'answers 再呼叫一次本工具即可繼續（一樣立刻回應 accepted，不會同步等），可能來回' +
                '好幾輪。' +
                '同時最多 3 個請求在跑研究/寫代碼（N=3），部署階段（會動到共用的 git repo）序列化' +
                '執行；額度用盡時在背景排隊，不影響這支工具本身「立刻回應」的行為。',
            inputSchema: {
                target: z.enum([ 'admin', 'platform' ]).optional()
                    .describe('要擴充哪個後台的 MCP server：admin 或 platform。第一次呼叫（不帶 requestId 時）必填；續接既有請求時不需要帶，會沿用第一次呼叫決定的值。'),
                request: z.string().min(10).max(4000).optional()
                    .describe('自然語言描述想要新增/擴充的能力，至少 10 字、至多 4000 字。第一次呼叫（不帶 requestId 時）必填；續接既有請求時忽略此欄位。'),
                notes: z.string().max(2000).optional()
                    .describe('補充資訊（例如已知的欄位限制、參考案例），非必填，至多 2000 字，僅第一次呼叫有意義。'),
                requestId: z.string().uuid().optional()
                    .describe('回答澄清問題、繼續某次請求時，填入上一次回應拿到的 requestId；第一次發起全新請求時不要填這個欄位。'),
                answers: z.string().max(4000).optional()
                    .describe('對應 requestId 那一輪澄清問題的回答，plain text 即可。有帶 requestId 就必須有 answers，否則會回錯誤。'),
            },
        },
        ({ target, request, notes, requestId: inputRequestId, answers }) => {
            // 下面全部是快速的同步驗證，不牽涉 sub-agent，不需要非阻塞化。
            //
            // **脆弱前提，改動前務必注意**（2026-08-20 對抗性 session review 明確
            // 驗證過並要求記下來）：這段 handler body 是**非 async、從讀
            // conversation 狀態到 saveConversation()+踢出 processInBackground()
            // 全程沒有任何 `await`**——JS run-to-completion 保證同一個 requestId
            // 的兩次併發呼叫不可能在這段中間交錯執行，這是唯一保護「續接澄清時
            // lastRound.answers 賦值」不會被併發呼叫踩到的機制。**如果以後在這段
            // 中間加了任何 `await`，這個保護會悄悄失效且不會有任何型別/測試錯誤
            // 提示你**，加 await 前請重新確認是否需要額外的鎖。
            let requestId: string;
            let scratchDir: string;
            let state: ConversationState;

            if (inputRequestId !== undefined) {
                requestId = inputRequestId;
                scratchDir = join(SCRATCH_DIR, requestId);
                const loaded = loadConversation(scratchDir);
                if (loaded === null) {
                    return asTextResult({
                        success: false, errorKind: 'unknown_request_id',
                        message: `找不到 requestId=${ requestId } 對應的請求，可能是打錯或這個 process 曾經重啟過（狀態存在記憶體外的 scratch 檔案裡，理論上不受影響，但請先確認 requestId 沒複製錯），如果確定找不到，請重新用完整的 request 描述發起一次新請求（不要帶 requestId）。`,
                    });
                }
                if (loaded.completed) {
                    return asTextResult({
                        success: false, errorKind: 'already_completed',
                        message: `requestId=${ requestId } 這次請求已經結案（不論當初是成功還是失敗），不能再繼續。如果還有新需求，請重新發起一次新的請求（不要帶 requestId）。`,
                    });
                }
                if (loaded.status === 'researching' || loaded.status === 'deploying' || loaded.status === 'queued') {
                    return asTextResult({
                        success: false, errorKind: 'already_running',
                        message: `requestId=${ requestId } 目前正在處理中（status=${ loaded.status }），還沒有需要你回答的問題，請用 aladdin_toolsmith_query_log 查詢進度，不要重複呼叫本工具。`,
                    });
                }
                if (loaded.requestedBy !== (getCurrentIdentity() ?? 'unknown')) {
                    // 不透露「這個 requestId 其實存在、只是不是你的」這種可用來枚舉
                    // 別人請求存不存在的資訊，回應措辭跟「找不到」一致。
                    return asTextResult({
                        success: false, errorKind: 'unknown_request_id',
                        message: `找不到 requestId=${ requestId } 對應的請求，可能是打錯或已過期，請重新用完整的 request 描述發起一次新請求（不要帶 requestId）。`,
                    });
                }
                if (answers === undefined || answers.trim().length === 0) {
                    return asTextResult({
                        success: false, errorKind: 'missing_answers',
                        message: '帶了 requestId 但沒有帶 answers（或是空字串），不知道要回答什麼問題，請把回答填進 answers 欄位。',
                    });
                }
                const lastRound = loaded.rounds[ loaded.rounds.length - 1 ];
                if (lastRound === undefined) {
                    return asTextResult({
                        success: false, errorKind: 'no_pending_question',
                        message: `requestId=${ requestId } 目前沒有待回答的問題，狀態異常，請重新發起一次新請求。`,
                    });
                }
                lastRound.answers = answers;
                state = loaded;
                state.status = 'queued';
                saveConversation(scratchDir, state);
            } else {
                if (target === undefined || request === undefined) {
                    return asTextResult({
                        success: false, errorKind: 'missing_fields',
                        message: '第一次呼叫（不帶 requestId）必須同時帶 target 與 request。',
                    });
                }
                requestId = randomUUID();
                scratchDir = join(SCRATCH_DIR, requestId);
                // http.ts 的 /mcp handler 一律用 runWithIdentity() 包住整段處理，
                // 理論上這裡不可能讀到 undefined；萬一真的讀到（例如未來新增了
                // 繞過該包裝的呼叫路徑），用明確的 'unknown' 而不是讓後面的
                // git commit message／Telegram 通知悄悄印出 "undefined"。
                const requestedBy = getCurrentIdentity() ?? 'unknown';
                const now = new Date().toISOString();
                state = {
                    target, request, notes, rounds: [], codingStarted: false, completed: false,
                    requestedBy, createdAt: now, updatedAt: now, status: 'queued',
                };
                saveConversation(scratchDir, state);
            }

            // 不 await：讓它在背景繼續跑，呼叫端不用等。任何例外都在
            // processInBackground() 內部被接住寫回 status:'failed'，這裡的
            // .catch() 純粹是防禦性保底（避免萬一有漏網的同步拋出變成
            // unhandled rejection 讓整個 process 印出噪音 log）。
            void processInBackground(requestId, scratchDir, state).catch(err => {
                console.error(`[aladdin-toolsmith generate_tool] requestId=${ requestId } processInBackground 拋出未被接住的例外：${ err instanceof Error ? err.stack : String(err) }`);
            });

            return asTextResult({
                success: true,
                status: 'accepted',
                requestId,
                message: '已受理，正在背景處理（研究/寫代碼/驗證/部署整條下來可能長達 20-40 分鐘）。' +
                    '請用 aladdin_toolsmith_query_log（帶這個 requestId）查詢進度與結果，不需要等這次呼叫。',
            });
        },
    );
}
