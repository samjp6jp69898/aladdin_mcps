/**
 * tools/create_or_update_ip_region.ts — aladdin_platform_risk_platform_ip_region_create_or_update_ip_region
 *
 * rajah: RiskPlatformIpRegion.CreateOrUpdateIpRegion（risk_back_office.rajah:22）——id=0/留空為新增，
 * id>0 為更新。回傳型別是 Empty（無新 id），見 remote.gen.ts。
 *
 * 2026-08-25 讀 agrabah 後端原始碼查證（risk_platform_ip_region.ts:96-253）＋用 `bun -e` 對真正的
 * protobufjs 生成類別（RiskIpRegionEdit）與真正的 DbObject.assignKey()/DbRiskIpRegion 做隔離實測
 * （含完整 encode→decode 的真實 wire round trip）：
 * - `limitItem`/`limitMethod`/`limitContent`/`gameType`/`ids` 在 rajah model 皆標 `@Rules "Required"`
 *   （risk_back_office.rajah:120,123,126,129,132），本工具比照要求呼叫端每次都明確帶這些欄位，不提供
 *   「省略沿用舊值」的捷徑。
 * - ⚠️ **`remark` 地雷（已修正）**：assignKey 的判斷式是
 *   `(source.hasOwnProperty(key) && source[key] !== null) || source[key] === 0`——第一個 OR 分支只要
 *   欄位是 own property 就會觸發，跟值是什麼無關。若在 `.create({...})` 物件字面量裡無條件寫
 *   `remark: remark ?? ''`，即使呼叫端沒帶 remark，這個 key 依然會成為 own property，實測會把既有
 *   備註靜默清空——不是原本誤判的「只有 === 0 分支需要擔心」。修法：**只在呼叫端真的有帶 remark 時
 *   才把這個 key 放進物件**（省略時完全不放這個 key，讓它連 own property 都不是），已用真實生成類別
 *   encode/decode round trip 驗證可行。
 * - `promptText`（多語提示文字）不是直接存在這張表，是透過 `LocalizationManager.updateLocalizations`
 *   逐語系 upsert（`localization_manager.ts:61-64`）：只會更新陣列裡明確帶到的語系代碼，沒帶到的語系
 *   維持原值，不是整包覆蓋——空陣列/省略時 for 迴圈完全不執行，經實測確認是真的安全 no-op，
 *   跟 remark 的直接欄位覆蓋機制本質不同，不需要同樣的「省略 key」處理。
 * - `customerId`（i32，非 Required，語意「0=不開啟，>0=開啟id」）：省略時 protobufjs 讀出的預設值是
 *   0，會被 assignKey 判定成「明確要設成 0」寫入 DB，等同靜默關閉客服連結。因為這個 service 沒有對應
 *   的 GetForEdit 方法，本工具在更新時改用 `GetIpRegionList` 掃描找出目前的 customerId 當基準值
 *   （見 findIpRegionRowById()），呼叫端沒帶 customerId 時原樣沿用。
 * - 新增後無法拿到新 id（RPC 回傳 Empty），改用「呼叫前後 id 集合 diff」找出新增的那一筆（同一套手法見
 *   aladdin_admin_risk_admin_create_or_update_platform_risk_strategy 的 listAllStrategyIds()）。
 * - `limitContent` 依 `limitMethod` 會被後端格式驗證（IP 或國碼），格式錯誤回業務錯誤碼
 *   riskInvalidIpAddressFormat/riskInvalidCountryCodeFormat，非拋例外。
 * - 更新分支完成後會重新掃描 GetIpRegionList 讀回目前列的完整內容（round-trip），讓呼叫端能核對
 *   包含 remark 在內的欄位是否真的如預期（未指定的欄位是否仍等於呼叫前的值）。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { RiskIpRegionEdit, RiskIpRegionSearch } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { RISK_LIMIT_ITEM_MAP, RISK_LIMIT_METHOD_MAP, RISK_GAME_TYPE_MAP, PAGE_SIZE_MAP } from '../const.ts';

const MAX_SCAN_PAGES = 20; // size200/頁，上限 4000 筆，遠大於單一平台實際規則數。

/** 這個 service 沒有 GetForEdit，只能用不分頁掃描 GetIpRegionList 找出指定 id 的現有列。 */
async function findIpRegionRowById(id: number): Promise<
    { failed: true; errorResult: { failed: true; errorCode: number; message: string } }
    | { failed: false; row: Record<string, unknown> | undefined; allIds: number[] }
