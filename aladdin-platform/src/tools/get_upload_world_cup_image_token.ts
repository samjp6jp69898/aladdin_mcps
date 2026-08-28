/**
 * tools/get_upload_world_cup_image_token.ts — aladdin_platform_world_cup_platform_get_upload_world_cup_image_token
 *
 * rajah: WorldCupPlatform.GetUploadWorldCupImageToken() (token string 1)
 * （rajah/services/world_cup_back_office.rajah:420）。
 *
 * method-category-checklist.md 第 0 節排除規則已過：非 Placeholder（world_cup_back_office.rajah 全檔
 * 沒有任何 Placeholder method）；service WorldCupPlatform 沒有 @NoPublic（同檔 410-441 的
 * `# @Permission "WorldCup"` 是被註解掉的 @Permission）；agrabah 後端確實有 override、非 base class 的
 * notImplemented——agrabah/src/servers/sport_back_office/services/world_cup_platform.ts:89-101
 * methodGetUploadWorldCupImageToken，委派 agrabah/src/managers/file_manager.ts:96-108 createUploadToken
 * （folder='worldCup'、customData={maxSize:1920,format:'webp'}、postProcesses=[optimizeImage]、withTempFile=true）。
 *
 * 分類（method-category-checklist.md 第 8 節「上傳/建立用 token 類」）：名字是 Get 但性質是寫入前置動作。
 * 該節要求「驗證有效期限、是否綁定呼叫者身份、多次呼叫是否使前一個失效」，三項查證結果如下，
 * 全部寫進 description 讓呼叫端看得到：
 * - **有效期限**：1 小時。token 內容存在 cache，TTL 來自 file_manager.ts:12 的
 *   `FILE_DATA_EXPIRED_TIME = 60 * 60`，由 file_manager.ts:81-83 storeFileData 寫入。
 * - **是否綁定呼叫者身份**：**沒有綁定**。FileData（file_manager.ts:47-77）只存 folder / filename / path /
 *   customData / postProcesses / withTempFile，**沒有 platformId、也沒有 userId**；cacheKey 是
 *   `file:<隨機 id>`（:63-65），與登入身分無關。消費端 `POST {BASE_URL}/upload` 只吃 token + file、
 *   不帶 Authorization（見本 server 的 session.ts:302-320 uploadFile）；agrabah 路由端本身也沒有掛任何
 *   auth middleware——`app.post('/upload', bodyLimit(...), handler)` 直接 parseBody 交給 fileManager.upload
 *   （agrabah/src/servers/gate/handlers/file_handler.ts:32-49）。也就是說**這個 token 是一張
 *   不記名的短期憑證，任何拿到它的人都能在這 1 小時內往 worldCup 目錄上傳一個檔案**。
 * - **多次呼叫是否使前一個失效**：**不會**。每次呼叫都 `new FileData()`、id 走 short.generate()
 *   （file_manager.ts:56-60），彼此獨立，舊 token 在自己的 1 小時 TTL 內仍然有效。
 * - 補充（單次性）：同一個 token 只能成功上傳一次——upload 會把 status 從 waiting 改成 uploading
 *   （file_manager.ts:120-128），第二次用同一個 token 會拿到 fileTokenStateNotMatch。
 *
 * 因為是不記名憑證，本 tool 的回傳只放 token 本身、不做任何持久化紀錄，description 也明寫「勿快取、
 * 勿轉傳、勿寫進日誌」。
 *
 * **已知使用限制（誠實揭露）**：本 domain 目前**沒有任何會消費這個 token 的寫入 tool**——
 * 唯一會用到世界盃圖片欄位的是 WorldCupPlatform.SaveWorldCupInfo（world_cup_back_office.rajah:414），
 * 那支尚未包成 MCP tool。所以現階段這支只在「配合 server 端 uploadFile 流程手動上傳圖片」時有用。
 *
 * 跨租戶：token 不帶平台資訊（見上），上傳目錄固定 'worldCup'，不因平台而異。
 *
 * 本身不修改任何業務資料（只在 cache 建一筆 1 小時後自動過期的暫存紀錄），但**不是唯讀查詢**，
 * 每次呼叫都會產生一張新憑證，不要為了「試試看」而重複呼叫。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerGetUploadWorldCupImageTokenTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_world_cup_platform_get_upload_world_cup_image_token',
        {
            title: 'Issue a short-lived upload token for world cup images',
            description:
                '取得一張世界盃活動圖片的**上傳用短期憑證**（rajah: WorldCupPlatform.GetUploadWorldCupImageToken，' +
                'world_cup_back_office.rajah:420）。**本 service 目前沒有權限節點把關**——rajah 上的 ' +
                '`@Permission "WorldCup"` 整段被註解掉，只要登入平台後台即可呼叫。' +
                '\n\n' +
                '**這不是唯讀查詢**：名字雖然是 Get，實際上每次呼叫都會**新發一張憑證**，是上傳流程的前置動作。' +
                '不要為了探測而反覆呼叫。' +
                '\n\n' +
                '**憑證性質（2026-08-28 讀原始碼查證，三點都要注意）**：' +
                '(1) **有效期 1 小時**（agrabah/src/managers/file_manager.ts:12 FILE_DATA_EXPIRED_TIME=3600 秒），' +
                '過期即失效，**不要快取或重複使用**，每次要上傳就重新取一張。' +
                '(2) **不記名**——憑證內容不含平台 id 也不含使用者 id（file_manager.ts:47-65 的 FileData 沒有這些欄位），' +
                '而消費端 `POST /upload` 只驗 token、不帶 Authorization。也就是說任何拿到這個 token 的人，' +
                '都能在有效期內往 worldCup 目錄上傳一個檔案。**請勿把這個值寫進日誌、轉貼到對話以外的地方、或交給第三方。**' +
                '(3) **重複呼叫不會使先前的憑證失效**——每次都是獨立的新 token，舊的在自己的 1 小時內仍可用。' +
                '另外同一張 token **只能成功上傳一次**，上傳後狀態即改變，再用會得到 fileTokenStateNotMatch 錯誤。' +
                '\n\n' +
                '上傳限制（後端建立憑證時就寫死，呼叫端不能改）：圖片長寬上限 1920、一律轉成 webp 格式、' +
                '會經過影像最佳化後處理，且以暫存檔形式存放；上傳目錄固定為 worldCup。' +
                '\n\n' +
                '**目前的使用限制**：本 MCP server **還沒有任何會消費這張憑證的世界盃寫入 tool**——' +
                '會用到世界盃圖片欄位的是 WorldCupPlatform.SaveWorldCupInfo，那支尚未包成 tool。' +
                '所以現在取到 token 之後，需要自行走 agrabah 的 `POST /upload`（form-data 帶 token + file）' +
                '才能換到圖片路徑。',
            inputSchema: {},
        },
        async () => {
            const r = await withAutoRelogin(
                () => remote.sportBackOffice.worldCupPlatform.GetUploadWorldCupImageToken(),
            );
            if (r.failed) return asErrorResult(r);
            return asTextResult({
                success: true,
                token: r.data?.token ?? '',
                expiresInSeconds: 3600,
                warning: '這是不記名的短期上傳憑證（1 小時、單次上傳有效）：不要寫進日誌、不要快取重用、不要轉交他人。'
                    + '重複呼叫本 tool 不會使先前發出的憑證失效。',
                uploadConstraints: { folder: 'worldCup', maxSize: 1920, format: 'webp', postProcess: 'optimizeImage', withTempFile: true },
            });
        },
    );
}
