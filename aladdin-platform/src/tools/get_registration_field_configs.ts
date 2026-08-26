/**
 * tools/get_registration_field_configs.ts — aladdin_platform_security_restriction_platform_get_registration_field_configs
 *
 * rajah: SecurityRestrictionPlatform.GetRegistrationFieldConfigs
 * （security_restriction_back_office.rajah:205，@Permission "PlatCapCfg.Security"）
 *
 * 對應前端頁面：「產品系統」→「安全管理」→「註冊規則」分頁的欄位顯示設定表格。
 * 無參數，直接整包回傳全部列，不分頁（method-category-checklist.md 第 2 節「完全不分頁的全撈」，
 * 這是小型列舉表，dev 實測只有 3 筆，安全）。
 *
 * 2026-08-26 dev 實測發現：除了 RegistrationTypeEnum 定義的 user(1)/agent(2) 兩筆，資料庫還
 * 存在一筆 registrationType=0 的既有列（不在列舉定義內，疑似歷史遺留設定）。describeEnum()
 * 對照不到時原樣回傳數字，不視為錯誤或過濾掉。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { FIELD_REQUIREMENT_MAP, REGISTRATION_TYPE_MAP, describeEnum, toPlainNumber } from '../const.ts';

const FIELD_KEYS = [
    'address', 'birthday', 'password', 'email', 'qq', 'realName', 'gender', 'wechat', 'inviteCode', 'mobile', 'otpCode',
] as const;

/** 供 create_or_update_registration_field_config.ts 共用：把後端 row 轉成呼叫端友善的形狀。 */
export function formatRegistrationFieldConfig(row: Record<string, unknown>): Record<string, unknown> {
    const formatted: Record<string, unknown> = {
        id: toPlainNumber(row.id),
        registrationType: describeEnum(REGISTRATION_TYPE_MAP, row.registrationType as number),
    };
    for (const key of FIELD_KEYS) formatted[ key ] = describeEnum(FIELD_REQUIREMENT_MAP, row[ key ] as number);
    return formatted;
}

export function registerGetRegistrationFieldConfigsTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_security_restriction_platform_get_registration_field_configs',
        {
            title: 'Get registration field display configs',
            description:
                '讀取本平台「產品系統」→「安全管理」→「註冊規則」分頁目前的欄位顯示設定清單' +
                '（rajah: SecurityRestrictionPlatform.GetRegistrationFieldConfigs，無參數，不分頁，' +
                '目前資料量小，全部一次回傳）。每筆代表一個 registrationType（user=會員註冊、agent=代理註冊）' +
                '下，各註冊欄位（address/birthday/password/email/qq/realName/gender/wechat/inviteCode/mobile/otpCode）' +
                '的顯示要求：hidden=隱藏、optional=選填、required=必填。' +
                '要修改請改用 aladdin_platform_security_restriction_platform_create_or_update_registration_field_config' +
                '（以 registrationType 為業務鍵，內部會自動呼叫這支讀現值再合併覆蓋）。' +
                '回傳裡若出現 registrationType 為原始數字（非 user/agent 字串），代表資料庫存在不在列舉定義內的既有列' +
                '（dev 實測發現過 0），僅供參考、不代表工具異常。',
            inputSchema: {},
        },
        async () => {
            const r = await withAutoRelogin(() => remote.securityRestrictionBackOffice.securityRestrictionPlatform.GetRegistrationFieldConfigs());
            if (r.failed) return asErrorResult(r);

            const rows = r.data?.rows ?? [];
            return asTextResult({ success: true, rows: rows.map((row) => formatRegistrationFieldConfig(row as unknown as Record<string, unknown>)) });
        },
    );
}
