/**
 * tools/update_point_setting.ts — aladdin_platform_point_platform_update_point_setting
 *
 * rajah: PointPlatform.GetPointSetting + UpdatePointSetting（point_back_office.rajah:258,261，
 * 需要 @Permission "Store.Point.Setting.Configuration"）
 *
 * 分類（method-category-checklist.md 第 4 節「Upsert」精神）：UpdatePointSetting 吃整包
 * PointSetting 物件、非 partial patch，rajah 全庫無 @Optional 欄位存在性標記，故先讀現值、
 * 只覆蓋呼叫端明確帶的欄位、完成後 round-trip 讀回，比照 update_message_board_setting.ts 模式。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { PointSetting } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { ACTIVE_STATUS_MAP, TIME_LIMIT_TYPE_KEYS, TIME_LIMIT_TYPE_MAP, deepFixLongs } from '../const.ts';

const statusToggle = z.enum([ 'enabled', 'disabled' ]);

export function registerUpdatePointSettingTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_point_platform_update_point_setting',
        {
            title: 'Update platform-wide point settings',
            description:
                '更新本平台的全局積分設定並儲存（rajah: PointPlatform.GetPointSetting 讀現值 + ' +
                'UpdatePointSetting 寫入，需要權限節點 Store.Point.Setting.Configuration）。無 platformId，' +
                '單例設定，平台由連線本身判定。所有欄位皆為 optional：只帶你要改的欄位，其餘會先讀現值原樣帶回，' +
                '不會被清空或歸零。' +
                '2026-08-25 讀原始碼查證（point_platform.ts:681-720）：dueType="absoluteTime" 時 dueAtTimestamp ' +
                '必須有值，dueType="relativeTime" 時 dueDay 必須有值，兩者不搭配會回錯誤碼 ' +
                'pointSettingTimeLimitTypeAndTimeDayError；若你只改了 dueType、沒同時帶對應的 dueAtTimestamp/dueDay，' +
                '會沿用讀回的現值（可能導致組合不合法而被後端拒絕），建議改 dueType 時一併明確帶對應欄位。' +
                '完成後會自動讀回最新設定一併回傳。' +
                'prod 執行前確認：當這個 server 是正式環境（prod）時，執行本工具前必須先用 AskUserQuestion' +
                '（或功能相同的方式）明確詢問使用者是否要在正式環境執行這個操作，取得明確同意後才可以帶上 confirm 參數；' +
                '絕不能自行假設使用者同意。非 prod 環境不需要、也會忽略 confirm 欄位。',
            inputSchema: {
                pointStatus: statusToggle.optional().describe('積分產出狀態開關'),
                dueType: z.enum(TIME_LIMIT_TYPE_KEYS).optional().describe(
                    '積分時效類型：unlimitedTime=無限制、absoluteTime=絕對到期時間（搭配 dueAtTimestamp）、' +
                    'relativeTime=相對天數（搭配 dueDay）',
                ),
                dueAtTimestamp: z.number().int().optional().describe('過期絕對時間（毫秒 epoch），dueType=absoluteTime 時必填'),
                dueDay: z.number().int().min(1).max(720).optional().describe('過期相對天數（1~720），dueType=relativeTime 時必填'),
                expirationNoticeStatus: statusToggle.optional().describe('過期提示狀態開關'),
                expirationNoticeDay: z.number().int().optional().describe('距離過期幾日要提示'),
                expirationNoteHint: z.string().optional().describe('過期提示的說明文字（前端用）'),
                confirm: z.string().optional().describe(
                    `正式環境（prod）專用的強制確認欄位；非 prod 環境會被忽略、不需提供。當這個 server 是正式環境時，` +
                    `必須先取得使用者明確同意，再帶上精確字串 "${ PROD_CONFIRM_TOKEN }" 才會執行，否則本工具會拒絕執行並回錯誤。`,
                ),
            },
        },
        async (input) => {
            assertProdConfirmed(input.confirm);

            const getR = await withAutoRelogin(() => remote.pointBackOffice.pointPlatform.GetPointSetting());
            if (getR.failed) return asErrorResult(getR);
            const base = getR.data?.setting;
            if (!base) return asTextResult({ success: false, message: '讀取目前設定失敗：後端回傳空值' });

            const overrides: Record<string, unknown> = {};
            if (input.pointStatus !== undefined) overrides.pointStatus = ACTIVE_STATUS_MAP[ input.pointStatus ];
            if (input.dueType !== undefined) overrides.dueType = TIME_LIMIT_TYPE_MAP[ input.dueType ];
            if (input.dueAtTimestamp !== undefined) overrides.dueAtTimestamp = input.dueAtTimestamp;
            if (input.dueDay !== undefined) overrides.dueDay = input.dueDay;
            if (input.expirationNoticeStatus !== undefined) overrides.expirationNoticeStatus = ACTIVE_STATUS_MAP[ input.expirationNoticeStatus ];
            if (input.expirationNoticeDay !== undefined) overrides.expirationNoticeDay = input.expirationNoticeDay;
            if (input.expirationNoteHint !== undefined) overrides.expirationNoteHint = input.expirationNoteHint;

            const merged = PointSetting.create({ ...base, ...overrides });

            const setR = await withAutoRelogin(() => remote.pointBackOffice.pointPlatform.UpdatePointSetting(merged));
            if (setR.failed) return asErrorResult(setR);

            const checkR = await withAutoRelogin(() => remote.pointBackOffice.pointPlatform.GetPointSetting());
            return asTextResult({
                success: true,
                message: '積分設定已更新',
                setting: checkR.failed ? null : deepFixLongs(checkR.data?.setting),
            });
        },
    );
}
