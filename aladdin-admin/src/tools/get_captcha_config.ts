/**
 * tools/get_captcha_config.ts — aladdin_admin_admin_captcha_config_get_captcha_config
 *
 * rajah: AdminCaptchaConfig.GetCaptchaConfig(captchaType) (adminStatus, captchaConfig)
 * （verification_code.rajah:43，service 定義於 verification_code.rajah:29，
 * @Permission "AdminCaptchaConfig" 掛在 service 標頭，本 method 未自帶 @Permission，
 * 依 rajah/CLAUDE.md「service 級 @Permission 綁定規則」，這支會承接該節點）。
 *
 * 對應前端頁面：產品系統 → 驗證碼管理 → 驗證碼設置（VerificationSettings.vue）。
 *
 * 系統層級設定，每個「有 adapter 的」captchaType 在 `captcha_config` 表各自一列，彼此獨立，
 * 跟平台無關（不吃、也不需要 platformId）——不要跟同 domain 的 aladdin_admin_admin_captcha_config_
 * get_platform_verification_configs（平台各自的驗證碼「啟用類型清單」設定）搞混，那是另一張表。
 *
 * **`captchaType` 刻意不開放 `off`**（2026-08-25 讀源碼確認，非猜測）：CaptchaTypeEnum
 * （verification_code_common.rajah:7-12）雖然定義了 `off=0`，但 agrabah 只註冊了
 * numeral/arithmetic/geetest 三種 adapter（agrabah/src/servers/verification_code/adapters/
 * index.ts），`getAdapter(off)` 一定回傳 undefined，`GetCaptchaConfig(off)`/`SetCaptchaConfig(off, ...)`
 * 一定回 `verificationTypeNotSupported` 業務錯誤，不是「off 沒有 config 內容但呼叫成功」——這點
 * 跟 arithmetic 不一樣（arithmetic 呼叫會成功、只是沒有 config 內容）。前端編輯表單用的
 * `AdminCaptchaConfigEditCaptchaTypeEnum`（verification_code_common.rajah:16-20）也刻意排除
 * `off`，這裡跟前端一致，只開放 numeral/arithmetic/geetest 三個可查詢值。
 *
 * `captchaConfig` 是 @Union model（verification_code_common.rajah:64-68），只有
 * captchaType=geetest（回傳 geetest 子物件）或 captchaType=numeral（回傳 numeral 子物件）
 * 才有內容；arithmetic 沒有對應的設定資料，`captchaConfig` 為空物件（兩個 variant 都不存在），
 * 這不是錯誤，呼叫仍會成功。
 *
 * 敏感資料處理（第 8 節）：geetest 子物件裡的 `geetestKey` 是極驗後台的 API 私鑰，
 * 預設遮罩（只顯示尾 4 碼）；`geetestHost`/`geetestId` 不遮罩——`geetestId`（極驗的
 * public id）本質上是嵌在前台頁面 JS 裡的公開值（比照 Google reCAPTCHA 的 site key 概念，
 * 不是伺服器端才能持有的密鑰），跟 geetestKey 性質不同，遮罩它反而讓 agent 誤判成敏感值。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { CAPTCHA_TYPE_MAP, STATUS_MAP } from '../const.ts';

// 排除 off——見檔頭註解，off 沒有對應 adapter，呼叫必定回 verificationTypeNotSupported。
const QUERYABLE_CAPTCHA_TYPE_KEYS = [ 'numeral', 'arithmetic', 'geetest' ] as const satisfies readonly (keyof typeof CAPTCHA_TYPE_MAP)[];
const REVERSE_STATUS_MAP = Object.fromEntries(Object.entries(STATUS_MAP).map(([ k, v ]) => [ v, k ])) as Record<number, string>;

function maskSecret(value: string | undefined | null): string {
    if (!value) return '(未設定)';
    if (value.length <= 4) return '***';
    return `***${ value.slice(-4) }`;
}

/**
 * 把後端回傳的 captchaConfig 原始物件轉成對呼叫端友善的形狀：geetestKey 遮罩、
 * adminStatus 轉成可讀字串。update_captcha_config.ts 的回傳也共用這支，確保「讀到的」
 * 與「改完讀回的」格式一致。
 */
export function formatCaptchaConfigResult(
    adminStatus: number | undefined,
    captchaConfig: Record<string, unknown> | undefined | null,
    revealSecrets: boolean,
): Record<string, unknown> {
    const geetest = captchaConfig?.geetest as Record<string, unknown> | undefined;
    return {
        adminStatus: adminStatus !== undefined ? (REVERSE_STATUS_MAP[ adminStatus ] ?? adminStatus) : undefined,
        captchaConfig: {
            geetest: geetest ? { ...geetest, geetestKey: revealSecrets ? geetest.geetestKey : maskSecret(geetest.geetestKey as string) } : undefined,
            numeral: (captchaConfig?.numeral as Record<string, unknown> | undefined) ?? undefined,
        },
        secretsRevealed: !!revealSecrets,
    };
}

export function registerGetCaptchaConfigTool(server: McpServer): void {
    server.registerTool(
        'aladdin_admin_admin_captcha_config_get_captcha_config',
        {
            title: 'Get system-wide captcha config for one captcha type',
            description:
                '讀取系統層級「產品系統 → 驗證碼管理 → 驗證碼設置」某一個驗證碼類型的目前設定' +
                '（rajah: AdminCaptchaConfig.GetCaptchaConfig）——每個 captchaType 在後端各自一列，' +
                '彼此獨立，跟平台無關。要修改請改用 aladdin_admin_admin_captcha_config_' +
                'set_captcha_config——那支工具會先呼叫這支讀現值再合併覆蓋。' +
                'captchaType 不接受 off——off 沒有對應的後端 adapter，呼叫必定回業務錯誤' +
                '（verificationTypeNotSupported），不是「off 沒有 config 但查詢成功」，見檔頭註解。' +
                'arithmetic 類型沒有對應的設定資料（captchaConfig.geetest/numeral 都會是 undefined），' +
                '這是正常現象，不是查詢失敗。' +
                'geetestKey 是極驗 API 私鑰，預設遮罩顯示尾 4 碼，帶 revealSecrets=true 才回明文，' +
                '取得明文後不要寫入任何持久化 log；geetestHost/geetestId 是公開值，不遮罩。' +
                '這是純讀取查詢，不會修改任何資料，可安全重複呼叫。',
            inputSchema: {
                captchaType: z.enum(QUERYABLE_CAPTCHA_TYPE_KEYS).describe('要查詢的驗證碼類型：numeral=數字驗證碼/arithmetic=算術驗證碼/geetest=極驗（不接受 off，見說明）'),
                revealSecrets: z.boolean().optional().describe('預設 false（遮罩 geetestKey，只顯示尾 4 碼或"(未設定)"）。帶 true 才會回傳完整明文。'),
            },
        },
        async ({ captchaType, revealSecrets }) => {
            const r = await withAutoRelogin(() => remote.verificationCode.adminCaptchaConfig.GetCaptchaConfig(CAPTCHA_TYPE_MAP[ captchaType ]));
            if (r.failed) return asErrorResult(r);

            return asTextResult({
                success: true,
                ...formatCaptchaConfigResult(r.data?.adminStatus, r.data?.captchaConfig as unknown as Record<string, unknown>, !!revealSecrets),
            });
        },
    );
}
