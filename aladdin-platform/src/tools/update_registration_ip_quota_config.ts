/**
 * tools/update_registration_ip_quota_config.ts — aladdin_platform_app_user_ip_quota_platform_update_registration_ip_quota_config
 *
 * rajah: AppUserIpQuotaPlatform.GetRegistrationIpQuotaConfig + UpdateRegistrationIpQuotaConfig
 * （user_back_office.rajah:557-562，需要 @Permission "Risk.IpRestriction.SameIp.Save"）
 *
 * 2026-08-26 讀 agrabah 後端原始碼查證（app_user_ip_quota_platform.ts:56-70 →
 * RegistrationIpQuotaManager.updateConfig()，registration_ip_quota_manager.ts:356-453）：
 * - **status/initialQuotaCount/releaseQuotaCount/customerId 是整欄位覆蓋（非合併）**：transaction 內
 *   `FOR UPDATE` 鎖現有 row，直接 `UPDATE ... SET status=?, initial_quota_count=?, release_quota_count=?,
 *   customer_id=?`，沒有 pre-load 判斷。rajah 全庫沒有 @Optional/@Partial 這類欄位存在性標記
 *   （method-category-checklist.md 第 4 節），所以本工具照該檢查清單要求：先呼叫
 *   GetRegistrationIpQuotaConfig 讀現值，只覆蓋呼叫端明確帶的欄位，其餘原樣帶回，完成後再讀一次做
 *   round-trip 驗證。
 * - **limitPrompt（多語提示）不是整批覆蓋**：走 `LocalizationManager.updateById()`，逐一對陣列裡的
 *   `code` 做 upsert（查無則 insert），**只動陣列裡明確帶到的語系代碼，沒帶到的語系原樣保留**，
 *   跟 create_or_update_ip_region.ts 的 promptText 是同一套機制。實際行為比「整批覆蓋」更安全，
 *   本工具仍照「先讀現值原樣帶回」的統一模式處理（省略時沿用現值全部語系，帶入時只影響帶到的語系）。
 * - initialQuotaCount/releaseQuotaCount 在 rajah 標 `@Rules "Range(1,999);Required"`。
 *   若這個平台從未設定過，GetConfig 回傳的預設值（`getDefaultConfig()`，registration_ip_quota_manager.ts）
 *   這兩欄實際是 999（`DEFAULT_INITIAL_QUOTA_COUNT`/`DEFAULT_RELEASE_QUOTA_COUNT`），不是 0，走讀現值
 *   合併時本來就會落在合法區間內；zod schema 仍保留 min(1)/max(999) 驗證，是保護呼叫端明確傳入非法值的
 *   情況，不是暗示預設值會是 0。
 * - limitPrompt 陣列標 `@Rules "MaxLength(50)"`，每則提示文字最長 50 字元。
 * - 成功後端會清 Redis cache 並背景寫 audit（僅記 after snapshot）。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { RegistrationIpQuotaConfig } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { ACTIVE_STATUS_MAP } from '../const.ts';
import { formatRegistrationIpQuotaConfig } from './get_registration_ip_quota_config.ts';

export function registerUpdateRegistrationIpQuotaConfigTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_app_user_ip_quota_platform_update_registration_ip_quota_config',
        {
            title: 'Update registration IP quota (same-IP restriction) config',
            description:
                '修改本平台「註冊 IP 配額限制」總開關與相關設定（rajah: AppUserIpQuotaPlatform.UpdateRegistrationIpQuotaConfig，' +
                'user_back_office.rajah:561）。無參數帶 platformId，單例設定，平台由連線本身判定。' +
                '所有欄位皆為 optional：只帶你要改的欄位，其餘會先讀現值原樣帶回。status/initialQuotaCount/' +
                'releaseQuotaCount/customerId 後端整欄位覆蓋（非合併），limitPrompt 是逐語系 upsert' +
                '（只影響陣列裡明確帶到的語系代碼，其餘語系不受影響），詳見檔頭註解。' +
                '完成後會自動讀回最新設定一併回傳，方便核對是否真的改成功、以及未指定的欄位是否仍等於呼叫前的值。',
            inputSchema: {
                status: z.enum([ 'enabled', 'disabled' ]).optional().describe('總開關：enabled=啟用註冊 IP 配額限制、disabled=停用'),
                initialQuotaCount: z.number().int().min(1).max(999).optional().describe('新 IP 初始可註冊數，1~999，省略則沿用現值'),
                releaseQuotaCount: z.number().int().min(1).max(999).optional().describe('每次釋放（release_registration_ip_quota）補回的配額數，1~999，省略則沿用現值'),
                limitPrompt: z.array(z.object({
                    code: z.string().max(20).describe('語系代碼，例如 zh-CN、zh-TW、en-US，最長 20 字元（後端 MAX_LOCALIZATION_CODE_LENGTH）'),
                    value: z.string().max(50).describe('該語系下的限制提示詞，最長 50 字元'),
                })).optional().describe('達註冊上限時前台顯示的多語提示文字；只更新陣列裡明確帶到的語系代碼，沒帶到的語系維持原值，省略則完全不動'),
                customerId: z.number().int().min(0).optional().describe('客服連結 id：0＝關閉，>0＝開啟指定客服連結 id。省略則沿用現值'),
                confirm: z.string().optional().describe(
                    `正式環境（prod）專用的強制確認欄位；非 prod 環境會被忽略、不需提供。當這個 server 是正式環境時，` +
                    `必須先取得使用者明確同意，再帶上精確字串 "${ PROD_CONFIRM_TOKEN }" 才會執行，否則本工具會拒絕執行並回錯誤。`,
                ),
            },
        },
        async (input) => {
            assertProdConfirmed(input.confirm);

            const getR = await withAutoRelogin(() => remote.appUserBackOffice.appUserIpQuotaPlatform.GetRegistrationIpQuotaConfig());
            if (getR.failed) return asErrorResult(getR);

            const base = getR.data?.config;
            if (!base) return asTextResult({ success: false, message: '讀取目前設定失敗：後端回傳空值' });

            const overrides: Record<string, unknown> = {};
            if (input.status !== undefined) overrides.status = ACTIVE_STATUS_MAP[ input.status ];
            if (input.initialQuotaCount !== undefined) overrides.initialQuotaCount = input.initialQuotaCount;
            if (input.releaseQuotaCount !== undefined) overrides.releaseQuotaCount = input.releaseQuotaCount;
            if (input.limitPrompt !== undefined) overrides.limitPrompt = input.limitPrompt;
            if (input.customerId !== undefined) overrides.customerId = input.customerId;

            const merged = RegistrationIpQuotaConfig.create({ ...base, ...overrides });

            const setR = await withAutoRelogin(() => remote.appUserBackOffice.appUserIpQuotaPlatform.UpdateRegistrationIpQuotaConfig(merged));
            if (setR.failed) return asErrorResult(setR);

            const checkR = await withAutoRelogin(() => remote.appUserBackOffice.appUserIpQuotaPlatform.GetRegistrationIpQuotaConfig());
            const checkConfig = checkR.failed ? undefined : checkR.data?.config;
            return asTextResult({
                success: true,
                message: '註冊 IP 配額設定已更新',
                config: checkConfig ? formatRegistrationIpQuotaConfig(checkConfig as unknown as Record<string, unknown>) : null,
            });
        },
    );
}
