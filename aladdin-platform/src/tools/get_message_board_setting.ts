/**
 * tools/get_message_board_setting.ts — aladdin_platform_message_board_platform_get_message_board_post_setting
 *
 * rajah: MessageBoardPlatform.GetMessageBoardPostSetting
 * （message_board_back_office.rajah:1560-1561）
 *
 * 對應前端頁面：「大舞台中心」(message-board) →「大舞台設定」(message-board-setting)
 * 頁籤下的「基本設置」(message-board-setup) 分頁，abu/platform/src/pages/message_board/MessageBoardSetup.vue
 * 的 loadSettings()。
 *
 * 這支 method 沒有任何參數（不吃 platformId）——是「這個平台的大舞台設置」單例設定，
 * 平台是由呼叫端連線的 BASE_URL host 判定（見 session.ts 的 setHeaderHandlerToAllGroup
 * 註解），不需要、也不應該讓呼叫端自己帶 platformId。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import {
    ACTIVE_STATUS_MAP,
    GIFT_CONDS_LOGIC_MAP,
    TIP_AUDIT_RELEASE_TYPE_MAP,
    GLOBAL_PIN_MODE_MAP,
    CHANGE_USER_DETAIL_CHARGE_TIMES_MAP,
    toPlainNumber,
} from '../const.ts';

/** 數字 → 對照表 key 的字串；查不到已知 key 時原樣回傳數字，不讓未知值消失。 */
function describeEnum<T extends Record<string, number>>(map: T, value: number | null | undefined): string | number {
    if (value === null || value === undefined) return value as never;
    const hit = Object.entries(map).find(([ , v ]) => v === value);
    return hit ? hit[ 0 ] : value;
}

/**
 * 把後端回傳的 MessageBoardPostSetting 原始物件轉成對呼叫端（agent）友善的形狀：
 * enum 欄位轉成字串、i64 欄位（Long 物件/十進位字串）轉成一般數字。
 * update_message_board_setting.ts 的回傳也共用這支，確保「讀到的」與「改完讀回的」
 * 格式一致，不會因為呼叫路徑不同而長得不一樣。
 */
export function formatMessageBoardSetting(s: Record<string, unknown>): Record<string, unknown> {
    return {
        ...s,
        postsChangeUserDetailMinChargeTotal: toPlainNumber(s.postsChangeUserDetailMinChargeTotal),
        postsGiftReceiveTotalAmount: toPlainNumber(s.postsGiftReceiveTotalAmount),
        postsUserAuthSwitch: describeEnum(ACTIVE_STATUS_MAP, s.postsUserAuthSwitch as number),
        postsReviewSwitch: describeEnum(ACTIVE_STATUS_MAP, s.postsReviewSwitch as number),
        postsCommentReviewSwitch: describeEnum(ACTIVE_STATUS_MAP, s.postsCommentReviewSwitch as number),
        postsReviewChangeUserDetailSwitch: describeEnum(ACTIVE_STATUS_MAP, s.postsReviewChangeUserDetailSwitch as number),
        postsChangeUserDetailMinChargeTimes: describeEnum(CHANGE_USER_DETAIL_CHARGE_TIMES_MAP, s.postsChangeUserDetailMinChargeTimes as number),
        postsGiftCondsLogic: describeEnum(GIFT_CONDS_LOGIC_MAP, s.postsGiftCondsLogic as number),
        postsGiftNeedOverWageringToSendSwitch: describeEnum(ACTIVE_STATUS_MAP, s.postsGiftNeedOverWageringToSendSwitch as number),
        tipAuditSwitch: describeEnum(ACTIVE_STATUS_MAP, s.tipAuditSwitch as number),
        tipAuditReleaseType: describeEnum(TIP_AUDIT_RELEASE_TYPE_MAP, s.tipAuditReleaseType as number),
        globalPinMode: describeEnum(GLOBAL_PIN_MODE_MAP, s.globalPinMode as number),
    };
}

export function registerGetMessageBoardSettingTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_message_board_platform_get_message_board_post_setting',
        {
            title: 'Get message board (stage) basic setting',
            description:
                '讀取本平台「大舞台中心」→「大舞台設定」頁籤中「基本設置」分頁目前的設定內容' +
                '（rajah: MessageBoardPlatform.GetMessageBoardPostSetting，無參數，單例設定，平台由連線本身判定）。' +
                '要修改請改用 aladdin_platform_message_board_platform_set_message_board_post_setting——那支工具會先呼叫這支 tool 讀現值再合併覆蓋，' +
                '所以呼叫端通常不需要自己先呼叫這支再手動拼參數，但仍可用這支單獨查看目前設定。' +
                '回傳裡的 postsGiftWageringMultiplier 是後端實際儲存值（顯示倍率 × 10000 的整數，例如顯示 1.5 倍存的是 15000），' +
                '不是顯示用小數。id/version/commentWeight/likeWeight/postsGiftPlatformCommission/' +
                'postsChangeUserDetailMinChargeVersion 是後端內部欄位，前端「基本設置」頁面沒有對應的可編輯欄位' +
                '（不在 update 工具的可帶參數清單裡），僅供參考。',
            inputSchema: {},
        },
        async () => {
            const r = await withAutoRelogin(() => remote.messageBoardBackOffice.messageBoardPlatform.GetMessageBoardPostSetting());
            if (r.failed) return asErrorResult(r);

            const s = r.data?.setting;
            if (!s) return asTextResult({ success: true, setting: null });

            return asTextResult({ success: true, setting: formatMessageBoardSetting(s as unknown as Record<string, unknown>) });
        },
    );
}
