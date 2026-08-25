/**
 * tools/update_platform_verification_config.ts — aladdin_admin_admin_captcha_config_set_platform_verification_config
 *
 * rajah: AdminCaptchaConfig.GetPlatformVerificationConfigs（找現值）+ SetPlatformVerificationConfig
 * （verification_code.rajah:47，@Permission "AdminCaptchaConfig.Verification.Pspm.Edit"）。
 *
 * 對應前端頁面：產品系統 → 驗證碼管理 → 平台列表，編輯單一平台的可用類型/當前類型。
 *
 * **地雷（2026-08-25 讀源碼確認，即程式碼裡標註的 FAQ-1858）**：`SetPlatformVerificationConfig`
 * 後端是 `config.from({ platformId, ...param })`（agrabah/src/servers/verification_code/
 * services/admin_captcha_config.ts），`from()`（database_types/verification_code.ts）對
 * `availableCaptchaTypes` 的判斷式是 `if (source.availableCaptchaTypes != null)`——proto3
 * repeated 欄位沒有「有沒有被設定」這個狀態，呼叫端沒帶 `availableCaptchaTypes` 時，decode 出來
 * 的值是空陣列 `[]` 而不是 `null`/`undefined`，會被這個判斷式當成「呼叫端明確要清空」直接覆蓋
 * 掉現有清單。**所以本工具每次呼叫都會先讀現值、無論呼叫端有沒有帶 `availableCaptchaTypes`，
 * 送出的 param 一律帶完整陣列**，不依賴後端做任何欄位級保護（跟 platform 端自己的
 * `SetPlatformVerificationCaptchaType` 不同，那支後端自己有做這層保護，見同目錄
 * aladdin-platform 版本的 update_platform_verification_captcha_type.ts 檔頭註解）。
 *
 * 沒有直接用 platformId 查單筆的 method，讀現值靠
 * get_platform_verification_configs.ts 匯出的 findPlatformVerificationConfigRow()（逐頁掃描
 * 到底），找不到視為這個平台尚未設定過，預設 captchaType=off、availableCaptchaTypes=[]。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { VerificationPlatformConfigEdit } from '/Users/user/aladdin/abu/admin/src/generated/types.gen.js';
import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { CAPTCHA_TYPE_MAP } from '../const.ts';
import { findPlatformVerificationConfigRow, formatVerificationPlatformConfig } from './get_platform_verification_configs.ts';

const CAPTCHA_TYPE_KEYS = Object.keys(CAPTCHA_TYPE_MAP) as [ keyof typeof CAPTCHA_TYPE_MAP, ...(keyof typeof CAPTCHA_TYPE_MAP)[] ];

export function registerUpdatePlatformVerificationConfigTool(server: McpServer): void {
    server.registerTool(
        'aladdin_admin_admin_captcha_config_set_platform_verification_config',
        {
            title: 'Update one platform\'s available/current captcha type',
            description:
                '修改指定平台的驗證碼設定（可用類型清單 + 目前選用類型），rajah: ' +
                'AdminCaptchaConfig.SetPlatformVerificationConfig。' +
                '所有欄位皆為 optional：只帶你要改的欄位，其餘先讀現值原樣帶回——但這是工具層自己做的' +
                '防呆，不是後端保護，見檔頭註解的 proto3 空陣列地雷（沒讀現值直接漏帶 availableCaptchaTypes' +
                '會被後端當成明確清空）。' +
                'captchaType 應該屬於 availableCaptchaTypes 清單內（後端邏輯上的合理限制，但本工具未強制' +
                '前置檢查，若不屬於可能造成該平台驗證碼行為異常，請自行確保兩者一致）。' +
                '找不到指定 platformId 的現有設定時視為新增（預設 captchaType=off、availableCaptchaTypes=[]' +
                '再套用覆蓋值）。完成後會自動讀回最新設定一併回傳，方便核對是否真的改成功。' +
                'prod 執行前確認（H38 同構機制）：當這個 server 是正式環境（prod）時，執行本工具前必須先用 ' +
                'AskUserQuestion（或功能相同的方式）明確詢問使用者是否要在正式環境執行這個操作，取得明確同意' +
                '後才可以帶上 confirm 參數；絕不能自行假設使用者同意。非 prod 環境不需要、也會忽略 confirm 欄位。',
            inputSchema: {
                platformId: z.number().int().describe('要修改的平台 id'),
                captchaType: z.enum(CAPTCHA_TYPE_KEYS).optional().describe('該平台目前選用的驗證碼類型，不帶則沿用現值'),
                availableCaptchaTypes: z.array(z.enum(CAPTCHA_TYPE_KEYS)).optional().describe(
                    '該平台可選用的驗證碼類型清單，不帶則沿用現值。**注意：帶空陣列不是「不限制」，' +
                    '是「這個平台完全沒有可用的驗證碼類型」**——後端 setCaptchaType 用 includes() 檢查目標類型是否在此清單內，' +
                    '空清單會讓任何 captchaType 都判定為不合法，等同鎖死該平台的驗證碼功能，非必要不要帶空陣列。',
                ),
                confirm: z.string().optional().describe(
                    `正式環境（prod）專用的強制確認欄位；非 prod 環境會被忽略、不需提供。當這個 server 是正式環境時，` +
                    `必須先取得使用者明確同意，再帶上精確字串 "${ PROD_CONFIRM_TOKEN }" 才會執行，否則本工具會拒絕執行並回錯誤。`,
                ),
            },
        },
        async (input) => {
            assertProdConfirmed(input.confirm);

            const found = await findPlatformVerificationConfigRow(input.platformId);
            if (found.listR) return asErrorResult(found.listR);

            const baseCaptchaType = found.matchedRow?.platformCurrentCaptchaType ?? CAPTCHA_TYPE_MAP.off;
            const baseAvailableTypes = found.matchedRow?.availableCaptchaTypes ?? [];

            const finalCaptchaType = input.captchaType !== undefined ? CAPTCHA_TYPE_MAP[ input.captchaType ] : baseCaptchaType;
            const finalAvailableTypes = input.availableCaptchaTypes !== undefined
                ? input.availableCaptchaTypes.map((k) => CAPTCHA_TYPE_MAP[ k ])
                : baseAvailableTypes;

            const setR = await withAutoRelogin(() => remote.verificationCode.adminCaptchaConfig.SetPlatformVerificationConfig(
                input.platformId,
                VerificationPlatformConfigEdit.create({ captchaType: finalCaptchaType, availableCaptchaTypes: finalAvailableTypes }),
            ));
            if (setR.failed) return asErrorResult(setR);

            const checkFound = await findPlatformVerificationConfigRow(input.platformId);
            if (checkFound.listR || !checkFound.matchedRow) {
                return asTextResult({ success: true, message: '設定已更新，但 round-trip 讀回失敗，請自行確認', platformId: input.platformId });
            }

            return asTextResult({
                success: true,
                message: '平台驗證碼設定已更新',
                config: formatVerificationPlatformConfig(checkFound.matchedRow as unknown as Record<string, unknown>),
            });
        },
    );
}
