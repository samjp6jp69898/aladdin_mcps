/**
 * tools/create_or_update_registration_field_config.ts —
 * aladdin_platform_security_restriction_platform_create_or_update_registration_field_config
 *
 * rajah: SecurityRestrictionPlatform.CreateOrUpdateRegistrationFieldConfig
 * （security_restriction_back_office.rajah:208，@Permission "PlatCapCfg.Security.RegRule"）
 *
 * method-category-checklist.md 第 4 節：RegistrationFieldConfig 沒有 @Optional 標記，且 2026-08-26
 * agent 查證後端實作（agrabah security_restriction_platform.ts:74-109）確認是「先 load 現有列、
 * 用手寫欄位賦值只覆蓋指定欄位」模式（非整包覆蓋、非通用 assignKey）——即使如此，仍照規則要求
 * 無條件先讀現值再合併，不假設呼叫端會自己拼出正確的完整 payload。
 *
 * 業務鍵是 registrationType（不是 id——id 是 @Hide 的內部欄位，前端與呼叫端都不會、也不應該自己填）：
 * 內部先呼叫 GetRegistrationFieldConfigs 找出符合 registrationType 的既有列，找到就帶其 id 走更新
 * （只覆蓋呼叫端明確帶的欄位），找不到則視為新增（id=0），此時因為 rajah model 每個欄位都標
 * @Rules "Required"，要求呼叫端必須把全部 11 個欄位都帶齊，否則拒絕執行並列出缺少的欄位。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { RegistrationFieldConfig } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { FIELD_REQUIREMENT_MAP, REGISTRATION_TYPE_MAP } from '../const.ts';
import { formatRegistrationFieldConfig } from './get_registration_field_configs.ts';

const fieldRequirement = z.enum([ 'hidden', 'optional', 'required' ]);
const FIELD_KEYS = [
    'address', 'birthday', 'password', 'email', 'qq', 'realName', 'gender', 'wechat', 'inviteCode', 'mobile', 'otpCode',
] as const;

export function registerCreateOrUpdateRegistrationFieldConfigTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_security_restriction_platform_create_or_update_registration_field_config',
        {
            title: 'Create or update registration field display config',
            description:
                '新增或修改本平台「產品系統」→「安全管理」→「註冊規則」分頁中，指定 registrationType' +
                '（user=會員註冊、agent=代理註冊）下各註冊欄位的顯示要求（hidden=隱藏/optional=選填/required=必填）' +
                '（rajah: SecurityRestrictionPlatform.CreateOrUpdateRegistrationFieldConfig）。' +
                '以 registrationType 為業務鍵：內部會先查詢是否已有該 registrationType 的既有設定，' +
                '有的話走更新（只覆蓋你明確帶的欄位，其餘保留現值），沒有的話走新增' +
                '（此時 rajah 定義每個欄位皆為必填，必須把全部 11 個欄位都帶齊，否則拒絕執行）。' +
                '完成後會自動讀回最新設定一併回傳。' +
                'prod 執行前確認：當這個 server 是正式環境時，執行前必須先用 AskUserQuestion 明確詢問使用者是否同意，' +
                '取得同意後才可以帶上 confirm 參數；非 prod 環境不需要、也會忽略 confirm 欄位。',
            inputSchema: {
                registrationType: z.enum([ 'user', 'agent' ]).describe('業務鍵：user=會員註冊、agent=代理註冊'),
                address: fieldRequirement.optional().describe('地址欄位顯示要求'),
                birthday: fieldRequirement.optional().describe('生日欄位顯示要求'),
                password: fieldRequirement.optional().describe('密碼欄位顯示要求'),
                email: fieldRequirement.optional().describe('郵箱欄位顯示要求'),
                qq: fieldRequirement.optional().describe('QQ 欄位顯示要求'),
                realName: fieldRequirement.optional().describe('真實姓名欄位顯示要求'),
                gender: fieldRequirement.optional().describe('性別欄位顯示要求'),
                wechat: fieldRequirement.optional().describe('WeChat 欄位顯示要求'),
                inviteCode: fieldRequirement.optional().describe('邀請碼欄位顯示要求'),
                mobile: fieldRequirement.optional().describe('手機號欄位顯示要求'),
                otpCode: fieldRequirement.optional().describe('OTP 欄位顯示要求'),
                confirm: z.string().optional().describe(
                    `正式環境（prod）專用的強制確認欄位；非 prod 環境會被忽略。當這個 server 是正式環境時，` +
                    `必須先取得使用者明確同意，再帶上精確字串 "${ PROD_CONFIRM_TOKEN }" 才會執行。`,
                ),
            },
        },
        async (input) => {
            assertProdConfirmed(input.confirm);

            const listR = await withAutoRelogin(() => remote.securityRestrictionBackOffice.securityRestrictionPlatform.GetRegistrationFieldConfigs());
            if (listR.failed) return asErrorResult(listR);

            const targetTypeValue = REGISTRATION_TYPE_MAP[ input.registrationType ];
            const rows = (listR.data?.rows ?? []) as unknown as Record<string, unknown>[];
            const existing = rows.find((row) => row.registrationType === targetTypeValue);

            const overrides: Record<string, unknown> = {};
            for (const key of FIELD_KEYS) {
                const value = input[ key ];
                if (value !== undefined) overrides[ key ] = FIELD_REQUIREMENT_MAP[ value ];
            }

            let payload: Record<string, unknown>;
            if (existing) {
                payload = { ...existing, ...overrides, registrationType: targetTypeValue };
            } else {
                const missing = FIELD_KEYS.filter((key) => input[ key ] === undefined);
                if (missing.length > 0) {
                    return asTextResult({
                        success: false,
                        message: `registrationType=${ input.registrationType } 目前沒有既有設定，新增時必須帶齊全部欄位，缺少：${ missing.join(', ') }`,
                    });
                }
                payload = { id: 0, registrationType: targetTypeValue, ...overrides };
            }

            const setR = await withAutoRelogin(() =>
                remote.securityRestrictionBackOffice.securityRestrictionPlatform.CreateOrUpdateRegistrationFieldConfig(
                    RegistrationFieldConfig.create(payload),
                ),
            );
            if (setR.failed) return asErrorResult(setR);

            const checkR = await withAutoRelogin(() => remote.securityRestrictionBackOffice.securityRestrictionPlatform.GetRegistrationFieldConfigs());
            const checkRows = (checkR.failed ? [] : checkR.data?.rows ?? []) as unknown as Record<string, unknown>[];
            const checkRow = checkRows.find((row) => row.registrationType === targetTypeValue);

            return asTextResult({
                success: true,
                message: existing ? '註冊欄位設定已更新' : '註冊欄位設定已新增',
                config: checkRow ? formatRegistrationFieldConfig(checkRow) : null,
            });
        },
    );
}
