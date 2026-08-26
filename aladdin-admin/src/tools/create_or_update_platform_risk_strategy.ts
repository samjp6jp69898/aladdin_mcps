/**
 * tools/create_or_update_platform_risk_strategy.ts — aladdin_admin_risk_admin_create_or_update_platform_risk_strategy
 *
 * rajah: RiskAdmin.CreateOrUpdatePlatformRiskStrategy（risk.rajah:47）——超管視角的 upsert，
 * id=0/留空為新增、id>0 為更新。回傳型別是 Empty（無新 id），見 remote.gen.ts。
 *
 * 2026-08-25 讀 agrabah 後端原始碼查證（risk_admin.ts:94-140），並用 `bun -e` 實測
 * `PlatformRiskStrategyEditForAdmin.create({...})` 的實際行為修正過一版：
 * - 更新分支對傳入的 PlatformRiskStrategyEditForAdmin 直接呼叫 `dbPlatformRiskStrategy.from(edit)`，
 *   底層走 DbObject.assignKey()（agrabah/src/database_types/base.ts:6-17）。實測 `.create({...})`
 *   只帶部分欄位時，沒被明確帶到的欄位**不是 own property**（`hasOwnProperty` 為 false）——但
 *   protobufjs 產生的 message class 把每個數字欄位的型別預設值（0）設在 prototype 上，透過
 *   prototype chain 讀取 `source[key]` 仍會拿到 `0`，不是 `undefined`。assignKey 判斷式的第二個
 *   分支 `source[key] === 0` 不看 `hasOwnProperty`，只看讀出來的值，因此「沒帶的數字欄位」還是
 *   會被判定成「明確要設成 0」而覆蓋進 DB（字串欄位不受影響，prototype 預設值是 `''`，
 *   `'' !== 0`）。這就是 method-category-checklist.md 第 4 節模式 2 的已知地雷，因此更新分支
 *   **必須**先呼叫 GetPlatformRiskStrategyForEdit 讀現值、把沒帶到的欄位原樣帶回，一律送出完整
 *   合併後的物件，不能只送呼叫端這次明確給的欄位。
 * - riskStrategyCode 在 rajah model 標 `@NoEdit`（risk.rajah:94）：後端 `excludeFieldsFromUpdate`
 *   保護它不被更新分支覆寫，本工具比照，更新時一律沿用現值、忽略呼叫端帶的值（若有帶，僅供
 *   識別用途，實際送出的值以現值為準）。
 * - `platform_risk_strategies` 表（agrabah/migrations/risk/202511191645_re_create_risk_strategy.sql）
 *   對 (platform_id, risk_strategy_code) 沒有 DB unique 限制，dev 站台實測同一平台可以有重複
 *   riskStrategyCode 的多筆策略——新增後無法用業務鍵反查新 id，只能用「呼叫前後 id 集合 diff」
 *   找出新增的那一筆（見 listAllStrategyIds()），非嚴格並發安全（極端情況下若同時有其他人在
 *   同一個 platformId 底下新增，diff 可能對到多個 id，此時工具會誠實回報「無法唯一確認」而不
 *   是亂猜）。
 * - RiskAdmin 沒有任何刪除/停用/狀態切換 method（見 risk.rajah:37-48 全部 method 清單）——
 *   新增測試資料後無法透過任何 MCP tool 清除，會永久留在 dev 站台，需要人工到 DB 處理。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { PlatformRiskStrategyEditForAdmin } from '/Users/user/aladdin/abu/admin/src/generated/types.gen.js';
import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

const MAX_SCAN_PAGES = 20; // 每頁固定 100 筆（後端 DefaultPageSize），上限 2000 筆，遠大於單一平台實際策略數。

/**
 * 掃描指定 platformId 底下所有風控策略的 id 集合，供新增後 diff 出新 id 使用。
 * totalPage 只有 page=1 時後端才會真的計算（見 aladdin_admin_risk_admin_list_platform_risk_strategies
 * 的既有陷阱說明），故以 page=1 的 totalPage 為準，並以「該頁 rows 為空」當提早結束的保險條件。
 */
async function listAllStrategyIds(platformId: number): Promise<
    { failed: true; errorResult: { failed: true; errorCode: number; message: string } }
    | { failed: false; ids: number[]; scannedPages: number; hitScanCap: boolean }
> {
    const ids: number[] = [];
    let totalPage = 1;
    let page = 1;
    for (; page <= totalPage && page <= MAX_SCAN_PAGES; page++) {
        const r = await withAutoRelogin(() => remote.risk.riskAdmin.ListPlatformRiskStrategies(platformId, page));
        if (r.failed) return { failed: true, errorResult: r as any };
        if (page === 1) totalPage = r.data?.totalPage ?? 1;
        const rows = r.data?.rows ?? [];
        if (rows.length === 0) break;
        for (const row of rows) ids.push(row.id ?? 0);
    }
    return { failed: false, ids, scannedPages: page - 1, hitScanCap: totalPage > MAX_SCAN_PAGES };
}

