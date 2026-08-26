/**
 * tools/get_platform_deposit_setting.ts — aladdin_admin_deposit_admin_get_platform_deposit_setting_for_edit
 *
 * rajah: DepositAdmin.GetPlatformDepositSettingForEdit(platformId i32 1)
 * (setting PlatformDepositSettingEditForAdmin 1)
 * （payment_back_office.rajah:2940，@Permission "PaymentDepositAdmin.SettingPlatform"）
 *
 * agrabah 對應實作：src/servers/payment_back_office/services/deposit_admin.ts 的
 * methodGetPlatformDepositSettingForEdit（真的有 override），委派
 * PaymentManager.getPlatformDepositSetting。
 *
 * **已知資料陷阱（讀原始碼確認，非推測）**：這支名字叫 Get，但底層不是純讀取——
 * `getPlatformDepositSetting`（managers/payment_manager.ts:5010）先用 `platform_id = ?` 查
 * `DbPlatformDepositSettings`，**查不到時會直接 INSERT 一筆帶預設值的新記錄**（timeout=1800/
 * switches=0/differentNameLimit=0）再回傳，不是回錯誤或空值。比照 method-category-checklist.md
 * 第 1 節「Get 前綴不保證唯讀」——呼叫本工具本身就會對從未設定過充值設定的 platformId 產生一筆
 * 真實 DB 寫入（副作用是良性的預設值 bootstrap，不是危險寫入，但呼叫端需知道這不是純唯讀查詢）。
 * `platform_id` 沒有驗證/外鍵檢查，帶一個不存在的 platformId 一樣會建立一筆孤兒設定列，不會報錯——
 * platformId 一律應先用 aladdin_admin_list_platforms 取得真實 id。
 *
 * `PlatformDepositSettingEditForAdmin`（payment_back_office.rajah:2275-2278）只有一個 URL 欄位
 * （callbackBaseUrl），不含任何金鑰/密碼。
 *
 * dev 驗證：對真實存在的 platformId 呼叫，確認回傳結構；重複呼叫同一 platformId 兩次，確認
 * 第二次不會再新增一筆（loadObject 找到既有列後直接回傳，不會重複 insert）。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerGetPlatformDepositSettingTool(server: McpServer): void {
    server.registerTool(
        'aladdin_admin_deposit_admin_get_platform_deposit_setting_for_edit',
        {
            title: 'Get a platform\'s deposit setting (may create a default row)',
            description:
                '取得指定平台的充值（Deposit）設定，供編輯用（rajah: DepositAdmin.GetPlatformDepositSettingForEdit，' +
                'payment_back_office.rajah:2940）。platformId 來自 aladdin_admin_list_platforms 的回傳結果。' +
                '**這支雖然名字叫 Get，底層不是純讀取**：若該 platformId 從未設定過充值設定，後端會直接建立一筆' +
                '帶預設值（timeout=1800 秒/switches=0/differentNameLimit=0）的新記錄再回傳——呼叫本工具本身就可能' +
                '對資料庫產生一筆真實寫入（重複呼叫同一 platformId 不會重複建立，第二次會讀到既有列）。' +
                'platformId 沒有存在性驗證，帶一個不存在的 platformId 一樣會建立一筆孤兒設定列，不會報錯，' +
                '所以 platformId 一律應先用 aladdin_admin_list_platforms 確認是真實 id。回傳只有一個 URL 欄位' +
                '（callbackBaseUrl），不含任何金鑰/密碼。',
            inputSchema: {
                platformId: z.number().int().describe('平台 id，來自 aladdin_admin_list_platforms 的回傳結果'),
            },
        },
        async ({ platformId }) => {
            const r = await withAutoRelogin(() => remote.paymentBackOffice.depositAdmin.GetPlatformDepositSettingForEdit(platformId));
            if (r.failed) return asErrorResult(r);
            return asTextResult({ success: true, setting: r.data?.setting });
        },
    );
}
