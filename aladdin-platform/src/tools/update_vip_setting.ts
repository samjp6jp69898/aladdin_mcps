/**
 * tools/update_vip_setting.ts — aladdin_platform_vip_level_platform_update_vip_setting
 *
 * rajah: VipLevelPlatform.GetVipSetting（需要 @Permission "AppUser.Vip"） +
 * UpdateVipSetting（vip_back_office.rajah:1269,1271，需要 @Permission "AppUser.Vip.VipConfig"）
 *
 * 分類（method-category-checklist.md 第 4 節「Upsert」精神）：UpdateVipSetting 吃整包 VipSetting，
 * 先讀現值、只覆蓋呼叫端明確帶的欄位、完成後 round-trip。
 *
 * ⚠️ 跨租戶風險的正確歸因（2026-08-25 review 修正）：後端 methodUpdateVipSetting（vip_level_platform.ts:
 * 533-638）本身**不會**用 context.platformId 錨定要更新哪一列——:536 讀出的現值只檢查 failed 就丟棄，
 * :541 `dbVipSetting.from(vipSetting)` 整包信任 payload 帶的 id/platformId，updateObject 的 WHERE 只用
 * payload 的 id，不是「後端內部保證安全」。這支 tool 之所以安全，是因為 base 永遠來自本次 GetVipSetting
 * （查詢有以 context.platformId 錨定）、overrides 白名單不含 id/platformId、且 inputSchema 根本不開放這兩個
 * 欄位讓呼叫端亂帶——安全性由本 tool 的結構保證，不是後端保證，未來若改寫這支 tool 務必維持這個白名單設計。
 *
 * ⚠️ 刻意排除 equityIcons：agrabah vip_level_platform.ts:611-627 對 equityIcons 是「只保留傳入陣列
 * 裡的 id，其餘一律軟刪除」（非 diff、非保留），本 tool 不對外開放編輯此欄位，一律原樣把讀回的現值帶回，
 * 避免呼叫端不了解這個刪除語意而不小心刪掉既有圖標。新增/修改/刪除權益圖標涉及圖片上傳流程，需要另外的
 * tool（尚未實作，見 vip_back_office__VipLevelPlatform__GetUploadVipSettingImageToken 的 needs_clarification）。
 *
 * ⚠️ 已知後端限制（非本 tool 引入，僅記錄）：userLevels 的 SyncTargetIdsForSource 若失敗，
 * vip_level_platform.ts:577-581 會把錯誤吞掉（return 的是主表 errorCode 而非同步結果），transaction 仍會
 * commit、UpdateVipSetting 仍回成功。因此本 tool 在 round-trip 讀回後會額外比對 userLevels 是否等於送出值，
 * 不一致時在回傳中明確標示，不能只看 UpdateVipSetting 本身的 errorCode。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { VipSetting, LocalizationString } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { deepFixLongs } from '../const.ts';

const VIP_LEVEL_UPGRADE_MODE_MAP = { continuous: 1, dailyOnce: 2 } as const;
const LEVEL_GIFT_MODE_MAP = { allLevel: 1, currentLevel: 2 } as const;

const localizationSchema = z.array(z.object({
    code: z.string().describe('語言代碼，如 zh-CN/zh-TW/en-US'),
    value: z.string(),
})).describe('多語系陣列');

export function registerUpdateVipSettingTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_vip_level_platform_update_vip_setting',
        {
            title: 'Update VIP global setting',
            description:
                '更新本平台 VIP 全域設定（單例，rajah: VipLevelPlatform.GetVipSetting 讀現值 + UpdateVipSetting 寫入，' +
                '讀取需要權限節點 AppUser.Vip、寫入需要 AppUser.Vip.VipConfig）。無 id 參數，id/platformId 皆從 ' +
                '本次 GetVipSetting 的讀回值取得、不開放呼叫端指定（安全性由本 tool 結構保證，後端本身不會做' +
                '跨租戶檢查，見檔頭註解）。' +
                '所有欄位皆為 optional：只帶你要改的欄位，其餘先讀現值原樣帶回。' +
                '五個 *AuditMultiple 欄位（levelAuditMultiple/birthAuditMultiple/monthAuditMultiple/' +
                'weekAuditMultiple/dayAuditMultiple）需傳入「實際倍數 ×10000」的整數（例如要設 3 倍傳 30000）。' +
                '五個 *ValidityTime 欄位單位是小時。userLevels 若帶入是整批覆蓋（未帶到的層級 id 會被移除參與資格，' +
                '傳空陣列會清空全部），不帶則維持現值；⚠️ 各 *GiftName 多語系欄位若傳空陣列 [] 後端視為「未帶」不會' +
                '清空（與 userLevels 語意相反），無法用這支 tool 清空多語系名稱。' +
                '⚠️ 本 tool 不提供 equityIcons（權益圖標）欄位：後端對這個欄位是「只保留傳入陣列裡的 id，其餘一律' +
                '軟刪除」，一旦誤用會刪光既有圖標，因此本 tool 一律原樣把現值帶回、不開放呼叫端修改；如需管理權益' +
                '圖標請先向使用者確認需求，目前尚無對應 tool。' +
                '完成後會讀回最新設定一併回傳，但讀回走約 3 分鐘 TTL 的記憶體快取、清快取為非同步廣播，緊接著讀回' +
                '有極小機率仍是舊值，不能只憑回傳的 setting 內容判斷這次更新是否生效，userLevels 已額外比對' +
                '（見下方 userLevelsSyncConfirmed）。' +
                'prod 執行前確認：當這個 server 是正式環境（prod）時，執行本工具前必須先用 AskUserQuestion' +
                '（或功能相同的方式）明確詢問使用者是否要在正式環境執行這個操作，取得明確同意後才可以帶上 confirm 參數；' +
                '絕不能自行假設使用者同意。非 prod 環境不需要、也會忽略 confirm 欄位。',
            inputSchema: {
                vipLevelUpgradeMode: z.enum([ 'continuous', 'dailyOnce' ]).optional().describe('VIP 升級模式：continuous=連續升級、dailyOnce=每日一級'),
                levelGiftMode: z.enum([ 'allLevel', 'currentLevel' ]).optional().describe('晉級禮金領取模式：allLevel=所有等級、currentLevel=當前等級'),
                insuranceDays: z.number().int().min(0).optional().describe('保級天數'),
                levelGiftName: localizationSchema.optional().describe('晉級禮金名稱'),
                levelValidityTime: z.number().int().min(0).optional().describe('晉級禮金有效時間（小時）'),
                levelAuditMultiple: z.number().int().min(0).max(10_000_000).optional().describe('晉級禮金稽核倍數（已 ×10000 的整數，對應後台顯示倍數上限 1000）'),
                birthGiftName: localizationSchema.optional().describe('生日禮金名稱'),
                birthValidityTime: z.number().int().min(0).optional().describe('生日禮金有效時間（小時）'),
                birthAuditMultiple: z.number().int().min(0).max(10_000_000).optional().describe('生日禮金稽核倍數（已 ×10000 的整數，對應後台顯示倍數上限 1000）'),
                monthGiftName: localizationSchema.optional().describe('每月紅包名稱'),
                monthValidityTime: z.number().int().min(0).optional().describe('每月紅包有效時間（小時）'),
                monthAuditMultiple: z.number().int().min(0).max(10_000_000).optional().describe('每月紅包稽核倍數（已 ×10000 的整數，對應後台顯示倍數上限 1000）'),
                weekGiftName: localizationSchema.optional().describe('每週紅包名稱'),
                weekValidityTime: z.number().int().min(0).optional().describe('每週紅包有效時間（小時）'),
                weekAuditMultiple: z.number().int().min(0).max(10_000_000).optional().describe('每週紅包稽核倍數（已 ×10000 的整數，對應後台顯示倍數上限 1000）'),
                dayGiftName: localizationSchema.optional().describe('每日紅包名稱'),
                dayValidityTime: z.number().int().min(0).optional().describe('每日紅包有效時間（小時）'),
                dayAuditMultiple: z.number().int().min(0).max(10_000_000).optional().describe('每日紅包稽核倍數（已 ×10000 的整數，對應後台顯示倍數上限 1000）'),
                userLevels: z.array(z.number().int()).optional().describe('福利參與的會員層級 id 清單（整批覆蓋，不帶則維持現值）'),
                confirm: z.string().optional().describe(
                    `正式環境（prod）專用的強制確認欄位；非 prod 環境會被忽略、不需提供。當這個 server 是正式環境時，` +
                    `必須先取得使用者明確同意，再帶上精確字串 "${ PROD_CONFIRM_TOKEN }" 才會執行，否則本工具會拒絕執行並回錯誤。`,
                ),
            },
        },
        async (input) => {
            assertProdConfirmed(input.confirm);

            const getR = await withAutoRelogin(() => remote.vipBackOffice.vipLevelPlatform.GetVipSetting());
            if (getR.failed) return asErrorResult(getR);
            const base = getR.data?.setting;
            if (!base) return asTextResult({ success: false, message: '讀取目前設定失敗：後端回傳空值' });

            const overrides: Record<string, unknown> = {};
            if (input.vipLevelUpgradeMode !== undefined) overrides.vipLevelUpgradeMode = VIP_LEVEL_UPGRADE_MODE_MAP[ input.vipLevelUpgradeMode ];
            if (input.levelGiftMode !== undefined) overrides.levelGiftMode = LEVEL_GIFT_MODE_MAP[ input.levelGiftMode ];
            if (input.insuranceDays !== undefined) overrides.insuranceDays = input.insuranceDays;
            for (const key of [
                'levelGiftName', 'levelValidityTime', 'levelAuditMultiple',
                'birthGiftName', 'birthValidityTime', 'birthAuditMultiple',
                'monthGiftName', 'monthValidityTime', 'monthAuditMultiple',
                'weekGiftName', 'weekValidityTime', 'weekAuditMultiple',
                'dayGiftName', 'dayValidityTime', 'dayAuditMultiple',
                'userLevels',
            ] as const) {
                const value = input[ key ];
                if (value === undefined) continue;
                overrides[ key ] = key.endsWith('GiftName') ? (value as { code: string; value: string }[]).map((l) => LocalizationString.create(l)) : value;
            }

            // equityIcons 一律沿用現值，不開放呼叫端修改（見檔頭註解）。
            const merged = VipSetting.create({ ...base, ...overrides, equityIcons: base.equityIcons });

            const setR = await withAutoRelogin(() => remote.vipBackOffice.vipLevelPlatform.UpdateVipSetting(merged));
            if (setR.failed) return asErrorResult(setR);

            const checkR = await withAutoRelogin(() => remote.vipBackOffice.vipLevelPlatform.GetVipSetting());
            const checkedSetting = checkR.failed ? null : checkR.data?.setting;
            const expectedUserLevels = (input.userLevels ?? base.userLevels ?? []).slice().sort((a, b) => a - b);
            const actualUserLevels = (checkedSetting?.userLevels ?? []).slice().sort((a, b) => a - b);
            const userLevelsSyncConfirmed = checkR.failed
                ? null
                : JSON.stringify(expectedUserLevels) === JSON.stringify(actualUserLevels);

            return asTextResult({
                success: true,
                message: 'UpdateVipSetting 呼叫已成功；讀回可能受快取影響，請一併參考 userLevelsSyncConfirmed',
                setting: checkedSetting ? deepFixLongs(checkedSetting) : null,
                userLevelsSyncConfirmed,
            });
        },
    );
}
