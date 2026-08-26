/**
 * tools/batch_review_posts.ts — aladdin_platform_message_board_platform_batch_review_posts
 *
 * rajah: MessageBoardPlatform.BatchReviewPosts(ids [i32] 1, status MessageBoardStatusEnum 2)（無回傳值）
 * （rajah/services/message_board_back_office.rajah:1568，非 @NoPublic）
 *
 * **權限查證更正（同批次姊妹 tool review_post.ts review 時發現，此檔同步修正）**：`# @Permission
 * "MessageBoard"`（service 標頭上方，1529 行）是 `#` 開頭的純註解，不是真實 attribute，service 真實
 * attributes 只有 `Module`；`BatchReviewPosts` 本身也沒有自己的 `@Permission`。**這支 method 在 rajah
 * 裡完全沒有 `@Permission`，很可能代表後端對它不做權限檢查**，不是「需要權限節點 MessageBoard」。
 *
 * method-category-checklist.md 第 0 節排除規則已過：agrabah 對應 Service
 * （message_board_platform.ts:methodBatchReviewPosts，1074-1099 行）確認有真實實作，非
 * notImplemented。分類：第 6 節「狀態轉換」（批量）——**風險最高的子類**：無回傳資料（Empty），
 * 只能靠 RPC 是否報錯判斷整批結果，且是 fail-fast 逐筆處理，見下方陷阱。
 *
 * 2026-08-26 讀 agrabah 後端原始碼查證（1074-1099 行）：
 * - `ids` 上限 = `DefaultPageSize`（100），空陣列或超過 100 筆一律整批拒絕（回
 *   `messageBoardCommentIdsOverLimit`，錯誤碼命名雖帶 comment 字樣但這裡是貼文用途，rajah 沿用同
 *   一顆錯誤碼），此情況下**完全不會處理任何一筆**。
 * - status 同單筆版限制只能 approved/rejected，否則整批拒絕，同樣不處理任何一筆。
 * - **關鍵陷阱：fail-fast 且已成功的筆數不會回滾**——逐一呼叫 `_reviewSinglePost`（與單筆版
 *   `ReviewPost` 共用核心），**遇到第一筆失敗就立刻中止並回傳該筆錯誤碼**，但在它之前已經成功
 *   審核的 id（`successIds`）**已經真的寫入 DB 並產生 audit**，不會被撤銷。RPC 回傳的錯誤只代表
 *   「整批沒有全部完成」，**無法從回傳值知道哪些 id 已經成功、哪些沒處理到**——本工具因此在失敗
 *   時明確提示呼叫端需另外用 get_message_board_posts 查詢實際結果，不能假設「回錯就是全部沒變化」。
 * - 逐筆失敗原因與單筆版相同：id 不存在或目前不是 pending 狀態，一律回 `messageBoardPostNotExists`
 *   （無法區分兩種情況）。
 * - 官方貼文不適用（同單筆版，直接操作 `posts` 表、無 `isOfficial` 參數）。
 *
 * **2026-08-26 dev 實測**：pk-platform.alddev.com——ids=[] 正確回 messageBoardCommentIdsOverLimit；
 * ids 混合「已知不存在的 id」與「已知已審核過的 id」，正確在第一筆就整批中止並回
 * messageBoardPostNotExists。**誠實限制**：與單筆版 review_post 相同，dev 站台目前沒有真正處於
 * pending 狀態的貼文，未能實測「批量中前幾筆成功、中間某筆失敗中止」這個 fail-fast 部分成功情境的
 * 完整行為，僅驗證了「全部都會失敗」與「整批上限/狀態驗證」兩條路徑。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { MESSAGE_BOARD_STATUS_MAP } from '../const.ts';

const REVIEW_STATUS_KEYS = [ 'approved', 'rejected' ] as const;

export function registerBatchReviewPostsTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_message_board_platform_batch_review_posts',
        {
            title: 'Batch approve or reject pending message board posts',
            description:
                '批量審核多筆待審核的大舞台動態貼文（rajah: MessageBoardPlatform.BatchReviewPosts）。' +
                '**權限狀況不明確：這支 method 在 rajah 裡沒有任何 @Permission，很可能代表後端對它完全不做' +
                '權限檢查**（詳見檔頭說明）。**只適用一般會員貼文，不支援官方貼文**。ids 陣列上限 100 筆，' +
                '空陣列或超過 100 筆會整批拒絕、不處理任何一筆。status 只能是 approved(通過) 或 rejected(拒絕)，' +
                '非法值同樣整批拒絕。**極重要：這是 fail-fast 逐筆處理，遇到第一筆失敗（id 不存在或非 ' +
                'pending 狀態）就立刻中止，但在它之前已經處理成功的 id 不會回滾——RPC 失敗只代表「沒有全部' +
                '完成」，無法從回傳值知道哪些 id 實際已經成功**。呼叫失敗後應該用 ' +
                'get_message_board_posts（帶 commentStatus 篩選）重新查詢確認實際結果，不能假設本次呼叫' +
                '完全沒有生效。建議呼叫前先用 get_message_board_posts（commentStatus="pending"）確認每個 ' +
                'id 目前確實是 pending 狀態，降低中途失敗的機率。',
            inputSchema: {
                ids: z.array(z.number().int().min(1)).min(1).max(100).describe('要審核的貼文 id 陣列，1~100 筆，每筆都應該目前是 pending 狀態'),
                status: z.enum(REVIEW_STATUS_KEYS).describe('審核結果：approved(通過)/rejected(拒絕)，套用到全部 ids，僅接受這兩種值'),
            },
        },
        async (input) => {
            const r = await withAutoRelogin(() => remote.messageBoardBackOffice.messageBoardPlatform.BatchReviewPosts(
                input.ids,
                MESSAGE_BOARD_STATUS_MAP[ input.status ],
            ));
            if (r.failed) {
                return asErrorResult(r, {
                    hint: 'fail-fast：這個錯誤可能發生在整批驗證階段（全部未處理）或逐筆處理中途（部分 id 已成功、不會回滾）。' +
                        '請用 get_message_board_posts 重新查詢這批 ids 目前的實際狀態，不要假設本次呼叫完全沒有生效——' +
                        '但 get_message_board_posts 的 search 沒有 id 清單篩選欄位，無法直接「查這幾個 id 現在的狀態」，' +
                        '只能靠 commentStatus/時間等條件撈頁後自行比對 id，批次較大或分散時可靠性有限。',
                });
            }

            return asTextResult({ success: true, message: `${ input.ids.length } 筆貼文已全部審核為 ${ input.status }`, ids: input.ids });
        },
    );
}
