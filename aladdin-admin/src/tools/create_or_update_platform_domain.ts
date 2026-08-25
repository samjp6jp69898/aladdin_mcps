/**
 * tools/create_or_update_platform_domain.ts — aladdin_admin_core_admin_create_or_update_platform_domain
 *
 * rajah: CoreAdmin.CreateOrUpdatePlatformDomain(platformId i32 1, domain PlatformDomain 2)
 * （rajah/services/core.rajah:227-228，需要權限節點 PlatformManagementAdmin.PlatformList.Domain.Edit）。
 *
 * method-category-checklist.md 第 0 節排除規則已過：非 Placeholder、非 @NoPublic；agrabah 對應實作
 * agrabah/src/servers/core_back_office/services/core_admin.ts:210-243（methodCreateOrUpdatePlatformDomain）
 * 確認有真實實作，非 base class 的 notImplemented。方法名含 CreateOrUpdate、吃一個
 * PlatformDomain（非 XxxEdit 命名但結構相同）model，套用 method-category-checklist.md 第 4 節。
 *
 * 2026-08-25 讀源碼查證：
 * - `domain.id === 0` 走新增（insertObject），否則走更新（`updateObject(dbDomain, false)`——第二參數
 *   真名是 `notModifiedIsError`，見 mysql_relational_database_engine.ts:206-237，`false` 時欄位 diff
 *   為空也回 `ErrorCode.success`；與 CurrencyAdmin.UpdateCurrency 用 `true`（欄位 diff 為空回
 *   `nothingChanged`）不同，這支就算新值與現值完全相同也不會回 nothingChanged，直接回成功。
 * - **重要風險（已讀源碼確認，非推論）：更新時完全沒有驗證 id 是否真的屬於 platformId 參數指定的
 *   平台**。後端邏輯是「不論 id 屬於哪個平台，一律把 `dbDomain.platformId` 覆寫成呼叫端傳入的
 *   platformId 再 updateObject」（core_admin.ts:221-232）——若呼叫端對一個屬於平台 A 的域名 id，
 *   帶上平台 B 的 platformId 呼叫這支方法，後端會**把這筆域名記錄的所屬平台改成 B**（域名劫持/
 *   平台路由被改到別的平台），且沒有任何錯誤提示。本工具在更新分支（id 非 0）前，強制先呼叫
 *   GetPlatformDomains(platformId) 確認這個 id 真的在該平台的清單裡，不在則直接拒絕、不送出 RPC——
 *   這是本工具自己加的防線，不是後端保護。**這道防線防的是誤用/手滑（帶錯 platformId），不是防
 *   惡意繞過或併發：查核與寫入之間非原子操作（無鎖、無版本欄位），若在查核通過後、RPC 送出前，
 *   該域名剛好被另一個呼叫改到別的平台，本工具仍會把它改回呼叫端指定的 platformId，屬理論上的
 *   TOCTOU 競態，對 admin 後台工具的實際併發現實影響很小，予以記錄但不特別處理。
 * - `domainType` 只有 platform/agent 兩種真正生效的值：後端用三元判斷
 *   `domain.domainType === PlatformDomainTypeEnum.platform ? GateId.platform : GateId.agent`
 *   （core_admin.ts:224），也就是說**任何非 platform 的值（包含 promotion=3）都會被當成 agent**，
 *   沒有真正的 promotion 分支。本工具的 zod schema 只允許 'platform'/'agent' 兩個選項，不接受
 *   promotion，避免呼叫端誤用一個實際上會被靜默改判成 agent 的值。
 * - platformId 不存在時回 `AgrabahErrorCodeEnum.platformNotExists`（core_admin.ts:217-218，寫入前
 *   檢查），不會靜默成功。
 * - **`domains.domain` 欄位有全域 UNIQUE 索引**（agrabah/migrations/core/202412301835_create_domains.sql，
 *   `CONSTRAINT domains_domain_index UNIQUE (domain)`）：同一個 domain 字串不能同時存在於任兩筆記錄
 *   （不論同平台或跨平台），撞到會回業務錯誤（duplicatedData），不會靜默成功、也不會覆蓋別人的記錄。
 *   這個約束同時保證了本工具用 domain 字串做讀回比對（round-trip）不會撞到別的列。
 * - 成功後同時 publish 兩條 ReloadDomain message（gateName: platform、agent），立即影響對應 gate
 *   的域名路由快取，是有實際運維影響的操作，非單純資料庫記錄。
 * - **沒有對應的刪除/停用 method**：整個 CoreAdmin service 找不到 DeletePlatformDomain 之類的
 *   method，PlatformDomain model 也沒有 status 欄位可停用。新增的域名記錄一旦建立無法透過 RPC
 *   移除，只能之後再呼叫本工具把 `domain` 欄位改成別的值覆蓋掉——不是真正的刪除。dev 驗證時比照
 *   本目錄 `create_platform.ts` 先例（真建一筆測試平台，因同樣無刪除 method），用明顯的測試字串
 *   建立一筆域名，接受它留在 dev（非正式環境，且值本身就標示為測試用途，無法被解析成真實網域）。
 *
 * ⚠️ 這支寫入後立即影響對應平台的域名路由（platform/agent gate），請先確認影響範圍再對非測試平台
 * 執行；建議只在測試用平台或明確要新增/修改的域名上操作。
 *
 * prod 執行前確認（H36，比照本 server 既有寫入 tool 慣例）：正式環境需先取得使用者明確同意、帶上
 * confirm 參數。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { PlatformDomain } from '/Users/user/aladdin/abu/admin/src/generated/types.gen.js';
import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { toPlainNumber } from '../const.ts';

const DOMAIN_TYPE_MAP = { platform: 1, agent: 2 } as const;
const DOMAIN_TYPE_KEYS = Object.keys(DOMAIN_TYPE_MAP) as [ keyof typeof DOMAIN_TYPE_MAP, ...(keyof typeof DOMAIN_TYPE_MAP)[] ];

export function registerCreateOrUpdatePlatformDomainTool(server: McpServer): void {
    server.registerTool(
        'aladdin_admin_core_admin_create_or_update_platform_domain',
        {
            title: 'Create or update a platform/agent gate domain',
            description:
                '新增或更新一筆平台域名（rajah: CoreAdmin.CreateOrUpdatePlatformDomain，需要權限節點 ' +
                'PlatformManagementAdmin.PlatformList.Domain.Edit）。id 省略或 0 走新增，帶入既有 id 走更新。' +
                'id 從 aladdin_admin_core_admin_get_platform_domains 取得。' +
                'domainType 只接受 platform/agent（後端沒有真正的 promotion 分支，任何非 platform 的值都會' +
                '被當成 agent，本工具不提供 promotion 選項避免誤用）。' +
                '⚠️ 更新既有 id 時，本工具會先確認該 id 真的屬於你指定的 platformId（GetPlatformDomains 查核），' +
                '不屬於就拒絕——後端本身完全不驗證這件事，直接帶錯 platformId 會把該域名記錄的所屬平台改成' +
                '你指定的那個 platformId（等同把域名路由改到別的平台），本工具在呼叫層加了這道防線。' +
                '⚠️ 寫入成功會立即觸發對應 gate（platform/agent）的域名路由快取刷新，是有實際運維影響的操作。' +
                '⚠️ 沒有對應的刪除/停用 method，新增的域名記錄無法真正移除，只能之後再呼叫本工具把 domain ' +
                '欄位改成別的值覆蓋——測試時請用明顯可辨識的測試字串（例如帶 zz-test- 前綴），避免建立容易與' +
                '真實域名混淆的資料。' +
                '⚠️ domain 欄位有全域 UNIQUE 約束（DB 層，不分平台），重複的 domain 字串會回業務錯誤' +
                '（duplicatedData），不會靜默成功或覆蓋別的記錄。' +
                'platformId 不存在時回業務錯誤，不會靜默成功。' +
                'prod 執行前確認（H36）：當這個 server 是正式環境（prod）時，執行本工具前必須先用 ' +
                'AskUserQuestion（或功能相同的方式）明確詢問使用者是否要在正式環境執行這個操作，取得明確' +
                '同意後才可以帶上 confirm 參數；絕不能自行假設使用者同意。非 prod 環境（dev/pre/evi）不' +
                '需要、也會忽略 confirm 欄位。',
            inputSchema: {
                platformId: z.number().int().describe('平台 id，來自 aladdin_admin_platform_management_list_platform_details 的回傳結果'),
                id: z.number().int().min(0).optional().describe('域名記錄 id；省略或 0 代表新增，帶入既有 id（來自 aladdin_admin_core_admin_get_platform_domains）代表更新'),
                domain: z.string().min(1).describe('域名字串，例如 abu-platform.alddev.com'),
                domainType: z.enum(DOMAIN_TYPE_KEYS).describe('域名類型：platform 或 agent（不支援 promotion，見上方說明）'),
                confirm: z.string().optional().describe(
                    `正式環境（prod）專用的強制確認欄位；非 prod 環境會被忽略、不需提供。當這個 server 是正式環境時，` +
                    `必須先取得使用者明確同意，再帶上精確字串 "${ PROD_CONFIRM_TOKEN }" 才會執行，否則本工具會拒絕執行並回錯誤。`,
                ),
            },
        },
        async ({ platformId, id, domain, domainType, confirm }) => {
            assertProdConfirmed(confirm);
            const targetId = id ?? 0;

            // i64 timestamp 經 protobufjs decode 可能是 Long 物件，統一轉換避免吐出內部物件（同批
            // get_platform_domains.ts 的慣例）。
            const toPlainRow = (row: { updatedAtTimestamp?: unknown; createdAtTimestamp?: unknown }) => ({
                ...row,
                updatedAtTimestamp: toPlainNumber(row.updatedAtTimestamp),
                createdAtTimestamp: toPlainNumber(row.createdAtTimestamp),
            });

            if (targetId !== 0) {
                const listBefore = await withAutoRelogin(() => remote.coreBackOffice.coreAdmin.GetPlatformDomains(platformId));
                if (listBefore.failed) return asErrorResult(listBefore);
                const owned = listBefore.data?.rows?.find((row) => row.id === targetId);
                if (!owned) {
                    return asTextResult({
                        success: false,
                        message: `拒絕：id=${ targetId } 不在 platformId=${ platformId } 的域名清單裡（可能不存在，或屬於另一個平台）——` +
                            '後端不驗證此關聯、帶錯 platformId 會把域名改到別的平台，本工具主動擋下，未送出 RPC',
                        rowsOfThisPlatform: (listBefore.data?.rows ?? []).map(toPlainRow),
                    });
                }
            }

            const domainPayload = PlatformDomain.create({
                id: targetId,
                domain,
                domainType: DOMAIN_TYPE_MAP[ domainType ],
            });
            const r = await withAutoRelogin(() => remote.coreBackOffice.coreAdmin.CreateOrUpdatePlatformDomain(platformId, domainPayload));
            if (r.failed) return asErrorResult(r);

            const listAfter = await withAutoRelogin(() => remote.coreBackOffice.coreAdmin.GetPlatformDomains(platformId));
            const matched = !listAfter.failed ? listAfter.data?.rows?.find((row) => row.domain === domain) : undefined;

            return asTextResult({
                success: true,
                message: targetId === 0 ? '新增成功' : '更新成功',
                readBack: matched ? toPlainRow(matched) : (!listAfter.failed
                    ? { note: '讀回時用 domain 字串比對找不到，非預期，請人工確認', rows: (listAfter.data?.rows ?? []).map(toPlainRow) }
                    : null),
            });
        },
    );
}
