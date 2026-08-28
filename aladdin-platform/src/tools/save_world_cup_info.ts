/**
 * tools/save_world_cup_info.ts — aladdin_platform_world_cup_platform_save_world_cup_info
 *
 * rajah: WorldCupPlatform.SaveWorldCupInfo(speActWorldCup SpeActWorldCup 1)
 * （rajah/services/world_cup_back_office.rajah:414；SpeActWorldCup 定義在
 * rajah/services/world_cup_common.rajah:110-178，巢狀的 WorldCupTeam 在同檔 181-192、
 * Milestone 195-215、GoalSprint 218-237、Knockout 240-264）。
 *
 * method-category-checklist.md 第 0 節排除規則已過：非 Placeholder（world_cup_back_office.rajah 全檔
 * 沒有任何 Placeholder method）；service WorldCupPlatform 沒有 @NoPublic（同檔 410-441 的
 * `# @Permission "WorldCup"` 是被註解掉的 @Permission）；agrabah 後端確實有 override、非 base class 的
 * notImplemented——agrabah/src/servers/sport_back_office/services/world_cup_platform.ts:40-50
 * methodSaveWorldCupInfo，委派
 * agrabah/src/servers/sport_back_office/models/world_cup_platform_db.ts:11-104 saveWorldCupInfo。
 *
 * 分類（method-category-checklist.md 第 4 節「Upsert / CreateOrUpdate」）：吃一個完整的 SpeActWorldCup，
 * 用 `id` 分流（db:33）——**id > 0 走更新、id 為 0/未帶走新增**，符合第 4 節第 3 點描述的慣例。
 *
 * **合併模式：第 4 節的模式 3「真正整包覆蓋、完全沒有 pre-load」**。db:15-32 直接 `new DbWorldCupInfo()`
 * 逐欄從 payload 賦值就送去 update，沒有先 load 現有列合併任何欄位。所以第 4 節第 1 點
 * 「必須先呼叫對應的 GetXxx 取得完整現值、只覆寫要改的欄位」是硬需求，**本 tool 每次更新都會先呼叫
 * GetWorldCupInfoList(id) 讀現值再合併**，寫入後再讀一次做 round-trip 驗證（第 4 節第 2 點）。
 *
 * **可以完整合併、不會有欄位被無聲清空**（我逐欄比對過寫入端與讀取端）：
 * 寫入端（db:18-30）寫的是 activityName / levelList / showStartTime / showEndTime / allowGuest /
 * activityInfo / activityStatus / activityPicture / worldCupTeam / milestone / goalSprint / knockout
 * 共 12 個欄位，外加 server 自己決定的 platformId 與 operatorId；讀取端（db:116-130）回的正好是這 12 個
 * 加上 id。兩邊一對一，所以「讀回來 → 改幾個欄位 → 整包送回」不會遺漏任何可寫欄位。
 *
 * **新增（id=0）這條路徑有不可逆的副作用，本 tool 因此加了 confirmCreate 閘門**（第 11 節「需二次確認」）：
 * 1. 後端**沒有任何刪除 world cup 活動的 method**（world_cup_back_office.rajah 全檔只有 Save/Get），
 *    新增出來的活動用 API 無法移除。
 * 2. 新增時會依 `milestone.startTime` ~ `milestone.endTime` **逐日批次產生「每日幸運球隊」**
 *    （db:38-101，每天一列、每列 3 隊寫進 DbWorldCupLuckyTeams）。日期區間拉多長就產生多少列。
 * 3. 後端在這條路徑上有兩個會炸的前提，本 tool 在送出前先擋掉、給明確訊息，不讓它到後端才爆：
 *    - `milestone` 沒帶時 db:39 直接讀 `speActWorldCup.milestone.startTime` 會拋 TypeError，
 *      被 service 的 try/catch 吃成語意不明的 unknown 錯誤（world_cup_platform.ts:41-49）。
 *    - `worldCupTeam` 裡一隊都沒有 `luckyFlag=true` 時，db:58-60 回 objectNotFound（整個交易回滾）。
 * **更新（id>0）不會重新產生幸運球隊**——db:33-35 的更新分支完全沒有碰 DbWorldCupLuckyTeams。
 * 也就是說改了既有活動的 milestone 日期區間，幸運球隊排程不會跟著變，這點 description 有寫明。
 *
 * 巢狀欄位為什麼用「原樣帶回」而不是展開成完整 schema：worldCupTeam / milestone / goalSprint / knockout
 * 在 DB 裡就是四個 JSON 字串欄位（db:27-30 toDbJson、db:127-130 JSON.parse 還原），
 * 而 rajah 這邊光是它們的巢狀定義就有 16 個 model、338 行。手抄一份 400 行的 zod schema 除了容易與 rajah
 * 漂移（const.ts 對 TransactionCategoryEnum 也是基於同樣理由選擇不手抄），也不符合這幾個欄位的實際用法：
 * 它們是整包讀出、整包寫回的設定塊。因此本 tool 把 worldCupTeam 定成明確 schema（只有 4 欄，而且
 * 新增路徑要靠 luckyFlag 做前置檢查），另外三個維持結構透明的傳遞，並在 description 寫清楚
 * 「從 get_world_cup_info_list 讀出來、就地修改後整包帶回」。
 *
 * 併發：後端整段包在 doTransaction 裡（db:13），但本 tool 的前置讀取在該交易之外，
 * read-modify-write 非原子，讀與寫之間若有他人改動會被覆蓋（last write wins）。
 *
 * 跨租戶（**這段的防線位置跟直覺相反，改動本檔前務必先看懂**）：後端的更新分支**沒有**平台隔離。
 * updateObject 組出來的 SQL 是 `UPDATE world_cup_info SET ... WHERE id = ?`
 * （mysql_relational_database_engine.ts:254），條件只有 id、沒有 platform_id；而 platformId 本身還在
 * SET 清單裡（db:18 每次都寫成 context.platformId）。也就是說直接對後端送一個別平台的活動 id，
 * 會把那筆活動改掉並「過戶」到自己平台。
 * **真正擋住這件事的是本 tool 的前置讀取**：GetWorldCupInfoList 有強制的 platform_id 過濾
 * （db:108-111），查不到就直接中止、不送出任何寫入（見下方 handler 對 row 不存在的處理）。
 * 所以那段前置讀取同時是「第 4 節要求的合併手段」與「唯一的跨租戶防線」，
 * **不能當成單純的效能包袱拿掉或改成有條件才讀**。
 *
 * 敏感資料（第 8 節）：全部是活動設定（名稱、時間、圖片路徑、隊伍、任務獎勵設定），
 * 無密鑰/token/PII，不需遮罩。
 *
 * 2026-08-28 dev 實測踩到並修正的一個坑：合併現值時原本用 `toObject(row, { defaults: true })`，
 * 那會把巢狀 JSON 區塊裡所有未設定的欄位實體化成預設值（luckyFlag:false、group:0、awardPictureUrl:'' …）
 * 再整包寫回去。資料沒有遺失（筆數與既有值都對），但它憑空改寫了 DB 裡那四個 JSON 欄位的內容，
 * 違背「只覆蓋呼叫端明確要改的欄位、其餘原樣帶回」。已改成 `defaults: false`——只帶回實際存在的欄位，
 * 巢狀結構因此逐位元保持原狀。相對地，worldCupTeam 的 teamPicture / luckyFlag 也必須是選填，
 * 否則讀取端沒回傳這兩個欄位（值為預設值時不序列化）的隊伍就無法原樣帶回、會被 schema 擋死。
 *
 * 2026-08-28 dev 實測的第二個發現：**這支不可能回 nothingChanged**。DbWorldCupInfo 的 showStartTime /
 * showEndTime 是 Date 欄位（database_types/world_cup.ts:6-7），後端每次都 `new Date(...)` 重建
 * （db:21-22），而 updateObject 的差異判斷是 `object[key] !== originObject[key]`
 * （mysql_relational_database_engine.ts:232）——兩個內容相同但不同實例的 Date 以 `!==` 比較永遠為真，
 * 所以差異集合永遠非空。實測連送兩次完全相同的內容，第二次仍回 success 且 nothingChanged=false，
 * 與賽程專欄那支（純量欄位、會回 nothingChanged）行為不同。特判邏輯保留作為容錯，但不會被觸發。
 *
 * **這是寫入操作，不是唯讀查詢。**
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { SpeActWorldCup, WorldCupSearchRequest } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { ErrorCode } from '/Users/user/aladdin/genie/src/common/error_code.ts';
import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

// OpenStatusEnum（world_cup_common.rajah:83-88）。目前只有本檔與 save_world_cup_fixtures_info.ts
// 各自用得到，兩邊都只是 off/on 兩態的小常數，依 mcps/README.md 第二節先各自留在檔案內；
// 之後若有第三支需要，再抽到 const.ts。
const ACTIVITY_STATUS_MAP = { off: 0, on: 1 } as const;

// 新增時逐日產生幸運球隊，一天一列。設一個明確上限，避免呼叫端把 milestone 區間填錯
// （例如 startTime 忘了帶而變成 1970）時，一次在 DB 裡灌進上萬列且無法用 API 清除。
const MAX_LUCKY_TEAM_DAYS = 400;
const DAY_MS = 24 * 60 * 60 * 1000;

const worldCupTeamSchema = z.object({
    id: z.number().int().min(1).describe('隊伍序號'),
    teamName: z.string().min(1).describe('隊伍名稱'),
    teamPicture: z.string().optional().describe(
        '隊伍圖標路徑（後端 @Type "File:Image"，值是上傳後拿到的路徑字串）。'
        + '省略＝空字串——讀取 tool 對沒有圖片的隊伍不會回這個欄位，所以這裡設成選填，讓讀到的清單能原樣帶回',
    ),
    luckyFlag: z.boolean().optional().describe(
        '是否為幸運隊伍；**新增活動時至少要有一隊為 true**，否則後端回 objectNotFound 並整筆回滾。'
        + '省略＝false——讀取 tool 對非幸運隊伍不會回這個欄位（protobuf 預設值不序列化），所以這裡設成選填',
    ),
});

/** 取「當地日曆日」的起點，與後端 dayjs(x).startOf('day') 的行為對齊，用來估算會產生幾列幸運球隊。 */
function startOfDay(ms: number): number {
    const d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}

export function registerSaveWorldCupInfoTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_world_cup_platform_save_world_cup_info',
        {
            title: 'Create or update a world cup activity configuration',
            description:
                '**寫入操作**：新增或更新本平台的世界盃活動主體設定（rajah: WorldCupPlatform.SaveWorldCupInfo，' +
                'world_cup_back_office.rajah:414）。**本 service 目前沒有權限節點把關**——rajah 上的 ' +
                '`@Permission "WorldCup"` 整段被註解掉，只要登入平台後台即可呼叫，寫入端一樣沒有守門。' +
                '\n\n' +
                '**帶 id＝更新、不帶 id＝新增**（後端用 id 是否為 0 分流）。兩條路徑的風險差很多，分開看：' +
                '\n\n' +
                '**更新（建議的用法）**：後端是整包覆蓋、不做欄位合併，所以**本 tool 會自動先讀一次現值、' +
                '只覆蓋你明確指定的欄位、其餘原樣帶回**，寫完再讀一次 round-trip 驗證並回傳 before / after 供你比對。' +
                '可寫的 12 個欄位與讀取 tool 回傳的欄位一對一，所以不會有欄位被無聲清空。' +
                '**注意：更新既有活動時，後端不會重新產生「每日幸運球隊」排程**——即使你改了 milestone 的日期區間，' +
                '幸運球隊仍是當初新增時就排好的那一份。' +
                '\n\n' +
                '**新增（不可逆，需明確確認）**：必須帶 `confirmCreate: true` 才會執行。原因有三：' +
                '(1) 後端**沒有任何刪除世界盃活動的 method**，建出來就無法用 API 移除；' +
                '(2) 新增會依 milestone 的起訖日**逐日批次產生「每日幸運球隊」**，一天一列寫進 DB，區間多長就產生多少列；' +
                '(3) 新增時**這 8 個欄位全部必填**（沒有現值可以沿用）：activityName、showStartTime、showEndTime、' +
                'activityPicture、levelList、worldCupTeam、activityInfo、milestone。前 7 個是 rajah 標 ' +
                '@Rules "Required" 的欄位，但**後端完全不驗**——漏帶不會報錯，而是建出展示時間 1970-01-01、' +
                '沒有配圖或沒有可見層級的殘廢活動，且無法用 API 刪除；milestone 則是後端新增分支會直接解參考的欄位，' +
                '沒帶會拋錯成語意不明的 unknown。此外 worldCupTeam 裡必須至少有一隊 `luckyFlag=true`，' +
                '否則後端回 objectNotFound 並整筆回滾。' +
                '本 tool 會在送出前先檢查這些前提、並把「即將產生幾列幸運球隊」算給你看，' +
                `超過 ${ MAX_LUCKY_TEAM_DAYS } 天會直接拒絕（避免 milestone 時間填錯時在 DB 灌進上萬列且無法清除）。` +
                '\n\n' +
                '**worldCupTeam / milestone / goalSprint / knockout 這四個欄位是整包取代語意**：它們在後端就是四個 ' +
                'JSON 欄位。正確做法是先用 aladdin_platform_world_cup_platform_get_world_cup_info_list 讀出現值，' +
                '就地修改後**整包**帶回；不帶則沿用現值（更新時）。其中 milestone / goalSprint / knockout 的內部結構' +
                '很深（rajah 裡 16 個 model、338 行），本 tool 不重新定義它們的 schema，請原樣帶回讀到的結構。' +
                '\n\n' +
                '**重複送出相同內容不是 no-op**（2026-08-28 dev 實測發現）：本 method 與賽程專欄那支不同，' +
                '它每次都會真的送出 UPDATE。原因是後端把 showStartTime / showEndTime 寫成 `new Date(...)`' +
                '（world_cup_platform_db.ts:21-22），而底層 updateObject 是用 `!==` 逐欄比對' +
                '（mysql_relational_database_engine.ts:232）——兩個內容相同但不同實例的 Date 永遠比不相等，' +
                '所以這兩個欄位一定被判定為「有變動」，DB 的 updated_at 與操作者也會跟著更新。' +
                '本 tool 仍保留 nothingChanged 的容錯處理，但實務上這支不會走到那條路徑。' +
                '\n\n' +
                '**併發限制**：後端寫入有交易保護，但本 tool 的前置讀取在交易之外——讀到寫的空檔若有別人改了同一個活動，' +
                '對方的改動會被這次寫入蓋掉（last write wins）。' +
                '更新操作**可逆**：動手前先用讀取 tool 把現值留一份就能還原；**新增操作不可逆**。',
            inputSchema: {
                id: z.number().int().min(1).optional().describe(
                    '要更新的世界盃活動 id，來自 aladdin_platform_world_cup_platform_get_world_cup_info_list；' +
                    '**不帶代表新增一個全新活動**（不可逆，需同時帶 confirmCreate=true）',
                ),
                confirmCreate: z.boolean().optional().describe(
                    '只有在「不帶 id 的新增」情境需要，且必須明確傳 true 才會執行。' +
                    '新增出來的活動無法用 API 刪除，且會逐日產生每日幸運球隊資料',
                ),
                activityName: z.string().max(8).optional().describe('活動名稱（rajah @Rules "Required;MaxLength(8)"）；更新時不帶＝維持現況'),
                activityStatus: z.enum([ 'on', 'off' ]).optional().describe('活動開關：on=開啟、off=關閉；更新時不帶＝維持現況'),
                showStartTime: z.number().int().min(1).optional().describe('活動展示時間起（毫秒 epoch）；更新時不帶＝維持現況'),
                showEndTime: z.number().int().min(1).optional().describe('活動展示時間迄（毫秒 epoch）；更新時不帶＝維持現況'),
                activityPicture: z.string().optional().describe(
                    '活動配圖路徑（後端 @Type "File:Image"）。圖片要先上傳取得路徑，' +
                    '上傳憑證可用 aladdin_platform_world_cup_platform_get_upload_world_cup_image_token 取得；更新時不帶＝維持現況',
                ),
                allowGuest: z.boolean().optional().describe('未登入是否可見；更新時不帶＝維持現況'),
                levelList: z.array(z.number().int()).optional().describe(
                    '可見的會員層級 id 陣列（整包取代，不是增量）；更新時不帶＝維持現況',
                ),
                activityInfo: z.string().optional().describe('活動規則（HTML 富文本）；更新時不帶＝維持現況'),
                worldCupTeam: z.array(worldCupTeamSchema).optional().describe(
                    '隊伍設定的**完整清單**（整包取代，沒列到的舊隊伍會消失）；更新時不帶＝維持現況。' +
                    '新增活動時必填，且至少要有一隊 luckyFlag=true',
                ),
                milestone: z.record(z.string(), z.unknown()).optional().describe(
                    '「任務集里程」設定，整包取代。請原樣帶回 get_world_cup_info_list 讀到的 milestone 結構（就地修改後整包送回）；' +
                    '更新時不帶＝維持現況。新增活動時必填，且其中的 startTime / endTime（毫秒 epoch）決定會產生幾天份的幸運球隊',
                ),
                goalSprint: z.record(z.string(), z.unknown()).optional().describe(
                    '「進球衝刺戰」設定，整包取代。請原樣帶回讀到的結構；更新時不帶＝維持現況',
                ),
                knockout: z.record(z.string(), z.unknown()).optional().describe(
                    '「晉級爭冠賽」設定，整包取代。請原樣帶回讀到的結構；更新時不帶＝維持現況',
                ),
            },
        },
        async (input) => {
            const isCreate = input.id === undefined;

            // ── 新增路徑的前置閘門：全部在送出任何 RPC 之前擋掉 ────────────────────────
            if (isCreate) {
                if (input.confirmCreate !== true) {
                    return asTextResult({
                        success: false,
                        message: '這是「新增世界盃活動」的請求（沒有帶 id），屬於不可逆操作，必須同時帶 confirmCreate=true 才會執行。'
                            + '後端沒有任何刪除世界盃活動的 method，建立後無法用 API 移除；'
                            + '而且新增會依 milestone 的起訖日逐日產生「每日幸運球隊」資料。'
                            + '若你其實是要修改既有活動，請帶上該活動的 id（用 aladdin_platform_world_cup_platform_get_world_cup_info_list 查）。',
                    });
                }
                // rajah 對 SpeActWorldCup 標了 @Rules "Required" 的欄位共 7 個（world_cup_common.rajah:124/128-133/
                // 139-140/150-151/155-156/159-160）：activityName / showStartTime / showEndTime / activityPicture /
                // levelList / worldCupTeam / activityInfo。**後端完全不驗這些 Rules**（db:19-30 照單全收），
                // 所以漏帶不會報錯，而是會建出一個展示時間 1970-01-01（new Date(0)，db:21-22）、沒有配圖、
                // 沒有可見層級的殘廢活動——而且沒有任何 API 可以刪掉它。新增是不可逆路徑，這裡一併補上檢查。
                // milestone 不在 rajah 的 Required 清單裡，但後端新增分支 db:39 會直接讀 milestone.startTime，
                // 沒帶就拋 TypeError，被 service 的 try/catch 吃成語意不明的 unknown 錯誤，所以同樣列為必填。
                const REQUIRED_ON_CREATE = [
                    'activityName', 'showStartTime', 'showEndTime', 'activityPicture',
                    'levelList', 'worldCupTeam', 'activityInfo', 'milestone',
                ] as const;
                const missing = REQUIRED_ON_CREATE.filter((k) => input[ k ] === undefined);
                if (missing.length > 0) {
                    return asTextResult({
                        success: false,
                        message: `新增活動時這些欄位必填（沒有現值可以沿用）：${ missing.join('、') }。`
                            + '前七個是 rajah 上標 @Rules "Required" 的欄位，但後端並不驗證——漏帶不會報錯，'
                            + '而是會建出展示時間 1970-01-01、沒有配圖或沒有可見層級的殘廢活動，且無法用 API 刪除。'
                            + 'milestone 則是後端新增分支會直接解參考的欄位，沒帶會拋錯成語意不明的 unknown。',
                    });
                }
                const teams = input.worldCupTeam ?? [];
                if (!teams.some((t) => t.luckyFlag === true)) {
                    return asTextResult({
                        success: false,
                        message: 'worldCupTeam 裡必須至少有一隊 luckyFlag=true。'
                            + '後端要靠這些隊伍抽每日幸運球隊，一隊都沒有時會回 objectNotFound 並把整筆新增回滾。',
                    });
                }
                const ms = input.milestone as { startTime?: unknown; endTime?: unknown };
                const startTime = typeof ms.startTime === 'number' ? ms.startTime : 0;
                const endTime = typeof ms.endTime === 'number' ? ms.endTime : 0;
                if (startTime <= 0 || endTime <= 0) {
                    return asTextResult({
                        success: false,
                        message: 'milestone 裡必須有大於 0 的 startTime 與 endTime（毫秒 epoch）。'
                            + '後端會用這兩個值逐日產生每日幸運球隊；填 0 會被當成 1970-01-01，產生的排程沒有意義。',
                    });
                }
                if (endTime < startTime) {
                    return asTextResult({ success: false, message: `milestone.endTime（${ endTime }）早於 startTime（${ startTime }），請確認時間區間。` });
                }
                const days = Math.floor((startOfDay(endTime) - startOfDay(startTime)) / DAY_MS) + 1;
                // 用白名單式判斷（必須落在 1..MAX 之間）而不是 `days > MAX`：epoch 超出 JS Date 上限
                // （8.64e15，例如呼叫端誤把奈秒時間戳當毫秒傳）時 startOfDay 回 NaN，days 也是 NaN，
                // 而 `NaN > MAX` 是 false——會直接穿透這道閘門。穿透的後果不是「多寫幾列」而是掛掉服務：
                // 後端 db:39-46 的 dayjs(NaN) 是 Invalid Date，`tempDate.isAfter(endDate)` 對兩個 Invalid Date
                // 永遠回 false，while 迴圈不會結束、activityDates 無限增長，而此時 db:37 的 insertObject 已經
                // 執行、整段又在 doTransaction 內，等於 OOM 加上交易懸掛持鎖。
                if (!(Number.isFinite(days) && days >= 1 && days <= MAX_LUCKY_TEAM_DAYS)) {
                    return asTextResult({
                        success: false,
                        message: Number.isFinite(days)
                            ? `milestone 的日期區間是 ${ days } 天，新增時會逐日產生 ${ days } 列每日幸運球隊資料，`
                                + `超出本工具允許的 1~${ MAX_LUCKY_TEAM_DAYS } 天範圍，已中止（這些資料無法用 API 清除）。`
                                + '請確認 milestone.startTime / endTime 是否填錯。'
                            : 'milestone.startTime / endTime 不是有效的毫秒 epoch（超出 JavaScript Date 可表示的範圍，'
                                + '常見原因是誤把奈秒或微秒時間戳當成毫秒傳）。已在送出前中止：'
                                + '這種值會讓後端產生每日幸運球隊的迴圈無法結束，不只是多寫幾列資料而已。',
                        milestoneStartTime: startTime,
                        milestoneEndTime: endTime,
                        estimatedLuckyTeamRows: Number.isFinite(days) ? days : undefined,
                    });
                }
            }

            // ── 更新路徑：第 4 節硬需求，先讀現值再合併 ──────────────────────────────
            let beforePlain: Record<string, unknown> | null = null;
            if (!isCreate) {
                const before = await withAutoRelogin(
                    () => remote.sportBackOffice.worldCupPlatform.GetWorldCupInfoList(WorldCupSearchRequest.create({ id: input.id })),
                );
                if (before.failed) return asErrorResult(before, { stage: '前置讀取現值失敗，未進行任何寫入' });
                const row = (before.data?.rows ?? [])[ 0 ];
                if (!row) {
                    return asTextResult({
                        success: false,
                        message: `找不到 id=${ input.id } 的世界盃活動（查詢已限定在當前登入平台）。`
                            + '未進行任何寫入——本 tool 不會因為查不到就改走新增，避免把「打錯 id 的更新」變成「意外建立新活動」。',
                    });
                }
                beforePlain = SpeActWorldCup.toObject(row, { defaults: false, longs: Number, enums: Number });
            }

            const merged: Record<string, unknown> = beforePlain ? { ...beforePlain } : {};
            merged.id = input.id ?? 0;
            if (input.activityName !== undefined) merged.activityName = input.activityName;
            if (input.activityStatus !== undefined) merged.activityStatus = ACTIVITY_STATUS_MAP[ input.activityStatus ];
            if (input.showStartTime !== undefined) merged.showStartTime = input.showStartTime;
            if (input.showEndTime !== undefined) merged.showEndTime = input.showEndTime;
            if (input.activityPicture !== undefined) merged.activityPicture = input.activityPicture;
            if (input.allowGuest !== undefined) merged.allowGuest = input.allowGuest;
            if (input.levelList !== undefined) merged.levelList = input.levelList;
            if (input.activityInfo !== undefined) merged.activityInfo = input.activityInfo;
            if (input.worldCupTeam !== undefined) merged.worldCupTeam = input.worldCupTeam;
            if (input.milestone !== undefined) merged.milestone = input.milestone;
            if (input.goalSprint !== undefined) merged.goalSprint = input.goalSprint;
            if (input.knockout !== undefined) merged.knockout = input.knockout;

            const payload = SpeActWorldCup.fromObject(merged);
            const w = await withAutoRelogin(() => remote.sportBackOffice.worldCupPlatform.SaveWorldCupInfo(payload));

            // 與 save_world_cup_fixtures_info 同款處理：更新分支走的是
            // mysql_relational_database_engine.ts:206-236 的 updateObject(obj, true)，
            // 「沒有任何欄位變動」回 nothingChanged，而「找不到列」回的是 idNotExists，兩者不會混淆；
            // 且該 return 發生在送出 UPDATE SQL 之前，代表 DB 沒被動過。因此不當成失敗。
            const nothingChanged = w.failed && w.errorCode === ErrorCode.nothingChanged;
            if (w.failed && !nothingChanged) {
                return asErrorResult(w, {
                    stage: isCreate ? '新增失敗（後端整筆交易回滾）' : '更新失敗，設定應維持原狀（建議再讀一次確認）',
                    before: beforePlain,
                });
            }

            // ── round-trip 驗證 ────────────────────────────────────────────────
            const after = await withAutoRelogin(
                () => remote.sportBackOffice.worldCupPlatform.GetWorldCupInfoList(
                    WorldCupSearchRequest.create({ id: isCreate ? 0 : (input.id as number) }),
                ),
            );
            if (after.failed) {
                return asErrorResult(after, { stage: '寫入已成功，但 round-trip 讀回失敗，請自行再查一次確認結果', before: beforePlain });
            }
            const afterRows = (after.data?.rows ?? []).map(
                (r) => SpeActWorldCup.toObject(r, { defaults: false, longs: Number, enums: Number }),
            );
            const afterRow = isCreate
                ? afterRows.reduce<Record<string, unknown> | null>((best, r) => (!best || (r.id as number) > (best.id as number) ? r : best), null)
                : afterRows[ 0 ] ?? null;

            return asTextResult({
                success: true,
                created: isCreate,
                nothingChanged,
                activityId: afterRow?.id ?? null,
                before: beforePlain,
                after: afterRow,
                hint: isCreate
                    ? '新增完成。此活動無法用 API 刪除；每日幸運球隊已依 milestone 的起訖日逐日產生。'
                        + '回傳的 after 是本平台目前 id 最大的那筆活動（後端沒有回傳新建 id，這是用讀取結果推定的），'
                        + '請自行用 aladdin_platform_world_cup_platform_get_world_cup_info_list 覆核。'
                    : nothingChanged
                        ? '後端回報這次沒有任何欄位被改動（送出的內容與現況完全相同），已照常讀回現況供你確認；這不是錯誤。'
                        : '要還原成呼叫前的狀態，把上面 before 的欄位整包送回本 tool 即可（注意 before 是完整現值快照）。',
            });
        },
    );
}
