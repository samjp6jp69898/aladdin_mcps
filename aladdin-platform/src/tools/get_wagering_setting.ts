/**
 * tools/get_wagering_setting.ts — aladdin_platform_wagering_platform_get_wagering_setting
 *
 * rajah: WageringPlatform.GetWageringSetting（wagering_back_office.rajah:421，
 * method 級 @Permission "Finance.Wagering.Setting"，無參數，單例設定）。
 *
 * 分類（method-category-checklist.md 第 1 節「讀取單筆」）：無參數、回傳單一 model 的單例設定。
 *
 * **「Get 前綴不保證唯讀」的查證結果：有條件寫入（低風險，但要據實記錄）。**
 * 呼叫鏈：methodGetWageringSetting（agrabah/src/servers/wagering_back_office/services/
 * wagering_platform.ts:672-675）→ wageringManager.getWageringSetting
 * （agrabah/src/managers/wagering_manager.ts:81-102）→ **getOrCreateDbWageringSetting**
 * （同檔 541-561）：查不到本平台的 wagering_setting 列時會 insertObject 建一列預設值
 * （同檔 552-556）。與 get_manual_add_user_wagering_info.ts 那支的錢包 lazy-init 不同的是，
 * 這裡建的是「本平台自己的設定列」、內容就是後端預設值，不涉及任何會員資料，
 * 且平台只要有人開過後台設定頁就已存在。仍在 description 揭露。
 * autoRemoveBalance 那半邊是 currencyLinkManager.queryByIdWithoutError（同檔 94）
 * → currency_link_manager.ts:87-105，只有 loadObjects，純讀取。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { formatCurrencyLinks, STATUS_MAP } from '../const.ts';

/** 給呼叫端看的 autoRemoveSwitch 對照，避免只回一個裸數字。 */
const AUTO_REMOVE_SWITCH_LABELS: Record<number, string> = {
    [ STATUS_MAP.enabled ]: 'enabled（開啟自動解除）',
    [ STATUS_MAP.disabled ]: 'disabled（關閉自動解除）',
};

/**
 * WageringSetting（wagering_back_office.rajah:41-48）的統一輸出形狀：
 * autoRemoveBalance 是 [CurrencyLink]，其 value 是 i64（decode 後是 Long 實例），
 * 用既有的 formatCurrencyLinks 逐筆轉成一般數字；autoRemoveSwitch 是 i32，
 * 由 `...s` 原樣帶出即可，不需要也不該再覆寫一次。
 */
function formatWageringSetting(s: Record<string, unknown>): Record<string, unknown> {
    return {
        ...s,
        autoRemoveSwitchLabel: AUTO_REMOVE_SWITCH_LABELS[ Number(s.autoRemoveSwitch) ] ?? String(s.autoRemoveSwitch),
        autoRemoveBalance: formatCurrencyLinks(s.autoRemoveBalance),
    };
}

