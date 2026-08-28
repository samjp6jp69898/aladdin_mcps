/**
 * tools/save_world_cup_fixtures_info.ts — aladdin_platform_world_cup_platform_save_world_cup_fixtures_info
 *
 * rajah: WorldCupPlatform.SaveWorldCupFixturesInfo(worldCupFixturesSetting WorldCupFixturesSetting 1)
 * （rajah/services/world_cup_back_office.rajah:440；WorldCupFixturesSetting 定義在
 * rajah/services/world_cup_common.rajah:463-471、內含的 FixturesRecord 在同檔 474-496）。
 *
 * method-category-checklist.md 第 0 節排除規則已過：非 Placeholder（world_cup_back_office.rajah 全檔
 * 沒有任何 Placeholder method）；service WorldCupPlatform 沒有 @NoPublic（同檔 410-441 的
 * `# @Permission "WorldCup"` 是被註解掉的 @Permission）；agrabah 後端確實有 override、非 base class 的
 * notImplemented——agrabah/src/servers/sport_back_office/services/world_cup_platform.ts:266-277
 * methodSaveWorldCupFixturesInfo，委派
 * agrabah/src/servers/sport_back_office/models/world_cup_platform_db.ts:640-668 saveWorldCupFixturesInfo。
 *
 * 分類（method-category-checklist.md 第 4 節「Upsert / CreateOrUpdate」）：吃一個完整的設定 model，
 * 以 platform_id 定位、有就 update、沒有就 insert（db:661-666）。
 *
 * **後端落在第 4 節的哪一種合併模式：模式 3「真正整包覆蓋、完全沒有 pre-load」**。db:655-659 直接
 * `new DbWorldCupFixturesInfo()`，只把 platformId / open / fixtures / operatorId 四個欄位塞進去就送去 update，
 * **完全沒有先 load 現有列再合併欄位**（唯一 load 的那次 db:644-648 是 `FOR UPDATE` 鎖列 + 取 id，
 * 資料本身沒有被拿來合併）。因此第 4 節第 1 點「包這類 method 前必須先呼叫對應的 GetXxx 取得完整現值，
 * 只覆寫呼叫端明確要改的欄位」在這裡不是保險而是硬需求：少帶 fixturesRecord 就會把整份賽程清單清掉。
 * 本 tool 因此**每次都先呼叫 GetWorldCupFixturesInfo 讀現值**，只覆蓋呼叫端明確指定的欄位，
 * 其餘原樣帶回；寫入後再讀一次做 round-trip 驗證（第 4 節第 2 點），並把 before / after 一起回給呼叫端。
 *
 * 第 4 節第 3 點（新增 vs 更新要明確告知）：後端不是用 id 分流，而是用「platform_id 這列存不存在」分流
 * （db:661-666）；本 tool 用前置讀取的結果判斷並回傳 `created`（true=這次是新建、false=更新現有列）。
 * 另外後端**完全忽略呼叫端傳入的 id**（db:662 一律用 load 到的現有列 id 覆蓋），所以本 tool 不開放 id 參數。
 *
 * 併發：後端整段包在 doTransaction 裡、且 load 時帶 `FOR UPDATE` 鎖列（db:643-648），
 * 同時有兩個人改同一平台的設定會排隊而不是互相覆蓋到一半。但**這不保護「讀-改-寫」的整體原子性**：
 * 本 tool 的前置讀取發生在交易之外，若在讀與寫之間有別人改了設定，那份改動會被本次寫入蓋掉（last write wins）。
 * description 已註明。
 *
 * 跨租戶：後端寫死 `platform_id = ?` 取 context.platformId（db:646-647、656），改不到別平台的設定。
 *
 * 敏感資料（第 8 節）：只有開關與公開賽程資訊（隊伍名、圖片路徑、比分字串），無密鑰/token/PII。
 *
 * **這是寫入操作，不是唯讀查詢。** 影響前台/Lago 世界盃 Tab 的賽程專欄顯示。可逆：先用
 * aladdin_platform_world_cup_platform_get_world_cup_fixtures_info 讀下現值就能還原。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { WorldCupFixturesSetting } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { ErrorCode } from '/Users/user/aladdin/genie/src/common/error_code.ts';
import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
// OpenStatusEnum（world_cup_common.rajah:83-88）。目前只有這一支 tool 用得到，依 mcps/README.md
// 第二節「只有這個 tool 用得到的一次性小常數才留在檔案內」放在這裡而不是 const.ts；
// 日後若 SaveWorldCupInfo 也包成 tool（SpeActWorldCup.activityStatus 同樣是這個 enum），再抽到 const.ts。
const WORLD_CUP_OPEN_STATUS_MAP = { off: 0, on: 1 } as const;

/**
 * 每一列的 schema。**十個欄位全部必填、刻意不給 .default()**——因為後端是整包覆蓋、
 * 連 row 層級也沒有任何合併：呼叫端送出的那一列就是該列的最終內容。如果這裡給了預設值，
 * 呼叫端（尤其是 LLM）很自然會只帶 `{id, points}` 想「只改積分」，schema 會把其餘欄位補成
 * ''/0 直接寫進 DB，那一列的隊名、圖片、比分就被清空了——而且是靜默發生、沒有任何錯誤。
 * 改成全欄位必填之後，這種寫法會在參數驗證階段就被擋下，逼呼叫端先讀完整現值再送回。
 */
