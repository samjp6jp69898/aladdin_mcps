/**
 * tools/list_trade_password_lock_record.ts — aladdin_platform_security_restriction_platform_list_trade_password_lock_record
 *
 * rajah: SecurityRestrictionPlatform.ListTradePasswordLockRecord
 * （security_restriction_back_office.rajah:229，@Permission "PlatCapCfg.Security.FundCode"）
 *
 * method-category-checklist.md 第 2 節分頁清單查詢：search 內有 identifier（會員帳號，dev 實測後端
 * 用 LIKE 模糊比對，非精準單一鎖定，見 agrabah security_restriction_platform.ts:492-495），
 * 加上時間區間/status/tradeVerifyType 篩選條件，可有效收斂結果，歸類為 A 級（有可鎖定目標的欄位），
 * 不強制要求逐頁掃描到底；回傳含 totalPage，呼叫端需要更完整結果時自行加大 page 翻頁。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { ListTradePasswordLockRecordSearch } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { ACTIVE_TRADE_PASSWORD_LOCK_STATUS_MAP, TRADE_PASSWORD_LOCK_STATUS_MAP, TRADE_VERIFY_TYPE_MAP, describeEnum, toPlainNumber } from '../const.ts';

const searchStatus = z.enum([ 'lock', 'unlock' ]);
const tradeVerifyTypeKeys = Object.keys(TRADE_VERIFY_TYPE_MAP) as [ keyof typeof TRADE_VERIFY_TYPE_MAP, ...(keyof typeof TRADE_VERIFY_TYPE_MAP)[] ];

export function registerListTradePasswordLockRecordTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_security_restriction_platform_list_trade_password_lock_record',
        {
            title: 'List trade password lock records',
            description:
                '查詢本平台「產品系統」→「安全管理」→「資金密碼管理」分頁的交易密碼錯誤鎖定紀錄' +
                '（rajah: SecurityRestrictionPlatform.ListTradePasswordLockRecord，分頁，回傳 rows + totalPage）。' +
                'identifier（會員帳號）是後端 LIKE 模糊比對，不是精準相等；status 篩選只接受 lock（鎖定）/' +
                'unlock（解鎖）兩態（後端故意隱藏 warn/clear）。要解鎖某筆紀錄請改用' +
                'aladdin_platform_security_restriction_platform_unlock_trade_password_lock_record（吃這支回傳的 id）。',
            inputSchema: {
                page: z.number().int().min(1).default(1).describe('頁碼，從 1 開始'),
                pageSize: z.number().int().min(1).max(200).default(20).describe('每頁筆數'),
                startCreatedAtTimestamp: z.number().int().optional().describe('提交時間區間開始（毫秒 timestamp）'),
                endCreatedAtTimestamp: z.number().int().optional().describe('提交時間區間結束（毫秒 timestamp）'),
                identifier: z.string().optional().describe('會員帳號，模糊比對'),
                status: searchStatus.optional().describe('狀態篩選：lock=鎖定、unlock=解鎖'),
                tradeVerifyType: z.enum(tradeVerifyTypeKeys).optional().describe('操作頁面篩選（觸發驗證的操作類型）'),
            },
        },
        async (input) => {
            const search = ListTradePasswordLockRecordSearch.create({
                startCreatedAtTimestamp: input.startCreatedAtTimestamp,
                endCreatedAtTimestamp: input.endCreatedAtTimestamp,
                identifier: input.identifier,
                status: input.status !== undefined ? ACTIVE_TRADE_PASSWORD_LOCK_STATUS_MAP[ input.status ] : undefined,
                tradeVerifyType: input.tradeVerifyType !== undefined ? TRADE_VERIFY_TYPE_MAP[ input.tradeVerifyType ] : undefined,
            });

            const r = await withAutoRelogin(() =>
                remote.securityRestrictionBackOffice.securityRestrictionPlatform.ListTradePasswordLockRecord(input.page, input.pageSize, search),
            );
            if (r.failed) return asErrorResult(r);

            const rows = (r.data?.rows ?? []) as unknown as Record<string, unknown>[];
            return asTextResult({
                success: true,
                totalPage: r.data?.totalPage,
                rows: rows.map((row) => ({
                    ...row,
                    createdAtTimestamp: toPlainNumber(row.createdAtTimestamp),
                    updatedAtTimestamp: toPlainNumber(row.updatedAtTimestamp),
                    tradeVerifyType: describeEnum(TRADE_VERIFY_TYPE_MAP, row.tradeVerifyType as number),
                    status: describeEnum(TRADE_PASSWORD_LOCK_STATUS_MAP, row.status as number),
                })),
            });
        },
    );
}
