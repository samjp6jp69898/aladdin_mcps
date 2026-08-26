/**
 * tools/relist_post.ts — aladdin_platform_message_board_platform_relist_post
 *
 * rajah: MessageBoardPlatform.RelistPost(id i32 1, isOfficial bool 2)（無回傳值）
 * （rajah/services/message_board_back_office.rajah:1573，@Permission "MessageBoard.MbPost.PostMgmt.Ops.DelistPost"，
 * 與姊妹 method DelistPost 共用同一個權限節點，非 @NoPublic）
 *
 * method-category-checklist.md 第 0 節排除規則已過：agrabah 對應 Service
 * （message_board_platform.ts:methodRelistPost，1259-1310 行附近）確認有真實實作，非 notImplemented。
 * 分類：第 6 節「狀態轉換」——`DelistPost` 的反向操作，把 `delisted` 貼文改回 `approved`。
 *
 * 2026-08-26 讀 agrabah 後端原始碼查證（1259-1310 行）：
 * - 是 `delist_post.ts` 的鏡像操作：只有 `status === delisted` 的貼文能重新上架，會同時清空
 *   `delist_reason`（改回空字串）。查詢有 `platform_id = ?` 篩選（1269 行），無跨租戶問題。
 * - 支援官方貼文（`isOfficial` 決定操作 `posts` 還是 `official_posts` 表），與 `delist_post.ts` 一致。
 * - 程式碼原意是想區分兩種失敗：id 不存在回 `messageBoardPostNotExists`、id 存在但非 delisted 回
 *   `messageBoardPostUpdateFailed`。
 * - **真實後端 bug（與 delist_post.ts 完全同構，2026-08-26 dev 實測發現並交叉驗證，非本工具引入）**：
 *   `loadObject()` 查無資料時回傳 `failed: false, data: null`（成功但資料是 null），`methodRelistPost`
 *   的 `if (post.failed)` 判斷式永遠不為 true，「id 不存在」這段錯誤處理是死碼；接著直接讀
 *   `post.data.status` 對 `null` 丟出未捕捉例外，實測回傳的是**泛用的 `unknown`（errorCode=1）**，
 *   不是 `messageBoardPostNotExists`。**只有「id 存在但非 delisted」會正確回
 *   `messageBoardPostUpdateFailed`**（此時 `post.data` 非 null，不會觸發例外）。
 * - **不冪等**：對已經是 approved（或其他非 delisted）狀態的貼文重複呼叫會回
 *   `messageBoardPostUpdateFailed`，不會靜默成功。
 * - 副作用：若下架當時打賞收入 summary_state 曾被回沖成 `delistedReverted`，重新上架時會嘗試補回
 *   `post_count`（`incrementPostCount`），失敗不擋業務（狀態仍會 commit，由補償 Job 兜底）——這是
 *   後端內部處理，本工具不需額外動作。
 *
 * **2026-08-26 dev 實測**：pk-platform.alddev.com——對已知不存在的極大 id 呼叫，**實測回傳
 * errorCode=1（unknown），不是預期的 messageBoardPostNotExists**（已用繞過本工具、直接呼叫 remote
 * client 的 raw script 交叉驗證，確認不是本工具的包裝層問題，是後端既有 bug，見上方說明）；對已知
 * 目前是 approved（非 delisted）狀態的真實貼文呼叫正確回 `messageBoardPostUpdateFailed`（非法轉換
 * 被拒絕，這條路徑正常）。**誠實限制**：dev 站台目前沒有可安全操作的 delisted 狀態貼文，未驗證
 * 「成功重新上架」的完整 round-trip。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerRelistPostTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_message_board_platform_relist_post',
        {
            title: 'Relist a delisted message board post back to approved',
            description:
                '把一則已下架（delisted）的大舞台動態貼文重新上架，改回 approved 狀態並清空下架原因' +
                '（rajah: MessageBoardPlatform.RelistPost，需要權限節點 MessageBoard.MbPost.PostMgmt.Ops.' +
                'DelistPost，與 delist_post 共用同一個權限節點）。支援一般會員貼文與官方貼文（isOfficial ' +
                '區分）。**不冪等**：只有目前狀態是 delisted 的貼文能重新上架，對已經是 approved 或其他' +
                '狀態重複呼叫會回 messageBoardPostUpdateFailed 錯誤（不會靜默成功）。**已知後端 bug（非本' +
                '工具引入，2026-08-26 dev 實測發現）**：id 不存在時實際上不會回 messageBoardPostNotExists，' +
                '而是會因為後端未處理的空值例外回傳泛用的 unknown 錯誤（errorCode=1，訊息通常是空字串）' +
                '——只有「id 存在但目前不是 delisted」才會正確回 messageBoardPostUpdateFailed。不確定目前' +
                '狀態可先用 get_message_board_posts 查一次。',
            inputSchema: {
                id: z.number().int().min(1).describe('大舞台動態貼文 id，必須目前處於 delisted（已下架）狀態'),
                isOfficial: z.boolean().describe('true=重新上架官方動態，false=重新上架一般會員動態；兩者是獨立實體表'),
            },
        },
        async (input) => {
            const r = await withAutoRelogin(() => remote.messageBoardBackOffice.messageBoardPlatform.RelistPost(
                input.id,
                input.isOfficial,
            ));
            if (r.failed) {
                return asErrorResult(r, {
                    hint: 'errorCode=1(unknown)=已知後端 bug，id 不存在時的正常反應（非本工具問題）；messageBoardPostUpdateFailed=id 存在但目前不是 delisted 狀態；可先用 get_message_board_posts 確認 id 是否存在、目前狀態',
                });
            }

            return asTextResult({ success: true, message: `貼文 ${ input.id } 已重新上架` });
        },
    );
}
