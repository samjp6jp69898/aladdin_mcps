/**
 * tools/delist_post.ts — aladdin_platform_message_board_platform_delist_post
 *
 * rajah: MessageBoardPlatform.DelistPost(id i32 1, reason string 2, isOfficial bool 3)（無回傳值）
 * （rajah/services/message_board_back_office.rajah:1570，@Permission "MessageBoard.MbPost.PostMgmt.Ops.DelistPost"，非 @NoPublic）
 *
 * method-category-checklist.md 第 0 節排除規則已過：agrabah 對應 Service
 * （message_board_platform.ts:methodDelistPost，1180-1239 行）確認有真實實作，非 notImplemented。
 * 分類：第 6 節「狀態轉換」——status 目標固定是 delisted（不是輸入參數，方法本身即代表這個轉換）。
 *
 * 2026-08-26 讀 agrabah 後端原始碼查證（1180-1239 行）：
 * - `reason` 必填非空字串，空字串回 `messageBoardDelistReasonRequired`。
 * - **支援官方貼文**（`isOfficial` 決定操作 `posts` 還是 `official_posts` 表），跟同一批次先前
 *   實作的 `review_post`/`batch_review_posts`（只操作 `posts` 表、不支援官方貼文）不同，這支
 *   method 兩種貼文都適用。
 * - **這支 method 有做 `platform_id = ?` 篩選**（1187 行），跟 `get_post.ts`（已因跨租戶缺口撤回
 *   needs_clarification）不同，沒有同樣的跨平台讀取風險。
 * - 只有 `status === approved` 的貼文可以下架，程式碼原意是想區分兩種失敗：id 不存在回
 *   `messageBoardPostNotExists`、id 存在但非 approved 回 `messageBoardPostUpdateFailed`。
 * - **真實後端 bug（2026-08-26 dev 實測發現，非本工具引入）**：`id 不存在` 這條路徑實際上**不會**
 *   回 `messageBoardPostNotExists`——`loadObject()`（`mysql_relational_database_engine.ts:271-296`）
 *   查無資料時回傳的是 `ServiceResult.fromData(null)`，也就是 **`failed: false`、`data: null`**
 *   （成功、但資料是 null），不是 `failed: true`。`methodDelistPost`（1188 行）的判斷式只寫
 *   `if (post.failed)`，永遠不會為 true，這段「id 不存在」的錯誤處理是死碼；接著程式碼直接讀
 *   `post.data.status`（1191 行），對 `data: null` 會丟出未捕捉的 TypeError，落到上層通用例外處理，
 *   實測回傳的是**泛用的 `unknown`（errorCode=1，非 1101）**，不是文件容易讓人誤以為的
 *   `messageBoardPostNotExists`。**只有「id 存在但目前不是 approved」這條路徑會正確回
 *   `messageBoardPostUpdateFailed`**（因為此時 `post.data` 非 null，不會觸發例外）。
 * - **不冪等**：對已下架/未審核/已拒絕等非 approved 狀態的貼文重複呼叫會回
 *   `messageBoardPostUpdateFailed`，不會靜默成功。
 * - 副作用：若該貼文原本打賞收入已結算（`summaryState === applied`），下架時會嘗試扣回
 *   `post_count`（`decrementPostCount`），失敗不擋業務（狀態仍會 commit，由補償 Job 兜底）——這是
 *   後端內部處理，本工具不需額外動作。
 *
 * **2026-08-26 dev 實測**：pk-platform.alddev.com——reason 傳空字串正確回
 * `messageBoardDelistReasonRequired`；帶已知不存在的極大 id 呼叫，**實測回傳 errorCode=1（unknown），
 * 不是預期的 messageBoardPostNotExists**（已用繞過本工具、直接呼叫 remote client 的 raw script 交叉
 * 驗證兩次，確認不是本工具的包裝層問題，是後端既有 bug，見上方說明）。**誠實限制**：與
 * review_post/batch_review_posts 同理，未在 dev 找到可安全操作（不影響其他 session 測試資料）的
 * approved 狀態貼文完整驗證「成功下架」與「id 存在但非 approved」這兩條路徑，只驗證了 reason 必填與
 * id 不存在（意外發現的真實 bug）這兩條路徑。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerDelistPostTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_message_board_platform_delist_post',
        {
            title: 'Delist (take down) an approved message board post',
            description:
                '把一則已通過審核（approved）的大舞台動態貼文下架（rajah: MessageBoardPlatform.DelistPost，' +
                '需要權限節點 MessageBoard.MbPost.PostMgmt.Ops.DelistPost）。支援一般會員貼文與官方貼文' +
                '（isOfficial 區分）。reason 必填（下架原因，會存入 delist_reason 欄位，非空字串）。' +
                '**不冪等**：只有目前狀態是 approved 的貼文能下架，對已下架/待審核/已拒絕等其他狀態重複' +
                '呼叫會回 messageBoardPostUpdateFailed 錯誤（不會靜默成功、也不會覆蓋成別的狀態）。' +
                '**已知後端 bug（非本工具引入，2026-08-26 dev 實測發現）**：id 不存在時實際上不會回 ' +
                'messageBoardPostNotExists，而是會因為後端未處理的空值例外回傳泛用的 unknown 錯誤' +
                '（errorCode=1，訊息通常是空字串）——只有「id 存在但目前不是 approved」才會正確回 ' +
                'messageBoardPostUpdateFailed。不確定目前狀態可先用 get_message_board_posts 查一次。',
            inputSchema: {
                id: z.number().int().min(1).describe('大舞台動態貼文 id，必須目前處於 approved（已通過審核）狀態'),
                reason: z.string().min(1).max(500).describe('下架原因，必填非空字串，會存入貼文的下架原因欄位（500 字上限為工具層保守設定，非已查證的後端 DB 欄位長度限制）'),
                isOfficial: z.boolean().describe('true=下架官方動態，false=下架一般會員動態；兩者是獨立實體表'),
            },
        },
        async (input) => {
            const r = await withAutoRelogin(() => remote.messageBoardBackOffice.messageBoardPlatform.DelistPost(
                input.id,
                input.reason,
                input.isOfficial,
            ));
            if (r.failed) {
                return asErrorResult(r, {
                    hint: 'errorCode=1(unknown)=已知後端 bug，id 不存在時的正常反應（非本工具問題）；messageBoardPostUpdateFailed=id 存在但目前不是 approved 狀態；可先用 get_message_board_posts 確認 id 是否存在、目前狀態',
                });
            }

            return asTextResult({ success: true, message: `貼文 ${ input.id } 已下架` });
        },
    );
}
