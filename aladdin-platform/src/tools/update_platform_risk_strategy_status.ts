/**
 * tools/update_platform_risk_strategy_status.ts — aladdin_platform_risk_platform_update_platform_risk_strategy_status
 *
 * rajah: RiskPlatform.UpdatePlatformRiskStrategyStatus（risk.rajah:67，需要 @Permission
 * "Risk.RiskStrategy.WithdrawTag.Ops.ToggleStatus"）——只切換單一策略的 status，不動其他欄位（tagName/
 * priority/riskLevel/riskStrategyCurrencyConditions 皆不受影響，見 risk_platform.ts:157-179 註解）。
 *
 * 2026-08-25 讀 agrabah 後端原始碼查證（common/database_helper.ts:25-49 的 updateStatus()）＋
 * dev 站台實測（pk-platform.alddev.com，id=1042「測試」策略）：
 * - id 不存在或屬於別的平台（`WHERE id = ? AND platform_id = ?`，此處 platformId 恆為
 *   context.platformId > 0，故一定會加上這個過濾）時，SQL 影響列數為 0，回 errorCode=14
 *   （objectNotFound）——實測確認，含跨平台 id 案例（用別平台的 id 呼叫，行為等同 id 不存在）。
 * - **同值呼叫（新狀態＝目前狀態）已實測成功**，不是原先依 MySQL 預設行為推論擔心的
 *   「影響列數 0 → 誤判成 objectNotFound」——這個專案的 mysql2 連線預設就帶 FOUND_ROWS
 *   capability flag（node_modules/mysql2/lib/connection_config.js 的 getDefaultFlags()），
 *   affectedRows 語意是「matched rows」而非「changed rows」，結構性保證同值呼叫不會被誤判
 *   （比照同一個 aladdin-platform server 內 `update_game_vendor_status.ts:24-50` 的既有實測
 *   結論），可放心重複呼叫同一個目標狀態，不會非預期失敗。
 * - `PlatformRiskStrategyEdit`（GetPlatformRiskStrategyForEdit 的回傳型別）沒有 status 欄位，
 *   無法用它做寫入後 round-trip，改用 GetPlatformRiskStrategies（不分頁全撈）比對 id 讀回驗證。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { STATUS_MAP, STATUS_KEYS } from '../const.ts';

export function registerUpdatePlatformRiskStrategyStatusTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_risk_platform_update_platform_risk_strategy_status',
        {
            title: "Toggle a risk strategy's enabled/disabled status",
            description:
                '切換單一風控策略的啟用/停用狀態（rajah: RiskPlatform.UpdatePlatformRiskStrategyStatus，risk.rajah:67）。' +
                '只改 status 欄位，不影響 tagName/priority/riskLevel/riskStrategyCurrencyConditions（觸發門檻條件）等其他設定。' +
                '停用後既有已寫入的風控事件歷史紀錄不會刪除，後台仍可查到歷史命中；下次風控掃描（TriggerRiskStrategyFromWithdraw）' +
                '不會再套用已停用的策略。' +
                'id 從 aladdin_platform_risk_platform_list_platform_risk_strategies 或 get_platform_risk_strategies 取得，' +
                '只能操作當前登入平台自己的策略（後端強制 platform_id 過濾）。' +
                'status 合法值（rajah StatusEnum）：unknown/enabled/disabled/frozen/deleted，一般啟用/停用只會用到 enabled/disabled。' +
                '2026-08-25 dev 站台實測：id 不存在或屬於別平台時回 errorCode=14（objectNotFound）；' +
                '同值呼叫（目標狀態＝目前狀態）會成功，不會被誤判成失敗，可放心重複呼叫。' +
                'prod 執行前確認（H38）：當這個 server 是正式環境（prod）時，執行本工具前必須先用 AskUserQuestion' +
                '（或功能相同的方式）明確詢問使用者是否要在正式環境執行這個操作，取得明確同意後才可以帶上 confirm 參數；' +
                '絕不能自行假設使用者同意。非 prod 環境（dev/pre/evi）不需要、也會忽略 confirm 欄位。',
            inputSchema: {
                id: z.number().int().describe('風控策略 id，從 list_platform_risk_strategies 或 get_platform_risk_strategies 取得'),
                status: z.enum(STATUS_KEYS).describe('目標狀態：unknown/enabled/disabled/frozen/deleted，一般啟用/停用用 enabled/disabled'),
                confirm: z.string().optional().describe(
                    `正式環境（prod）專用的強制確認欄位；非 prod 環境會被忽略、不需提供。當這個 server 是正式環境時，` +
                    `必須先取得使用者明確同意，再帶上精確字串 "${ PROD_CONFIRM_TOKEN }" 才會執行，否則本工具會拒絕執行並回錯誤。`,
                ),
            },
        },
        async ({ id, status, confirm }) => {
            assertProdConfirmed(confirm);
            const r = await withAutoRelogin(() => remote.risk.riskPlatform.UpdatePlatformRiskStrategyStatus(id, STATUS_MAP[ status ]));
            if (r.failed) return asErrorResult(r);

            // PlatformRiskStrategyEdit（GetPlatformRiskStrategyForEdit 的回傳型別）沒有 status 欄位，改用不分頁的
            // GetPlatformRiskStrategies 讀回全部策略比對 id。
            const listResult = await withAutoRelogin(() => remote.risk.riskPlatform.GetPlatformRiskStrategies());
            const matched = !listResult.failed
                ? listResult.data?.rows?.find((row) => row.id === id)
                : undefined;

            return asTextResult({
                success: true,
                message: '更新成功',
                readBack: matched ?? (!listResult.failed ? { note: '讀回清單中沒找到這個 id，非預期，請人工確認', rows: listResult.data?.rows } : null),
            });
        },
    );
}
