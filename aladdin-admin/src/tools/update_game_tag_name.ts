/**
 * tools/update_game_tag_name.ts — aladdin_admin_game_vendor_admin_update_game_tag_name
 *
 * rajah: GameVendorAdmin.UpdateGameTagName（game_back_office.rajah:343）。
 * @Permission "GameVendor.Game.Ops.Edit"（非 Placeholder、非 @NoPublic，agrabah 對應
 * Service 有真實 override：agrabah/src/servers/game_back_office/services/game_vendor_admin.ts
 * 的 methodUpdateGameTagName，2026-08-24 已核對非「大小寫打錯的偽 Placeholder」也非純權限
 * 佔位符）。
 *
 * **實際行為（讀 methodUpdateGameTagName + LocalizationManager.updateById 源碼確認，
 * 並於 2026-08-24 在 dev 站台 https://admin.alddev.com 實打驗證，非憑方法名/註解猜測）**：
 * - `tag`（GameTagNameEdit.tag）不是任意數字，而是後端固定的 TS enum 成員（依 tagType 對到
 *   GameVendorFeeTagEnum / GameDisplayTagEnum / GameRebateTagEnum，三者數值集合完全相同：
 *   unknown/slot/board/fish/live/sport/eSport/lottery，已逐一核對三份 rajah enum 定義一致）。
 *   這支 method 本身**不驗證** tag 是否真的落在該 enum 內（讀源碼確認，methodUpdateGameTagName
 *   只查 getLocalizationServiceId(tagType)，完全沒有對 tag 的存在性檢查）——傳一個不存在的數字
 *   理論上一樣會成功執行、在 id_localizations 表憑空建出一筆跟任何真實標籤都對不上的孤兒翻譯列
 *   （此點僅為源碼推論，未實測，因為沒有對應的刪除介面可清理這類孤兒列，避免污染 dev 資料）。
 *   本工具用 zod enum 鎖死 tag 只能是已知合法值，杜絕這個陷阱，不假設呼叫端會自己傳對。
 * - `name`（[LocalizationString]）的合併粒度是**逐語言代碼**（LocalizationManager.updateById
 *   對每個傳入的 code 各自跑一次 `UPDATE ... WHERE code=?`，影響 0 列且 value 非空才補一筆
 *   INSERT）：你**沒有列出**的語言代碼完全不受影響、維持原值——2026-08-24 dev 實測：對
 *   tagType=appDisplay/tag=slot 只送 `[{code:'zh-CN', value:测试值}]`，寫入後讀回 zh-CN 確實變成
 *   測試值，同時原本存在的 en-US 條目原封不動（PASS，證據見下方測試紀錄）。但你**列出且傳空
 *   字串**的語言，UPDATE 會照樣執行、把既有翻譯直接清成空字串——不是「維持原值」的意思（此點為
 *   源碼推論：`update()` 函式對 UPDATE 影響列數>0 時無條件視為成功、不檢查 value 是否為空，只有
 *   走 INSERT 分支才會因 value 空而跳過；未針對「清空既有值」單獨實測，因為會破壞既有語系資料，
 *   風險與測試效益不成比例）。想保留某語言的既有值，唯一作法是不要把它放進 names 陣列，不能靠
 *   傳空字串代替「跳過」。
 * - tagType=frontendGroup（前台遊戲標籤，平台自訂）刻意不開放：agrabah 的 TagEnumMap 對
 *   frontendGroup 是空物件 `{}`，ListAllGameTagNamesByType(frontendGroup) 2026-08-24 dev 實測
 *   確認回傳 tags.length=0，但 UpdateGameTagName 的 getLocalizationServiceId 對 frontendGroup
 *   仍有對應的 localizationServiceId（TagLocalizationServiceIdMap 有這個 key），照樣會接受任意
 *   tag 數字寫入 id_localizations——frontendGroup 標籤真正的資料表是 platform_game_tags（model
 *   PlatformGameTag，每平台各自的流水號 id，不是這組固定 enum），對應的讀寫方法是同一 service 的
 *   ListAllGameFrontendGroupTags/CreateOrUpdateGameFrontendGroupTag（本工具未涵蓋，如需操作前台
 *   自訂標籤請改用那組）。若在此開放 frontendGroup，agent 會以為在改一個真實標籤，實際上是在寫
 *   一筆跟任何 PlatformGameTag 都無關的孤兒翻譯列，故本工具的 tagType 只收
 *   vendorFee/appDisplay/rebate 三種（本檔內局部常數 UPDATABLE_GAME_TAG_TYPE_KEYS，刻意不用
 *   const.ts 共用的 GAME_TAG_TYPE_KEYS——後者含 frontendGroup，是給
 *   list_game_tag_names.ts 讀取查詢用，讀取端可以安全接受 frontendGroup 拿到「空陣列」的
 *   已知結果，但寫入端不能，兩者需求不同不可共用同一份 keys 常數）。
 *
 * **2026-08-24 dev 實打驗證紀錄（cwd=abu/admin，credentials.admin.env，帳號 landon001）**：
 * - `ListAllGameTagNamesByType(vendorFee)` errorCode=0，回傳 8 筆（tag=0~7），且**tag=0(unknown)
 *   完全沒有 name 陣列**（JSON 序列化後該筆不含 name key）——證實 method-category-checklist.md
 *   「個別標籤的 name 可能缺漏」不是理論風險，是本次驗證親見的真實資料狀態，呼叫端不應假設任何
 *   一筆都有完整三語系。
 * - `ListAllGameTagNamesByType(frontendGroup)` errorCode=0，回傳 0 筆，符合源碼推論。
 * - round-trip 寫入測試：對 tagType=appDisplay(2)/tag=slot(1) 原始 zh-CN="电子"，寫入測試值
 *   `ZZZ_TEST_<timestamp>` 後讀回確認 zh-CN 已變更、en-US="电子us" 完全不受影響（兩項斷言皆
 *   PASS），寫入後已還原 zh-CN 回原值"电子"並再次讀回確認還原成功（PASS）——dev 資料未留殘留。
 * - 非法 tagType=999：errorCode=317（AgrabahErrorCodeEnum.gameTagTypeNotExists，業務錯誤碼，
 *   非協定層擋下），與源碼 `if (!localizationServiceId) return GenieResult.error(...gameTagTypeNotExists)`
 *   完全吻合。
 *
 * 分類依據（method-category-checklist.md）：本質是「用固定業務鍵（tagType+tag，直接命中，
 * 不需要像第 5 節那樣先翻頁定位內部 id）更新單一欄位」的寫入操作，不完全落在任何一節（不是
 * CreateOrUpdate/Upsert 命名、也不是靠翻頁找內部 id），比照第 4 節 Upsert 精神處理最貼近——
 * 呼叫前先用 sibling 讀取方法 ListAllGameTagNamesByType（回傳受限於固定小型 enum，不分頁、
 * 可放心整包讀，符合第 2 節「完全不分頁的全撈：小型列舉表可放心用」）取得現值、確認
 * (tagType, tag) 組合真的存在；寫入後再讀一次做 round-trip 驗證，把 before/after 的 name
 * 陣列都攤在回傳結果裡讓呼叫端自行核對「沒列出的語言是否真的沒被動到」。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { GameTagNameEdit } from '/Users/user/aladdin/abu/admin/src/generated/types.gen.js';
import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { GAME_TAG_TYPE_MAP, GAME_TAG_MAP, GAME_TAG_KEYS } from '../const.ts';

// 只有本檔用得到的限縮清單：UpdateGameTagName 不支援 frontendGroup（見上方檔頭說明），
// 與 const.ts 共用的 GAME_TAG_TYPE_KEYS（含 frontendGroup，給查詢類 tool 用）刻意分開。
const UPDATABLE_GAME_TAG_TYPE_KEYS = [ 'vendorFee', 'appDisplay', 'rebate' ] as const;

export function registerUpdateGameTagNameTool(server: McpServer): void {
    server.registerTool(
        'aladdin_admin_game_vendor_admin_update_game_tag_name',
        {
            title: 'Update the localized display name of a game tag',
            description:
                '更新一個遊戲標籤的多語系顯示名稱（rajah: GameVendorAdmin.UpdateGameTagName，' +
                'game_back_office.rajah:343）。tag 的合法值是後端固定的 enum 成員' +
                '（unknown/slot/board/fish/live/sport/eSport/lottery，三種 tagType 共用同一組值），' +
                '不是任意數字或某張表的流水號 id——本工具已用固定選項鎖死，不需要另外查詢就知道有哪些' +
                '合法值。只支援 tagType=vendorFee（廠商殺數分類）/appDisplay（前端顯示分類）/' +
                'rebate（返水分類）三種；不支援 frontendGroup（前台平台自訂標籤），那組標籤是另一張表' +
                '（platform_game_tags），要改請改用 ListAllGameFrontendGroupTags/' +
                'CreateOrUpdateGameFrontendGroupTag（本 server 目前未提供對應 tool）。' +
                'names 只會動到你列出的語系代碼，沒列出的語系維持原值不受影響（2026-08-24 dev 實測' +
                '確認）；但若你把某語系列出且 value 傳空字串，會把該語系的既有翻譯直接清成空字串——' +
                '這不等於「跳過該語系」，想保留某語系原值就完全不要把它放進 names 陣列。' +
                '本工具會先呼叫 ListAllGameTagNamesByType 確認 (tagType, tag) 組合目前存在（取得' +
                '寫入前的現值），寫入後再呼叫一次做 round-trip 驗證，回傳的 before/after 都是完整' +
                'name 陣列，方便你自行核對沒列出的語言是否真的沒被動到；注意某些標籤可能完全沒有' +
                'name 資料（2026-08-24 dev 實測 vendorFee 的 unknown 就是這樣），這是既有資料現況，' +
                '不代表呼叫失敗。',
            inputSchema: {
                tagType: z.enum(UPDATABLE_GAME_TAG_TYPE_KEYS).describe(
                    '標籤類型：vendorFee(廠商殺數分類)/appDisplay(前端顯示分類)/rebate(返水分類)。' +
                    '不支援 frontendGroup（見本工具 description 說明）。',
                ),
                tag: z.enum(GAME_TAG_KEYS).describe(
                    '標籤本身：unknown(沒分類)/slot(電子)/board(棋牌)/fish(捕魚)/live(真人)/sport(體育)/' +
                    'eSport(電競)/lottery(彩票)。三種 tagType 共用同一組固定值，這是後端 enum 成員，' +
                    '不是可以自訂新增的流水號 id。',
                ),
                names: z.array(z.object({
                    code: z.string().min(1).describe('語系代碼，例如 zh-CN、zh-TW、en-US'),
                    value: z.string().describe(
                        '該語系下的新名稱。傳空字串會把既有翻譯直接清空成空字串，不是「維持原值」——' +
                        '想維持原值請直接不要把這個語系放進陣列，不要用空字串代替。',
                    ),
                })).min(1).describe('要更新的語系清單，只會動到這裡列出的語系代碼，其餘既有語系維持原值。'),
            },
        },
        async (input) => {
            const { tagType, tag, names } = input;
            const tagTypeValue = GAME_TAG_TYPE_MAP[ tagType ];
            const tagValue = GAME_TAG_MAP[ tag ];

            const beforeR = await withAutoRelogin(() => remote.gameBackOffice.gameVendorAdmin.ListAllGameTagNamesByType(tagTypeValue));
            if (beforeR.failed) return asErrorResult(beforeR);
            const beforeEntry = beforeR.data?.tags?.find((t) => t.tag === tagValue);
            if (!beforeEntry) {
                return asTextResult({
                    success: false,
                    message: `在 tagType=${ tagType } 底下找不到 tag=${ tag }（ListAllGameTagNamesByType 沒有回傳這筆，理論上不該發生，因為 tag 已被 schema 限制在固定 enum 內，可能是 dev 環境資料異常，請覆核）。`,
                });
            }

            const writeR = await withAutoRelogin(() => remote.gameBackOffice.gameVendorAdmin.UpdateGameTagName(
                GameTagNameEdit.create({ tagType: tagTypeValue, tag: tagValue, name: names }),
            ));
            if (writeR.failed) return asErrorResult(writeR);

            const afterR = await withAutoRelogin(() => remote.gameBackOffice.gameVendorAdmin.ListAllGameTagNamesByType(tagTypeValue));
            const afterEntry = afterR.failed ? undefined : afterR.data?.tags?.find((t) => t.tag === tagValue);

            return asTextResult({
                success: true,
                message: '更新成功',
                before: beforeEntry.name ?? [],
                after: afterEntry ? (afterEntry.name ?? []) : null,
                ...(afterR.failed || !afterEntry ? { note: '寫入已成功，但讀回驗證未能取得最新值，請自行呼叫 ListAllGameTagNamesByType 覆核' } : {}),
            });
        },
    );
}
