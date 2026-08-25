/**
 * tools/update_in_house_vendor_status.ts — aladdin_admin_in_house_game_back_office_update_vendor_status
 *
 * rajah: InHouseGameBackOffice.UpdateVendorStatus（in_house_game_back_office.rajah:285）：
 * `method UpdateVendorStatus(vendorId i32 1, status StatusEnum 2) ()`。service 標頭只有
 * `@LoginRequired`、method 本身無 `@Permission`（同 in_house_game_back_office.rajah:266-268 註解，
 * 權限節點已移至 AbuPermissionAdmin/AbuPermissionPlatform——但這支 method 對外沒有掛任何權限節點，
 * 任何已登入本後台的使用者皆可呼叫，跟 GameVendorAdmin.UpdateGameVendorStatus 需要
 * `GameVendor.Vendor.Status.Edit` 權限節點不同，不要誤以為所有狀態切換 method 都需要權限）。
 *
 * 前端實際用法確認只在 Admin：`abu/admin/src/pages/game/two_eight/GameVendorList.vue:110`
 * `api.remote.inHouseGameBackOffice.main.UpdateVendorStatus(vendorId, status)`；全庫搜尋
 * `abu/platform/src/pages` 找不到任何呼叫點，故本 tool 只放 aladdin-admin。
 *
 * === 【重要副作用，已用 dev 實測驗證，比對 agrabah 原始碼 docstring 確認】停用廠商會連鎖停用該廠商
 * 底下所有玩法組 ===
 * agrabah 後端實作（agrabah/src/servers/in_house_game_back_office/services/in_house_game_back_office.ts:1103-1170
 * methodUpdateVendorStatus，docstring 1104 行已明寫「停用時於 transaction 內連鎖停用該廠商底下所有
 * 玩法組（DbInHouseGamePlayGroup），並 clearPlayGroupCache 刷新 cache」）：
 * - `status === StatusEnum.disabled` 時，同一個 transaction 內會額外對 `in_house_game_play_groups`
 *   執行 `updateStatus(tx, vendorId, 0, status, ..., 'vendor_id')`——把該廠商底下**所有**玩法組的狀態
 *   一併改成 disabled（:1129），不管這些玩法組原本是 enabled 還是 disabled。
 * - transaction 成功後另外清除這些玩法組的 Redis cache（:1144-1155）。
 * - `status === StatusEnum.enabled` 時**不會**逆向恢復玩法組狀態（enabled 分支完全不碰
 *   `in_house_game_play_groups` 表）——這是不對稱行為：停用廠商會強制停用旗下全部玩法組，
 *   但重新啟用廠商**不會**自動恢復玩法組原本的狀態，需要另外用
 *   `aladdin_admin_in_house_game_back_office_update_play_group_status`（若已存在）逐一恢復。
 * - `updateStatus`（`agrabah/src/common/database_helper.ts:25-50`）用 UPDATE 影響列數判斷：
 *   `status` 不是合法 `StatusEnum` 值（或 `StatusEnum.last`）回 `errorCode=9`（invalidData）；
 *   影響列數為 0（vendorId 不存在）回 `errorCode=14`（objectNotFound）。
 *
 * `InHouseGameVendorEdit`（GetVendorEdit 的回傳 model）**沒有 status 欄位**，無法用它做寫入後的
 * round-trip 驗證，本 tool 改用 `GetVendorList` 讀回目前狀態（同 update_game_vendor_status.ts 的既有
 * 模式）；停用時額外呼叫 `GetPlayGroupList(vendorId)` 把連鎖影響的玩法組狀態一併讀回附在回應裡，
 * 讓呼叫端不必自己另外查證就能看到完整的連鎖影響範圍。
 *
 * === method-category-checklist.md 分類判定 ===
 * 屬第 6 節「狀態轉換」：帶明確目標狀態參數（不是無參數 bit-flip），非批量。有連鎖副作用（見上），
 * description 已明確揭露。
 *
 * === 2026-08-25 dev 實測（admin.alddev.com，帳號 landon001，VPN 已恢復）===
 * 選用 vendorId=2（get_in_house_vendor_list 實測的「未使用」佔位廠商）。**選用前用
 * get_in_house_play_group_list(vendorId=2) 確認過，這個廠商底下其實有 2 個玩法組（id=2、id=3），
 * 不是零個**——但兩者原始狀態都已經是 disabled（2），所以下面的連鎖 UPDATE 雖然真的會命中它們
 * （`WHERE vendor_id = 2`）並各觸發一次 `clearPlayGroupCache`，實際數值沒有淨變化，選這個廠商仍是
 * round-trip 安全的（連鎖不會把任何原本 enabled 的玩法組意外停用）：
 *   - 原始狀態：vendor disabled（2），玩法組 id=2/3 皆 disabled（2）。
 *   - `status="disabled"`（同值呼叫）：回傳成功（非 objectNotFound），round-trip 確認 vendor 狀態仍是
 *     disabled、玩法組 id=2/3 仍是 disabled——證實 `updateStatus` 底層的 UPDATE 對同值呼叫視為成功
 *     （affected rows 判斷未把「值未變」當失敗）。這不是巧合：agrabah 用的 mysql2 driver（package.json
 *     鎖定 3.18.0）預設連線 flags 含 `FOUND_ROWS`（`node_modules/mysql2/lib/connection_config.js`
 *     `getDefaultFlags()`），engine 用 `mysql.createPool(connectionString)` 建池未覆寫 flags，所以
 *     affectedRows 反映「符合 WHERE 條件的列數」而非「值真的被改變的列數」，同值 UPDATE 一樣算命中。
 *   - `status="enabled"`：round-trip 確認 vendor 狀態變成 enabled；玩法組 id=2/3 因 enabled 分支不碰
 *     `in_house_game_play_groups` 表，維持 disabled 不變（符合「enabled 不逆向恢復」的不對稱行為）。
 *   - `status="disabled"`（改回原值）：round-trip 確認 vendor 狀態恢復 disabled，玩法組 id=2/3 仍是
 *     disabled（本來就是，這次連鎖 UPDATE 同樣無淨變化），測試環境已還原乾淨。
 *   - `vendorId=999999999`（不存在）：回傳 `errorCode=14`（objectNotFound）。
 *   - 非法 status（如 `"not_a_real_status"`）：**這個情境沒有真的打進 RPC**——本 tool 的 zod schema
 *     `z.enum(STATUS_KEYS)` 在請求送出前就直接擋下，回 MCP 層級的 input validation error。上方檔頭
 *     描述的「status 帶非法列舉值回 errorCode=9（invalidData）」是讀 `updateStatus` 原始碼的推論，
 *     不是本 tool 實際測到的路徑（本 tool 的 schema 讓呼叫端幾乎不可能觸發這個後端分支）。
 * 純粹狀態切換測試已在 round-trip 復原（vendor 狀態、玩法組狀態皆恢復原值），未對真實有活躍玩法組的
 * 廠商（id=1/6/7/8）執行任何寫入。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { InHouseGameVendorListSearch, InHouseGamePlayGroupListSearch } from '/Users/user/aladdin/abu/admin/src/generated/types.gen.js';
import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { STATUS_MAP, STATUS_KEYS } from '../const.ts';

export function registerUpdateInHouseVendorStatusTool(server: McpServer): void {
    server.registerTool(
        'aladdin_admin_in_house_game_back_office_update_vendor_status',
        {
            title: 'Update an in-house (自研) game vendor status',
            description:
                '切換自研（in-house）遊戲廠商的啟用/停用狀態（rajah: InHouseGameBackOffice.' +
                'UpdateVendorStatus）。無需任何權限節點，任何已登入本後台的使用者皆可呼叫。' +
                '【重要副作用，呼叫 status="disabled" 前務必先查證影響範圍】status="disabled" 時，後端會在' +
                '同一個 transaction 內連鎖把這個廠商底下**所有玩法組**（不論原本是啟用還是停用）一併停用，' +
                '且這個連鎖是不可逆、不對稱的：status="enabled" 重新啟用廠商**不會**自動恢復玩法組原本的' +
                '狀態。回應的 affectedPlayGroups 只是連鎖**之後**的最終狀態（全部都會是 disabled），無法' +
                '從這個欄位分辨哪些玩法組原本是 enabled——若之後想恢復，必須在呼叫這支 tool **之前**先用 ' +
                'aladdin_admin_in_house_game_back_office_get_play_group_list（帶 vendorId、status=enabled）' +
                '查出並自行保留原本啟用中的玩法組清單，事後才有辦法逐一恢復。' +
                'vendorId 不存在回 errorCode=14（objectNotFound）；status 帶非法列舉值理論上回 errorCode=9' +
                '（invalidData，這是讀後端原始碼的推論——本 tool 的 zod schema 會在送出前直接擋下非法值，' +
                '實務上呼叫端幾乎不會真的觸發這個後端分支）。同值呼叫（目標狀態與現值相同）會成功（no-op），' +
                '不會誤報找不到（已 dev 實測驗證，底層 mysql2 driver 預設帶 FOUND_ROWS flag）。' +
                'GetVendorEdit 沒有 status 欄位，本 tool 寫入後改用 GetVendorList 讀回驗證。' +
                'prod 執行前確認（H36）：當這個 server 是正式環境時，執行前必須先用 AskUserQuestion' +
                '（或功能相同方式）明確詢問使用者是否要在正式環境執行，取得同意後才可帶上 confirm 參數；' +
                '絕不能自行假設使用者同意。非 prod 環境不需要、也會忽略 confirm 欄位。',
            inputSchema: {
                vendorId: z.number().int().describe('自研遊戲廠商 id，來自 aladdin_admin_in_house_game_back_office_get_vendor_list 的回傳結果'),
                status: z.enum(STATUS_KEYS).describe('目標狀態：unknown/enabled/disabled/frozen/deleted，一般啟用/停用用 enabled/disabled；status="disabled" 會連鎖停用該廠商底下所有玩法組，見 description 副作用說明'),
                confirm: z.string().optional().describe(
                    `正式環境（prod）專用的強制確認欄位；非 prod 環境會被忽略、不需提供。當這個 server 是正式環境時，` +
                    `必須先取得使用者明確同意，再帶上精確字串 "${ PROD_CONFIRM_TOKEN }" 才會執行，否則本工具會拒絕執行並回錯誤。`,
                ),
            },
        },
        async ({ vendorId, status, confirm }) => {
            assertProdConfirmed(confirm);
            const r = await withAutoRelogin(() => remote.inHouseGameBackOffice.main.UpdateVendorStatus(vendorId, STATUS_MAP[ status ]));
            if (r.failed) return asErrorResult(r);

            const listResult = await withAutoRelogin(() => remote.inHouseGameBackOffice.main.GetVendorList(
                InHouseGameVendorListSearch.fromObject({ gameId: 0, vendorName: '' }), 1, 200,
            ));
            const matched = !listResult.failed ? listResult.data?.rows?.find((row) => row.id === vendorId) : undefined;

            let affectedPlayGroups: unknown = undefined;
            if (status === 'disabled') {
                const playGroupsResult = await withAutoRelogin(() => remote.inHouseGameBackOffice.main.GetPlayGroupList(
                    InHouseGamePlayGroupListSearch.fromObject({ vendorId, status: 0, name: '' }), 1, 200,
                ));
                affectedPlayGroups = !playGroupsResult.failed ? playGroupsResult.data?.rows ?? [] : { note: '讀回玩法組清單失敗，連鎖影響範圍請自行用 get_play_group_list 查證' };
            }

            return asTextResult({
                success: true,
                message: '更新成功',
                readBack: matched ?? (!listResult.failed ? { note: '讀回清單中沒找到這個 vendorId，非預期，請人工確認', rows: listResult.data?.rows } : null),
                ...(affectedPlayGroups !== undefined ? { affectedPlayGroups } : {}),
            });
        },
    );
}
