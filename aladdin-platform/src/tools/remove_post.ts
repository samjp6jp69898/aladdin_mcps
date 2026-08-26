/**
 * tools/remove_post.ts — aladdin_platform_message_board_platform_remove_post
 *
 * rajah: MessageBoardPlatform.RemovePost(id i32 1, isOfficial bool 2)（無回傳值）
 * （rajah/services/message_board_back_office.rajah:1587，非 @NoPublic）
 *
 * **權限狀況同 review_post.ts/batch_review_posts.ts 已發現的問題**：這支 method 本身沒有自己的
 * `@Permission`，service 標頭上方看似有的 `# @Permission "MessageBoard"` 是 `#` 開頭的死註解、不是
 * 真實 rajah attribute（真正生效的只有 `@Module`），因此這支 method 在 rajah 裡完全沒有
 * `@Permission`，很可能代表後端對它不做權限檢查。
 *
 * method-category-checklist.md 第 0 節排除規則已過：agrabah 對應 Service
 * （message_board_platform.ts:methodRemovePost，1556-1641 行）確認有真實實作，非 notImplemented。
 * 分類：第 7 節「刪除」——**軟刪除**：把 `status` 改成對應的 `removeXxx` 狀態，資料列本身不會被
 *   實際刪除（DB row 仍在，只是狀態轉成待審核刪除/已審核刪除等）。
 *
 * 2026-08-26 讀 agrabah 後端原始碼查證（1556-1641 行）：
 * - **支援官方貼文**（`isOfficial` 決定操作 `posts` 還是 `official_posts` 表）。
 * - 查詢有 `platform_id = ?` 篩選（1564 行），沒有跨租戶問題；後續 UPDATE 只用 `id = ? AND status = ?`
 *   （不含 platform_id）當樂觀鎖條件，這是安全的——SELECT 階段已經確認過這個 id 屬於本平台，UPDATE
 *   的 status 比對只是防併發競態，不是租戶邊界檢查。
 * - **狀態映射**：依目前狀態轉成對應的 `removeXxx`：pending→removePending、approved→removeApproved、
 *   rejected→removeRejected、delisted→removeDelisted。**非這四種狀態（含已經是任一 removeXxx 狀態）
 *   一律回 `invalidData`**——代表「不能對已經刪除過的貼文再刪一次」，重複呼叫不會靜默成功，也不冪等。
 * - 與 `id 不存在` 相關的**已知後端 bug（同 delist_post.ts/relist_post.ts 那個死碼模式）**：
 *   `loadObject()` 查無資料回傳 `failed:false, data:null`，`if (post.failed)` 判斷式因此是死碼，
 *   緊接著 `switch (post.data.status)` 對 null 讀屬性會丟未捕捉例外，實測回傳泛用 `unknown`
 *   （errorCode=1），不是文件原意的 `messageBoardPostNotExists`。
 * - 副作用：若打賞收入 summary_state 曾是 `applied`，會嘗試扣回 `post_count`；若是 `pending`（從未
 *   +1 過），直接終結為 `void`；若是 `delistedReverted`（下架時已扣過），鎖定為 `reverted`；已是終態
 *   （`reverted`/`void`）則不做任何事——這些都是後端內部處理，本工具不需額外動作。
 *
 * **2026-08-26 dev 實測**：pk-platform.alddev.com——對已知不存在的極大 id 呼叫，實測回傳
 * errorCode=1（unknown），符合上述已知後端 bug（沿用 delist_post.ts 已交叉驗證過的同一種 bug 結論，
 * 此處未重複用 raw script 驗證）。**誠實限制**：dev 站台目前沒有可安全操作（不影響其他 session 測試
 * 資料）的貼文可供完整驗證「成功軟刪除」的 round-trip，只驗證了「id 不存在」這條路徑。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerRemovePostTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_message_board_platform_remove_post',
        {
            title: 'Soft-delete a message board post',
            description:
                '軟刪除一則大舞台動態貼文（rajah: MessageBoardPlatform.RemovePost）——**只改變 status ' +
                '為對應的 removeXxx 狀態，不會真的刪除資料列**。**權限狀況不明確：這支 method 在 rajah ' +
                '裡沒有任何 @Permission，很可能代表後端對它完全不做權限檢查**（詳見檔頭說明）。支援一般' +
                '會員貼文與官方貼文（isOfficial 區分）。**不冪等**：只有目前是 pending/approved/rejected/' +
                'delisted 四種狀態能刪除，已經刪除過（任一 removeXxx 狀態）再刪一次會回 invalidData ' +
                '（不會靜默成功）。**已知後端 bug（非本工具引入）**：id 不存在時實際上不會回 ' +
                'messageBoardPostNotExists，而是回泛用的 unknown 錯誤（errorCode=1，訊息通常是空字串）' +
                '，可先用 get_message_board_posts 確認 id 是否存在、目前狀態。',
            inputSchema: {
                id: z.number().int().min(1).describe('大舞台動態貼文 id，必須目前是 pending/approved/rejected/delisted 其中之一'),
                isOfficial: z.boolean().describe('true=軟刪除官方動態，false=軟刪除一般會員動態；兩者是獨立實體表'),
            },
        },
        async (input) => {
            const r = await withAutoRelogin(() => remote.messageBoardBackOffice.messageBoardPlatform.RemovePost(
                input.id,
                input.isOfficial,
            ));
            if (r.failed) {
                return asErrorResult(r, {
                    hint: 'errorCode=1(unknown)=已知後端 bug，id 不存在時的常見反應（非本工具問題）；invalidData=id 存在但目前狀態不允許刪除（已刪除過，或狀態異常）；可先用 get_message_board_posts 確認目前狀態',
                });
            }

            return asTextResult({ success: true, message: `貼文 ${ input.id } 已軟刪除` });
        },
    );
}
