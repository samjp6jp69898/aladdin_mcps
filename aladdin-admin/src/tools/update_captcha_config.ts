/**
 * tools/update_captcha_config.ts — aladdin_admin_admin_captcha_config_set_captcha_config
 *
 * rajah: AdminCaptchaConfig.GetCaptchaConfig + SetCaptchaConfig（verification_code.rajah:39-43，
 * @Permission "AdminCaptchaConfig.Verification.Vs.Edit"）。
 *
 * 對應前端頁面：產品系統 → 驗證碼管理 → 驗證碼設置（VerificationSettings.vue 的儲存按鈕）。
 *
 * SetCaptchaConfig 對「該 captchaType 那一列」是整包覆蓋、完全沒有 pre-load（2026-08-25 讀
 * 源碼確認 agrabah/src/servers/verification_code/cache_manager.ts 的 setConfig：直接把呼叫端
 * 傳入的 captchaConfig/adminStatus 整包 insert/update 那一列，只有 id 是內部帶入），
 * 屬 method-category-checklist.md 第 4 節「模式 3」，所以這裡照該檢查清單要求：先呼叫
 * GetCaptchaConfig 讀現值，只覆蓋呼叫端明確帶的欄位（geetest 的 host/id/key 各自可獨立覆蓋，
 * 不帶的沿用現值），完成後 round-trip 讀回驗證。
 *
 * **重要副作用（2026-08-25 讀源碼確認，非猜測）**：只要這次呼叫結果讓 adminStatus 變成非
 * enabled（例如把 geetest 停用），後端 `turnOffCaptchaType`（cache_manager.ts:100-124）會
 * 立即批次把「目前所有選用這個 captchaType 的平台」的 platform_config.captcha_type 改成
 * numeral（若停用的正是 numeral 本身，改成 off；若 numeral 本身也是 disabled 狀態，同樣退回
 * off），這是**跨平台的級聯寫入**，會在管理員不知情的情況下改動其他平台的驗證碼類型設定，
 * 且沒有自動復原機制——之後把這個 captchaType 重新設回 enabled，並不會把先前被級聯改掉的
 * 平台自動改回來，需要另外用 aladdin_admin_admin_captcha_config_
 * set_platform_verification_config 逐一改回。每次呼叫只要最終 adminStatus≠enabled 就會重跑
 * 這段級聯（即使呼叫前就已經是 disabled 狀態），不是只在「從 enabled 變成 disabled」那一次
 * 才觸發。
 *
 * **`captchaType` 不接受 `off`**（見同目錄 get_captcha_config.ts 檔頭註解）：off 沒有對應的
 * 後端 adapter，`SetCaptchaConfig(off, ...)` 必定回 `verificationTypeNotSupported` 業務錯誤，
 * 不是「off 沒有 config 但呼叫成功」。arithmetic 類型沒有可設定的 config 內容，只需要帶
 * adminStatus。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { VerificationCaptchaConfig } from '/Users/user/aladdin/abu/admin/src/generated/types.gen.js';
import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { CAPTCHA_TYPE_MAP, STATUS_MAP } from '../const.ts';
import { formatCaptchaConfigResult } from './get_captcha_config.ts';

// 排除 off——見檔頭註解，off 沒有對應 adapter，呼叫必定回 verificationTypeNotSupported。
const QUERYABLE_CAPTCHA_TYPE_KEYS = [ 'numeral', 'arithmetic', 'geetest' ] as const satisfies readonly (keyof typeof CAPTCHA_TYPE_MAP)[];
const ADMIN_STATUS_KEYS = [ 'enabled', 'disabled' ] as const;

export function registerUpdateCaptchaConfigTool(server: McpServer): void {
    server.registerTool(
        'aladdin_admin_admin_captcha_config_set_captcha_config',
        {
            title: 'Update system-wide captcha config for one captcha type',
            description:
                '修改系統層級「產品系統 → 驗證碼管理 → 驗證碼設置」某一個驗證碼類型的設定並儲存' +
                '（rajah: AdminCaptchaConfig.SetCaptchaConfig）。所有欄位皆為 optional：只帶你要改的' +
                '欄位，其餘（含 geetest 的 host/id/key 個別欄位）會先讀現值原樣帶回，不會被清空——' +
                '後端這支 method 對整個 captchaType 那一列是整包覆蓋、沒有局部合併保護，見檔頭註解。' +
                'captchaType 不接受 off——off 沒有對應的後端 adapter，呼叫必定回業務錯誤，見檔頭註解。' +
                'arithmetic 類型沒有可設定的 config 內容，只需要帶 adminStatus。' +
                '完成後會自動讀回最新設定一併回傳（geetestKey 遮罩），方便核對是否真的改成功。' +
                '\n\n**高風險副作用，執行前務必先讀完整段**：把某個 captchaType 的 adminStatus 設成非 ' +
                'enabled（停用），後端會立即批次把「目前選用這個類型」的所有平台級聯改成 numeral' +
                '（停用的是 numeral 本身則改成 off），這會在其他平台管理員不知情下悄悄改變他們的驗證碼' +
                '類型，且沒有自動復原——重新啟用該類型並不會把這些平台改回來。除非操作者明確要求停用某個' +
                '全域驗證碼類型，否則不要在改 geetest 參數等其他欄位時意外帶錯 adminStatus 把它改成 disabled。' +
                'prod 執行前確認（H38 同構機制）：當這個 server 是正式環境（prod）時，執行本工具前必須先用 ' +
                'AskUserQuestion（或功能相同的方式）明確詢問使用者是否要在正式環境執行這個操作，取得明確同意' +
                '後才可以帶上 confirm 參數；絕不能自行假設使用者同意。非 prod 環境不需要、也會忽略 confirm 欄位。',
            inputSchema: {
                captchaType: z.enum(QUERYABLE_CAPTCHA_TYPE_KEYS).describe('要修改的驗證碼類型：numeral=數字驗證碼/arithmetic=算術驗證碼/geetest=極驗（不接受 off，見說明）'),
                adminStatus: z.enum(ADMIN_STATUS_KEYS).optional().describe(
                    '這個類型的系統層級啟用狀態，不帶則沿用現值。設成 disabled 會觸發上方描述的跨平台級聯，務必謹慎。',
                ),
                geetestHost: z.string().optional().describe('僅 captchaType=geetest 時有意義，不帶則沿用現值'),
                geetestId: z.string().optional().describe('僅 captchaType=geetest 時有意義（極驗公開 id，非密鑰），不帶則沿用現值'),
                geetestKey: z.string().optional().describe('僅 captchaType=geetest 時有意義，極驗 API 私鑰，不帶則沿用現值；帶了會覆蓋成新明文'),
                numeralLength: z.number().int().min(1).optional().describe('僅 captchaType=numeral 時有意義（驗證碼位數），不帶則沿用現值'),
                confirm: z.string().optional().describe(
                    `正式環境（prod）專用的強制確認欄位；非 prod 環境會被忽略、不需提供。當這個 server 是正式環境時，` +
                    `必須先取得使用者明確同意，再帶上精確字串 "${ PROD_CONFIRM_TOKEN }" 才會執行，否則本工具會拒絕執行並回錯誤。`,
                ),
            },
        },
        async (input) => {
            assertProdConfirmed(input.confirm);

            const captchaTypeNum = CAPTCHA_TYPE_MAP[ input.captchaType ];
            const getR = await withAutoRelogin(() => remote.verificationCode.adminCaptchaConfig.GetCaptchaConfig(captchaTypeNum));
            if (getR.failed) return asErrorResult(getR);

            const finalAdminStatus = input.adminStatus !== undefined ? STATUS_MAP[ input.adminStatus ] : (getR.data?.adminStatus ?? STATUS_MAP.disabled);

            const currentConfig = getR.data?.captchaConfig as unknown as { geetest?: Record<string, unknown>; numeral?: Record<string, unknown> } | undefined;
            let merged: Record<string, unknown> = {};
            if (input.captchaType === 'geetest') {
                const base = currentConfig?.geetest ?? { geetestHost: '', geetestId: '', geetestKey: '' };
                merged = {
                    geetest: {
                        geetestHost: input.geetestHost !== undefined ? input.geetestHost : base.geetestHost,
                        geetestId: input.geetestId !== undefined ? input.geetestId : base.geetestId,
                        geetestKey: input.geetestKey !== undefined ? input.geetestKey : base.geetestKey,
                    },
                };
            } else if (input.captchaType === 'numeral') {
                const base = currentConfig?.numeral ?? { length: 4 };
                merged = { numeral: { length: input.numeralLength !== undefined ? input.numeralLength : base.length } };
            }
            // arithmetic：沒有 config 內容，merged 保持空物件（VerificationCaptchaConfig 兩個 variant 都不設）

            const setR = await withAutoRelogin(() => remote.verificationCode.adminCaptchaConfig.SetCaptchaConfig(
                captchaTypeNum,
                finalAdminStatus,
                VerificationCaptchaConfig.create(merged),
            ));
            if (setR.failed) return asErrorResult(setR);

            const checkR = await withAutoRelogin(() => remote.verificationCode.adminCaptchaConfig.GetCaptchaConfig(captchaTypeNum));
            if (checkR.failed) {
                return asTextResult({ success: true, message: '驗證碼設定已更新，但 round-trip 讀回失敗，請自行確認', writeErrorCode: 0 });
            }

            return asTextResult({
                success: true,
                message: '驗證碼設定已更新',
                ...formatCaptchaConfigResult(checkR.data?.adminStatus, checkR.data?.captchaConfig as unknown as Record<string, unknown>, false),
            });
        },
    );
}
