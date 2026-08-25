/**
 * tools/update_platform_verification_captcha_type.ts — aladdin_platform_platform_captcha_config_set_platform_verification_captcha_type
 *
 * rajah: PlatformCaptchaConfig.SetPlatformVerificationCaptchaType(captchaType)
 * （verification_code.rajah:58，@Permission "PlatCapCfg.PsConfig.VerifyStyle.Save"）。
 *
 * 對應前端頁面：產品系統 → 產品配置 → 驗證方式（切換目前使用的驗證碼類型）。
 *
 * 跟 aladdin-admin 那支 set_platform_verification_config 不一樣：這支後端自己有做局部合併
 * 保護（2026-08-25 讀源碼確認 agrabah/src/servers/verification_code/cache_manager.ts 的
 * `setCaptchaType`）——會先讀現有的 `availableCaptchaTypes` 原樣帶回，只換
 * `platformCurrentCaptchaType`，所以本工具不需要、也不應該自己先讀現值再組 payload，直接
 * 傳呼叫端指定的 captchaType 即可，這是刻意的單參數直接呼叫（同
 * method-category-checklist.md 第 6 節「Toggle 類，帶明確目標狀態」）。
 *
 * captchaType 必須屬於本平台的 availableCaptchaTypes 清單（用
 * aladdin_platform_platform_captcha_config_get_platform_verification_config
 * 查詢），後端會驗證，不屬於清單內會回業務錯誤，不是本工具攔的。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { CAPTCHA_TYPE_MAP } from '../const.ts';

const CAPTCHA_TYPE_KEYS = Object.keys(CAPTCHA_TYPE_MAP) as [ keyof typeof CAPTCHA_TYPE_MAP, ...(keyof typeof CAPTCHA_TYPE_MAP)[] ];
const REVERSE_CAPTCHA_TYPE_MAP = Object.fromEntries(Object.entries(CAPTCHA_TYPE_MAP).map(([ k, v ]) => [ v, k ])) as Record<number, string>;

export function registerUpdatePlatformVerificationCaptchaTypeTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_platform_captcha_config_set_platform_verification_captcha_type',
        {
            title: 'Switch this platform\'s current captcha type',
            description:
                '把本平台目前使用的驗證碼類型切換成指定值（rajah: ' +
                'PlatformCaptchaConfig.SetPlatformVerificationCaptchaType）。captchaType 必須屬於本平台的' +
                ' availableCaptchaTypes 清單內（用 aladdin_platform_platform_captcha_config_' +
                'get_platform_verification_config 先查），不屬於清單內會回業務錯誤。' +
                '後端自己會保留既有的 availableCaptchaTypes 清單不受影響，只改當前選用類型' +
                '（不像 aladdin-admin 那支 set_platform_verification_config 需要工具層自己防呆，見檔頭註解）。' +
                '完成後會自動讀回最新設定一併回傳，方便核對是否真的改成功。' +
                'prod 執行前確認（H38 同構機制）：當這個 server 是正式環境（prod）時，執行本工具前必須先用 ' +
                'AskUserQuestion（或功能相同的方式）明確詢問使用者是否要在正式環境執行這個操作，取得明確同意' +
                '後才可以帶上 confirm 參數；絕不能自行假設使用者同意。非 prod 環境不需要、也會忽略 confirm 欄位。',
            inputSchema: {
                captchaType: z.enum(CAPTCHA_TYPE_KEYS).describe('要切換成的驗證碼類型：off=關閉/numeral=數字驗證碼/arithmetic=算術驗證碼/geetest=極驗'),
                confirm: z.string().optional().describe(
                    `正式環境（prod）專用的強制確認欄位；非 prod 環境會被忽略、不需提供。當這個 server 是正式環境時，` +
                    `必須先取得使用者明確同意，再帶上精確字串 "${ PROD_CONFIRM_TOKEN }" 才會執行，否則本工具會拒絕執行並回錯誤。`,
                ),
            },
        },
        async ({ captchaType, confirm }) => {
            assertProdConfirmed(confirm);

            const setR = await withAutoRelogin(() => remote.verificationCode.platformCaptchaConfig.SetPlatformVerificationCaptchaType(CAPTCHA_TYPE_MAP[ captchaType ]));
            if (setR.failed) return asErrorResult(setR);

            const checkR = await withAutoRelogin(() => remote.verificationCode.platformCaptchaConfig.GetPlatformVerificationConfig());
            const config = checkR.failed ? undefined : checkR.data?.config;
            return asTextResult({
                success: true,
                message: '本平台驗證碼類型已更新',
                config: config ? {
                    ...config,
                    platformCurrentCaptchaType: REVERSE_CAPTCHA_TYPE_MAP[ config.platformCurrentCaptchaType as number ] ?? config.platformCurrentCaptchaType,
                    availableCaptchaTypes: (config.availableCaptchaTypes ?? []).map((t) => REVERSE_CAPTCHA_TYPE_MAP[ t as number ] ?? t),
                } : null,
            });
        },
    );
}
