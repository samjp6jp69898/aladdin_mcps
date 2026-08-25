/**
 * tools/get_chat_speech_setting.ts — aladdin_platform_chat_speech_setting_platform_get_chat_speech_setting
 *
 * rajah: ChatSpeechSettingPlatform.GetChatSpeechSetting（chat_back_office.rajah:29）
 *
 * 對應前端頁面：房間管理 → 房間限制設定 → 房間功能設定 → 聊天室發言設定。
 *
 * 這支 method 沒有任何參數（不吃 platformId）——是「這個平台的聊天室發言設定」單例，
 * platformId 由連線本身的登入態隱式帶入（agrabah `RequestContext.platformId` 從
 * request header 解析，不需要、也不應該讓呼叫端自己帶）。2026-08-25 讀源碼確認
 * （agrabah/src/managers/room_setting_manager.ts）：DB 查無現有設定列時不會報錯，
 * 直接回傳全部欄位為 0／空陣列的預設值（語意是「不限制」），呼叫端不需要另外處理
 * 「尚未設定過」的錯誤情境。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { toPlainNumber } from '../const.ts';

/**
 * 把後端回傳的 ChatSpeechSetting 原始物件轉成對呼叫端（agent）友善的形狀：
 * rechargeAmount 是 i64，decode 後可能是 Long 物件，轉成一般數字。
 * update_chat_speech_setting.ts 的回傳也共用這支，確保「讀到的」與「改完讀回的」格式一致。
 */
export function formatChatSpeechSetting(s: Record<string, unknown>): Record<string, unknown> {
    return {
        ...s,
        rechargeAmount: toPlainNumber(s.rechargeAmount),
    };
}

export function registerGetChatSpeechSettingTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_chat_speech_setting_platform_get_chat_speech_setting',
        {
            title: 'Get chat speech (room speaking) setting',
            description:
                '讀取本平台「房間管理」→「房間限制設定」→「房間功能設定」→「聊天室發言設定」目前的設定內容' +
                '（rajah: ChatSpeechSettingPlatform.GetChatSpeechSetting，無參數，單例設定，平台由連線本身判定）。' +
                '要修改請改用 aladdin_platform_chat_speech_setting_platform_save_chat_speech_setting——' +
                '那支工具會先呼叫這支 tool 讀現值再合併覆蓋，所以呼叫端通常不需要自己先呼叫這支再手動拼參數，' +
                '但仍可用這支單獨查看目前設定。' +
                'vipLevel/messageBoardLevel/memberLevels 是「Select」型欄位，存的是其他設定表（VIP 等級設定/' +
                '大舞台等級設定/會員等級設定）的等級 id，不是固定列舉值；vipLevel/messageBoardLevel 為 0、' +
                'memberLevels 為空陣列都代表「不限制」。尚未設定過的平台會回傳全部欄位為 0／空陣列的預設值' +
                '（後端查無資料列時的既有行為，不是錯誤）。',
            inputSchema: {},
        },
        async () => {
            const r = await withAutoRelogin(() => remote.chatBackOffice.chatSpeechSettingPlatform.GetChatSpeechSetting());
            if (r.failed) return asErrorResult(r);

            const s = r.data?.setting;
            if (!s) return asTextResult({ success: true, setting: null });

            return asTextResult({ success: true, setting: formatChatSpeechSetting(s as unknown as Record<string, unknown>) });
        },
    );
}
