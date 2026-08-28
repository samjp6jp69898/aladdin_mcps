/**
 * tools/list_user_level_strategies.ts — aladdin_platform_strategy_get_list
 *
 * rajah: Strategy.GetList（user_level_back_office.rajah:210，@LoginRequired、無 @Permission）——
 * 列出本平台「會員層級」的全部層級策略（自動層級策略 + 三種固定層級識別策略）。
 *
 * 2026-08-28 讀 agrabah 後端原始碼查證
 * （agrabah/src/servers/user_level_back_office/services/strategy.ts:43-107，methodGetList）：
 * 真的查 DB（DbUserLevelStrategy，以 context.platformId 篩選、priority asc 排序），非 placeholder；
 * 無參數、不分頁——策略是平台層級的小型列舉表（四種 UserLevelStrategyTypeEnum），數量不會成長。
 *
 * 分類（method-category-checklist.md 第 2 節「讀取清單」）：完全不分頁的全撈，但底層不是會持續
 * 成長的歷史/log 表（每個平台的策略筆數等於策略種類數），屬該節「小型列舉表可放心用」的情形。
 *
 * 後端已知行為（讀 source 得到，寫進 description 避免呼叫端誤判）：
 * - rules / depositAmountAmount / validBetAmount 任一層 DB 讀取失敗時，後端「降級為空陣列 +
 *   logger.info」而不回錯誤（strategy.ts:53-55、64-66、74-76、84-86），所以看到空陣列時
 *   **無法分辨「本來就沒設定」與「DB 讀取失敗被降級」**，這是後端既有行為，本 tool 不代為掩飾。
 * - type 為 notLoggedIn/noDeposit 且該策略一條 rule 都沒有時，後端回傳一條**全空的預設 rule**
 *   （id=0 的 UserLevelStrategyRule.create()，strategy.ts:57-59），不是空陣列——這是給前端表單
 *   預留一列可填欄位用的，不代表 DB 裡真的有這條規則。
 * - targetIds 只有 notLoggedIn/noDeposit 兩種策略會讀（strategy.ts:96-104），其餘策略維持空陣列。
 * - **targetIds 的失敗判斷有後端 bug**：strategy.ts:98 的 `if (loadResult.failed)` 用的是外層迴圈
 *   先前查 rules 用的 `loadResult`，不是這一次查 targetIds 的 `linkResult`（變數 shadowing，
 *   agrabah 原始碼註解本身也標了 [TBD]）。後果：targetIds 自己那次查詢失敗時不會走降級分支，
 *   反而會把 linkResult.data（可能是 undefined）直接指派上去；反過來若 rules 查詢失敗，
 *   targetIds 會被清成空陣列而與它自己的查詢結果無關。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { deepFixLongs } from '../const.ts';

export function registerListUserLevelStrategiesTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_strategy_get_list',
        {
            title: "List the current platform's user level strategies",
            description:
                '列出本平台全部會員層級策略與其底下的規則（rajah: Strategy.GetList，' +
                '後台「會員管理」→「會員層級」的層級自動化策略／層級識別策略設定）。' +
                '無參數、不分頁，一次回傳該平台所有策略（依 priority 由小到大排序）。' +
                'type 是 UserLevelStrategyTypeEnum（auto=0 自動層級策略／notLoggedIn=1 未登入／' +
                'noDeposit=2 未存款／rechargeFailed=3 連續充值失敗）；switch 與各條件的 ' +
                'depositCountSwitch/depositAmountSwitch/validBetSwitch/withdrawalCountSwitch ' +
                '都是 ActiveStatusEnum（enabled=1／disabled=2）；各 *Scope 是 StrategyRuleScopeEnum' +
                '（FullLife=0 生涯全部／ThirtyDays=1／FifteenDays=2／SevenDays=3／ThisLevel=4 本層級）。' +
                'rule 的 userLevelId 是來源層級（0 代表所有層級，auto 策略不使用）、targetLevelId 是目標層級，' +
                '兩者的合法 id 用 aladdin_platform_user_level_get_name_list 查。' +
                'depositAmountAmount／validBetAmount 是多幣別 CurrencyLink 陣列（每筆含 code 幣別代碼與 value）；' +
                '**value 是 stored 值、不是人類可讀金額**（依該幣別精度縮放，常見 ÷10000），本工具不做換算。' +
                '注意兩個後端既有行為：(1) 後端讀 rules 或幣別額度失敗時會**降級回空陣列而不報錯**，' +
                '所以空陣列無法分辨「沒設定」與「讀取失敗」；(2) notLoggedIn／noDeposit 策略沒有任何規則時，' +
                '後端會回一條 id=0 的全空預設 rule 供前端表單填寫，不代表 DB 裡真有這條規則。' +
                '另外 targetIds（策略套用的層級清單）**只有 notLoggedIn／noDeposit 兩型策略會讀取**，' +
                'auto／rechargeFailed 兩型必然是空陣列，那不是讀取失敗。' +
                '**targetIds 還有一個後端已知 bug**（strategy.ts:98 誤用外層變數判斷失敗，變數 shadowing）：' +
                '它的空值/失敗語意可能與它自己那次查詢的結果不一致，所以看到 targetIds 為空時' +
                '**不能**推論「這個策略沒有設定套用層級」，需要另外從後台或 DB 確認。' +
                '2026-08-28 dev 實測（pk-platform.alddev.com）回傳真實資料。',
            inputSchema: {},
        },
        async () => {
            const r = await withAutoRelogin(() => remote.userLevelBackOffice.strategy.GetList());
            if (r.failed) return asErrorResult(r);
            return asTextResult({ success: true, rows: deepFixLongs(r.data?.rows ?? []) });
        },
    );
}
