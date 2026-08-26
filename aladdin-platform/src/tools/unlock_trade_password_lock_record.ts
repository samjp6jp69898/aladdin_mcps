/**
 * tools/unlock_trade_password_lock_record.ts — aladdin_platform_security_restriction_platform_unlock_trade_password_lock_record
 *
 * rajah: SecurityRestrictionPlatform.UnlockTradePasswordLockRecord
 * （security_restriction_back_office.rajah:231，無獨立 @Permission，由 service 級 @Permission "PlatCapCfg.Security" 承接）
 *
 * method-category-checklist.md 第 6 節狀態轉換：無回傳值，呼叫後自行呼叫
 * ListTradePasswordLockRecord（search.identifier 取回該筆，因為 rajah 沒有依 id 查單筆的 method）
 * 讀回目前狀態做 round-trip 驗證，讓呼叫端知道實際是否轉成 unlock。
 *
 * 冪等性：2026-08-26 dev 實測——對已經是 unlock 狀態的紀錄（id=13）重複呼叫，RPC 不報錯、
 * 狀態維持 unlock（round-trip 讀回仍是 unlock），是安全的冪等操作，可放心重試。
 *
 * 陷阱（2026-08-26 dev 實測）：對根本不存在的 id（如 999999）呼叫，後端一樣回 success，不報
 * idNotExists 之類的錯誤（疑似 UPDATE ... WHERE id=? 影響 0 列也視為成功，未做存在性檢查）。
 * 因此本工具的「success: true」只代表 RPC 呼叫本身沒出錯，不代表真的有解鎖到東西——
 * round-trip 查不到該筆時 currentStatus 會回一段提示文字，呼叫端必須看這個欄位、不能只看 success。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { ListTradePasswordLockRecordSearch } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { TRADE_PASSWORD_LOCK_STATUS_MAP, describeEnum } from '../const.ts';

export function registerUnlockTradePasswordLockRecordTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_security_restriction_platform_unlock_trade_password_lock_record',
        {
            title: 'Unlock a trade password lock record',
            description:
                '解鎖指定的交易密碼錯誤鎖定紀錄（rajah: SecurityRestrictionPlatform.UnlockTradePasswordLockRecord），' +
                '對應「產品系統」→「安全管理」→「資金密碼管理」分頁紀錄列表的「解鎖」操作。' +
                'id 請先用 aladdin_platform_security_restriction_platform_list_trade_password_lock_record 查詢取得，' +
                '不要憑猜測填入。此操作對已是 unlock 狀態的紀錄重複呼叫是安全的冪等操作（dev 實測確認），' +
                '但仍建議呼叫前先確認是要解鎖正確的那一筆。後端無回傳值，本工具會在呼叫後自動用' +
                'identifier 重新查詢該筆紀錄目前狀態，一併回傳供核對（rajah 沒有依 id 查單筆的 method，' +
                '若同一 identifier 短時間內有多筆紀錄，round-trip 核對可能不精準，此時請自行用' +
                'list 工具複核）。' +
                '陷阱（dev 實測）：對不存在的 id 呼叫，後端一樣回成功、不會報錯——success:true 只代表' +
                'RPC 呼叫本身沒出錯，不保證真的解鎖到東西，請務必看 currentStatus 欄位核對實際結果。',
            inputSchema: {
                id: z.number().int().min(1).describe('要解鎖的鎖定紀錄 id（來自 list 工具的回傳）'),
                identifier: z.string().describe('該筆紀錄的會員帳號（來自 list 工具的回傳），用於呼叫後 round-trip 核對目前狀態'),
            },
        },
        async (input) => {
            const r = await withAutoRelogin(() => remote.securityRestrictionBackOffice.securityRestrictionPlatform.UnlockTradePasswordLockRecord(input.id));
            if (r.failed) return asErrorResult(r);

            const checkR = await withAutoRelogin(() =>
                remote.securityRestrictionBackOffice.securityRestrictionPlatform.ListTradePasswordLockRecord(
                    1, 50, ListTradePasswordLockRecordSearch.create({ identifier: input.identifier }),
                ),
            );
            const checkRows = (checkR.failed ? [] : checkR.data?.rows ?? []) as unknown as Record<string, unknown>[];
            const checkRow = checkRows.find((row) => row.id === input.id);

            return asTextResult({
                success: true,
                message: `id=${ input.id } 已送出解鎖`,
                currentStatus: checkRow ? describeEnum(TRADE_PASSWORD_LOCK_STATUS_MAP, checkRow.status as number) : '(round-trip 查無此筆，請自行用 list 工具核對)',
            });
        },
    );
}
