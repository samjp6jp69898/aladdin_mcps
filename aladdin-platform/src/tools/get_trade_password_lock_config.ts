/**
 * tools/get_trade_password_lock_config.ts — aladdin_platform_security_restriction_platform_get_trade_password_lock_config
 *
 * rajah: SecurityRestrictionPlatform.GetTradePasswordLockConfig
 * （security_restriction_back_office.rajah:234，@Permission "PlatCapCfg.Security.FundCode.Config"）
 *
 * 對應前端頁面：「產品系統」→「安全管理」→「資金密碼管理」分頁的「交易密碼設置」區塊。
 * 無參數，單例設定：哪些金流/直播/大舞台操作需要驗證交易密碼（bindFiat 等 bool 開關），
 * 以及驗證失敗達門檻後的鎖定規則（verifyLimitType/lockActiveStatus/lockLimit）。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { ACTIVE_STATUS_MAP, VERIFY_LIMIT_TYPE_MAP, describeEnum } from '../const.ts';

/** 供 create_or_update_trade_password_lock_config.ts 共用。 */
export function formatTradePasswordLockConfig(c: Record<string, unknown>): Record<string, unknown> {
    return {
        ...c,
        verifyLimitType: describeEnum(VERIFY_LIMIT_TYPE_MAP, c.verifyLimitType as number),
        lockActiveStatus: describeEnum(ACTIVE_STATUS_MAP, c.lockActiveStatus as number),
    };
}

export function registerGetTradePasswordLockConfigTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_security_restriction_platform_get_trade_password_lock_config',
        {
            title: 'Get trade password (fund code) lock config',
            description:
                '讀取本平台「產品系統」→「安全管理」→「資金密碼管理」分頁中「交易密碼設置」的目前設定' +
                '（rajah: SecurityRestrictionPlatform.GetTradePasswordLockConfig，無參數，單例設定）。' +
                'bindFiat/bindCrypto/bindWallet/withdraw/goldDeposit/buyRoomTicket/buyCar/giftGiving/donate' +
                '是各操作是否需要驗證交易密碼的開關；verifyLimitType 是驗證週期（every=每次、hour=1小時內、day=本日）、' +
                'lockActiveStatus 是驗證錯誤達 lockLimit 次數後是否鎖定的開關。' +
                '要修改請改用 aladdin_platform_security_restriction_platform_create_or_update_trade_password_lock_config' +
                '（內部會先呼叫這支讀現值再合併覆蓋）。',
            inputSchema: {},
        },
        async () => {
            const r = await withAutoRelogin(() => remote.securityRestrictionBackOffice.securityRestrictionPlatform.GetTradePasswordLockConfig());
            if (r.failed) return asErrorResult(r);

            const edit = r.data?.edit;
            if (!edit) return asTextResult({ success: true, config: null });
            return asTextResult({ success: true, config: formatTradePasswordLockConfig(edit as unknown as Record<string, unknown>) });
        },
    );
}
