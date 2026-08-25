/**
 * tools/create_or_update_activity_tab.ts — aladdin_platform_activity_platform_create_or_update_activity_tabs
 *
 * rajah: ActivityPlatform.CreateOrUpdateActivityTabs(rows [ActivityTab] 1) ()
 * （activity_back_office.rajah:1772，@Permission "BonusCenter.Activity.Config.ActTab.Ops.Edit"，
 * service 定義於同檔 1767 行，非 @NoPublic）——對應後台「優惠中心 > 活動管理」的活動欄目管理
 * 彈窗，新增/修改/排序/啟停活動頁籤。agrabah 對應實作
 * agrabah/src/servers/activity_back_office/services/activity_platform.ts:1576
 * methodCreateOrUpdateActivityTabs，確認有真實實作（在單一 transaction 內逐筆 upsert），
 * 非 base class 的 notImplemented stub。
 *
 * 分類：method-category-checklist.md 第 4 節「Upsert / CreateOrUpdate」，且屬該節第 5 點特別
 * 提到的真實案例（該檔案本身就是以 CreateOrUpdateActivityTabs 為例）：這是**批次陣列型
 * upsert**，逐筆 upsert，DB 裡存在但沒出現在傳入陣列的舊資料**既不刪除也不 diff、原樣保留**
 * ——這是第三種語意，既非整包覆蓋也非差異刪除。因此呼叫端不需要每次都把所有既有頁籤全部
 * 帶回，只帶要新增/修改的那幾筆即可，省略的頁籤不會受影響。
 *
 * 本工具刻意只暴露「一次新增或修改一筆」的介面（不是照搬 RPC 的陣列參數），理由：
 * 1. rajah 沒有單筆 Get by id，只有 GetActivityTabs() 全撈；本工具內部用它取得現值，逐欄
 *    合併呼叫端有帶到的欄位（method-category-checklist.md 第 4 節「先讀現值、只覆蓋要改
 *    欄位」的通用安全要求）——agrabah 端對 id>0 的每一筆是 `tab.sortOrder = row.sortOrder;
 *    tab.status = row.status;` 無條件覆蓋（非稀疏合併），若呼叫端漏帶 status/sortOrder 又
 *    不先讀現值合併，會把沒打算改的欄位覆蓋成 undefined/預設值。
 * 2. 對「id>0 但找不到對應現值」的情況，agrabah 端是靜默 continue、不報錯也不新增
 *    （activity_platform.ts:1596-1599）——本工具在送出 RPC 前就先用讀到的現值檢查，id 不存在
 *    直接擋下並明確回報，不讓呼叫端誤以為「沒報錯=已更新」。
 * 3. **CreateOrUpdateActivityTabsResponse 是 Empty**（沒有回傳新建 id）：新增一筆後唯一能拿到
 *    新 id 的方式是寫入前後各呼叫一次 GetActivityTabs()，用「寫入後多出來的 id」反推——本工具
 *    的 round-trip 驗證就是這樣做的；正常情況（沒有其他人同時併發新增）能唯一辨識，若偵測到
 *    寫入前後新增的 id 不只一個（代表期間有其他呼叫也在新增），會如實列出所有候選 id、不猜測
 *    哪一個是這次呼叫建立的。
 *
 * 建立新頁籤時 sortOrder 若省略，本工具會用「目前現有頁籤裡最大的 sortOrder + 1」當預設值
 * （單純方便使用，不是後端行為）；status 省略預設 enabled。name 依 rajah `@Rules "Required;"`
 * （activity_back_office.rajah:1150 附近 model ActivityTab）為必填，建立時至少要帶一組
 * {code, value}；修改時省略 name 則沿用現值，若有帶則採逐語系合併（沿用其他既有語系、只覆蓋
 * 你有帶到的語系），不是整包覆蓋 name 陣列。
 *
 * --- dev 驗證（2026-08-25，pk-platform.alddev.com，帳號 landon001；透過獨立 spike script，用
 *     @modelcontextprotocol/sdk 的 Client + StdioClientTransport 直接 spawn 本 worktree 的
 *     src/stdio.ts 呼叫真正的 tool，不經過目前 Claude Code session 的 MCP 連線設定）---
 * 1. 新增（不帶 id/status/sortOrder）：成功，id=1046（新分配）、sortOrder=17（呼叫前現有最大值
 *    為 16，+1 正確）、status=1（enabled 預設正確）、name=[{zh-CN, ...}]。反推新 id 邏輯正確
 *    辨識出唯一新增的 id。
 * 2. 修改剛建立的 id=1046，只帶 sortOrder=999：成功，sortOrder 變 999，status/name 維持原值
 *    （驗證「只覆蓋有帶的欄位」正確）。
 * 3. 再修改同一筆，只帶 status='disabled'：成功，status 變 2，sortOrder 維持 999、name 維持原值
 *    （驗證多次獨立編輯不會互相覆蓋掉未帶欄位）。
 * 4. 再修改同一筆，只帶 name=[{en-US, ...}]（原本只有 zh-CN）：成功，結果 name 陣列同時有
 *    en-US 與 zh-CN 兩筆——驗證逐語系合併正確，不是整包覆蓋。
 * 5. 對不存在的 id（999999999）呼叫：本工具在送出 RPC 前就先擋下，回傳明確錯誤訊息，未呼叫
 *    後端 RPC（驗證檔頭「id 不存在時客戶端先擋」的敘述屬實）。
 * 6. 新增但省略 name：本工具擋下，回傳「name 為必填」，未呼叫後端 RPC。
 *
 * **已知限制，如實記錄**：這組 rajah service 沒有 Delete 方法（只有 Create/Update/Toggle），
 * 測試建立的 id=1046 無法真正刪除，只能透過本工具自己設成 disabled 並用明顯可辨識的名稱
 * （"iago-spike-測試頁籤"/"iago-spike-test-tab"）留在 dev 環境，目前已是 disabled 狀態。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { ActivityTab } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { ACTIVE_STATUS_MAP } from '../const.ts';

const localizedTextSchema = z.array(z.object({
    code: z.string().describe('語系代碼，例如 zh-CN、zh-TW、en-US'),
    value: z.string().describe('該語系下的文字值'),
}));

function mergeLocalizedStrings(
    entries: { code: string; value: string }[] | undefined,
    existing: { code?: string | null; value?: string | null }[] | null | undefined,
): { code: string; value: string }[] {
    const merged = (existing ?? []).map((ls) => ({ code: ls.code ?? '', value: ls.value ?? '' }));
    if (!entries) return merged;

    for (const { code, value } of entries) {
        const idx = merged.findIndex((ls) => ls.code === code);
        if (idx !== -1) merged[ idx ] = { code, value };
        else merged.push({ code, value });
    }

    return merged;
}

export function registerCreateOrUpdateActivityTabTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_activity_platform_create_or_update_activity_tabs',
        {
            title: 'Create or update one activity tab on this platform',
            description:
                '新增或修改本平台的一筆活動頁籤（rajah: ActivityPlatform.CreateOrUpdateActivityTabs，' +
                '需要權限節點 BonusCenter.Activity.Config.ActTab.Ops.Edit；對應後台「優惠中心 > ' +
                '活動管理」的活動欄目管理彈窗）。不帶 id（或 id=0）表示新增，' +
                '帶既有 id 表示修改。修改時本工具會先呼叫 GetActivityTabs 讀現值，只覆蓋你有帶到的' +
                '欄位（status/sortOrder/name），其餘維持原值；name 若有帶，採逐語系合併（只覆蓋你' +
                '帶到的語系代碼，其餘語系維持原值），不是整包覆蓋。id 不存在時本工具會先擋下並回報' +
                '錯誤，不會送出 RPC（後端對不存在的 id 是靜默略過、不報錯也不新增，直接呼叫容易誤判' +
                '成功）。新增時 name 為必填（至少一組 {code, value}），sortOrder 省略時預設為目前' +
                '最大 sortOrder + 1，status 省略時預設 enabled。' +
                '⚠️ 後端沒有回傳新建頁籤的 id（RPC 回應是空的）：本工具用「寫入前後 GetActivityTabs ' +
                '差異」反推新 id，正常情況能唯一辨識；若偵測到同時間有其他人也在新增（前後差異不只 ' +
                '1 筆新 id），會列出全部候選 id、不會用猜的。' +
                '省略某筆既有頁籤不會受影響（既不會被刪除、也不會被當成要刪除的差異）——這是這支批次' +
                'RPC 的既有語意，不是本工具限制。id 供本工具與其他頁籤 tool 使用的查詢入口是 ' +
                'aladdin_platform_activity_platform_get_activity_tabs。' +
                'prod 執行前確認：當這個 server 是正式環境（prod）時，執行本工具前必須先用 ' +
                'AskUserQuestion（或功能相同的方式）明確詢問使用者是否要在正式環境執行這個操作，取得' +
                '明確同意後才可以帶上 confirm 參數；絕不能自行假設使用者同意。非 prod 環境不需要、也' +
                '會忽略 confirm 欄位。',
            inputSchema: {
                id: z.number().int().min(0).optional().describe('要修改的頁籤 id（來自 aladdin_platform_activity_platform_get_activity_tabs）；省略或 0 表示新增一筆'),
                status: z.enum([ 'enabled', 'disabled' ]).optional().describe('頁籤狀態；修改時省略沿用現值，新增時省略預設 enabled'),
                sortOrder: z.number().int().optional().describe('排序（數字越小越前面，依既有資料觀察）；修改時省略沿用現值，新增時省略預設為目前最大 sortOrder + 1'),
                name: localizedTextSchema.optional().describe('頁籤名稱多語系陣列；新增時必填（至少一組），修改時省略沿用現值、有帶則逐語系合併'),
                confirm: z.string().optional().describe(
                    `正式環境（prod）專用的強制確認欄位；非 prod 環境會被忽略、不需提供。當這個 server 是正式環境時，` +
                    `必須先取得使用者明確同意，再帶上精確字串 "${ PROD_CONFIRM_TOKEN }" 才會執行，否則本工具會拒絕執行並回錯誤。`,
                ),
            },
        },
        async ({ id, status, sortOrder, name, confirm }) => {
            assertProdConfirmed(confirm);

            const beforeR = await withAutoRelogin(() => remote.activityBackOffice.activityPlatform.GetActivityTabs());
            if (beforeR.failed) return asErrorResult(beforeR);
            const beforeRows = beforeR.data?.rows ?? [];

            const isEdit = id !== undefined && id > 0;
            let current: (typeof beforeRows)[number] | undefined;

            if (isEdit) {
                current = beforeRows.find((r) => r.id === id);
                if (!current) {
                    return asTextResult({
                        success: false,
                        message: `找不到 id=${ id } 的頁籤，未送出更新請求（後端對不存在的 id 是靜默略過、不會報錯也不會新增，直接呼叫容易誤判成功，本工具先擋下）`,
                    });
                }
            }

            if (!isEdit && (!name || name.length === 0)) {
                return asTextResult({ success: false, message: '新增頁籤時 name 為必填（至少一組 {code, value}）' });
            }

            const maxSortOrder = beforeRows.reduce((max, r) => Math.max(max, r.sortOrder ?? 0), 0);

            const nextStatus = status !== undefined ? ACTIVE_STATUS_MAP[ status ] : (current?.status ?? ACTIVE_STATUS_MAP.enabled);
            const nextSortOrder = sortOrder !== undefined ? sortOrder : (current?.sortOrder ?? maxSortOrder + 1);
            const nextName = mergeLocalizedStrings(name, current?.name);

            const row = ActivityTab.create({
                id: id ?? 0,
                status: nextStatus,
                sortOrder: nextSortOrder,
                name: nextName,
            });

            const updateR = await withAutoRelogin(() => remote.activityBackOffice.activityPlatform.CreateOrUpdateActivityTabs([ row ]));
            if (updateR.failed) return asErrorResult(updateR);

            const afterR = await withAutoRelogin(() => remote.activityBackOffice.activityPlatform.GetActivityTabs());
            if (afterR.failed) {
                return asTextResult({
                    success: true,
                    message: 'RPC 回報成功，但寫入後讀回驗證失敗，無法確認實際結果',
                    verifyError: { errorCode: afterR.errorCode, message: afterR.message },
                });
            }
            const afterRows = afterR.data?.rows ?? [];

            if (isEdit) {
                const after = afterRows.find((r) => r.id === id);
                return asTextResult({
                    success: true,
                    message: after ? '修改完成' : '寫入 RPC 已成功，但讀回時比對不到這個 id，可能是寫入與讀回之間該筆被同時間的其他操作刪除，請自行用 get_activity_tabs 確認目前狀態',
                    tab: after ?? null,
                });
            }

            const beforeIds = new Set(beforeRows.map((r) => r.id));
            const newIds = afterRows.filter((r) => !beforeIds.has(r.id)).map((r) => r.id);
            if (newIds.length === 1) {
                const created = afterRows.find((r) => r.id === newIds[ 0 ]);
                return asTextResult({ success: true, message: '新增完成', tab: created ?? null });
            }
            return asTextResult({
                success: true,
                message: newIds.length === 0
                    ? '新增完成，但寫入後讀回比對不到新增的頁籤（可能被同時間的其他操作影響），請自行用 get_activity_tabs 確認'
                    : `新增完成，但無法唯一辨識新建的頁籤 id（偵測到 ${ newIds.length } 筆新 id，可能有其他人同時也在新增），候選 id 列於 candidateIds`,
                candidateIds: newIds,
            });
        },
    );
}
