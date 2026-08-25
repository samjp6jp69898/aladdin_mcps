/**
 * tools/update_chat_speech_setting.ts — aladdin_platform_chat_speech_setting_platform_save_chat_speech_setting
 *
 * rajah: ChatSpeechSettingPlatform.GetChatSpeechSetting + SaveChatSpeechSetting
 * （chat_back_office.rajah:29-32，@Permission "Room.RoomRestriction.RoomFunctions.ChatSetting"）
 *
 * 對應前端頁面：房間管理 → 房間限制設定 → 房間功能設定 → 聊天室發言設定。
 *
 * SaveChatSpeechSetting 吃的是完整 ChatSpeechSetting 物件，不是 partial patch，且 rajah
 * 全庫沒有 @Optional/@Partial 這類「欄位存在性」標記可以判斷後端會不會把沒帶到的欄位當成
 * 「明確要歸零」覆蓋掉（method-category-checklist.md 第 4 節）——2026-08-25 讀源碼確認
 * （agrabah/src/managers/room_setting_manager.ts）後端確實是整包覆蓋（先用 platformId 查現
 * 有列、有則整列 updateObject／無則 insertObject，memberLevels 關聯表整批刪除重建），所以
 * 這裡照該檢查清單要求的模式：先呼叫 GetChatSpeechSetting 讀現值，只覆蓋呼叫端明確帶的欄位，
 * 其餘（含 memberLevels 陣列）原樣帶回，完成後再讀一次做 round-trip 驗證。
 *
 * platformId 不是參數——由連線本身的登入態隱式帶入，見 get_chat_speech_setting.ts 檔頭註解。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { ChatSpeechSetting } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { formatChatSpeechSetting } from './get_chat_speech_setting.ts';

export function registerUpdateChatSpeechSettingTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_chat_speech_setting_platform_save_chat_speech_setting',
        {
            title: 'Update chat speech (room speaking) setting',
            description:
                '修改本平台「房間管理」→「房間限制設定」→「房間功能設定」→「聊天室發言設定」並儲存' +
                '（rajah: ChatSpeechSettingPlatform.SaveChatSpeechSetting，就是該頁面「儲存」按鈕實際打的 API）。' +
                '無參數 platformId，單例設定，平台由連線本身判定，不需要、也不接受 platformId。' +
                '所有欄位皆為 optional：只帶你要改的欄位，其餘會先讀現值原樣帶回，不會被清空或歸零' +
                '（後端這支 method 吃整包物件、不是 partial patch，見檔頭註解）。' +
                '完成後會自動讀回最新設定一併回傳，方便核對是否真的改成功。' +
                'vipLevel/messageBoardLevel 傳 0 代表不限制（等級 id 門檻），memberLevels 傳空陣列代表不限制' +
                '會員層級（不是「不修改」——不修改請直接省略這個欄位）。' +
                'prod 執行前確認（H38 同構機制）：當這個 server 是正式環境（prod）時，執行本工具前必須先用 AskUserQuestion' +
                '（或功能相同的方式）明確詢問使用者是否要在正式環境執行這個操作，取得明確同意後才可以帶上 confirm 參數；' +
                '絕不能自行假設使用者同意。非 prod 環境不需要、也會忽略 confirm 欄位。',
            inputSchema: {
                vipLevel: z.number().int().min(0).optional().describe('可發言的 VIP 等級門檻 id，0 表示不限制'),
                messageBoardLevel: z.number().int().min(0).optional().describe('可發言的大舞台等級門檻 id，0 表示不限制'),
                rechargeAmount: z.number().int().min(0).optional().describe('可發言所需累計充值金額，0 表示不限制'),
                intervalSeconds: z.number().int().min(0).optional().describe('發言間隔秒數，0 表示不限制'),
                memberLevels: z.array(z.number().int().min(0)).optional().describe(
                    '可發言的會員層級 id 陣列（對應會員等級設定），空陣列代表不限制——注意這個欄位是整包覆蓋，' +
                    '傳陣列就是「最終應該是這些」，不是新增/移除既有值的差異運算；不想修改請省略此欄位。',
                ),
                confirm: z.string().optional().describe(
                    `正式環境（prod）專用的強制確認欄位；非 prod 環境會被忽略、不需提供。當這個 server 是正式環境時，` +
                    `必須先取得使用者明確同意，再帶上精確字串 "${ PROD_CONFIRM_TOKEN }" 才會執行，否則本工具會拒絕執行並回錯誤。`,
                ),
            },
        },
        async (input) => {
            assertProdConfirmed(input.confirm);

            const getR = await withAutoRelogin(() => remote.chatBackOffice.chatSpeechSettingPlatform.GetChatSpeechSetting());
            if (getR.failed) return asErrorResult(getR);

            // 讀源碼確認 GetChatSpeechSetting 查無資料列時也一定回傳完整預設物件（不是 null，見
            // get_chat_speech_setting.ts 檔頭註解），理論上這個分支不會發生；仍比照
            // update_message_board_setting.ts 的 fail-fast 處理，若後端行為未來改變也不會誤把
            // 半套資料當 base 寫回去。
            const base = getR.data?.setting;
            if (!base) return asTextResult({ success: false, message: '讀取目前設定失敗：後端回傳空值' });

            const overrides: Record<string, unknown> = {};
            if (input.vipLevel !== undefined) overrides.vipLevel = input.vipLevel;
            if (input.messageBoardLevel !== undefined) overrides.messageBoardLevel = input.messageBoardLevel;
            if (input.rechargeAmount !== undefined) overrides.rechargeAmount = input.rechargeAmount;
            if (input.intervalSeconds !== undefined) overrides.intervalSeconds = input.intervalSeconds;
            if (input.memberLevels !== undefined) overrides.memberLevels = input.memberLevels;

            const merged = ChatSpeechSetting.create({ ...base, ...overrides });

            const setR = await withAutoRelogin(() => remote.chatBackOffice.chatSpeechSettingPlatform.SaveChatSpeechSetting(merged));
            if (setR.failed) return asErrorResult(setR);

            const checkR = await withAutoRelogin(() => remote.chatBackOffice.chatSpeechSettingPlatform.GetChatSpeechSetting());
            const checkSetting = checkR.failed ? undefined : checkR.data?.setting;
            return asTextResult({
                success: true,
                message: '聊天室發言設定已更新',
                setting: checkSetting ? formatChatSpeechSetting(checkSetting as unknown as Record<string, unknown>) : null,
            });
        },
    );
}