const fixturesRecordSchema = z.object({
    id: z.number().int().min(0).describe('該列的 id；沿用讀回來的值，新增列時填 0'),
    teamGroup: z.string().describe('組別，自由字串（沒有就傳空字串，不能省略）'),
    tempRanking: z.number().int().min(0).max(4).describe('隊伍排名 TeamRankingEnum：1=第一、2=第二、3=第三、4=第四；0=未設定（現有資料可能是 0，原樣帶回即可）'),
    teamName: z.string().describe('隊伍名稱（沒有就傳空字串，不能省略）'),
    teamPictureUrl: z.string().describe('隊伍圖片路徑（後端 @Type "File:Image"，值是上傳後拿到的路徑字串；沒有就傳空字串）'),
    totalMatches: z.number().int().min(0).describe('比賽總場次'),
    matchResult: z.string().describe('比賽勝/平/負，自由字串（例如 "1/2/3"），後端不做結構化解析；沒有就傳空字串'),
    goalsResult: z.string().describe('進球失分，自由字串（例如 "4/5/6"），後端不做結構化解析；沒有就傳空字串'),
    points: z.number().int().min(0).describe('積分'),
    showAdvance: z.number().int().min(0).max(1).describe('顯示晉級 ShowAdvanceEnum：0=不顯示、1=顯示'),
});

export function registerSaveWorldCupFixturesInfoTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_world_cup_platform_save_world_cup_fixtures_info',
        {
            title: 'Update the world cup fixtures (standings) panel setting of the current platform',
            description:
                '**寫入操作**：更新本平台的世界盃「賽程資訊專欄」設定（rajah: WorldCupPlatform.SaveWorldCupFixturesInfo，' +
                'world_cup_back_office.rajah:440）。會影響前台/Lago 世界盃 Tab 上賽程專欄的顯示。' +
                '**本 service 目前沒有權限節點把關**——rajah 上的 `@Permission "WorldCup"` 整段被註解掉，' +
                '只要登入平台後台即可呼叫，寫入端也一樣沒有守門。' +
                '\n\n' +
                '**後端是整包覆蓋、不做欄位合併**（2026-08-28 讀原始碼查證，' +
                'agrabah/src/servers/sport_back_office/models/world_cup_platform_db.ts:640-668：直接 new 一個 ' +
                'DbWorldCupFixturesInfo 就送去 update，沒有任何 pre-load 合併）。為了安全，' +
                '**本 tool 每次都會先自動讀一次現值、只覆蓋你明確指定的欄位、其餘原樣帶回**，' +
                '寫完再讀一次做 round-trip 驗證，並把 before / after 一起回給你比對。' +
                '\n\n' +
                '**參數語意（最重要的一段）**：' +
                '`open` 不帶＝維持現況；帶了才改。' +
                '`fixturesRecord` 不帶＝**維持現有整份清單不動**（推薦：只想開關專欄就不要帶它）；' +
                '一旦帶了，它就是**整份清單的最終狀態、完全取代舊清單**——沒出現在陣列裡的舊資料會直接消失，' +
                '不是「只更新你帶的那幾筆」。要改其中一筆，正確做法是先用 ' +
                'aladdin_platform_world_cup_platform_get_world_cup_fixtures_info 讀出完整清單、' +
                '改掉那一筆之後把**整份**送回來。傳空陣列 `[]` 等於清空整份賽程清單。' +
                '\n\n' +
                '**而且「整份送回」是連每一列的每個欄位都要帶齊**：後端在 row 層級同樣沒有合併，' +
                '你送出的那一列就是該列的最終內容。因此本 tool 的每列 schema **十個欄位全部必填、沒有預設值**——' +
                '想只改某列的積分卻只傳 `{id, points}` 會直接被參數驗證擋下（這是刻意的保護：' +
                '若允許省略，被省掉的隊名/圖片/比分會被靜默清空）。正確做法一律是「讀回完整清單 → 改掉要改的欄位 → 整份送回」。' +
                '\n\n' +
                '**新增 vs 更新**：後端不是用 id 判斷，而是看「本平台這列設定存不存在」——不存在就新建。' +
                '回傳的 `created` 會告訴你這次走的是新建（true）還是更新（false）。' +
                '後端會忽略傳入的設定 id（一律用現有列的 id），所以本 tool 不開放 id 參數。' +
                '\n\n' +
                '**併發限制**：後端寫入本身有交易 + FOR UPDATE 鎖列保護，但本 tool 的「先讀現值」發生在那個交易之外——' +
                '如果在讀到寫的空檔有別人改了同一份設定，對方的改動會被這次寫入蓋掉（last write wins）。' +
                '要改重要設定前建議先確認沒有其他人同時在動。' +
                '\n\n' +
                '**送出與現況完全相同的內容時**（例如讀回來原樣送回、或同一個指令重跑一次），後端會回 ' +
                'nothingChanged（UPDATE 沒有改到任何欄位）。本 tool **不把它當成失敗**——你要的狀態本來就已經成立——' +
                '而是照常 round-trip 讀回現況、回傳 success 並附上 `nothingChanged: true` 讓你知道這次沒有產生變更。' +
                '（2026-08-28 dev 實測發現，原本會被誤報成寫入失敗。）' +
                '\n\n' +
                '本操作**可逆**：動手前先用 aladdin_platform_world_cup_platform_get_world_cup_fixtures_info ' +
                '把現值留一份，就能原樣還原。查詢一律限定當前登入平台，改不到別平台的設定。',
            inputSchema: {
                open: z.enum([ 'on', 'off' ]).optional().describe(
                    '賽程專欄總開關：on=開啟、off=關閉；**不帶代表維持現況不動**',
                ),
                fixturesRecord: z.array(fixturesRecordSchema).optional().describe(
                    '賽程列的**完整最終清單**——帶了就整份取代舊清單（沒列到的舊資料會消失），' +
                    '不帶則維持現有清單不動。傳 [] 等於清空。' +
                    '**每一列的 10 個欄位都必填、不能只帶想改的那幾個**（後端 row 層級也沒有合併，' +
                    '省略的欄位等同要求清空該欄位；本 schema 因此不給預設值，少帶會直接驗證失敗）。' +
                    '要改單筆：先用 get_world_cup_fixtures_info 讀出完整清單，改掉目標欄位，再把整份送回。',
                ),
            },
        },
        async ({ open, fixturesRecord }) => {
            if (open === undefined && fixturesRecord === undefined) {
                return asTextResult({
                    success: false,
                    message: 'open 與 fixturesRecord 至少要指定一個，否則這次呼叫不會有任何改動（本 tool 不做空寫入）',
                });
            }

            // 第 4 節硬需求：後端整包覆蓋、沒有 pre-load 合併，所以一定要先讀現值再合併。
            const before = await withAutoRelogin(() => remote.sportBackOffice.worldCupPlatform.GetWorldCupFixturesInfo());
            if (before.failed) {
                return asErrorResult(before, { stage: '前置讀取現值失敗，未進行任何寫入' });
            }
            const current = before.data?.worldCupFixturesSetting ?? null;
            const created = current === null || current === undefined;

            const currentRows = Array.from(current?.fixturesRecord ?? []).map((row) => ({
                id: row.id ?? 0,
                teamGroup: row.teamGroup ?? '',
                tempRanking: row.tempRanking ?? 0,
                teamName: row.teamName ?? '',
                teamPictureUrl: row.teamPictureUrl ?? '',
                totalMatches: row.totalMatches ?? 0,
                matchResult: row.matchResult ?? '',
                goalsResult: row.goalsResult ?? '',
                points: row.points ?? 0,
                showAdvance: row.showAdvance ?? 0,
            }));
            const beforeSnapshot = { open: current?.open ?? 0, fixturesRecord: currentRows };

            const merged = WorldCupFixturesSetting.create({
                id: current?.id ?? 0, // 後端會忽略，帶回原值只是不製造無謂差異
                open: open !== undefined ? WORLD_CUP_OPEN_STATUS_MAP[ open ] : beforeSnapshot.open,
                fixturesRecord: fixturesRecord !== undefined ? fixturesRecord : currentRows,
            });

            const w = await withAutoRelogin(() => remote.sportBackOffice.worldCupPlatform.SaveWorldCupFixturesInfo(merged));

            // 2026-08-28 dev 實測發現：把讀回來的內容原封不動送回去（例如只是想確認一下、或重跑同一個
            // 指令），後端會回 genie ErrorCode.nothingChanged（=10，genie/src/common/error_code.ts:12）——
            // 因為 UPDATE 沒有改到任何欄位。這在語意上不是失敗：呼叫端要的狀態本來就已經是現況。
            // 「這個碼不可能代表找不到列」不是靠推論，是發碼點本身就把兩種情況分開：發 10 的是
            // agrabah/src/engines/relational_database/mysql/mysql_relational_database_engine.ts:206-236 的
            // updateObject(object, notModifiedIsError=true)——也正是 db:663 走的那支。該函式裡
            // 「物件沒有 id 欄位」(:207-208) 與「用 id 重讀不到原物件」(:221-223) 一律回
            // ErrorCode.idNotExists，**只有**逐欄 diff 後 keys.length === 0 才回 nothingChanged (:234-236)。
            // 而且那個 return 發生在送出任何 UPDATE SQL 之前，代表回這個碼時 DB 根本沒被動過。
            // 因此這裡不當成錯誤，改為照常做 round-trip 讀回、回傳 success 並掛上 nothingChanged 旗標。
            // 附帶：operatorId = context.userId 也在 diff 範圍內，所以實務上只有「同一個操作者送出完全
            // 相同的內容」才會觸發；換一個操作者送相同內容會正常 UPDATE 成功。
            const nothingChanged = w.failed && w.errorCode === ErrorCode.nothingChanged;
            if (w.failed && !nothingChanged) {
                return asErrorResult(w, { stage: '寫入失敗，設定應維持原狀（建議再讀一次確認）', before: beforeSnapshot });
            }

            // 第 4 節第 2 點：round-trip 讀回，讓呼叫端能逐欄比對沒要求改的欄位有沒有被動到。
            const after = await withAutoRelogin(() => remote.sportBackOffice.worldCupPlatform.GetWorldCupFixturesInfo());
            if (after.failed) {
                return asErrorResult(after, { stage: '寫入已送出成功，但 round-trip 讀回失敗，請自行再查一次確認結果', before: beforeSnapshot });
            }
            const now = after.data?.worldCupFixturesSetting ?? null;
            const afterRows = Array.from(now?.fixturesRecord ?? []).map((row) => ({
                id: row.id ?? 0,
                teamGroup: row.teamGroup ?? '',
                tempRanking: row.tempRanking ?? 0,
                teamName: row.teamName ?? '',
                teamPictureUrl: row.teamPictureUrl ?? '',
                totalMatches: row.totalMatches ?? 0,
                matchResult: row.matchResult ?? '',
                goalsResult: row.goalsResult ?? '',
                points: row.points ?? 0,
                showAdvance: row.showAdvance ?? 0,
            }));
            const afterSnapshot = { open: now?.open ?? 0, fixturesRecord: afterRows };

            const untouchedRowsPreserved = fixturesRecord === undefined
                ? JSON.stringify(afterSnapshot.fixturesRecord) === JSON.stringify(beforeSnapshot.fixturesRecord)
                : undefined;

            return asTextResult({
                success: true,
                nothingChanged,
                created,
                changed: {
                    open: open !== undefined ? { from: beforeSnapshot.open, to: afterSnapshot.open } : '未指定，維持現況',
                    fixturesRecordCount: { from: beforeSnapshot.fixturesRecord.length, to: afterSnapshot.fixturesRecord.length },
                },
                untouchedRowsPreserved,
                before: beforeSnapshot,
                after: afterSnapshot,
                hint: nothingChanged
                    ? '後端回報這次沒有任何欄位被改動（送出的內容與現況完全相同），已照常讀回現況供你確認；這不是錯誤。'
                    : '後端是整包覆蓋語意；要還原成呼叫前的狀態，把上面 before 的 open 與 fixturesRecord 整份送回本 tool 即可。',
            });
        },
    );
}
