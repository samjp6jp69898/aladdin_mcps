/**
 * tools/create_urgent_info_config.ts — aladdin_platform_urgent_info_platform_create_config
 *
 * rajah: UrgentInfoPlatform.CreateConfig（information_back_office.rajah:120，
 * @Permission "DailyOperation.Information.Create"）——新增一筆「緊急通知」設定。
 *
 * 2026-08-25 讀 agrabah 後端原始碼查證：
 * - agrabah/src/servers/information_back_office/services/urgent.ts:33-37 methodCreateConfig 直接
 *   委派 `InformationBackOfficeManager.createConfig(context, DbUrgentInfo, config)`，非
 *   notImplemented 空殼。
 * - agrabah/src/managers/information_manager.ts:27-118 createConfig 的關鍵行為：
 *   - **新建立的紀錄一律強制 status=disabled**（:60 `status: StatusEnum.disabled`），呼叫端無法
 *     透過這支 method 直接建立「已上線」的通知，必須另外呼叫 EnableConfig 才會生效——這代表本
 *     工具的寫入操作對真實使用者沒有立即可見的副作用，風險低於一般 Create。
 *   - 會寫一筆後台操作日誌（:110 after(context, PlatformActionIdEnum.informationCreate, forAudit)），
 *     這是唯一的背景副作用；不會觸發 InformationStartProcessJob／PopulateInformationConfigCache——
 *     這兩個 import 只在 updateConfig 啟用中的紀錄（:241-242）與 updateStatus 轉為 enabled（:294-296）
 *     時才觸發，CreateConfig 因為一律建成 disabled，不會走到這兩個分支。
 *   - endAtTimestamp 只有 > 0 時才會拿去跟 startAtTimestamp 比較（`endAtTimestamp > 0 &&
 *     startAtTimestamp >= endAtTimestamp` 才回錯誤 informationInvalidConfigEndTime），
 *     endAtTimestamp=0 代表「不設結束時間」，是合法值不是漏填。
 *   - title/content 為必填且不可為空陣列（agrabah/src/database_types/information.ts:224-238
 *     validate()），每個 LocalizationString 的 code 不可為空字串、value 必須是字串。
 *   - DbUrgentInfo 的能力旗標（database_types/information.ts:399）：needTitle/needEndAt/needPush/
 *     needFreq 為 true，needRole/hasLink/hasGift/needPopup/needMarquee/hasLiveId 為 false——與
 *     rajah UrgentInfoCreateOrUpdate 只有 title/sort/content/startAtTimestamp/endAtTimestamp/
 *     pushingFrequency 六個欄位（無 roleConfig/gifts/popup/marquee）完全對應。
 * - **RPC 本身不回傳新建紀錄的 id**（回傳型別是 `Empty`），比照 aladdin-admin 的
 *   `aladdin_admin_platform_management_create_platform` 既有慣例（該工具用 code 讀回驗證），
 *   本工具建立成功後改用 title 做盡力而為（best-effort）讀回：呼叫
 *   `CommonInfoPlatform.GetConfigs`（type=urgent, status=disabled, title=第一組
 *   LocalizationString 的 value 當模糊搜尋關鍵字, pageSize=50, 依 id DESC 排序)，在結果中找
 *   title 陣列與呼叫端輸入完全相同（JSON 深比對）的第一筆（id 最大，即最新建立）。title 不是
 *   唯一鍵，若短時間內有其他人建立了相同 title 的緊急通知，讀回結果可能不是這次建立的那一筆——
 *   description 已明確標註此限制，不保證讀回一定準確，只是「RPC 沒報錯」以外的額外佐證。
 *
 * 2026-08-25 dev 實測（stdio 直打本工具，dev 帳密，對 pk-platform.alddev.com）：
 * 用帶時間戳記的獨特測試字串建立一筆緊急通知，確認：
 * - CreateConfig 呼叫成功（errorCode=0）。
 * - 讀回機制正確找到剛建立的紀錄，title/content/sort/pushingFrequency 與輸入一致，status=disabled
 *   （驗證「新建一律 disabled」）。
 * - endAtTimestamp=0（不設結束時間）與 endAtTimestamp>startAtTimestamp 兩種合法情境皆測試通過；
 *   endAtTimestamp<=startAtTimestamp（且 >0）時後端正確回 informationInvalidConfigEndTime。
 * - 測試完成後用讀回的 id 呼叫 DeleteConfig 清理（軟刪除為 status=deleted，updateStatus 沒有轉換
 *   限制，deleted 狀態的紀錄不會出現在預設查詢中），確認 dev 環境未留下測試髒資料。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { InformationSearch, LocalizationString, UrgentInfoCreateOrUpdate } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { INFORMATION_TYPE_MAP, STATUS_MAP, toPlainNumber } from '../const.ts';

const localizationSchema = z.object({
    code: z.string().min(1).describe('語系代碼，例如 zh-CN、zh-TW、en-US'),
    value: z.string().describe('該語系下的文字值'),
});

export function registerCreateUrgentInfoConfigTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_urgent_info_platform_create_config',
        {
            title: 'Create an urgent info notice',
            description:
                '新增一筆「緊急通知」設定（rajah: UrgentInfoPlatform.CreateConfig，需要權限節點 ' +
                'DailyOperation.Information.Create）。新建立的紀錄**一律強制為 disabled 狀態**' +
                '（後端寫死，呼叫端無法透過這支方法直接建立已上線的通知），要讓它生效需另外呼叫 ' +
                'EnableConfig（本 domain 尚未包裝成 tool，之後補上）；建立時會寫一筆後台操作日誌，' +
                '但不會觸發任何背景 job 或快取刷新（那些只在啟用時才觸發）。' +
                'endAtTimestamp 不帶或帶 0 代表不設結束時間；有帶（>0）時必須大於 startAtTimestamp，' +
                '否則回 informationInvalidConfigEndTime。' +
                'RPC 本身不回傳新建紀錄的 id（回傳型別是 Empty），本工具建立成功後會用 title 做' +
                '盡力而為的讀回查找（找 type=urgent/status=disabled/title 完全相同、id 最大的一筆），' +
                'title 不是唯一鍵，讀回結果不保證一定是這次建立的那一筆，僅供額外佐證，找不到時不代表' +
                '建立失敗（RPC 本身沒報錯即代表已寫入）。',
            inputSchema: {
                title: z.array(localizationSchema).min(1).describe('通知標題，多語系陣列，至少 1 筆，必填'),
                sort: z.number().int().min(0).describe('排序值，越小越前面，必填'),
                content: z.array(localizationSchema).min(1).describe('通知內容（富文本 HTML 字串放在 value），多語系陣列，至少 1 筆，必填'),
                startAtTimestamp: z.number().int().describe('生效開始時間，毫秒 epoch（非秒），必填'),
                endAtTimestamp: z.number().int().optional().describe('生效結束時間，毫秒 epoch（非秒）。不帶或 0 代表不設結束時間；有帶時必須大於 startAtTimestamp'),
                pushingFrequency: z.number().int().min(0).optional().describe('推播頻率設定值，不帶則送 0'),
            },
        },
        async ({ title, sort, content, startAtTimestamp, endAtTimestamp, pushingFrequency }) => {
            const config = UrgentInfoCreateOrUpdate.create({
                title: title.map((t) => LocalizationString.create(t)),
                sort,
                content: content.map((c) => LocalizationString.create(c)),
                startAtTimestamp,
                endAtTimestamp: endAtTimestamp ?? 0,
                pushingFrequency: pushingFrequency ?? 0,
            });
            const r = await withAutoRelogin(() => remote.informationBackOffice.urgentInfoPlatform.CreateConfig(config));
            if (r.failed) return asErrorResult(r);

            // best-effort 讀回：title 完全相同 + status=disabled + type=urgent，取 id 最大的一筆。
            const titleJson = JSON.stringify(title);
            const searchTitle = title[ 0 ]?.value ?? '';
            const search = InformationSearch.create({ type: INFORMATION_TYPE_MAP.urgent, status: STATUS_MAP.disabled, title: searchTitle, ids: [], content: '', startAtFromTimestamp: 0, startAtToTimestamp: 0 });
            const listResult = await withAutoRelogin(() => remote.informationBackOffice.commonInfoPlatform.GetConfigs(search, 1, 50));
            const matched = !listResult.failed
                ? (listResult.data?.rows ?? []).find((row) => JSON.stringify(row.title) === titleJson)
                : undefined;

            const readBack = matched
                ? {
                    ...matched,
                    startAtTimestamp: toPlainNumber(matched.startAtTimestamp),
                    endAtTimestamp: toPlainNumber(matched.endAtTimestamp),
                    createdAtTimestamp: toPlainNumber(matched.createdAtTimestamp),
                    updatedAtTimestamp: toPlainNumber(matched.updatedAtTimestamp),
                    // UrgentInfo 的 hasGift=false，gifts 恆為空陣列，這裡仍比照 list_information_configs.ts
                    // 轉換 i64 的 expireTime，維持兩處邏輯一致，避免未來其他 type（如有 gift）複製本檔時漏做。
                    gifts: (matched.gifts ?? []).map((gift) => ({ ...gift, expireTime: toPlainNumber(gift.expireTime) })),
                }
                : { note: 'best-effort 讀回沒找到完全相同 title 的紀錄，不代表建立失敗，RPC 本身沒報錯即代表已寫入' };

            return asTextResult({ success: true, message: '建立成功（狀態強制為 disabled）', readBack });
        },
    );
}
