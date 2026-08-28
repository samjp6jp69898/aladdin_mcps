/**
 * tools/get_world_cup_fixtures_info.ts — aladdin_platform_world_cup_platform_get_world_cup_fixtures_info
 *
 * rajah: WorldCupPlatform.GetWorldCupFixturesInfo() (worldCupFixturesSetting WorldCupFixturesSetting 1)
 * （rajah/services/world_cup_back_office.rajah:442；回傳型別 WorldCupFixturesSetting 定義在
 * rajah/services/world_cup_common.rajah:463-471，內含的 FixturesRecord 在同檔 474-496）。
 *
 * method-category-checklist.md 第 0 節排除規則已過：非 Placeholder；service WorldCupPlatform 沒有
 * @NoPublic（world_cup_back_office.rajah:410-411 只有一行被註解掉的 `# @Permission "WorldCup"`）；
 * agrabah 後端確實有 override、非 base class 的 notImplemented——
 * agrabah/src/servers/sport_back_office/services/world_cup_platform.ts:244-247 methodGetWorldCupFixturesInfo，
 * 委派 agrabah/src/servers/sport_back_office/models/world_cup_platform_db.ts:617-638 getWorldCupFixturesInfo。
 * （實作放在 sport_back_office server，agrabah 沒有 world_cup_back_office 目錄。）
 *
 * 分類（method-category-checklist.md 第 1 節「讀取單筆」）：無任何參數，回傳本平台唯一一筆賽程專欄設定
 * （world_cup_fixtures_info 表以 platform_id 為單位，每平台最多一列，見 saveWorldCupFixturesInfo 的
 * upsert 邏輯 world_cup_platform_db.ts:640-668）。
 *
 * **第 1 節要求實測「查無資料」的行為——這裡要分清楚哪條路徑真的實打過**：
 * - 「已設定」路徑：2026-08-28 對 dev（pk-platform.alddev.com）真打驗證過，回 configured=true、
 *   open=1、fixturesRecord 48 筆真實資料（含一筆全欄位皆為預設值的列，用來驗證下方的逐欄正規化有效）。
 * - 「尚未設定」路徑：**無法在 dev 重現、未實打**。該平台已存在一列設定，要製造出「查無資料」得直接
 *   刪 DB 那一列，超出本工作的授權範圍。此分支目前**只有原始碼依據**：world_cup_platform_db.ts:630 的
 *   `if (result.success && result.data.length > 0)` 整段會被跳過，後端**不回錯誤**、只是讓 response 的
 *   worldCupFixturesSetting 維持未設定（解碼後為 null）。本 tool 據此回 configured=false + setting=null，
 *   不讓 agent 自己猜 null 的意思。
 *
 * 跨租戶：SQL 寫死 `WHERE platform_id = ?` 帶 context.platformId，讀不到別平台資料。
 *
 * 敏感資料（第 8 節）：回傳只有開關、隊伍名稱/圖片、賽果統計等公開賽程資訊，無密鑰/token/PII，不需遮罩。
 *
 * 純讀取查詢，不修改任何資料，可安全重複呼叫。
 * 未來若新增賽程設定的寫入 tool（rajah: WorldCupPlatform.SaveWorldCupFixturesInfo），本 tool 是它的**必要前置**：
 * 該 Save 在後端是整包覆蓋、完全沒有 pre-load 合併（world_cup_platform_db.ts:640-668 直接 new 一個
 * DbWorldCupFixturesInfo 覆寫 open 與 fixtures 欄位），呼叫端必須先用本 tool 讀出現值再合併。
 * 該寫入 tool 尚未實作，所以 description 目前不指名引用它（避免引用不存在的 tool 名稱）。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerGetWorldCupFixturesInfoTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_world_cup_platform_get_world_cup_fixtures_info',
        {
            title: 'Get the world cup fixtures (standings) panel setting of the current platform',
            description:
                '讀取本平台的世界盃「賽程資訊專欄」設定（rajah: WorldCupPlatform.GetWorldCupFixturesInfo，' +
                'world_cup_back_office.rajah:442）。**本 service 目前沒有權限節點把關**——rajah 上的 ' +
                '`@Permission "WorldCup"` 整段被註解掉，只要登入平台後台即可呼叫。無參數；' +
                '賽程專欄以平台為單位，每個平台最多一筆設定（world_cup_fixtures_info 表，WHERE platform_id = 當前登入平台），' +
                '讀不到別平台的設定。' +
                '\n\n' +
                '2026-08-28 讀原始碼查證（agrabah/src/servers/sport_back_office/models/world_cup_platform_db.ts:617-638，' +
                '此分支未在 dev 實打——要製造出「查無資料」得直接刪 DB 那一列，超出授權範圍）：' +
                '本平台**尚未建立過**賽程設定時，後端不回錯誤、而是回一個空的回應，' +
                '本 tool 會據此回 `configured: false` 且 `setting: null`；已建立過則回 `configured: true`。' +
                '要區分「沒設定過」與「設定過但關閉」請看這個欄位，不要只看 open。' +
                '\n\n' +
                '欄位語意：`open` 是專欄總開關（0=關閉、1=開啟）；`fixturesRecord` 是各隊伍的賽程/積分列，' +
                'DB 裡存成單一 JSON 字串欄位，後端讀取時 JSON.parse 還原；該欄位為 NULL 或 JSON 解析失敗時' +
                '後端不會拋錯，而是當成「沒有任何列」——本 tool 會把這種情況正規化成空陣列 `[]`（不是 null、也不是缺鍵）。' +
                '每列的 tempRanking 是隊伍排名 TeamRankingEnum：1=第一、2=第二、3=第三、4=第四' +
                '（world_cup_common.rajah:443-452）；showAdvance 是「顯示晉級」（0=不顯示、1=顯示，' +
                'ShowAdvanceEnum，world_cup_common.rajah:455-460）；matchResult / goalsResult 是後台自由輸入的字串' +
                '（實測值如 "1/2/3"、"4/5/6"），不是結構化數值，不要嘗試當數字解析。' +
                'teamGroup（組別）也是自由字串，沒填時本 tool 回空字串。' +
                '\n\n' +
                '注意本設定在後端的寫入端是**整包覆蓋**語意（不做欄位合併），所以未來若要修改賽程設定，' +
                '一律得先用本 tool 讀出完整現值、只改要改的部分再整包送回，否則沒帶到的資料會被清掉。' +
                '純讀取查詢，不修改任何資料，可安全重複呼叫。',
            inputSchema: {},
        },
        async () => {
            const r = await withAutoRelogin(() => remote.sportBackOffice.worldCupPlatform.GetWorldCupFixturesInfo());
            if (r.failed) return asErrorResult(r);

            const setting = r.data?.worldCupFixturesSetting ?? null;
            if (!setting) {
                return asTextResult({ success: true, configured: false, setting: null });
            }

            // 不直接把 protobuf message 丟給 deepFixLongs：那支只走 Object.entries（own property），
            // 而 protobuf 的預設值欄位是掛在 prototype 上的，會被整個丟掉——open=0 或 fixturesRecord 為空時
            // 鍵會直接消失，呼叫端分不清「值是預設值」與「後端沒回這個欄位」。這裡逐欄顯式讀出並補上預設值。
            return asTextResult({
                success: true,
                configured: true,
                setting: {
                    id: setting.id ?? 0,
                    open: setting.open ?? 0,
                    fixturesRecord: Array.from(setting.fixturesRecord ?? []).map((row) => ({
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
                    })),
                },
            });
        },
    );
}
