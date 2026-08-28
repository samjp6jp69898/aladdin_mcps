/**
 * tools/get_immediate_user_wagering.ts — aladdin_platform_wagering_user_platform_get_immediate_user_wagering
 *
 * rajah: WageringUserPlatform.GetImmediateUserWagering（wagering_back_office.rajah:445）。
 *
 * **權限：與同 service 的 ListUserWageringsByUser 完全相同——gate 層既不檢查權限節點、
 * 也不檢查登入。** 完整推論鏈（sync_routes.ts:28-31/64-70/108 → gate_types.ts:35-37 →
 * gate_handler_base.ts:281-291）寫在 list_user_wagerings_by_user.ts 檔頭，這裡不重複；
 * 結論一樣：service WageringUserPlatform（同檔 435-436）與本 method 都沒有 @Permission，
 * 所以 route.permissionId=0 且 route.loginRequired=0，mustLogin 為 false。
 *
 * 分類（method-category-checklist.md 第 1 節「讀取單筆」）：吃單一 userId、回傳單一 model。
 * - **「Get 前綴不保證唯讀」查證結果：真唯讀。** methodGetImmediateUserWagering
 *   （agrabah/src/servers/wagering_back_office/services/wagering_platform.ts:1018-1083）只有
 *   AppUserInternal.GetAppUserInfo（讀）+ 一次 queryOne 聚合 SELECT（同檔 1040-1058），
 *   無任何寫入、無 audit、無 cache 寫入。與同 domain 的 get_manual_add_user_wagering_info
 *   （會 lazy-init 錢包）、get_wagering_setting（會 lazy-init 設定列）不同。
 * - **id 不存在的行為**：GetAppUserInfo 失敗即回傳，errorCode 204 userNotExists（實測確認）。
 * - **跨租戶**：platformId 取自 context（同檔 1019），SQL 的 WHERE 帶 platform_id（同檔 1049），
 *   呼叫端無法指定。
 *
 * 第 8 節（PII，橫切分類）評估：回傳只有幣別代碼、五個計數（頂層 pendingCount + 巢狀四個）與一個 timestamp，
 * 無 identifier／realName／帳號／token 類欄位，不觸發遮罩要求。
 *
 * 回傳樹裡唯一的 i64 是 updatedAtTimestamp（rajah:330），需要 deepFixLongs；
 * 五個 count 都是 i32、currencyCode 是 string，不需要。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { deepFixLongs } from '../const.ts';

export function registerGetImmediateUserWageringTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_wagering_user_platform_get_immediate_user_wagering',
        {
            title: 'Get one member\'s wagering summary counts (member-detail panel)',
            description:
                '取單一會員的稽核狀況摘要（筆數統計），對應後台會員管理→會員詳情頁裡點開的「即時稽核」彈窗' +
                '（abu/platform/src/pages/users/dialog/UserImmediateWageringPopup.vue，' +
                '由 pages/users/user_detail/UserDetailBasic.vue:30 開啟；' +
                'agrabah doc comment 說的「詳情頁頂部面板」與實際 UI 不符，不要採信）' +
                '。rajah: WageringUserPlatform.GetImmediateUserWagering。回的是**筆數**不是金額，' +
                '要金額請用 aladdin_platform_wagering_platform_get_manual_add_user_wagering_info' +
                '（未稽核總額）或 aladdin_platform_wagering_platform_get_user_un_wagering_detail（逐筆明細）。' +
                '2026-08-28 讀 agrabah 原始碼查證（agrabah/src/servers/wagering_back_office/services/' +
                'wagering_platform.ts:1018-1083）並實打 dev 驗證，以下五點務必先看清楚：' +
                '**(1) 這支在 gate 層既不檢查權限節點、也不檢查登入**——與同 service 的 ' +
                'aladdin_platform_wagering_user_platform_list_user_wagerings_by_user 情況完全相同' +
                '（service WageringUserPlatform 與本 method 都沒有 @Permission，導致 permissionId=0 ' +
                '且 loginRequired=0，gate 的 mustLogin 為 false）。呼叫端請自行確認操作者本來就該' +
                '看得到這位會員的資料，不要假設後端替你把過關。' +
                '**(2) 三個 pendingCount 不是同一個東西，不要假設頂層等於下面兩個相加**——' +
                '頂層 info.pendingCount 統計的是該會員**所有 wageringType** 的 pending 筆數；' +
                'depositInfo / discountInfo 底下的 pendingCount 只統計各自那一組 wageringType，' +
                '是頂層的子集，所以關係是「頂層 >= 兩者相加」，只有在該會員恰好只有充值與 VIP 禮金' +
                '兩類稽核時才會剛好相等。dev 實測就是不相等的情況：頂層 53、depositInfo 24、' +
                'discountInfo 0（53 > 24 + 0），其餘 29 筆屬於既非充值也非 VIP 禮金的類型' +
                '（本 method 不回傳類型組成，無法從回傳值判斷是哪些；要知道請用 ' +
                'aladdin_platform_wagering_platform_list_user_wagerings 看 rows[].wageringType）。' +
                '**(3) completedCount 的「completed」其實是「不再是 pending」**——SQL 用的是 ' +
                '`status IN (completed, autoRemove, manualRemove)`（同檔 1028），也就是說' +
                '**被自動解除或被後台手動解除的稽核，也會被算進 completedCount**，' +
                '不代表這位會員真的把打碼量打完了。要區分是「打完」還是「被解除」，' +
                '請改用 aladdin_platform_wagering_platform_list_user_wagerings 看每筆的 status ' +
                '（但 completed 該值後端無條件剔除、篩不到，只能靠 autoRemove/manualRemove 反推）。' +
                '**(4) deposit 與 discount 各自涵蓋哪些類型是後端寫死的**（同檔 1029-1039）：' +
                'depositInfo 只含 wageringType=1（paymentDeposit 充值）；' +
                'discountInfo 只含 wageringType 2-7（vipUpgrade 晉級／vipDay 每日／vipWeek 每週／' +
                'vipMonth 每月／vipBirth 生日／vipHoliday 節日，全部是 VIP 禮金）。' +
                '「優惠」在這裡**只涵蓋 VIP 禮金**，不含活動彩金（9）、返水（10）、優惠中心充值優惠（40）等' +
                '其他直覺上也算優惠的類型——那些只會被算進頂層 pendingCount。' +
                '**(5) 統計範圍限該會員自身幣別**——SQL 的 WHERE 帶 `currency_code = 該會員的 currencyCode`' +
                '（同檔 1049），回傳的 info.currencyCode 就是這個幣別；多幣別會員的其他幣別不列入。' +
                'updatedAtTimestamp 是該會員（該幣別）**全部**稽核紀錄的 MAX(updated_at)，' +
                '不限 pending、也不限 deposit/discount；單位是毫秒 epoch；完全沒有紀錄時為 0。' +
                '本工具純讀取，內部只有一次讀取型 RPC + 一次聚合 SELECT，無任何寫入。',
            inputSchema: {
                userId: z.number().int().min(1).describe(
                    '會員 id（不是會員帳號字串）。用帳號換 id 建議用 ' +
                    'aladdin_platform_activity_platform_get_user_id_by_identifier（純查詢、無副作用）。' +
                    '查無此會員會回 errorCode 204 userNotExists',
                ),
            },
        },
        async ({ userId }) => {
            const r = await withAutoRelogin(() => remote.wageringBackOffice.wageringUserPlatform.GetImmediateUserWagering(userId));
            if (r.failed) return asErrorResult(r);

            return asTextResult({
                success: true,
                info: deepFixLongs(r.data?.info ?? null),
                notes: {
                    pendingCount: '頂層 pendingCount 是「所有 wageringType」的 pending 筆數，'
                        + 'depositInfo/discountInfo 只算各自那組類型、是它的子集，'
                        + '所以關係是「頂層 >= 兩者相加」，不保證相等（只有該會員恰好只有這兩類稽核時才相等）',
                    completedCount: '這裡的 completed 是 status IN (completed, autoRemove, manualRemove)，'
                        + '也就是「不再是 pending」——被自動/手動解除的也算進去，不代表真的打完打碼量',
                    coverage: 'depositInfo 只含 wageringType=1（充值）；discountInfo 只含 2-7（VIP 各類禮金）。'
                        + '活動彩金/返水/優惠中心優惠等其他類型不在這兩組內，只計入頂層 pendingCount',
                    scope: '統計限該會員自身 currencyCode。updatedAtTimestamp 是該幣別全部稽核紀錄的 '
                        + 'MAX(updated_at)（不限狀態與類型），毫秒 epoch，無紀錄時為 0',
                },
            });
        },
    );
}
