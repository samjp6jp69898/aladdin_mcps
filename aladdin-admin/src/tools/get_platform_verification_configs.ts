/**
 * tools/get_platform_verification_configs.ts — aladdin_admin_admin_captcha_config_get_platform_verification_configs
 *
 * rajah: AdminCaptchaConfig.GetPlatformVerificationConfigs(page, pageSize) (rows, totalPage)
 * （verification_code.rajah:50，method 未自帶 @Permission，依 service 標頭 @Permission
 * "AdminCaptchaConfig" 規則承接該節點）。
 *
 * 對應前端頁面：產品系統 → 驗證碼管理 → 平台列表（VerificationSettings.vue 同頁另一個分頁）。
 *
 * method-category-checklist.md 第 2 節：`pageSize` 是 `PageSizeEnum`（common.rajah:2440-2448，
 * 伺服器端強制上限 200），沒有可鎖定單一平台的篩選欄位（只有 page/pageSize），屬 B 級清單。
 * 每筆 `VerificationPlatformConfig`（verification_code_common.rajah:26-37）本身帶 `platformId`，
 * 可在拿到資料後用它篩選特定平台——本工具的 `platformId` 參數就是做這件事：內部逐頁掃描到底
 * （用回傳的 `totalPage` 當終止條件，不是憑空設上限），找到就提早回傳，找不到會照實回報已掃描
 * 頁數，不會誤報「已掃描全部」。
 *
 * `platformName`/`availableCaptchaTypesString` 兩個顯示用欄位（2026-08-25 讀源碼確認
 * agrabah/src/database_types/verification_code.ts 的 DbVerificationPlatformConfig 完全沒有
 * 持久化這兩欄，後端 response 組裝也沒有填）永遠是空字串，不是這筆資料真的沒有名稱。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { CAPTCHA_TYPE_MAP } from '../const.ts';

const LIST_PAGE_SIZE = 200;
const REVERSE_CAPTCHA_TYPE_MAP = Object.fromEntries(Object.entries(CAPTCHA_TYPE_MAP).map(([ k, v ]) => [ v, k ])) as Record<number, string>;

/**
 * 把後端回傳的 VerificationPlatformConfig 原始物件（availableCaptchaTypes/
 * platformCurrentCaptchaType 都是裸數字）轉成字串 key，跟本 domain 其他工具
 * （get/set_captcha_config、platform 端 get/set_platform_verification_config）的輸出格式一致。
 * 2026-08-25 dev 實測發現：不轉換會讓 agent 把這裡讀到的裸數字直接回填進
 * update_platform_verification_config.ts 的 zod enum 參數，直接被 schema 擋下報錯——
 * update_platform_verification_config.ts 也共用這支，確保讀/寫兩邊格式一致。
 */
export function formatVerificationPlatformConfig(row: Record<string, unknown>): Record<string, unknown> {
    return {
        ...row,
        platformCurrentCaptchaType: REVERSE_CAPTCHA_TYPE_MAP[ row.platformCurrentCaptchaType as number ] ?? row.platformCurrentCaptchaType,
        availableCaptchaTypes: ((row.availableCaptchaTypes as number[] | undefined) ?? []).map((t) => REVERSE_CAPTCHA_TYPE_MAP[ t ] ?? t),
    };
}

/**
 * 逐頁掃描 GetPlatformVerificationConfigs 找出指定 platformId 的那一列，供本檔案的 list 工具
 * 與 update_platform_verification_config.ts 的讀現值步驟共用（同 upsert_game.ts 的
 * findGameRowByBusinessKey 模式）。
 */
export async function findPlatformVerificationConfigRow(platformId: number) {
    let totalPage = 1;
    let scannedPages = 0;
    for (let page = 1; page <= totalPage; page++) {
        const listR = await withAutoRelogin(() => remote.verificationCode.adminCaptchaConfig.GetPlatformVerificationConfigs(page, LIST_PAGE_SIZE));
        if (listR.failed) return { listR, matchedRow: undefined, scannedPages } as const;
        scannedPages++;
        totalPage = listR.data?.totalPage ?? 1;
        const matchedRow = listR.data?.rows?.find((row) => row.platformId === platformId);
        if (matchedRow) return { listR: undefined, matchedRow, scannedPages } as const;
    }
    return { listR: undefined, matchedRow: undefined, scannedPages } as const;
}

export function registerGetPlatformVerificationConfigsTool(server: McpServer): void {
    server.registerTool(
        'aladdin_admin_admin_captcha_config_get_platform_verification_configs',
        {
            title: 'List (or find one) platform verification captcha config',
            description:
                '列出各平台的驗證碼設定（可用類型清單 + 目前選用類型），rajah: ' +
                'AdminCaptchaConfig.GetPlatformVerificationConfigs。' +
                '帶 platformId 時，內部逐頁掃描到底（不是只查第一頁）找出該平台那一列並直接回傳，' +
                '找不到會回傳 found=false + 已掃描頁數（代表這個平台目前沒有設定過，行為等同預設值：' +
                'availableCaptchaTypes=[]、platformCurrentCaptchaType=off）；' +
                '不帶 platformId 則回傳指定 page/pageSize 的原始分頁清單（供瀏覽用）。' +
                'platformName/availableCaptchaTypesString 這兩個顯示用欄位後端目前完全沒有串接，' +
                '永遠是空字串，不代表這筆資料異常。' +
                '這是純讀取查詢，不會修改任何資料，可安全重複呼叫。',
            inputSchema: {
                platformId: z.number().int().optional().describe('要查詢的平台 id；帶了會忽略 page/pageSize，內部逐頁掃描到底找這一筆'),
                page: z.number().int().min(1).optional().describe('僅在未帶 platformId 時使用，預設 1'),
                pageSize: z.number().int().min(1).max(200).optional().describe('僅在未帶 platformId 時使用，預設 200（伺服器端上限）'),
            },
        },
        async ({ platformId, page, pageSize }) => {
            if (platformId !== undefined) {
                const found = await findPlatformVerificationConfigRow(platformId);
                if (found.listR) return asErrorResult(found.listR);
                if (!found.matchedRow) {
                    return asTextResult({
                        success: true,
                        found: false,
                        scannedPages: found.scannedPages,
                        message: `已掃描全部 ${ found.scannedPages } 頁，找不到 platformId=${ platformId } 的設定（視為尚未設定過，預設 availableCaptchaTypes=[]、platformCurrentCaptchaType=off）`,
                    });
                }
                return asTextResult({ success: true, found: true, config: formatVerificationPlatformConfig(found.matchedRow as unknown as Record<string, unknown>) });
            }

            const r = await withAutoRelogin(() => remote.verificationCode.adminCaptchaConfig.GetPlatformVerificationConfigs(page ?? 1, pageSize ?? LIST_PAGE_SIZE));
            if (r.failed) return asErrorResult(r);

            return asTextResult({
                success: true,
                rows: (r.data?.rows ?? []).map((row) => formatVerificationPlatformConfig(row as unknown as Record<string, unknown>)),
                totalPage: r.data?.totalPage ?? 0,
            });
        },
    );
}