export function registerGetWageringSettingTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_wagering_platform_get_wagering_setting',
        {
            title: 'Get platform wagering (audit) auto-remove setting',
            description:
                '讀取本平台「財務」→「稽核」→「設置」頁目前的稽核自動解除設定' +
                '（rajah: WageringPlatform.GetWageringSetting，需要權限節點 Finance.Wagering.Setting）。' +
                '無參數、單例設定，平台由連線本身的登入態決定，不吃也不該吃 platformId。' +
                '**這兩個欄位的業務意義（2026-08-28 讀 agrabah/src/managers/wagering_manager.ts:107-117、' +
                '137、221-258 查證）**：autoRemoveSwitch 是全平台單一開關（不分幣別）；' +
                'autoRemoveBalance 則是**逐幣別**的門檻金額。解除的判斷是把該會員「中心錢包 + ' +
                '各場館餘額」加總，**總餘額小於或等於該幣別門檻**就把他該幣別所有 status=pending 的' +
                '稽核改成 autoRemove（同檔 244-246 是 `if (userAllBalance > autoRemoveBalance) return success`，' +
                '也就是嚴格大於才不解除、**等於時會解除**；實際 UPDATE 在同檔 250-256），' +
                '等於免除他剩下的打碼要求、讓他可以提款。' +
                '**以下三點是這個設定最容易被誤解的地方，請務必看清楚：**' +
                '**(1) 平台開關不是解除的唯一決定因素，會被呼叫端參數雙向覆蓋**——後端邏輯' +
                '（同檔 227-233）是：呼叫端傳 disabled 就直接不解除；呼叫端傳 enabled 就直接往下走' +
                '（**完全不看平台開關**）；只有在呼叫端「兩者都不是」（例如 unknown/0）時才回頭看平台設定。' +
                '而 ManualAddUserWagering 會把後台操作員在彈窗勾的 autoRemoveSwitch 原樣傳進來' +
                '（wagering_platform.ts:540）。所以平台開關 disabled 時操作員仍可讓該筆解除，' +
                '平台開關 enabled 時操作員也可讓該筆不解除。' +
                '**(2) 沒有任何 job 會定期掃描，也不會回溯**——removeUserAllWagering 全 codebase 只有一個' +
                '呼叫點：addUserWagering 內部（wagering_manager.ts:137）。也就是說解除檢查**只在「這位會員' +
                '被新增一筆稽核」的那一刻發生**。把門檻調高確實會讓更多會員符合條件，' +
                '但既有會員不會立刻被釋放，要等他下一次被新增稽核紀錄時才會實際解除。' +
                '（附帶提醒：agrabah 端 wagering_platform.ts:661 的註解寫「其他 server / Job 需要讀取此設置' +
                '執行自動解除邏輯」，但 codebase 裡查無這樣的 Job，該註解不可採信。）' +
                '**(3) 沒出現在 autoRemoveBalance 陣列裡的幣別，門檻等同 0**——後端用 find 找不到就取 0' +
                '（同檔 110-111），而餘額 0 才會 <= 0，實務上等於「該幣別永不自動解除」。' +
                '本工具原樣回傳後端給的陣列，不會替缺席幣別補 0，請自行對照 ' +
                'aladdin_platform_currency_platform_get_currencies 檢查有沒有漏設。' +
                '**值域與單位**：autoRemoveSwitch 是 StatusEnum（common.rajah:1078-1086），' +
                '這裡實際只會用到 1=enabled、2=disabled；後端只特判 disabled（同檔 230），' +
                '任何非 2 的值在內部路徑都等同「不擋」。本平台從未設定過時，新建列吃 ORM 預設值 ' +
                'AutoRemoveSwitchDefault = disabled（agrabah/src/database_types/wagering.ts:106）。' +
                'autoRemoveBalance 是 CurrencyLink 陣列（{code, value}），value 是 **stored 整數**，' +
                'stored = 人類金額 × 10^(decimalPlaces+2)（jafar/src/exchange.ts:32-38），本工具不換算；' +
                '幣別精度查 aladdin_platform_currency_platform_get_currencies 的 decimalPlaces。' +
                '**副作用揭露**：本 method 內部走 getOrCreateDbWageringSetting' +
                '（agrabah/src/managers/wagering_manager.ts:541-561），本平台若還沒有 wagering_setting 列，' +
                '會建一列後端預設值。建的是本平台自己的設定列、不涉及任何會員資料，' +
                '正常情況下（後台設定頁開過一次）早已存在，但仍不宜宣稱本工具完全唯讀。' +
                '要修改請用 aladdin_platform_wagering_platform_update_wagering_setting。',
            inputSchema: {},
        },
        async () => {
            const r = await withAutoRelogin(() => remote.wageringBackOffice.wageringPlatform.GetWageringSetting());
            if (r.failed) return asErrorResult(r);

            const s = r.data?.wageringSetting;
            if (!s) return asTextResult({ success: true, wageringSetting: null });

            return asTextResult({
                success: true,
                wageringSetting: formatWageringSetting(s as unknown as Record<string, unknown>),
                notes: {
                    autoRemoveBalance: '逐幣別門檻，stored 整數（× 10^(decimalPlaces+2)），本工具不換算。'
                        + '會員「中心錢包 + 各場館餘額」總和 <= 門檻時，該幣別所有 pending 稽核會被改成 autoRemove（免除剩餘打碼）。'
                        + '沒出現在這個陣列裡的幣別，後端以門檻 0 計，等於永不自動解除',
                    autoRemoveSwitch: '全平台單一開關，不分幣別（1=enabled、2=disabled）。'
                        + '注意它會被呼叫端參數雙向覆蓋：ManualAddUserWagering 傳入的 autoRemoveSwitch 若明確是 '
                        + 'enabled 或 disabled，就完全不看這個平台設定',
                    trigger: '解除檢查只在「該會員被新增一筆稽核」時發生（addUserWagering → removeUserAllWagering），'
                        + '沒有定期 job、不回溯既有會員',
                },
            });
        },
    );
}