export function registerCreateOrUpdatePlatformRiskStrategyTool(server: McpServer): void {
    server.registerTool(
        'aladdin_admin_risk_admin_create_or_update_platform_risk_strategy',
        {
            title: 'Create or update a platform risk strategy (super-admin, upsert)',
            description:
                '超管視角新增或更新一筆風控策略（rajah: RiskAdmin.CreateOrUpdatePlatformRiskStrategy，risk.rajah:47，upsert 語意）。' +
                'id 留空或 0＝新增（此時 riskStrategyCode/tagName/priority 必填，對應 rajah @Rules Required）；' +
                'id>0＝更新（工具會先呼叫 get_platform_risk_strategy_for_edit 讀現值，只覆蓋你有帶的欄位，沒帶的欄位原樣沿用，' +
                '避免把沒提到的欄位覆蓋成 0/空字串——這是後端 assignKey 合併機制的已知地雷，見檔頭註解）。' +
                'riskStrategyCode 一經建立即不可編輯（rajah @NoEdit），更新時就算帶了這個欄位也會被忽略、一律沿用現值。' +
                '⚠️ 這支 method 只能改 tagName/tagDescription/priority/category/riskLevel 這些顯示層欄位，' +
                '不能設定策略實際觸發用的門檻參數（如快進快出的分鐘數/金額），rajah PlatformRiskStrategyEditForAdmin' +
                '（risk.rajah:90-102）沒有 riskStrategyCurrencyConditions 欄位（平台版 PlatformRiskStrategyEdit 才有）。' +
                '⚠️ 新增後不會拿到新 id（RPC 回傳型別是 Empty），本工具改用「呼叫前後的 id 集合 diff」找出新增的那一筆並讀回驗證；' +
                '若同時間有其他人在同一 platformId 底下新增，diff 可能無法唯一定位，工具會誠實回報而不是亂猜。' +
                '⚠️ RiskAdmin 沒有任何刪除/停用 method，新增的測試資料無法透過任何 MCP tool 清除，會永久留在該環境，' +
                '測試前請先想清楚，測試後如需清理只能請有 DB 權限的人手動處理。' +
                'platformId 用 aladdin_admin_platform_management_list_platform_details 查；riskStrategyCode/category 合法值對照見 ' +
                'aladdin_admin_risk_admin_list_platform_risk_strategies 的 description。' +
                'prod 執行前確認（H36）：當這個 server 是正式環境（prod）時，執行本工具前必須先用 AskUserQuestion' +
                '（或功能相同的方式）明確詢問使用者是否要在正式環境執行這個操作，取得明確同意後才可以帶上 confirm 參數；' +
                '絕不能自行假設使用者同意。非 prod 環境（dev/pre/evi）不需要、也會忽略 confirm 欄位。',
            inputSchema: {
                platformId: z.number().int().describe('平台 id，用 aladdin_admin_platform_management_list_platform_details 查'),
                id: z.number().int().optional().describe('策略 id：留空或 0＝新增；帶入既有 id＝更新，id 從 list_platform_risk_strategies 取得'),
                riskStrategyCode: z.number().int().optional().describe(
                    '策略代碼（rajah RiskStrategyCodeEnum 數值，如 withdrawQuickly=1000）。新增時必填；更新時就算帶了也會被忽略（@NoEdit，一律沿用現值）',
                ),
                tagName: z.string().optional().describe('策略標籤名稱。新增時必填；更新時不帶則沿用既有值'),
                tagDescription: z.string().optional().describe('策略說明文字。更新時不帶則沿用既有值，新增時不帶則為空字串'),
                priority: z.number().int().optional().describe('優先級，數字越小越優先。新增時必填；更新時不帶則沿用既有值'),
                category: z.number().int().optional().describe(
                    '風控分類（rajah RiskStrategyCategoryEnum 數值：capital=1/behavior=2/identityRisk=3/promotion=4/systemAbnormal=5）。' +
                    '更新時不帶則沿用既有值，新增時不帶則為 0',
                ),
                riskLevel: z.number().int().optional().describe('風險等級（rajah RiskLevelEnum 數值）。更新時不帶則沿用既有值，新增時不帶則為 0'),
                confirm: z.string().optional().describe(
                    `正式環境（prod）專用的強制確認欄位；非 prod 環境會被忽略、不需提供。當這個 server 是正式環境時，` +
                    `必須先取得使用者明確同意，再帶上精確字串 "${ PROD_CONFIRM_TOKEN }" 才會執行，否則本工具會拒絕執行並回錯誤。`,
                ),
            },
        },
        async ({ platformId, id, riskStrategyCode, tagName, tagDescription, priority, category, riskLevel, confirm }) => {
            assertProdConfirmed(confirm);

            const targetId = id ?? 0;
            const isCreate = targetId === 0;

            let mergedFields: { riskStrategyCode: number; tagName: string; tagDescription: string; priority: number; category: number; riskLevel: number };

            if (isCreate) {
                if (riskStrategyCode === undefined || tagName === undefined || priority === undefined) {
                    return asTextResult({
                        success: false,
                        message: '新增策略時 riskStrategyCode、tagName、priority 為必填（對應 rajah @Rules Required），未執行任何寫入',
                    });
                }
                mergedFields = {
                    riskStrategyCode,
                    tagName,
                    tagDescription: tagDescription ?? '',
                    priority,
                    category: category ?? 0,
                    riskLevel: riskLevel ?? 0,
                };
            } else {
                const currentR = await withAutoRelogin(() => remote.risk.riskAdmin.GetPlatformRiskStrategyForEdit(targetId));
                if (currentR.failed) return asErrorResult(currentR);
                const existing = currentR.data?.platformRiskStrategyEditForAdmin;
                if (!existing) {
                    return asTextResult({ success: false, message: `查無 id=${ targetId } 的既有策略，未執行任何寫入` });
                }
                mergedFields = {
                    riskStrategyCode: existing.riskStrategyCode ?? 0,
                    tagName: tagName ?? existing.tagName ?? '',
                    tagDescription: tagDescription ?? existing.tagDescription ?? '',
                    priority: priority ?? existing.priority ?? 0,
                    category: category ?? existing.category ?? 0,
                    riskLevel: riskLevel ?? existing.riskLevel ?? 0,
                };
            }

            const beforeIds = isCreate ? await listAllStrategyIds(platformId) : null;
            if (beforeIds?.failed) return asErrorResult(beforeIds.errorResult);

            const edit = PlatformRiskStrategyEditForAdmin.create({ id: targetId, ...mergedFields });
            const writeR = await withAutoRelogin(() => remote.risk.riskAdmin.CreateOrUpdatePlatformRiskStrategy(platformId, edit));
            if (writeR.failed) return asErrorResult(writeR);

            if (!isCreate) {
                const afterR = await withAutoRelogin(() => remote.risk.riskAdmin.GetPlatformRiskStrategyForEdit(targetId));
                return asTextResult({
                    success: true,
                    mode: 'update',
                    id: targetId,
                    verified: !afterR.failed ? afterR.data?.platformRiskStrategyEditForAdmin : null,
                });
            }

            // 新增：CreateOrUpdatePlatformRiskStrategy 回傳 Empty，沒有新 id；riskStrategyCode 在這張表無 DB unique
            // 限制，不能拿它反查，只能比對呼叫前後的 id 集合 diff 出新增的那一筆。
            const afterIds = await listAllStrategyIds(platformId);
            if (afterIds.failed) {
                return asTextResult({
                    success: true,
                    mode: 'create',
                    message: '寫入已送出，但讀回驗證失敗，請人工到後台確認是否成功',
                    readBackError: afterIds.errorResult,
                });
            }

            const beforeSet = new Set((beforeIds as { failed: false; ids: number[] }).ids);
            const newIds = afterIds.ids.filter((rid) => !beforeSet.has(rid));

            if (newIds.length !== 1) {
                return asTextResult({
                    success: true,
                    mode: 'create',
                    message: newIds.length === 0
                        ? '寫入已送出，但前後讀回的 id 集合沒有新增任何 id，可能掃描頁數上限不足或有並發寫入，請人工到後台確認'
                        : `寫入已送出，但前後 diff 出 ${ newIds.length } 個新 id（可能有並發寫入），無法唯一確認是哪一筆，請人工核對：${ newIds.join(',') }`,
                    beforeCount: (beforeIds as { failed: false; ids: number[] }).ids.length,
                    afterCount: afterIds.ids.length,
                    hitScanCap: afterIds.hitScanCap,
                });
            }

            const newId = newIds[ 0 ];
            const verifyR = await withAutoRelogin(() => remote.risk.riskAdmin.GetPlatformRiskStrategyForEdit(newId));
            return asTextResult({
                success: true,
                mode: 'create',
                id: newId,
                verified: !verifyR.failed ? verifyR.data?.platformRiskStrategyEditForAdmin : null,
                note: 'RiskAdmin 沒有刪除/停用 API，這筆資料無法透過任何 MCP tool 清除，測試用途請自行評估是否需要人工到 DB 處理',
            });
        },
    );
}
