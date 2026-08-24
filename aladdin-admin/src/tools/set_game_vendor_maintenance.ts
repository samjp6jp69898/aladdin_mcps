/**
 * tools/set_game_vendor_maintenance.ts — aladdin_admin_game_vendor_admin_set_game_vendor_maintenance
 *
 * rajah: GameVendorAdmin.SetGameVendorMaintenance（game_back_office.rajah:349，需要權限節點
 * "GameVendor.Vendor.Ops.Maintenance"）——設定某個廠商場館（母表 game_vendors）的維護時間窗口，
 * 操作對象是全平台共用母表，與平台無關，不帶 platformId 參數。
 *
 * 2026-08-24 讀 agrabah 後端原始碼查證（game_vendor_admin.ts:756-782）：
 * - 只吃 id + 兩個 i64 timestamp，直接 `UPDATE game_vendors SET maintenance_start_time = ?,
 *   maintenance_end_time = ? WHERE id = ?`，不涉及讀現值合併（只精準覆蓋這兩個欄位，
 *   不會動到 game_vendors 其他欄位），method-category-checklist.md 第 4 節「先讀現值」
 *   要求不適用於這支（它從結構上就不是整包 upsert，是針對性欄位 SET）。
 * - `maintenanceStartTimestamp`/`maintenanceEndTimestamp` 是 **毫秒 epoch**（後端直接
 *   `new Date(timestamp)`，不是秒），呼叫端不要誤填成秒。
 * - `maintenanceStartTimestamp > maintenanceEndTimestamp` 時回 errorCode=9（invalidData），
 *   不會寫入；start===end 允許（零長度窗口）。
 * - id 不存在（UPDATE 影響列數為 0）時回 errorCode=14（objectNotFound），不會寫入。
 * - **沒有獨立的「開啟/關閉維護」開關**：是否處於維護中（`isMaintaining`）是讀取當下即時
 *   計算的衍生值，規則是 `maintenance_start_time < NOW() AND NOW() < maintenance_end_time`
 *   （database_types/game.ts:69-71，DbGameVendor.isMaintaining getter；ListGameVendors 的
 *   maintenanceStatus 篩選條件用同一組 SQL 判斷）。也就是說：
 *   - 想「立刻開始維護」：start 設成 <= 現在，end 設成未來時間。
 *   - 想「立刻結束/取消維護」：把 end 設成 <= 現在即可（不需要、也沒有另一支方法可用）。
 *   - 想「排一段未來的維護」：start/end 都設成未來，isMaintaining 在 start 到達前仍是 false，
 *     到 start 之後才會變成 true——不是呼叫當下就生效，是後續每次讀取當下比對出來的。
 * - `rajah/services/game_back_office.rajah:296-303` 另外定義了一個 `GameVendorMaintenanceEdit`
 *   model（含 `status`（`@Type "Toggle"`）/`maintenanceStartTimestamp`/`maintenanceEndTimestamp`），
 *   但 `SetGameVendorMaintenance` 這支 method 的實際簽名**不吃這個 model**，直接是三個裸參數、
 *   也沒有 `status` 欄位——這個 model 目前查無其他 method 引用，疑似 rajah 定義與實際 RPC
 *   簽名之間的殘留/漂移，不代表這支 method 真的接受或需要 status 參數。
 * - 沒有回傳值（`Empty`）：寫入成功與否只能看 errorCode，本工具寫入成功後另外呼叫
 *   `ListAllGameVendors()`（不分頁、一次回傳全部場館的 `GameVendorEssential[]`，母表場館
 *   數量是小型列舉規模，可放心全撈，不套 method-category-checklist.md 第 2 節 B 級分頁
 *   掃描規則）讀回比對 id，驗證 maintenanceStartTimestamp/maintenanceEndTimestamp/isMaintaining
 *   確實如預期更新。
 * - 會連帶：audit log（SystemIdEnum.game，gameVendorMaintenanceEnable/Disable，依寫入當下
 *   `maintenanceEndTimestamp > Date.now()` 判斷）+ 發佈 `RefreshGameCache` message（platformId=0，
 *   全域快取失效通知），這兩項是背景動作，不影響本工具回傳結果。
 *
 * 2026-08-24 dev 實測（bun 直打 GameVendorAdmin.SetGameVendorMaintenance，未透過本 MCP tool，
 * host 尚未掛載）：見 dev_verification_evidence，涵蓋設定未來窗口、設定「現在進行中」窗口（驗證
 * isMaintaining 變 true）、start>end 應回 invalidData、id 不存在應回 objectNotFound 四種情境，
 * 並用 ListAllGameVendors 讀回驗證欄位、測完還原原值。過程中發現兩個文件上查不到、只能實測才
 * 知道的行為，已反映在下面與 description 裡：
 * 1. **毫秒精度會被後端無聲捨去到整秒**：DB 欄位對 maintenance_start_time/maintenance_end_time
 *    沒有次秒精度，寫入後讀回的值與送出值可能差到 999ms（實測有四捨五入到最近整秒的現象），
 *    不是本工具或 rajah 定義的問題，呼叫端不應期待逐毫秒精確往返。
 * 2. **ListAllGameVendors 回傳的 timestamp 欄位在 runtime 是 protobufjs Long 物件**
 *    （`{low, high, unsigned}`），跟宣告型別 `number` 不符——直接 JSON.stringify 會印出這個
 *    物件而不是可讀的 epoch ms。本工具在組裝 readBack 時用 `Number(...)` 轉換過，避免把這個
 *    物件原樣丟給 agent。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerSetGameVendorMaintenanceTool(server: McpServer): void {
    server.registerTool(
        'aladdin_admin_game_vendor_admin_set_game_vendor_maintenance',
        {
            title: "Set a game vendor's maintenance time window",
            description:
                '設定某個廠商場館（全平台共用母表 game_vendors）的維護時間窗口（rajah: ' +
                'GameVendorAdmin.SetGameVendorMaintenance，需要權限節點 GameVendor.Vendor.Ops.Maintenance）。' +
                '與平台無關，不帶 platformId 參數。id 從 aladdin_admin_game_vendor_admin_list_game_vendors 取得。' +
                'maintenanceStartTimestamp/maintenanceEndTimestamp 都是**毫秒 epoch**（不是秒），後端直接 ' +
                'new Date(timestamp) 使用，填成秒會被解讀成 1970 年附近的時間。' +
                '這支方法只精準覆蓋 game_vendors 的 maintenance_start_time/maintenance_end_time 兩欄，' +
                '不會動到場館的其他欄位（adapter/name/exchangeRate 等），不需要先讀現值合併。' +
                '**沒有獨立的開啟/關閉開關**：是否處於維護中（isMaintaining）是每次讀取當下即時計算的衍生值' +
                '（規則：maintenance_start_time < 現在 < maintenance_end_time）——想立刻開始維護，start 設成 ' +
                '現在或更早、end 設成未來；想立刻結束/取消維護，把 end 設成現在或更早即可，沒有另一支「取消維護」' +
                '方法；想排一段未來的維護，start/end 都設成未來，isMaintaining 會在 start 時間到達後才變 true' +
                '（不是呼叫當下就生效）。' +
                'start > end 時回 errorCode=9（invalidData），不會寫入；start === end 允許（零長度窗口）。' +
                'id 在母表不存在時回 errorCode=14（objectNotFound），不會寫入。' +
                '2026-08-24 dev 實測發現：後端 DB 欄位對這兩個時間沒有次秒精度，寫入後讀回的值可能與送出值' +
                '差到 999ms（四捨五入到整秒），不要預期逐毫秒精確往返。' +
                '沒有回傳值，寫入成功後本工具改用 aladdin_admin_game_vendor_admin_list_game_vendors 背後的 ' +
                'ListAllGameVendors（不分頁、一次回傳全部場館）讀回驗證，回傳的 readBack.maintenanceStartTimestamp/' +
                'maintenanceEndTimestamp 已轉換成一般數字（後端原始回傳在這兩個欄位是 protobufjs Long 物件，' +
                '本工具已代為轉換，呼叫端不需自行處理）。' +
                '注意：rajah 另外定義了一個 GameVendorMaintenanceEdit model（含 status 欄位），但這支 method ' +
                '實際簽名不吃這個 model、也沒有 status 參數，那個 model 目前查無其他 method 引用，疑似定義與' +
                '實際 RPC 簽名之間的殘留/漂移，不代表這支方法接受或需要 status。' +
                'prod 執行前確認（H36）：當這個 server 是正式環境（prod）時，執行本工具前必須先用 AskUserQuestion' +
                '（或功能相同的方式）明確詢問使用者是否要在正式環境執行這個操作，取得明確同意後才可以帶上 confirm 參數；' +
                '絕不能自行假設使用者同意。非 prod 環境（dev/pre/evi）不需要、也會忽略 confirm 欄位。',
            inputSchema: {
                id: z.number().int().describe('廠商場館 id（母表 game_vendors 的內部流水號），來自 aladdin_admin_game_vendor_admin_list_game_vendors 的回傳結果'),
                maintenanceStartTimestamp: z.number().int().describe('維護開始時間，毫秒 epoch（非秒）。必須 <= maintenanceEndTimestamp，否則回 invalidData'),
                maintenanceEndTimestamp: z.number().int().describe('維護結束時間，毫秒 epoch（非秒）。想立刻結束/取消維護，把這個值設成現在或更早即可'),
                confirm: z.string().optional().describe(
                    `正式環境（prod）專用的強制確認欄位；非 prod 環境會被忽略、不需提供。當這個 server 是正式環境時，` +
                    `必須先取得使用者明確同意，再帶上精確字串 "${ PROD_CONFIRM_TOKEN }" 才會執行，否則本工具會拒絕執行並回錯誤。`,
                ),
            },
        },
        async ({ id, maintenanceStartTimestamp, maintenanceEndTimestamp, confirm }) => {
            assertProdConfirmed(confirm);
            const r = await withAutoRelogin(() => remote.gameBackOffice.gameVendorAdmin.SetGameVendorMaintenance(id, maintenanceStartTimestamp, maintenanceEndTimestamp));
            if (r.failed) return asErrorResult(r);

            // 沒有帶 status 的單筆查詢方法，改用不分頁的 ListAllGameVendors 讀回全部場館比對 id。
            const listResult = await withAutoRelogin(() => remote.gameBackOffice.gameVendorAdmin.ListAllGameVendors());
            const matched = listResult.success
                ? listResult.data?.rows?.find((row) => row.id === id)
                : undefined;

            // 2026-08-24 dev 實測：maintenanceStartTimestamp/maintenanceEndTimestamp 在 runtime 是
            // protobufjs Long 物件（{low, high, unsigned}），不是宣告型別 number，JSON.stringify
            // 直接印會露出這個物件，Number(long) 可正確轉成 epoch ms（Long 有 valueOf）。
            const readBack = matched
                ? {
                    ...matched,
                    maintenanceStartTimestamp: Number(matched.maintenanceStartTimestamp),
                    maintenanceEndTimestamp: Number(matched.maintenanceEndTimestamp),
                }
                : (listResult.success ? { note: '讀回清單中沒找到這個 id，非預期，請人工確認', rows: listResult.data?.rows } : null);

            return asTextResult({
                success: true,
                message: '設定成功',
                readBack,
            });
        },
    );
}
