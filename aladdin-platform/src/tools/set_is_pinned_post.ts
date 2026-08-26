/**
 * tools/set_is_pinned_post.ts — aladdin_platform_message_board_platform_set_is_pinned_post
 *
 * rajah: MessageBoardPlatform.SetIsPinnedPost(id i32 1, isPinned bool 2)（無回傳值）
 * （rajah/services/message_board_back_office.rajah:1585，@Permission "MessageBoard.MbPost.PostMgmt.Status.PinPost"，非 @NoPublic）
 *
 * method-category-checklist.md 第 0 節排除規則已過：agrabah 對應 Service
 * （message_board_platform.ts:methodSetIsPinnedPost，1498-1535 行）確認有真實實作，非
 * notImplemented。分類：第 6 節「狀態轉換」——`Toggle*`/`SetIsXxx` 類，帶明確目標狀態
 * （`isPinned`），非無參數 bit-flip，不需要工具層自作聰明先查再反轉。
 *
 * 2026-08-26 讀 agrabah 後端原始碼查證（1498-1535 行）：
 * - **只適用一般會員貼文，不支援官方貼文**：只操作 `DbPostsBackOffice`（`posts` 表），無
 *   `isOfficial` 參數，與 `SetIsHotPost` 同組限制（rajah 註解「只有貼文,官方沒有」）。
 * - **前置閘門**：呼叫前會檢查平台的全局置頂設定（`GetMessageBoardPostSetting` 的
 *   `globalPinMode`）是否為 `off`，是的話直接拒絕（`messageBoardGlobalPinDisabled`），不管
 *   `id`/`isPinned` 帶什麼都一樣——這是平台層級開關，不是這支 method 能繞過的。
 * - **已是目標狀態時明確回 `nothingChanged`**（1515-1517 行，`ErrorCode.nothingChanged=10`），
 *   跟只用 UPDATE 影響列數判斷的其他狀態轉換 method 不同，這支在查完現值後就先比對，語意更清楚：
 *   「呼叫成功但沒有實際變化」與「呼叫失敗」是兩種不同的錯誤碼。
 * - **查詢有 `platform_id = ?` 篩選**（1510 行，程式碼註解明寫「防跨平台」），沒有跨租戶問題——
 *   對照本批次發現的 `SetPostRecommend`/`SetIsReceiveGift`/`SetIsHotPost` 三支同組但**沒有**
 *   platform_id 篩選的方法（已個別 flag 為 needs_clarification），這支是同一個檔案裡少數正確做了
 *   租戶隔離的對照組，可以放心建。
 * - **與 delist_post.ts/relist_post.ts 相同的已知後端 bug（id 不存在時的行為）**：`loadObject()`
 *   查無資料回傳 `failed:false, data:null`，`if (post.failed)` 判斷式是死碼，緊接著讀
 *   `post.data.isPinned` 對 null 會丟未捕捉例外，實測回傳泛用 `unknown`（errorCode=1），不是
 *   `messageBoardPostNotExists`。
 * - `pin_expire_at`（絕對到期時間快照）依 `globalPinMode`：`permanent` 設為 2999-12-31（視為永久）、
 *   `timed` 設為 `now + pinEffectiveHours` 小時、取消置頂時清為 `NULL`。呼叫端不需要也不能自己指定
 *   到期時間，完全由平台設定決定。
 *
 * **2026-08-26 dev 實測**：pk-platform.alddev.com——對已知不存在的極大 id 呼叫，實測回傳
 * errorCode=1（unknown），符合上述已知後端 bug（用繞過本工具、直接呼叫 remote client 的 raw
 * script 交叉驗證過同一種 bug，此處沿用結論未重複驗證）；對已知目前是 approved 且未置頂的真實貼文
 * 帶 isPinned=false 呼叫，正確回 `nothingChanged`（已是目標狀態，非錯誤但也沒有變化）。**誠實限制**：
 * 因平台目前 `globalPinMode` 設定與可安全操作的測試資料限制，未驗證「成功設為置頂」的完整
 * round-trip（isPinned=true 且尚未置頂的情境）。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerSetIsPinnedPostTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_message_board_platform_set_is_pinned_post',
        {
            title: 'Pin or unpin a message board post',
            description:
                '設定大舞台動態貼文是否置頂（rajah: MessageBoardPlatform.SetIsPinnedPost，需要權限節點 ' +
                'MessageBoard.MbPost.PostMgmt.Status.PinPost）。**只適用一般會員貼文，不支援官方貼文**。' +
                '**前置閘門（優先序最高，在檢查 id 是否存在之前執行）**：平台全局置頂設定（globalPinMode）' +
                '若為關閉（off），呼叫一律回 messageBoardGlobalPinDisabled，與 id/isPinned 帶什麼無關' +
                '——即使 id 不存在，只要 globalPinMode=off 就會先回這個錯誤，不會回下方的 unknown。' +
                '已經是目標狀態時回 ' +
                'nothingChanged（成功但沒有變化，不是錯誤）。到期時間完全由平台設定的 globalPinMode ' +
                '決定（永久或限時 N 小時），呼叫端不能自訂到期時間。**已知後端 bug（非本工具引入）**：' +
                'id 不存在時實際上不會回 messageBoardPostNotExists，而是回泛用的 unknown 錯誤' +
                '（errorCode=1，訊息通常是空字串），可先用 get_message_board_posts 確認 id 是否存在、' +
                '目前置頂狀態。',
            inputSchema: {
                id: z.number().int().min(1).describe('大舞台動態貼文 id（一般會員貼文，非官方貼文）'),
                isPinned: z.boolean().describe('true=設為置頂，false=取消置頂'),
            },
        },
        async (input) => {
            const r = await withAutoRelogin(() => remote.messageBoardBackOffice.messageBoardPlatform.SetIsPinnedPost(
                input.id,
                input.isPinned,
            ));
            if (r.failed) {
                return asErrorResult(r, {
                    hint: 'messageBoardGlobalPinDisabled=平台全局置頂設定已關閉；errorCode=1(unknown)=已知後端 bug，id 不存在時的常見反應（非本工具問題）；nothingChanged=已經是目標狀態（非錯誤）；messageBoardPostUpdateFailed=其他更新失敗',
                });
            }

            return asTextResult({ success: true, message: `貼文 ${ input.id } 已${ input.isPinned ? '設為置頂' : '取消置頂' }` });
        },
    );
}