> {
    const allIds: number[] = [];
    let matched: Record<string, unknown> | undefined;
    let totalPage = 1;
    for (let page = 1; page <= totalPage && page <= MAX_SCAN_PAGES; page++) {
        const r = await withAutoRelogin(() => remote.riskBackOffice.riskPlatformIpRegion.GetIpRegionList(
            RiskIpRegionSearch.create({}), page, PAGE_SIZE_MAP.size200,
        ));
        if (r.failed) return { failed: true, errorResult: r as any };
        if (page === 1) totalPage = r.data?.totalPage ?? 1;
        const rows = r.data?.rows ?? [];
        if (rows.length === 0) break;
        for (const row of rows) {
            allIds.push(row.id ?? 0);
            if (row.id === id) matched = row as unknown as Record<string, unknown>;
        }
    }
    return { failed: false, row: matched, allIds };
}

export function registerCreateOrUpdateIpRegionTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_risk_platform_ip_region_create_or_update_ip_region',
        {
            title: 'Create or update an IP/region game-access restriction rule',
            description:
                '新增或更新一筆「限制遊戲 IP/地區」規則（rajah: RiskPlatformIpRegion.CreateOrUpdateIpRegion，' +
                'risk_back_office.rajah:22，upsert 語意）。id 留空或 0＝新增；id>0＝更新。' +
                'limitItem/limitMethod/limitContent/gameType/ids 這五個欄位在 rajah 皆為必填（@Rules Required），' +
                '新增與更新都必須明確帶齊，不支援「省略沿用舊值」。' +
                'remark/promptText 可安全省略：省略時原樣沿用現值（promptText 是逐語系 upsert，只有陣列裡明確帶到' +
                '的語系代碼會被覆蓋，其餘語系不受影響）。' +
                '⚠️ customerId 是唯一有零值覆蓋風險的欄位：這個 service 沒有 GetForEdit，本工具更新前會自動掃描 ' +
                'GetIpRegionList 找出目前的 customerId 當基準值，呼叫端不帶則沿用現值，帶 0 視為明確要關閉客服連結。' +
                'limitContent 依 limitMethod 有格式限制：limitMethod=ip 要求合法 IP 格式，limitMethod=countryCode ' +
                '要求合法國碼格式（逗號分隔多值皆需合法），格式錯誤回業務錯誤碼（非例外）。' +
                'ids 是「遊戲廠商 id」或「指定遊戲 id」（依 gameType 決定語意），至少要選一個，全部須為正整數。' +
                '⚠️ 新增無法拿到新 id（RPC 回傳 Empty），改用呼叫前後 id 集合 diff 找出新 id；若同時間有其他人在' +
                '同一平台新增，diff 可能無法唯一定位，工具會誠實回報而不是亂猜。' +
                '更新完成後會重新掃描讀回這筆規則目前的完整內容（round-trip），供核對未指定的欄位是否仍維持原值。' +
                'prod 執行前確認：當這個 server 是正式環境（prod）時，執行本工具前必須先用 AskUserQuestion' +
                '（或功能相同的方式）明確詢問使用者是否要在正式環境執行這個操作，取得明確同意後才可以帶上 confirm 參數；' +
                '絕不能自行假設使用者同意。非 prod 環境（dev/pre/evi）不需要、也會忽略 confirm 欄位。',
            inputSchema: {
                id: z.number().int().optional().describe('規則 id：留空或 0＝新增；帶入既有 id＝更新，id 從 get_ip_region_list 取得'),
                limitItem: z.enum([ 'gameBlack', 'gameWhite' ]).describe('黑名單（限制訪問）或白名單（允許訪問），必填'),
                limitMethod: z.enum([ 'ip', 'countryCode' ]).describe('限制方式：IP 或國家代碼，必填'),
                limitContent: z.string().min(1).describe('限制內容，逗號分隔多值，依 limitMethod 需為合法 IP 或國碼格式，必填'),
                gameType: z.enum([ 'provider', 'specified' ]).describe('限制作用範圍：廠商（provider）或指定遊戲（specified），必填'),
                ids: z.array(z.number().int().positive()).min(1).describe('廠商 id 或指定遊戲 id 清單（依 gameType 決定語意），至少一個，必填'),
                remark: z.string().max(200).optional().describe('備註，最長 200 字元；省略則沿用現值（新增時為空字串）'),
                promptText: z.array(z.object({
                    code: z.string().describe('語系代碼，例如 zh-CN、zh-TW、en-US'),
                    value: z.string().describe('該語系下的提示文字，最長 200 字元'),
                })).optional().describe('前台提示文字，多語系；只更新陣列裡明確帶到的語系，其餘語系維持原值，省略則完全不動'),
                customerId: z.number().int().min(0).optional().describe(
                    '客服連結 id：0＝不開啟，>0＝開啟指定客服連結 id。省略時更新會沿用現值，新增時預設 0（不開啟）',
                ),
                confirm: z.string().optional().describe(
                    `正式環境（prod）專用的強制確認欄位；非 prod 環境會被忽略、不需提供。當這個 server 是正式環境時，` +
                    `必須先取得使用者明確同意，再帶上精確字串 "${ PROD_CONFIRM_TOKEN }" 才會執行，否則本工具會拒絕執行並回錯誤。`,
                ),
            },
        },
        async ({ id, limitItem, limitMethod, limitContent, gameType, ids, remark, promptText, customerId, confirm }) => {
            assertProdConfirmed(confirm);

            const targetId = id ?? 0;
            const isCreate = targetId === 0;

            let resolvedCustomerId = customerId ?? 0;
            let beforeIds: number[] = [];

            if (isCreate) {
                const scan = await findIpRegionRowById(-1); // -1 必查無此列，僅用來取得新增前的完整 id 集合
                if (scan.failed) return asErrorResult(scan.errorResult);
                beforeIds = scan.allIds;
            } else {
                // 更新一律先掃描確認 id 存在（避免對不存在的 id 送出寫入），順便在呼叫端沒帶 customerId 時取得現值。
                const scan = await findIpRegionRowById(targetId);
                if (scan.failed) return asErrorResult(scan.errorResult);
                if (!scan.row) {
                    return asTextResult({ success: false, message: `查無 id=${ targetId } 的既有規則，未執行任何寫入` });
                }
                if (customerId === undefined) {
                    resolvedCustomerId = (scan.row.customerId as number | undefined) ?? 0;
                }
            }

            // remark 只在呼叫端真的有帶時才放進物件——省略時完全不設這個 key，避免 assignKey 的
            // `hasOwnProperty` 分支把它當成「明確要清空」而覆蓋既有備註（見檔頭註解的地雷說明）。
            // 新增時若省略，直接不帶等同後端 DbRiskIpRegion.create() 的預設空字串，行為不變。
            const edit = RiskIpRegionEdit.create({
                id: targetId,
                limitItem: RISK_LIMIT_ITEM_MAP[ limitItem ],
                limitMethod: RISK_LIMIT_METHOD_MAP[ limitMethod ],
                limitContent,
                gameType: RISK_GAME_TYPE_MAP[ gameType ],
                ids,
                ...(remark !== undefined ? { remark } : {}),
                promptText: promptText ?? [],
                customerId: resolvedCustomerId,
            });
            const writeR = await withAutoRelogin(() => remote.riskBackOffice.riskPlatformIpRegion.CreateOrUpdateIpRegion(edit));
            if (writeR.failed) return asErrorResult(writeR);

            if (!isCreate) {
                // round-trip：重新掃描讀回這筆規則目前的完整內容，供核對未指定的欄位是否仍維持原值。
                const after = await findIpRegionRowById(targetId);
                return asTextResult({
                    success: true,
                    mode: 'update',
                    id: targetId,
                    verified: after.failed ? null : (after.row ?? null),
                });
            }

            // 新增：找出呼叫前後 id 集合的差集，確認新 id。
            const after = await findIpRegionRowById(-1);
            if (after.failed) {
                return asTextResult({ success: true, mode: 'create', message: '寫入已送出，但讀回驗證失敗，請人工到後台確認' });
            }
            const beforeSet = new Set(beforeIds);
            const newIds = after.allIds.filter((rid) => !beforeSet.has(rid));

            if (newIds.length !== 1) {
                return asTextResult({
                    success: true,
                    mode: 'create',
                    message: newIds.length === 0
                        ? '寫入已送出，但前後讀回的 id 集合沒有新增任何 id，請人工到後台確認'
                        : `寫入已送出，但前後 diff 出 ${ newIds.length } 個新 id（可能有並發寫入），無法唯一確認是哪一筆：${ newIds.join(',') }`,
                });
            }

            return asTextResult({ success: true, mode: 'create', id: newIds[ 0 ] });
        },
    );
}
