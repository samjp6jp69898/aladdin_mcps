/**
 * tools/get_platform_verification_config.ts — aladdin_platform_platform_captcha_config_get_platform_verification_config
 *
 * rajah: PlatformCaptchaConfig.GetPlatformVerificationConfig()（chat_back_office.rajah 無關，見
 * verification_code.rajah:62，@Permission "PlatCapCfg.PsConfig.VerifyStyle"）。
 *
 * 對應前端頁面：產品系統 → 產品配置 → 驗證方式（本平台自查用）。
 *
 * 沒有任何參數——platformId 由連線本身的登入態隱式帶入（agrabah `context.platformId`，同
 * chat_back_office 的 ChatSpeechSettingPlatform 模式）。2026-08-25 讀源碼確認
 * （agrabah/src/servers/verification_code/services/platform_captcha_config.ts）：查無資料列
 * 時不報錯，回傳預設值 `availableCaptchaTypes: []`、`platformCurrentCaptchaType: off`，代表這個
 * 平台尚未被 admin 端設定過任何可用驗證碼類型。
 *
 * `availableCaptchaTypes` 只能透過 aladdin-admin 的
 * aladdin_admin_admin_captcha_config_set_platform_verification_config 修改，
 * 本平台自己只能在既有清單內用
 * aladdin_platform_platform_captcha_config_set_platform_verification_captcha_type
 * 切換 `platformCurrentCaptchaType`。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { CAPTCHA_TYPE_MAP } from '../const.ts';

const REVERSE_CAPTCHA_TYPE_MAP = Object.fromEntries(Object.entries(CAPTCHA_TYPE_MAP).map(([ k, v ]) => [ v, k ])) as Record<number, string>;

export function registerGetPlatformVerificationConfigTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_platform_captcha_config_get_platform_verification_config',
        {
            title: 'Get this platform\'s verification captcha config',
            description:
                '讀取本平台「產品系統 → 產品配置 → 驗證方式」目前的設定（rajah: ' +
                'PlatformCaptchaConfig.GetPlatformVerificationConfig，無參數，平台由連線本身判定）。' +
                '查無資料時回傳預設值 availableCaptchaTypes=[]、platformCurrentCaptchaType=off' +
                '（代表本平台尚未被系統管理員設定過），不是錯誤。' +
                '要修改目前選用的類型（僅限於 availableCaptchaTypes 清單內），改用 ' +
                'aladdin_platform_platform_captcha_config_set_platform_verification_captcha_type；' +
                '要修改 availableCaptchaTypes 清單本身，需要系統管理員在 aladdin-admin 端操作，本平台端沒有這個能力。' +
                '這是純讀取查詢，不會修改任何資料，可安全重複呼叫。',
            inputSchema: {},
        },
        async () => {
            const r = await withAutoRelogin(() => remote.verificationCode.platformCaptchaConfig.GetPlatformVerificationConfig());
            if (r.failed) return asErrorResult(r);

            const config = r.data?.config;
            if (!config) return asTextResult({ success: true, config: null });

            return asTextResult({
                success: true,
                config: {
                    ...config,
                    platformCurrentCaptchaType: REVERSE_CAPTCHA_TYPE_MAP[ config.platformCurrentCaptchaType as number ] ?? config.platformCurrentCaptchaType,
                    availableCaptchaTypes: (config.availableCaptchaTypes ?? []).map((t) => REVERSE_CAPTCHA_TYPE_MAP[ t as number ] ?? t),
                },
            });
        },
    );
}
