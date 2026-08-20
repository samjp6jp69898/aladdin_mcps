/**
 * conversation.ts — 多輪澄清對話狀態管理（scratch/{requestId}/conversation.json）。
 *
 * 背景：generate_tool 原本一次 MCP tool 呼叫 = 一次 sub-agent spawn，run-agent.ts
 * 是同步 await 整個流程跑完，沒有任何中途介入機制。多輪澄清透過「同一個
 * requestId 觸發第二次 sub-agent spawn，並把累積的問答記錄餵進新的 prompt」來
 * 模擬，不是真的讓同一個 process 保持存活等輸入——sub-agent 本身仍是一次性、
 * 無狀態的 `claude -p` 呼叫，狀態全部外部化在這個檔案裡，reload/crash 都不怕丟失。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface ConversationRound {
    questions: string[];
    /** undefined 代表企劃還沒回答這一輪（理論上只會是最後一輪處於這個狀態）。 */
    answers?: string;
}

export interface ConversationState {
    target: 'admin' | 'platform';
    request: string;
    notes?: string;
    rounds: ConversationRound[];
    /** sub-agent 一旦判斷資訊足夠、開始寫代碼（manifest 不是 needs_clarification），
     * 澄清階段結束，之後不可再用同一個 requestId 繼續澄清。 */
    codingStarted: boolean;
    /** deploy-pipeline 跑完（不論成功失敗）後設為 true，這個 requestId 徹底結案，
     * 不可再用同一個 requestId 呼叫 generate_tool。 */
    completed: boolean;
    /** 2026-08-20：tokens.json 名冊裡的唯一 id，來自 identity.ts 的
     * getCurrentIdentity()——這次請求是誰發起的，供 commit message、Telegram
     * 通知、以及之後的查詢 log tool（依身分過濾，只能看自己的請求）使用。 */
    requestedBy: string;
    /** ISO 字串，只在建立時寫一次，供查詢 log tool 排序/顯示用。 */
    createdAt: string;
    /** 每次 saveConversation() 時更新，供查詢 log tool 判斷「最近有沒有動靜」。 */
    updatedAt: string;
    /** 2026-08-20：generate_tool.ts 改成非阻塞回應後加的進度欄位——呼叫端收到
     * 的是「已受理」，不是最終結果，要靠 aladdin_toolsmith_query_log 讀這個
     * 欄位知道現在跑到哪。background 處理函式在每個階段轉換時更新。 */
    status: 'queued' | 'researching' | 'needs_clarification' | 'deploying' | 'done' | 'failed';
    /** 只有 status 是 'done'/'failed' 時才有值——background 處理函式的終局結果，
     * query_log 讀這個欄位回傳給呼叫端，其餘欄位（conversation 全貌）也一併給。 */
    finalResult?: { success: boolean; errorKind?: string; stage?: string; message: string; warnings?: string[] };
}

function conversationPath(scratchDir: string): string {
    return join(scratchDir, 'conversation.json');
}

export function loadConversation(scratchDir: string): ConversationState | null {
    const path = conversationPath(scratchDir);
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf8')) as ConversationState;
}

/** 呼叫端不用自己管 updatedAt——每次存檔這裡自動蓋成現在時間；createdAt 只在
 * generate_tool.ts 建立全新請求時手動設一次，這裡不動它。 */
export function saveConversation(scratchDir: string, state: ConversationState): void {
    state.updatedAt = new Date().toISOString();
    mkdirSync(scratchDir, { recursive: true, mode: 0o700 });
    writeFileSync(conversationPath(scratchDir), JSON.stringify(state, null, 2));
}

/**
 * 2026-08-20（對抗性 session review，高優先度發現）：generate_tool.ts 非阻塞化
 * 之後，「這個 requestId 正在處理中」這件事完全靠記憶體裡的 acquire()/背景
 * Promise 存在，不是靠任何持久化的 process 追蹤。行程重啟或 crash（例如
 * `launchctl kickstart`）會讓所有記憶體裡的排隊與背景 Promise 直接消失，但
 * conversation.json 還停在 'queued'/'researching'/'deploying'、
 * `completed:false`——這種 requestId 會永遠卡住：`already_running` 擋掉續接、
 * 也沒有任何機制把它們轉成明確的失敗狀態，query_log 會一直顯示「還在跑」但
 * 其實早就死透了。
 *
 * 修法：http.ts 啟動時呼叫這支函式一次，掃過 scratch/ 底下所有
 * conversation.json，把「非終局 status 且 completed:false」的請求一律標成
 * failed——server 剛啟動這個時間點，不可能有任何背景任務還在真的執行中
 * （所有背景 Promise 都隨上一個行程消失了），所以這個判定不需要額外去檢查
 * 有沒有對應的子行程，狀態本身在「剛啟動」這個時間點就已經足夠說明一切。
 * `needs_clarification` 不算孤兒——那是合法的「等企劃回答」暫停狀態，行程
 * 重啟不影響它（下次續接會重新 spawn sub-agent，資訊都在 conversation.json
 * 裡），不應該被這裡誤清成 failed。
 */
export function cleanupOrphanedRequestsOnStartup(scratchRootDir: string): { cleaned: number } {
    let cleaned = 0;
    let entries: string[];
    try {
        entries = readdirSync(scratchRootDir);
    } catch {
        return { cleaned };
    }
    for (const name of entries) {
        const dir = join(scratchRootDir, name);
        try {
            if (!statSync(dir).isDirectory()) continue;
        } catch {
            continue;
        }
        const state = loadConversation(dir);
        if (state === null) continue;
        if (state.completed) continue;
        if (state.status === 'needs_clarification') continue;
        // 剩下的（queued/researching/deploying，或舊資料沒有 status 欄位）
        // 都是行程重啟前留下的孤兒，一律標成失敗，不留在看起來還在跑的狀態。
        state.completed = true;
        state.status = 'failed';
        state.finalResult = {
            success: false,
            errorKind: 'orphaned_after_restart',
            message: 'toolsmith 服務在這個請求處理過程中重啟或中斷，背景任務已經不存在，此為啟動時自動標記的失敗狀態。請重新發起一次新請求（不要帶這個 requestId）。',
        };
        try {
            saveConversation(dir, state);
            cleaned++;
        } catch {
            // 存檔失敗也不讓啟動流程掛掉，留給下次啟動再試一次。
        }
    }
    return { cleaned };
}

/**
 * 組成餵給 sub-agent 的對話歷史文字區塊，直接附進 prompt。第一輪（rounds 為空）
 * 回傳空字串——prompt-builder.ts 據此判斷要不要顯示「這是續接的第 N 輪」字樣。
 */
export function formatTranscript(state: ConversationState): string {
    if (state.rounds.length === 0) return '';
    const lines: string[] = [ `## 先前的澄清對話紀錄（這是第 ${ state.rounds.length + 1 } 輪，前面已經問過以下問題並得到回答）\n` ];
    state.rounds.forEach((round, i) => {
        lines.push(`### 第 ${ i + 1 } 輪你（上一輪的自己）問的問題`);
        round.questions.forEach((q) => lines.push(`- ${ q }`));
        lines.push('\n企劃的回答：');
        lines.push(round.answers ?? '（無，資料異常）');
        lines.push('');
    });
    lines.push('如果上面的回答已經足夠，直接進入下面的正常六步驟流程；如果還有其他真正卡住你、不問清楚就無法安全實作的問題，才繼續問（不要為了問而問，也不要重複問已經回答過的）。');
    return lines.join('\n');
}
