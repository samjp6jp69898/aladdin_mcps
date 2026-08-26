/**
 * tools/create_or_update_trade_password_lock_config.ts —
 * aladdin_platform_security_restriction_platform_create_or_update_trade_password_lock_config
 *
 * rajah: SecurityRestrictionPlatform.GetTradePasswordLockConfig + CreateOrUpdateTradePasswordLockConfig
 * （security_restriction_back_office.rajah:233-237，@Permission "PlatCapCfg.Security.FundCode.Config"）
 *
 * 2026-08-26 agent 查證後端實作（agrabah security_restriction_platform.ts:628-668）：更新時走
 * `dbConfig.from(edit)`，屬通用 ORM assignKey 合併（method-category-checklist.md 第 4 節第三種
 * 模式），bool 開關另外還有 `applySwitchesBooleans` 做 bitmask patch 合併——不管哪種模式，
 * 本工具一律先讀現值、把呼叫端未提供的欄位原樣併回完整 payload 再送出，兩種後端模式下都安全。
 * 單例設定，沒有 id 欄位（不同於 RegistrationFieldConfig，這支不需要業務鍵判斷新增/更新）。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { TradePasswordLockConfigEdit } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { ACTIVE_STATUS_MAP, VERIFY_LIMIT_TYPE_MAP } from '../const.ts';
import { formatTradePasswordLockConfig } from './get_trade_password_lock_config.ts';

const statusToggle = z.enum([ 'enabled', 'disabled' ]);
const verifyLimitType = z.enum([ 'every', 'hour', 'day' ]);

export function registerCreateOrUpdateTradePasswordLockConfigTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_security_restriction_platform_create_or_update_trade_password_lock_config',
        {
            title: 'Create or update trade password (fund code) lock config',
            description:
                '修改本平台「產品系統」→「安全管理」→「資金密碼管理」分頁中「交易密碼設置」並儲存' +
                '（rajah: SecurityRestrictionPlatform.CreateOrUpdateTradePasswordLockConfig）。單例設定，無需 id。' +
                '所有欄位皆為 optional：只帶你要改的欄位，其餘會先讀現值原樣帶回，不會被清空或歸零' +
                '（bool 開關若未帶，也會保留現值，不會被誤判成 false）。完成後會自動讀回最新設定一併回傳。' +
                'prod 執行前確認：當這個 server 是正式環境時，執行前必須先用 AskUserQuestion 明確詢問使用者是否同意，' +
                '取得同意後才可以帶上 confirm 參數；非 prod 環境不需要、也會忽略 confirm 欄位。',
            inputSchema: {
                bindFiat: z.boolean().optional().describe('綁定銀行卡是否需要驗證交易密碼'),
                bindCrypto: z.boolean().optional().describe('綁定虛擬貨幣鏈是否需要驗證交易密碼'),
                bindWallet: z.boolean().optional().describe('綁定虛擬錢包是否需要驗證交易密碼'),
                withdraw: z.boolean().optional().describe('餘額提現是否需要驗證交易密碼'),
                goldDeposit: z.boolean().optional().describe('金幣代充是否需要驗證交易密碼'),
                buyRoomTicket: z.boolean().optional().describe('購買房間門票是否需要驗證交易密碼'),
                buyCar: z.boolean().optional().describe('商城購買坐騎是否需要驗證交易密碼'),
                giftGiving: z.boolean().optional().describe('直播送禮/彈幕/守護是否需要驗證交易密碼'),
                donate: z.boolean().optional().describe('大舞台打賞是否需要驗證交易密碼'),
                verifyLimitType: verifyLimitType.optional().describe('驗證週期類型：every=每次、hour=1小時內、day=本日'),
                lockActiveStatus: statusToggle.optional().describe('驗證錯誤達次數後是否鎖定的開關'),
                lockLimit: z.number().int().min(0).optional().describe('幾次驗證錯誤後鎖定'),
                confirm: z.string().optional().describe(
                    `正式環境（prod）專用的強制確認欄位；非 prod 環境會被忽略。當這個 server 是正式環境時，` +
                    `必須先取得使用者明確同意，再帶上精確字串 "${ PROD_CONFIRM_TOKEN }" 才會執行。`,
                ),
            },
        },
        async (input) => {
            assertProdConfirmed(input.confirm);

            const getR = await withAutoRelogin(() => remote.securityRestrictionBackOffice.securityRestrictionPlatform.GetTradePasswordLockConfig());
            if (getR.failed) return asErrorResult(getR);

            const base = getR.data?.edit;
            if (!base) return asTextResult({ success: false, message: '讀取目前設定失敗：後端回傳空值' });

            const overrides: Record<string, unknown> = {};
            for (const key of [ 'bindFiat', 'bindCrypto', 'bindWallet', 'withdraw', 'goldDeposit', 'buyRoomTicket', 'buyCar', 'giftGiving', 'donate' ] as const) {
                if (input[ key ] !== undefined) overrides[ key ] = input[ key ];
            }
            if (input.verifyLimitType !== undefined) overrides.verifyLimitType = VERIFY_LIMIT_TYPE_MAP[ input.verifyLimitType ];
            if (input.lockActiveStatus !== undefined) overrides.lockActiveStatus = ACTIVE_STATUS_MAP[ input.lockActiveStatus ];
            if (input.lockLimit !== undefined) overrides.lockLimit = input.lockLimit;

            const merged = TradePasswordLockConfigEdit.create({ ...base, ...overrides });

            const setR = await withAutoRelogin(() =>
                remote.securityRestrictionBackOffice.securityRestrictionPlatform.CreateOrUpdateTradePasswordLockConfig(merged),
            );
            if (setR.failed) return asErrorResult(setR);

            const checkR = await withAutoRelogin(() => remote.securityRestrictionBackOffice.securityRestrictionPlatform.GetTradePasswordLockConfig());
            const checkConfig = checkR.failed ? undefined : checkR.data?.edit;
            return asTextResult({
                success: true,
                message: '交易密碼設置已更新',
                config: checkConfig ? formatTradePasswordLockConfig(checkConfig as unknown as Record<string, unknown>) : null,
            });
        },
    );
}
