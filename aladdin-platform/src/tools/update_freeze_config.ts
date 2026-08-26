/**
 * tools/update_freeze_config.ts — aladdin_platform_security_restriction_platform_update_freeze_config
 *
 * rajah: SecurityRestrictionPlatform.GetFreezeConfig + UpdateFreezeConfig
 * （security_restriction_back_office.rajah:239-243，@Permission "PlatCapCfg.Security.FreezeManagement"）
 *
 * FreezeConfig/FreezeRuleConfig 沒有 @Optional 標記，先呼叫 GetFreezeConfig 取現值，passwordError/
 * cancelOrder 兩組規則各自獨立合併（只帶其中一組也可以，未帶的那組原樣保留；帶了的那組內部欄位
 * 同樣只覆蓋明確提供的欄位），完成後 round-trip 再讀一次驗證。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { FreezeConfig, LocalizationString } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { ACTIVE_STATUS_MAP, FREEZE_DURATION_UNIT_MAP } from '../const.ts';
import { formatFreezeRuleConfig } from './get_freeze_config.ts';

const statusToggle = z.enum([ 'enabled', 'disabled' ]);
const durationUnit = z.enum([ 'minutes', 'hours', 'days' ]);
const localizationSchema = z.object({ code: z.string(), value: z.string() });

const freezeRuleSchema = z.object({
    enabled: statusToggle.optional().describe('此凍結規則開關'),
    triggerLimit: z.number().int().min(1).optional().describe('錯誤累計達此次數觸發凍結'),
    autoUnfreeze: statusToggle.optional().describe('凍結時長到期後是否自動解凍'),
    freezeDuration: z.number().int().min(1).optional().describe('凍結時長數值（配合 freezeDurationUnit）'),
    freezeDurationUnit: durationUnit.optional().describe('凍結時長單位：minutes/hours/days'),
    userMessage: z.array(localizationSchema).optional().describe('觸發凍結時顯示給使用者的多語提示文字（覆蓋整個陣列）'),
}).optional();

function mergeRule(base: Record<string, unknown> | undefined, input: z.infer<typeof freezeRuleSchema>): Record<string, unknown> | undefined {
    if (!base) return undefined;
    if (!input) return base;
    const overrides: Record<string, unknown> = {};
    if (input.enabled !== undefined) overrides.enabled = ACTIVE_STATUS_MAP[ input.enabled ];
    if (input.triggerLimit !== undefined) overrides.triggerLimit = input.triggerLimit;
    if (input.autoUnfreeze !== undefined) overrides.autoUnfreeze = ACTIVE_STATUS_MAP[ input.autoUnfreeze ];
    if (input.freezeDuration !== undefined) overrides.freezeDuration = input.freezeDuration;
    if (input.freezeDurationUnit !== undefined) overrides.freezeDurationUnit = FREEZE_DURATION_UNIT_MAP[ input.freezeDurationUnit ];
    if (input.userMessage !== undefined) overrides.userMessage = input.userMessage.map((m) => LocalizationString.create(m));
    return { ...base, ...overrides };
}

export function registerUpdateFreezeConfigTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_security_restriction_platform_update_freeze_config',
        {
            title: 'Update account freeze management config',
            description:
                '修改本平台「產品系統」→「安全管理」→「凍結管理」分頁的設定並儲存' +
                '（rajah: SecurityRestrictionPlatform.UpdateFreezeConfig）。單例設定，' +
                'passwordError（登錄密碼錯誤凍結規則）與 cancelOrder（取消充值訂單凍結規則）兩組規則各自獨立、' +
                '皆為 optional：只帶你要改的那一組即可，未帶的那組原樣保留；帶了的那組內部欄位同樣只覆蓋' +
                '你明確提供的欄位，其餘保留現值。userMessage 若要修改必須帶完整陣列（覆蓋整個陣列，不是逐筆合併）。' +
                '完成後會自動讀回最新設定一併回傳。' +
                'prod 執行前確認：當這個 server 是正式環境時，執行前必須先用 AskUserQuestion 明確詢問使用者是否同意，' +
                '取得同意後才可以帶上 confirm 參數；非 prod 環境不需要、也會忽略 confirm 欄位。',
            inputSchema: {
                passwordError: freezeRuleSchema.describe('登錄密碼錯誤凍結規則，只帶要改的欄位'),
                cancelOrder: freezeRuleSchema.describe('取消充值訂單凍結規則，只帶要改的欄位'),
                confirm: z.string().optional().describe(
                    `正式環境（prod）專用的強制確認欄位；非 prod 環境會被忽略。當這個 server 是正式環境時，` +
                    `必須先取得使用者明確同意，再帶上精確字串 "${ PROD_CONFIRM_TOKEN }" 才會執行。`,
                ),
            },
        },
        async (input) => {
            assertProdConfirmed(input.confirm);

            const getR = await withAutoRelogin(() => remote.securityRestrictionBackOffice.securityRestrictionPlatform.GetFreezeConfig());
            if (getR.failed) return asErrorResult(getR);

            const base = getR.data?.config;
            if (!base) return asTextResult({ success: false, message: '讀取目前設定失敗：後端回傳空值' });

            const merged = FreezeConfig.create({
                passwordError: mergeRule(base.passwordError as unknown as Record<string, unknown>, input.passwordError),
                cancelOrder: mergeRule(base.cancelOrder as unknown as Record<string, unknown>, input.cancelOrder),
            });

            const setR = await withAutoRelogin(() => remote.securityRestrictionBackOffice.securityRestrictionPlatform.UpdateFreezeConfig(merged));
            if (setR.failed) return asErrorResult(setR);

            const checkR = await withAutoRelogin(() => remote.securityRestrictionBackOffice.securityRestrictionPlatform.GetFreezeConfig());
            const checkConfig = checkR.failed ? undefined : checkR.data?.config;
            return asTextResult({
                success: true,
                message: '凍結管理設定已更新',
                config: checkConfig ? {
                    passwordError: checkConfig.passwordError ? formatFreezeRuleConfig(checkConfig.passwordError as unknown as Record<string, unknown>) : null,
                    cancelOrder: checkConfig.cancelOrder ? formatFreezeRuleConfig(checkConfig.cancelOrder as unknown as Record<string, unknown>) : null,
                } : null,
            });
        },
    );
}
