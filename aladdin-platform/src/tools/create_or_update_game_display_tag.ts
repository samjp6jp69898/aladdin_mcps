/**
 * tools/create_or_update_game_display_tag.ts — aladdin_platform_game_vendor_platform_create_or_update_game_display_tag
 *
 * rajah: GameVendorPlatform.CreateOrUpdateGameDisplayTag(tag PlatformGameDisplayTag 1, isNew bool 2)
 * （game_back_office.rajah:1125，@Permission "GameVendor.GameSetting.DisplayTag"）——新增或編輯
 * 一個前端遊戲分類標籤，用明確的 `isNew` 布林參數判斷新增/更新（不是靠 `tag=0` 判斷）。
 *
 * 2026-08-25 讀 agrabah 後端原始碼查證
 * （agrabah/src/servers/game_back_office/services/game_vendor_platform.ts:1581-1599
 * methodCreateOrUpdateGameDisplayTag，實際邏輯委派給共用的 209-299 行 `createOrUpdateTag()`）：
 *
 * **關鍵風險：編輯自訂標籤會靜默把 betSlipTemplate 重置成 unknown(0)（2026-08-25 review 追查出的真實
 * 資料破壞副作用，本工具已加技術防呆，不只是文件警告）**
 * - rajah model `PlatformGameDisplayTag` 第 9 個欄位 `betSlipTemplate GameDisplayTagEnum 9`
 *   （game_back_office.rajah:606，對應 migration `202608201014_add_bet_slip_template_to_platform_game_tags.sql`），
 *   但這個 MCP server 依賴的 abu/platform 已生成 client（`abu/platform/src/generated/types.gen.d.ts`
 *   的 `IPlatformGameDisplayTag` 介面、`remote.gen.ts`）**完全沒有這個欄位**——grep 全 `remote.gen.ts`
 *   找不到任何 `betSlipTemplate` 字樣，證實這是 codegen 落後於 rajah 定義造成的真實缺口，讀跟寫都受影響
 *   （既讀不到現值，也送不出新值），不是本工具能單獨修的問題（需要 abu/platform 重新跑 rajah generate）。
 * - **這個缺口不是「單純不支援、沒有影響」**：後端 `createOrUpdateTag()` 對 `appDisplay` 類型的更新分支
 *   固定執行 `UPDATE ... SET label=?, sort_order=?, bet_slip_template=? WHERE ...`，其中
 *   `bet_slip_template` 的值來自 `resolveBetSlipTemplate(tagType, tagId, tag.betSlipTemplate)`——
 *   對落在自訂範圍（tag 101-200）的標籤，`tag.betSlipTemplate` 永遠是 `undefined`（client 不認得這個
 *   欄位），`resolveBetSlipTemplate` 的邏輯是 `requested ?? GameDisplayTagEnum.unknown`，**結果永遠是
 *   `unknown(0)`**——也就是說，**呼叫本工具編輯任何一個自訂標籤（tag 101-200），無論你有沒有帶
 *   betSlipTemplate、無論該標籤原本設定過什麼樣板，都會被靜默重置成 unknown**。系統原生標籤（tag
 *   1-100）不受影響，因為 `resolveBetSlipTemplate` 對這個範圍固定回傳 tag id 本身，不受 `requested`
 *   參數影響。
 * - **本工具的防呆**：編輯自訂範圍（101-200）的標籤時，強制要求呼叫端明確帶
 *   `acknowledgeBetSlipTemplateReset: true` 才會執行，否則直接拒絕並說明原因；編輯系統原生標籤
 *   （1-100）不受影響，不需要這個參數。新增（isNew=true）自訂標籤本身沒有「清空既有值」的問題（本來
 *   就沒有現值可清），新標籤的 betSlipTemplate 會固定是 unknown，僅記錄為已知限制、不套用同一道防呆。
 *
 * **v1 範圍限定（另一項不支援）**：不支援 squareImage/rectangleImage/bannerImage 圖片上傳——這三個
 * 欄位涉及 `GetUploadGameImageToken` 兩段式上傳流程（類似 `aladdin-admin` 的 `upsert_game.ts` 已實作的
 * 圖片上傳邏輯），複雜度與測試成本較高，本輪先不做，需要的話請回報再擴充。
 *
 * **新增（isNew=true）**：
 * - `tag`（呼叫端傳入的編號）**完全被忽略**，伺服器自動用 `MAX(tag)+1` 指派新編號，並 clamp 到
 *   自訂範圍 `[101, 200]`（`CUSTOM_TAG_START`/`CUSTOM_TAG_END`）；超過 200 回
 *   `AgrabahErrorCodeEnum.gameMaxTagExceeded`，本平台目前自訂標籤數量離這個上限還很遠（dev 實測
 *   系統原生標籤 tag=1~7，自訂區間才剛起用）。
 * - `label`：若不帶，直接以 `undefined` insert（沒有預設空字串保護，rajah model 也沒有
 *   `@Rules "Required"` 但強烈建議必填，本工具在 isNew 時把 label 設為必填欄位）。
 * - `sortOrder`：不帶時後端自動 fallback `Constants.SortOrderDefault=1000`，本工具不需要自行預填。
 * - `name`（多語系名稱）rajah 標 `@Rules "Required"`，本工具在 isNew 時要求至少一組語言。
 * - **RPC 回應本身不含新指派的 tag id**（`GameVendorPlatformCreateOrUpdateGameDisplayTagResponse`
 *   沒有任何回傳欄位，`createOrUpdateTag()` 內部雖然有算出 `resultTag` 但沒有透過 response 帶出來）。
 *   本工具用「寫入前後各查一次 `ListAllGameDisplayTags`、diff 出新出現的 tag id」的方式回推新編號，
 *   附在回傳的 `createdTag` 欄位。
 *
 * **編輯（isNew=false）**：
 * - `tag`（呼叫端傳入的編號）是定位鍵，若不存在會走到 `UPDATE ... WHERE tag=?` 比對不到任何列——
 *   **這段更新沒有檢查 affectedRows**，查無此列時 RPC 仍回傳成功（跟 `UpdateGameTagSortOrder` 同一種
 *   缺口）。本工具在呼叫底層 RPC 前，先用 `ListAllGameDisplayTags` 確認這個 tag 真的存在於當前平台，
 *   不存在就直接在 tool 層回報找不到、不呼叫底層 RPC，避免誤報成功。
 * - **`label`/`sortOrder` 是整包覆蓋語意**（`if (tag.label == null) tag.label = ''`、
 *   `if (tag.sortOrder == null) tag.sortOrder = Constants.SortOrderDefault`）——呼叫端沒帶到的欄位
 *   會被覆寫成空字串/預設排序值，**不是**保留原值。本工具因此在編輯時強制先讀現值、把呼叫端沒帶的
 *   欄位用現值回填，符合 method-category-checklist.md 第 4 節「先讀現值，只覆蓋要改欄位」的要求。
 * - **多語系欄位（name）則相反，是安全的逐語言合併**：底層 `localizationManager.updateById()` 對傳入
 *   陣列逐筆 `UPDATE ... WHERE code=?`，沒帶到的語言碼完全不受影響（讀過
 *   `localization_manager.ts:16-41` 的 `update()` helper 確認：對空陣列或缺少的語言碼直接跳過，
 *   不會清空既有值）。本工具因此不需要對 `name` 做讀現值合併，呼叫端只需帶要更新的語言即可，其餘語言
 *   維持原值——這跟 label/sortOrder 的整包覆蓋語意剛好相反，容易搞混，特別記錄。
 *
 * **2026-08-25 已通過 dev 實測**（tool 掛進 tools/index.ts 之後，對 pk-platform.alddev.com 用真正的
 * MCP stdio Client 打 tools/call，涵蓋 zod schema 驗證與 registerTool handler 本身）：新增一筆自訂
 * 標籤（驗證 diff 出的新 tag id 落在 101-200、讀回 label/name 正確）、編輯該筆只改 label 但不帶
 * acknowledgeBetSlipTemplateReset（tool 層防呆擋下，未呼叫底層 RPC）、帶上
 * acknowledgeBetSlipTemplateReset:true 後編輯成功（驗證 sortOrder/name 維持原值，只有 label 改變）、
 * 編輯不存在的 tag（tool 層防呆回報找不到，未呼叫底層 RPC）、編輯系統原生標籤（tag=1）不需要
 * acknowledgeBetSlipTemplateReset 也能成功。測完的自訂標籤留在 dev（沒有刪除 API，比照本 server
 * 既有慣例：新增 + 說明留存）。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { PlatformGameDisplayTag, PlatformGameDisplayTagSearch, LocalizationString } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

const CUSTOM_TAG_START = 101;
const CUSTOM_TAG_END = 200;

async function listAllDisplayTags() {
    return withAutoRelogin(() => remote.gameBackOffice.gameVendorPlatform.ListAllGameDisplayTags(PlatformGameDisplayTagSearch.create({}), 0, 0));
}

export function registerCreateOrUpdateGameDisplayTagTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_game_vendor_platform_create_or_update_game_display_tag',
        {
            title: 'Create or update a front-end game display tag',
            description:
                '新增或編輯一個前端遊戲分類標籤（rajah: GameVendorPlatform.CreateOrUpdateGameDisplayTag，需要權限節點 ' +
                'GameVendor.GameSetting.DisplayTag），用 isNew 布林參數明確判斷新增/編輯。' +
                '**重要風險**：編輯自訂標籤（tag 101-200）會把該標籤的 betSlipTemplate（注單樣板）靜默重置成 ' +
                'unknown(0)——這是這個 MCP server 依賴的已生成 client 缺少 betSlipTemplate 欄位（codegen 落後於 ' +
                'rajah 定義）造成的真實副作用，不是單純不支援。本工具因此要求編輯自訂標籤時必須明確帶 ' +
                'acknowledgeBetSlipTemplateReset:true 才會執行，否則拒絕並說明原因；編輯系統原生標籤（tag 1-100）' +
                '不受影響，不需要這個參數。' +
                '**v1 不支援 squareImage/rectangleImage/bannerImage 圖片上傳**（涉及兩段式上傳流程，本輪未實作），需要的話請回報。' +
                '新增時：tag 編號由伺服器自動指派（MAX(tag)+1，clamp 到自訂範圍 101-200），呼叫端不需要也' +
                '不應該帶 tag；label 必填；name 至少要帶一組語言；RPC 本身不回傳新指派的 tag id，本工具用' +
                '寫入前後各查一次清單 diff 回推，附在 createdTag 欄位；新自訂標籤的 betSlipTemplate 固定為 ' +
                'unknown（同樣是前述 client 缺口所致，新標籤沒有既有值可清空，風險較低，不套用同一道防呆）。' +
                '編輯時：tag 必填（要編輯哪一筆的既有編號，用 aladdin_platform_game_vendor_platform_list_all_game_display_tags ' +
                '查詢取得）；**label/sortOrder 是整包覆蓋語意**——後端對沒帶到的欄位會覆寫成空字串/預設值，' +
                '不是保留原值，本工具已自動先讀現值、把沒帶的欄位用現值回填，呼叫端只需要帶真的要改的欄位；' +
                'name（多語系名稱）則相反，是安全的逐語言合併，只需要帶要更新的語言，其餘語言不受影響。' +
                'tag 不存在於當前平台時，本工具會在呼叫底層 RPC 前先擋下並回報找不到（後端本身對這個情況' +
                '缺乏 affectedRows 檢查，會靜默回成功但實際沒有寫入，本工具已補上防呆）。' +
                'prod 執行前確認：當這個 server 是正式環境（prod）時，執行本工具前必須先用 AskUserQuestion' +
                '（或功能相同的方式）明確詢問使用者是否要在正式環境執行這個操作，取得明確同意後才可以帶上 confirm 參數；' +
                '絕不能自行假設使用者同意。非 prod 環境不需要、也會忽略 confirm 欄位。' +
                '**2026-08-25 已通過 dev 實測**（真正 MCP stdio Client 打 tools/call，涵蓋新增自訂標籤、' +
                '編輯自訂標籤不帶 acknowledgeBetSlipTemplateReset 被擋下、帶上後編輯成功且其餘欄位不受影響、' +
                '編輯系統原生標籤不需要這個參數、編輯不存在的 tag 被 tool 層防呆擋下）。',
            inputSchema: {
                isNew: z.boolean().describe('true=新增（tag 由伺服器自動指派，呼叫端不要帶 tag）；false=編輯既有標籤（tag 必填）'),
                tag: z.number().int().optional().describe('編輯時必填：既有標籤的編號，來自 aladdin_platform_game_vendor_platform_list_all_game_display_tags 的 tag 欄位；新增時不要帶（會被忽略）'),
                label: z.string().optional().describe('後台顯示名稱；新增時必填，編輯時不帶則沿用現值'),
                sortOrder: z.number().int().min(1).max(100000).optional().describe('排序值（1-100000）；新增時不帶則後端預設 1000，編輯時不帶則沿用現值'),
                name: z.array(z.object({ code: z.string(), value: z.string() })).optional().describe('多語系顯示名稱，每筆 {code, value}；新增時至少一組，編輯時只需帶要更新的語言，其餘語言不受影響'),
                acknowledgeBetSlipTemplateReset: z.boolean().optional().describe(
                    '編輯自訂標籤（tag 101-200）時必須明確帶 true，確認知情並接受該標籤的 betSlipTemplate 會被' +
                    '靜默重置成 unknown(0)（已知的 client 缺口，見說明）；編輯系統原生標籤（tag 1-100）或新增時' +
                    '不需要這個參數',
                ),
                confirm: z.string().optional().describe(
                    `正式環境（prod）專用的強制確認欄位；非 prod 環境會被忽略、不需提供。當這個 server 是正式環境時，` +
                    `必須先取得使用者明確同意，再帶上精確字串 "${ PROD_CONFIRM_TOKEN }" 才會執行，否則本工具會拒絕執行並回錯誤。`,
                ),
            },
        },
        async ({ isNew, tag, label, sortOrder, name, acknowledgeBetSlipTemplateReset, confirm }) => {
            assertProdConfirmed(confirm);

            if (isNew) {
                if (!label) {
                    return asTextResult({ success: false, message: '新增標籤時 label 必填' });
                }
                if (!name || name.length === 0) {
                    return asTextResult({ success: false, message: '新增標籤時 name（多語系名稱）至少要帶一組語言' });
                }

                const before = await listAllDisplayTags();
                if (before.failed) return asErrorResult(before);
                const beforeTagIds = new Set((before.data?.tags ?? []).map((t) => t.tag));

                const payload = PlatformGameDisplayTag.create({
                    label,
                    sortOrder,
                    name: name.map((n) => LocalizationString.create(n)),
                });
                const r = await withAutoRelogin(() => remote.gameBackOffice.gameVendorPlatform.CreateOrUpdateGameDisplayTag(payload, true));
                if (r.failed) return asErrorResult(r);

                const after = await listAllDisplayTags();
                if (after.failed) {
                    return asTextResult({ success: true, message: '新增成功，但讀回確認新 tag id 時發生錯誤', createdTag: null });
                }
                const newTags = (after.data?.tags ?? []).filter((t) => !beforeTagIds.has(t.tag));
                return asTextResult({
                    success: true,
                    message: newTags.length === 1 ? '新增成功（betSlipTemplate 固定為 unknown，見說明）' : '新增成功，但 diff 出的新 tag 數量不是 1，請人工確認',
                    createdTag: newTags.length === 1 ? newTags[ 0 ] : newTags,
                });
            }

            // 編輯
            if (tag === undefined) {
                return asTextResult({ success: false, message: '編輯標籤時 tag 必填' });
            }

            const before = await listAllDisplayTags();
            if (before.failed) return asErrorResult(before);
            const current = (before.data?.tags ?? []).find((t) => t.tag === tag);
            if (!current) {
                return asTextResult({ success: false, message: `tag=${ tag } 沒有出現在本平台的標籤清單裡（可能不存在，或屬於別的平台），未呼叫底層 RPC` });
            }

            const isCustomTag = tag >= CUSTOM_TAG_START && tag <= CUSTOM_TAG_END;
            if (isCustomTag && !acknowledgeBetSlipTemplateReset) {
                return asTextResult({
                    success: false,
                    message: `tag=${ tag } 是自訂標籤（101-200），編輯會把它的 betSlipTemplate 靜默重置成 unknown(0)` +
                        '（已知的 client 缺口，見工具說明）。若確認接受這個後果，請帶 acknowledgeBetSlipTemplateReset:true 重試；' +
                        '未呼叫底層 RPC。',
                });
            }

            const payload = PlatformGameDisplayTag.create({
                tag,
                label: label ?? current.label,
                sortOrder: sortOrder ?? current.sortOrder,
                name: (name ?? []).map((n) => LocalizationString.create(n)),
            });
            const r = await withAutoRelogin(() => remote.gameBackOffice.gameVendorPlatform.CreateOrUpdateGameDisplayTag(payload, false));
            if (r.failed) return asErrorResult(r);

            const after = await listAllDisplayTags();
            const updated = !after.failed ? (after.data?.tags ?? []).find((t) => t.tag === tag) : undefined;
            return asTextResult({
                success: true,
                message: isCustomTag ? '更新成功（betSlipTemplate 已依已知缺口重置為 unknown）' : '更新成功',
                readBack: updated ?? (!after.failed ? { note: '讀回清單中沒找到這個 tag，非預期，請人工確認' } : null),
            });
        },
    );
}
