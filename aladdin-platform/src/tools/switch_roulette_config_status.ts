/**
 * tools/switch_roulette_config_status.ts — aladdin_platform_roulette_platform_switch_roulette_config_status
 *
 * rajah: RoulettePlatform.SwitchRouletteConfigStatus(id i32 1, status StatusEnum 2) ()
 * （rajah/services/roulette_back_office.rajah:325，@Permission "BonusCenter.Lottery.LotteryConfig.Status.Toggle"，
 * 非 @NoPublic）
 *
 * method-category-checklist.md 第 0 節排除規則已過：agrabah 對應 Service
 * （agrabah/src/servers/roulette_back_office/services/roulette_platform.ts:277-321，
 * methodSwitchRouletteConfigStatus）確認有真實 override、真的 updateObject 寫 DB，非 notImplemented。
 *
 * 分類：第 6 節「寫入 — 狀態轉換」。逐項檢查結果：
 * - **不是無參數 bit-flip**：`Switch` 前綴容易被誤解成「切換到相反狀態」，實作要求呼叫端明確帶
 *   目標 status。依 checklist 第 6 節「不要在 tool 包裝層自作聰明先查現況再反轉」，本工具把
 *   status 設為必填、不提供任何自動反轉行為。
 * - **非法轉換**：後端只接受 StatusEnum.enabled(1) / disabled(2)，其他值（含 unknown=0、
 *   frozen=3、deleted=10）一律 `ErrorCode.invalidData`。本工具在 zod 層就只開放 enabled/disabled 兩個
 *   字串 key，不讓 agent 送出注定失敗的值。
 * - **冪等性**：實作只做「載入 → 覆寫 status → update」，**沒有**任何 `alreadyEnabled`/
 *   `statusInvalid` 類的重複轉換防呆，把已經 enabled 的設定再設成 enabled 會安靜成功（no-op 寫入 +
 *   多寫一筆 audit log）。2026-08-28 dev 實測確認。
 * - **批量部分失敗**：不適用，本 method 一次只處理單一 id。
 * - **回傳值**：rajah 宣告是空回傳 `()`，client 端 decode 成 Empty；成功與否只能靠 errorCode 判斷，
 *   因此本工具在成功後**強制 round-trip** 呼叫 GetRouletteConfigById 讀回實際 status 一起回報，
 *   不只憑「RPC 沒報錯」就宣稱寫入成功。
 * - **副作用**：後端會寫 audit log（SystemIdEnum.roulette，
 *   PlatformActionIdEnum.rouletteConfigEnable / rouletteConfigDisable），且停用後前台
 *   `SpinRoulette` 會直接拒絕抽獎（roulette_platform.ts:281-283 註解）——這會影響真實玩家能不能抽獎，
 *   description 已明講。
 *
 * 2026-08-28 讀 agrabah 後端原始碼查證（roulette_platform.ts:277-321）：
 * - 查詢/更新皆綁 `platform_id = context.platformId AND id = ?`，id 不存在或屬於別平台回
 *   `ErrorCode.idNotExists`（11）。
 * - `updateObject(dbRouletteConfig, false)` 是把整列讀出來後只改 status 再寫回，不會動到其他欄位。
 *
 * 2026-08-28 dev 實測（pk-platform.alddev.com，帳號 landon001）：見檔案末端 review 附註的
 * 「實測紀錄」——用 id=1030（測試前狀態 disabled）做 disabled→enabled→讀回確認→改回 disabled→
 * 再讀回確認的完整 round-trip，測後狀態已還原成測試前的 disabled，dev 上沒有留下狀態變更；
 * 另外實測了「重複設成同一狀態」（冪等，安靜成功）與 id 不存在（idNotExists）。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { ACTIVE_STATUS_MAP, STATUS_MAP, numberToMapKey } from '../const.ts';

const TARGET_STATUS_KEYS = Object.keys(ACTIVE_STATUS_MAP) as [ keyof typeof ACTIVE_STATUS_MAP, ...(keyof typeof ACTIVE_STATUS_MAP)[] ];

export function registerSwitchRouletteConfigStatusTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_roulette_platform_switch_roulette_config_status',
        {
            title: 'Enable or disable one roulette (lottery) config',
            description:
                '把指定的轉盤設定切換成啟用或停用（rajah: RoulettePlatform.SwitchRouletteConfigStatus，' +
                '需要權限節點 BonusCenter.Lottery.LotteryConfig.Status.Toggle）。' +
                '**這是寫入操作，且會立刻影響真實玩家**：停用後前台抽獎（SpinRoulette）會直接被拒絕。' +
                '**必須明確指定 status**——雖然叫 Switch，後端不是「切到相反狀態」，而是「設成你指定的狀態」，' +
                '本工具刻意不提供自動反轉。status 只接受 enabled / disabled，其他狀態後端回 invalidData。' +
                '**不做重複轉換防呆**：把已經 enabled 的設定再設成 enabled 會安靜成功（等同 no-op 寫入，' +
                '但仍會多寫一筆後台操作日誌），所以呼叫前建議先用 ' +
                'aladdin_platform_roulette_platform_get_roulette_config_by_id 確認現況。' +
                '合法 id 請先用 aladdin_platform_roulette_platform_get_config_name_list 取得，不要猜。' +
                'rajah 宣告本 method 沒有回傳值，因此本工具在寫入成功後會自動 round-trip 讀回該設定的實際 ' +
                'status 一併回報（statusAfter），不只依賴「RPC 沒報錯」判斷成功。',
            inputSchema: {
                id: z.number().int().min(1).describe('轉盤設定 id，來自 get_config_name_list / get_roulette_config_list'),
                status: z.enum(TARGET_STATUS_KEYS).describe('要設定成的目標狀態：enabled(啟用) 或 disabled(停用)。必填，不會自動反轉'),
            },
        },
        async (input) => {
            const r = await withAutoRelogin(() => remote.rouletteBackOffice.roulettePlatform.SwitchRouletteConfigStatus(
                input.id,
                ACTIVE_STATUS_MAP[ input.status ],
            ));
            if (r.failed) {
                return asErrorResult(r, { hint: 'errorCode=11 是 idNotExists（id 不存在或不屬於當前平台）；errorCode 對應 invalidData 代表 status 不是 enabled/disabled' });
            }

            // rajah 宣告空回傳，成功與否無法從回應內容判斷 → 強制讀回確認（checklist 第 6 節）。
            const verify = await withAutoRelogin(() => remote.rouletteBackOffice.roulettePlatform.GetRouletteConfigById(input.id));
            if (verify.failed) {
                return asTextResult({
                    success: true,
                    id: input.id,
                    requestedStatus: input.status,
                    verified: false,
                    message: '狀態切換的 RPC 已成功回應，但回讀確認失敗（見 verifyError），請自行用 get_roulette_config_by_id 覆核',
                    verifyError: { errorCode: verify.errorCode, message: verify.message },
                });
            }

            const statusAfter = numberToMapKey(STATUS_MAP, verify.data?.config?.status ?? 0);
            return asTextResult({
                success: true,
                id: input.id,
                requestedStatus: input.status,
                verified: true,
                statusAfter,
                matched: statusAfter === input.status,
            });
        },
    );
}
