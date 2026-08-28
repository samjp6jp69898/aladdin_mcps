/**
 * tools/get_turnover_multiplier_setting.ts — aladdin_platform_wagering_platform_get_turnover_multiplier_setting
 *
 * rajah: WageringPlatform.GetTurnoverMultiplierSetting（wagering_back_office.rajah:428）。
 * 方法本身沒有獨立 @Permission，套用 service 級的 @Permission "Finance.Wagering"（同檔 389）。
 * 對照組：同 service 的 UpdateTurnoverMultiplierSetting 有自己的 @Permission
 * "Finance.Wagering.Setting.TurnoverMultiplierSetting"（同檔 430）。
 *
 * 分類（method-category-checklist.md 第 2 節「讀取清單」）：回傳陣列但**完全不分頁**。
 * 該節對不分頁全撈的要求是「若底層是會持續成長的表就要確認有無 LIMIT」——這裡不適用：
 * 底層 turnover_multiplier_setting 有 UNIQUE INDEX uk_platform_id_turnover_type
 * （agrabah/migrations/wagering/202601211708_create_wagering_table.sql:27），每平台每類型至多一列，
 * 是設定表不是 log 表。實際列數＝TurnoverTypeEnum 成員數（common.rajah:1770-1779，目前 4 個）
 * 加上「曾被寫入過的未知 turnoverType 數」——UpdateTurnoverMultiplierSetting 不驗 enum 值域就
 * insert（wagering_platform.ts:813-817），所以不能說「恆等於 4」，但上界是 TINYINT 值域、
 * 仍屬極小固定集合，非成長型資料。
 *
 * **「Get 前綴不保證唯讀」的查證結果：這一支是真唯讀**（本 domain 前兩支設定/資訊類 Get 都有
 * lazy-init 寫入，這支特地逐行確認過，結論相反，所以值得寫下來）：
 * methodGetTurnoverMultiplierSetting（agrabah/src/servers/wagering_back_office/services/
 * wagering_platform.ts:758-780）只呼叫 wageringManager.getTurnoverMultiplierList
 * （agrabah/src/managers/wagering_manager.ts:326-328），那支是單純的 loadObjects；
 * 缺少的 turnoverType 是在**記憶體裡**補上預設值再回傳（wagering_platform.ts:773-778），
 * 沒有寫回 DB。
 * 要特別注意的是同一個 manager 另有一支**單數版** getTurnoverMultiplier（同檔 291-320），
 * 那支在查不到時**會 insertObject 把預設值寫進 DB**（同檔 309-313），但它是消稽核 job 在用的
 * （servers/wagering_back_office/job/eliminate_user_wagering.ts:19），不在本 tool 的呼叫鏈上。
 * 兩支名字只差一個 List，行為卻不同，改動時別看錯。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

/**
 * TurnoverTypeEnum（common.rajah:1770-1779）。目前只有本檔一個消費者，故留在檔案內，
 * 不放 const.ts（依 mcps/README.md 第 2 步：兩支以上 tool 會用到才放 const.ts）。
 */
const TURNOVER_TYPE_LABELS: Record<number, string> = {
    1: 'gameBet（遊戲下注）',
    2: 'roomGift（直播間送禮）',
    3: 'messageBoardGift（大舞台打賞）',
    4: 'agentProxyDeposit（代理代存）',
};

/**
 * 倍率的縮放基數，來源是 `RateHelper.RateBase = 10000.0`（jafar/src/rate_helper.ts:18），
 * 消稽核端就是用 RateHelper.storedToNormal 除它（eliminate_user_wagering.ts:24）。
 * 注意別跟 rajah `const TurnoverMultiplierDefault i32 = 10000`（wagering.rajah:22）搞混——
 * 那個是「沒設定過時的預設值（1 倍）」，數值相同純屬巧合；預設值改了不代表基數跟著改。
 */
const TURNOVER_MULTIPLIER_SCALE = 10000;

export function registerGetTurnoverMultiplierSettingTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_wagering_platform_get_turnover_multiplier_setting',
        {
            title: 'Get platform turnover multiplier setting',
            description:
                '讀取本平台的「打碼倍率設置」——各類交易在消稽核（清打碼量）時各自要乘上多少倍' +
                '（rajah: WageringPlatform.GetTurnoverMultiplierSetting，套用 service 級權限節點 Finance.Wagering）。' +
                '無參數，平台由連線本身的登入態決定。**本工具是真唯讀**，內部只有一次 loadObjects，' +
                '無任何寫入（2026-08-28 逐行查證 agrabah/src/servers/wagering_back_office/services/' +
                'wagering_platform.ts:758-780 與 agrabah/src/managers/wagering_manager.ts:326-328）。' +
                '**(1) 倍率是「實際倍數 × 10000」的整數**——10000 = 1 倍、120000 = 12 倍。' +
                '實際用法在消稽核 job（agrabah/src/servers/wagering_back_office/job/' +
                'eliminate_user_wagering.ts:24-25）：`打碼量 = 該筆交易金額 × (turnoverMultiplier / 10000)`。' +
                '所以倍率調高＝同樣的下注/送禮能清掉更多稽核＝會員更快達成提款門檻，' +
                '這是會影響提款條件的設定，不是顯示設定。' +
                '**(2) 一定會回傳全部 4 種類型，就算 DB 裡沒設過**——後端會用 TurnoverTypeEnum 的完整成員' +
                '去補齊，DB 裡沒有的那幾種在回傳時補上預設值 10000（1 倍）' +
                '（wagering_platform.ts:773-778）。**補值只發生在記憶體，不會寫回 DB**，' +
                '所以你看到 turnoverMultiplier=10000 有兩種可能：真的設成 1 倍，或是從來沒設定過。' +
                '本工具無法區分這兩種情況（後端回傳的形狀完全一樣）。' +
                '**(3) turnoverType 的值域**（common.rajah:1770-1779）：1=gameBet 遊戲下注、' +
                '2=roomGift 直播間送禮、3=messageBoardGift 大舞台打賞、4=agentProxyDeposit 代理代存。' +
                '**(4) gameBet 在業務上是唯讀的，但只有前端一道把關**——abu 後台的打碼倍率設定彈窗' +
                '硬編了 `:readonly="item.turnoverType === TurnoverTypeEnum.gameBet"`' +
                '（abu/platform/src/pages/finance/wagering/TurnoverMultiplierSettingPopup.vue:94-95），' +
                '所以「gameBet 不該被改」是一條真實存在的業務規則。但 **agrabah 後端完全沒有第二道防線**：' +
                'methodUpdateTurnoverMultiplierSetting（wagering_platform.ts:800-855）對 gameBet 沒有任何' +
                '特殊處理、也不驗 turnoverType 的 enum 值域。rajah 雖然有一個名字很像的 ' +
                'TurnoverTypeSettingReadOnlyEnum（wagering_back_office.rajah:289-292，只含 gameBet），' +
                '但除了 generated 檔裡的 enum 宣告外，它只出現在 wagering_platform.ts:755 的一行註解，' +
                '沒有任何判斷邏輯引用它——前端那道把關用的是 TurnoverTypeEnum.gameBet，不是這個 enum。' +
                '結論：繞過前端直接打 RPC 是改得動 gameBet 的，但那會違反業務規則，不要這樣做。' +
                '本工具純讀取，不提供修改能力。',
            inputSchema: {},
        },
        async () => {
            const r = await withAutoRelogin(() => remote.wageringBackOffice.wageringPlatform.GetTurnoverMultiplierSetting());
            if (r.failed) return asErrorResult(r);

            // turnoverType 是 enum、turnoverMultiplier 是 **i32**（wagering_back_office.rajah:62-64），
            // 不是 i64，protobufjs 不會產生 Long 實例，所以這裡刻意不套 toPlainNumber/deepFixLongs
            // ——不是漏了。但 response 的 rows 型別是 ITurnoverMultiplierSetting[]（interface，
            // 欄位皆為 optional），不是同名的 class（那個才是必填 number），所以仍要處理 null/undefined。
            // 實務上後端一定會填這兩欄（wagering_platform.ts:769、774-777），?? 0 只是型別層的保險。
            const rows = (r.data?.rows ?? []).map((row) => {
                const multiplier = row.turnoverMultiplier ?? 0;
                const type = row.turnoverType ?? 0;
                return {
                    turnoverType: type,
                    turnoverTypeLabel: TURNOVER_TYPE_LABELS[ type ] ?? String(type),
                    turnoverMultiplier: multiplier,
                    effectiveMultiplier: multiplier / TURNOVER_MULTIPLIER_SCALE,
                };
            });

            return asTextResult({
                success: true,
                rows,
                notes: {
                    turnoverMultiplier: `原始值，實際倍數 × ${ TURNOVER_MULTIPLIER_SCALE }（${ TURNOVER_MULTIPLIER_SCALE } = 1 倍）。`
                        + 'effectiveMultiplier 是本工具替你除好的實際倍數，僅供閱讀；'
                        + '要寫回去請用原始的 turnoverMultiplier 值',
                    completeness: '一定會回傳全部 4 種 turnoverType。DB 裡沒設過的會被補上 10000（1 倍）再回傳，'
                        + '補值只在記憶體、不寫回 DB——所以 10000 無法區分「真的設成 1 倍」與「從未設定過」',
                    usage: '消稽核時：打碼量 = 該筆交易金額 × (turnoverMultiplier / 10000)。倍率調高＝會員更快清完打碼量',
                },
            });
        },
    );
}
