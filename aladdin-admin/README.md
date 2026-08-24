# aladdin-admin MCP

讓 Claude Code 直接呼叫 agrabah **admin** 後台的 RPC method。架構、Stateless/Stateful 說明、新增 tool 的公版流程、安裝與連線方式，一律看 `../README.md`（不要在這裡重複維護）。

## 已支援 tool

Tool 命名規則：`<server>_<service>_<method>`（server/service/method 各自轉 snake_case），命名規則全文見 `../tool-naming-convention.md`。

| Tool | rajah method | 說明 |
|---|---|---|
| `aladdin_admin_auth_login` | `Auth.Login` | 登入，token 存 process 記憶體 |
| `aladdin_admin_game_vendor_admin_create_or_update_game_vendor` | `GameVendorAdmin.CreateOrUpdateGameVendor` | 建立三方遊戲場館，成功後自動讀回驗證 |
| `aladdin_admin_game_vendor_admin_create_or_update_game_vendor_game` | `GameVendorAdmin.CreateOrUpdateGameVendorGame` | **唯一真正能建立全新廠商遊戲的入口**（寫進全平台共用的廠商遊戲母表）；platform 後台沒有這個能力，只能對母表已存在的遊戲做「上架到某平台」（見 `aladdin-platform` 的 `aladdin_platform_game_vendor_platform_update_game_vendor_game`）。用 gameVendorId+gameId 業務鍵判斷新增還是更新（工具內部自動查，找不到既有遊戲時 `name` 必填），支援方形圖/直方圖/橫幅圖上傳、`localizedNames` 多語系名稱——2026-08-22 前是 `create_game.ts`/`edit_game.ts` 兩支分開的 tool，因底層本來就是同一支 upsert RPC，套用命名規則會撞名，合併成一支反映結構性事實 |
| `aladdin_admin_game_vendor_admin_list_game_vendors` | `GameVendorAdmin.ListGameVendors` / `ListAllGameVendors` | 列出「三方場館母表」的場館清單，**參數全選填、不帶參數即列出全部**（無篩選且無 `page` 時走 `ListAllGameVendors` 一次拿全部）。補上 admin 端原本缺的「無參數列出全部場館」能力——先前 7 支 tool 沒有任何一支做得到（`list_games` 必填 `gameVendorId`、`list_platform_game_vendors` 必填 `platformId` 且只涵蓋該平台已建立關聯的場館），導致 agent 為了拿場館 id 跑去 `aladdin-platform` 的 `aladdin_platform_game_vendor_platform_list_game_vendors`（那是「已上架到該平台」的清單，不是母表）。回傳的 `id` 就是其他 admin tool 的 `gameVendorId` |
| `aladdin_admin_game_vendor_admin_list_games` | `GameVendorAdmin.ListGames` | 查某廠商在「廠商遊戲母表」的遊戲清單（全平台共用視角，不是某個 platform 的上架清單）；只有分頁，沒有 name/gameId 篩選 |
| `aladdin_admin_platform_management_list_platform_details` | `PlatformManagement.ListPlatformDetails` | 列出全部平台（id/code/status...），供其他兩支平台化 tool 取得合法 platformId；刻意未綁 `@Permission` |
| `aladdin_admin_game_vendor_admin_list_platform_game_vendors` | `GameVendorAdmin.ListPlatformGameVendors` | 查指定 platformId 底下的廠商場館清單與各自 status——真正平台化的查詢（RPC 簽名有明確 platformId） |
| `aladdin_admin_game_vendor_admin_update_platform_game_vendor_status` | `GameVendorAdmin.UpdatePlatformGameVendorStatus` | 把某場館在某平台底下的 status 改成指定值（需要權限節點 `PlatformManagementAdmin.PlatformList.Vendor.Status`），補上「幫平台啟用場館」這一步 |
| `aladdin_admin_game_vendor_admin_list_adapters` | `GameVendorAdmin.ListAdapters` | 無參數，即時列出後端目前已註冊的三方遊戲廠商 adapter 代碼（全撈，不分頁；底層是原始碼裡靜態註冊的 adapter class 清單，非 DB 表，2026-08-24 實測 37 個）。用途：`aladdin_admin_game_vendor_admin_create_or_update_game_vendor` 的 `adapter` 欄位（`@Type "Select:GameVendorAdapter"` + `@Rules "Required"`）與 `aladdin_admin_game_vendor_admin_list_game_vendors` 的 `adapter` 篩選條件都吃這裡回傳的值；比那兩支 description 引用的 `const.ts` `KNOWN_ADAPTERS` 靜態快照（2026-08-18 實測記錄）更即時可靠 |
| `aladdin_admin_game_vendor_admin_update_game_vendor_status` | `GameVendorAdmin.UpdateGameVendorStatus` | 把某廠商場館在全平台共用母表（`game_vendors`）裡的狀態改成指定值（需要權限節點 `GameVendor.Vendor.Status.Edit`）。**重要副作用**：目標 status 非 enabled 時會連鎖把該場館在**全部平台**的 `platform_game_vendors.admin_status` 一併改掉，且改回 enabled 不會逆向恢復（2026-08-24 讀 game_vendor_admin.ts:346-371 查證）；沒有帶 status 的單筆查詢 method，改用不分頁的 `ListAllGameVendors` 讀回驗證 |
| `aladdin_admin_game_vendor_admin_update_game_vendor_game_status` | GameVendorAdmin.UpdateGameVendorGameStatus | 更新廠商遊戲母表（game_vendor_games）裡某一筆遊戲的啟停狀態；id 來自 list_games / upsert_game 讀回結果；寫入後用 ListGames 第一頁讀回驗證（找不到≠失敗，見 tool 說明） |
| `aladdin_admin_game_vendor_admin_get_game_vendor_for_edit` | 用場館 id 讀取單一三方場館的完整編輯用資料（含 decryptedKey/decryptedToken，預設遮罩，帶 revealSecrets=true 才回明文） |
| `aladdin_admin_game_vendor_admin_list_all_game_tag_names_by_type` | `GameVendorAdmin.ListAllGameTagNamesByType` | 依標籤類型列出遊戲標籤的完整多語名稱清單（不分頁，一次全撈）。已知限制：`gameTagType=frontendGroup` 固定回傳空陣列（後端只讀寫死在 TS enum 裡的內建標籤，不查 DB 的自訂標籤表）；個別標籤的 `name` 可能整欄位缺漏（dev 實測 vendorFee 全部 8 筆都沒有 `name`）。 |
| `aladdin_admin_game_vendor_admin_update_game_tag_name` | `GameVendorAdmin.UpdateGameTagName` | 更新遊戲標籤（vendorFee 廠商殺數分類/appDisplay 前端顯示分類/rebate 返水分類，三者共用同一組固定 tag enum；不支援 frontendGroup 前台自訂標籤，那是另一張表）的多語系顯示名稱；寫入前後各呼叫一次 `ListAllGameTagNamesByType` 做 before/after round-trip，`names` 只動到你列出的語系代碼——2026-08-24 dev 站台實測確認「未列出語系不受影響」與非法 tagType 回業務錯誤碼 317（gameTagTypeNotExists） |

## src/ 結構

```
src/
  stdio.ts          — MCP entry point（stdio transport）
  http.ts            — MCP entry point（hosted，Streamable HTTP；Bearer 認證、/login、/files、/health、/mcp，見 ../README.md「Hosted 模式」）
  auth.ts             — Bearer token 名冊載入與認證 middleware（hosted 專用）
  session.ts         — 登入態管理（Client.encoded、Remote 實例、login/ensureLoggedIn/withAutoRelogin/uploadFile，per-identity 容器），所有 tool 共用；也是 IS_PROD/confirm 閘門所在
  const.ts            — 所有 tool 共用的 rajah enum 對照表與錯誤碼（ACTIVE_STATUS_MAP、WALLET_TYPE_MAP、GAME_TAG_MAP、IMAGE_SHAPE_MAP...），集中管理避免各 tool 各自重複一份
  files.ts            — POST /files 暫存目錄管理（型別白名單、身分綁定、配額、週期清理），hosted 專用
  instructions.ts     — hosted `/mcp` 的 McpServer instructions（依 IS_PROD 動態組字）
  login_throttle.ts   — /login 帳號層節流（冷卻期），hosted 專用
  audit_log.ts        — 稽核 log（H32；每個通過認證的 request 寫一行，含 tool 名稱/結果/agrabah identifier）
  mcp_result.ts       — MCP tool 回傳值包裝
  tools/
    index.ts           — 聚合所有 register*Tool，不放業務邏輯
    login.ts            — aladdin_admin_auth_login
    create_game_vendor.ts
    upsert_game.ts       — 新增/編輯廠商遊戲（upsert），含圖片上傳邏輯（uploadLocalizedImages）與多語名稱合併（mergeLocalizedStrings）
    list_game_vendors.ts — 母表場館清單（參數全選填；無篩選且無 page 時改走 ListAllGameVendors）
    list_vendor_games.ts
    list_platforms.ts
    list_platform_game_vendors.ts
    update_platform_game_vendor_status.ts
```

帳號/URL 只走 `.mcp.json` 的 `env`（`process.env.*`），`session.ts`/`const.ts` 都不寫死任何 fallback 值。

## 環境變數（stdio 模式：根目錄 `.mcp.json` 的 `env`）

> hosted（launchd 常駐）模式**不讀 `.mcp.json`**：`ALADDIN_ADMIN_API_URL` 由各環境自己的
> plist `EnvironmentVariables` 提供，帳密則完全不給常駐行程。詳見下方「launchd 常駐骨架」。

| 變數 | 說明 |
|---|---|
| `ALADDIN_ADMIN_API_URL` | admin 後台 dev 站台，例如 `https://admin.alddev.com` |
| `ALADDIN_ADMIN_USER` | 預設測試帳號 |
| `ALADDIN_ADMIN_PASSWORD` | 預設測試密碼 |
| `ALADDIN_ADMIN_IS_PROD` | H36：這個實例是否是正式環境。prod 實例**必須**設為 `true`，其餘環境（dev/pre/evi）不設定或設 `false`——設為 `true` 時，三支寫入 tool（`create_game_vendor`/`upsert_game`/`update_platform_game_vendor_status`）會強制要求呼叫端帶上精確字串 `confirm="CONFIRM_PROD_WRITE"` 才會執行，否則回錯誤且不打任何下游 RPC；未設定或非 `true`/`false`（大小寫、前後空白不拘）的值會讓行程啟動時直接失敗，不會被靜默當成非 prod。詳見 `src/session.ts` 的 `assertProdConfirmed`。 |

TOTP：dev 環境目前不需要。若未來需要，`aladdin_admin_auth_login` 保留 `totpCode` 選填參數——由 agent 在對話中向操作者當場索取當下驗證碼再帶入，不寫死、不落地存檔。

## 已知限制 / 系統行為陷阱（都已實測驗證，不是推論）

- `adapter`（建場館）只在 tool description 列出某次實測的已知合法值供參考，沒有對應查詢 tool，清單會過期。
- **場館建立後不會自動出現在任何 platform**：`aladdin_admin_game_vendor_admin_create_or_update_game_vendor` 建出來的場館，要先由 admin 端呼叫 `aladdin_admin_game_vendor_admin_update_platform_game_vendor_status`（platformId、gameVendorId、status=enabled）幫它啟用特定 platform，`aladdin-platform` 的 `aladdin_platform_game_vendor_platform_list_game_vendors` 才查得到——場館內部 id 是全域共用沒錯，但「該 id 在哪些 platform 可見」是另一張獨立的關聯表（2026-08-18 實測發現，之前文件誤寫成「id 通用即可直接用」，已修正；2026-08-19 H34 補上這支啟用 tool）。
- **admin 角色沒有平台切換 header**：H33 查證確認 `platform-code` header 後端無人讀取（真名是 `aladdin-platform-code`，Gate 轉發前無條件依 Host 覆寫，AdminGate 結構上不載入 domains 表故 platformId 恆為 0），H34 已移除該 header。admin 角色的平台 scope 一律走 RPC 明確的 `platformId` 參數——只有 `aladdin_admin_game_vendor_admin_list_platform_game_vendors` 與 `aladdin_admin_game_vendor_admin_update_platform_game_vendor_status` 這兩支是真正平台化的；其餘 tool（`create_game_vendor`/`upsert_game`/`list_game_vendors`/`list_vendor_games`）操作的都是全平台共用母表，與平台無關。詳見 `../_hosted-rollout/multi-env-platform-code-findings.md`。
- `squareImage`/`rectangleImage`/`bannerImage` 圖片欄位是「每個語言各自一張圖」，沒有「一張圖套用全部語言」的機制；`aladdin_admin_game_vendor_admin_create_or_update_game_vendor_game` 要求呼叫端明確帶每個語言各自的本機檔案路徑（stdio 模式）或 fileId（hosted 模式，見下）。每次上傳都要重新拿 token（單次使用、1 小時過期）。
- **H9：`upsert_game.ts` 的圖片參數 `{code, filePath}` / `{code, fileId}` 二選一**（D5/§4.3）：stdio 模式帶 `filePath`（本機絕對路徑），hosted 模式先呼叫 `POST /files` 上傳拿到 `fileId` 再帶入；同時帶或都不帶都回明確錯誤，整個圖片欄位不帶則沿用既有值（不受影響）。`fileId → 本機路徑` 的解析（`files.ts` 的 `resolveFileIdForIdentity`）先過 regex 格式白名單、再用 `Map` 精確比對、再用 `realpath` 二次確認落在暫存目錄內，三層防護擋路徑逃逸——已用 `../../../../Users/user/aladdin/.env`、絕對路徑、含 `/` 的 fileId 三種輸入實測全部被拒且無檔案被讀取。既有的「圖片一旦設定過就只能覆蓋、不能清空成未設定狀態」限制同樣適用（同下方 localizedName 的 proto3 限制）。
- **`localizedName`（多語系名稱）只能覆蓋、不能清空**：proto3 對「空陣列」與「欄位沒帶」無法區分，後端的部分更新邏輯會把明確傳入的空陣列當成「沒帶這個欄位」直接忽略，不會拿它去清掉既有值（2026-08-18 用真實遊戲資料 JDB/gameId=9024 實測驗證：設值成功，但事後想還原成空陣列失敗，只能改覆蓋成別的文字）。這是 rajah/protobuf 層的限制，不是本工具的 bug；langue tag 一旦設定過，之後只能用 `localizedNames` 覆蓋成別的值。
- 只支援 admin 後台；platform 後台的能力見 `aladdin-platform`。

## 支援環境清單（D13；H35 落實 pre/evi）

`aladdin-admin` 角色支援多環境，每個環境是**同一份 `src/http.ts` 程式碼、不同
一組 env 值**（port / `ALADDIN_ADMIN_API_URL` / `ALADDIN_ADMIN_TOKENS_PATH`），
新增一個環境只需要複製一份 `launchd/run-server-<env>.sh` + plist + 一份
`tokens.<env>.json` 名冊，不需要改任何 `src/` 程式碼。**若新環境是 prod，必須
額外 export `ALADDIN_ADMIN_IS_PROD=true`（見上方環境變數表），否則寫入 tool 的
confirm 閘門不會生效**——這是唯一區分「這是 prod」與其他環境的旗標，複製骨架
時最容易漏掉，起 server 後可從 stdout/`logs/launchd-server.out.log` 看
`prod 寫入閘門：啟用/停用` 這一行確認有沒有生效。

**H38（安全補強）**：光靠人工記得設旗標不夠可靠，`session.ts` 現在會在啟動時
交叉檢查 `ALADDIN_ADMIN_API_URL` 與 `ALADDIN_ADMIN_IS_PROD`——URL 不符合任何
已知的非 prod 網域特徵（`alddev.com`/`ald777.com`/`godev2.com`/`jxpre.com`/
`127.0.0.1`/`localhost`）卻沒有明確設 `IS_PROD=true`，行程會直接啟動失敗並
給出清楚的錯誤訊息，不會像過去那樣「URL 已經指向 prod、旗標卻忘了設」時
悄悄啟動成一個閘門完全關閉的實例。新增一個非 prod 的新環境時，若它的網域
不在上面清單裡，記得把網域加進 `session.ts` 的 `KNOWN_NON_PROD_URL_MARKERS`。

| 環境 | 後台網址 | port | tokens 名冊 | 狀態 |
|---|---|---|---|---|
| dev | `https://admin.alddev.com` | 8789 | `tokens.json` | 已部署（H1 起），**H15 已 launchctl 常駐並對外開放** |
| pre（企劃口中的 cqa） | `https://abu-admin.ald777.com` | 8791 | `tokens.pre.json` | H35 落實、手動驗證通過，**2026-08-20 已 launchctl 常駐並對外開放**（H38 完成後解鎖，使用者確認） |
| evi | `https://admin.godev2.com` | 8792 | `tokens.evi.json` | H35 落實、手動驗證通過，**2026-08-20 已 launchctl 常駐並對外開放**（H38 完成後解鎖，使用者確認） |
| uat / prod | 待補 | 待補 | 待補 | 網址未知，本輪不部署（見 plan.md D13、§5 非目標） |

三個環境的 tokens 名冊互不相交：dev 名冊被授權者不會自動獲得 pre/evi 存取權，
反之亦然（各自獨立 JSON 檔，格式與撤銷/新增語意見 `src/auth.ts` 檔頭）。三組
port（8789 dev / 8791 pre / 8792 evi，另 aladdin-platform dev 佔 8790）可
同時啟動、互不衝突，已用 `lsof` 實測驗證。

## launchd 常駐骨架（H13 dev；H35 擴充 pre/evi；H15 dev 已常駐上線）

`launchd/` 內含三組 `run-server*.sh` + plist，同一套骨架（比照已上線的
`telegram-dispatcher/launchd/`），只有 env 值不同：

**現況（2026-08-20 更新）**：dev（H15）、pre、evi（H38 完成後解鎖，使用者確認）
三個環境皆已 `launchctl bootstrap` 常駐並對外開放（經 ngrok → telegram-dispatcher
proxy(8787) 前綴分流）。

| 環境 | 腳本 | plist Label |
|---|---|---|
| dev | `run-server.sh` | `com.aladdin.mcp-admin-server` |
| pre | `run-server-pre.sh` | `com.aladdin.mcp-admin-pre-server` |
| evi | `run-server-evi.sh` | `com.aladdin.mcp-admin-evi-server` |

**本機手動跑**（開發、除錯用，不透過 launchd；會一直佔用這個 terminal，
Ctrl-C 停止）：

```bash
zsh /Users/user/aladdin/obsidian/mcps/aladdin-admin/launchd/run-server.sh      # dev :8789
zsh /Users/user/aladdin/obsidian/mcps/aladdin-admin/launchd/run-server-pre.sh  # pre :8791
zsh /Users/user/aladdin/obsidian/mcps/aladdin-admin/launchd/run-server-evi.sh  # evi :8792
curl http://localhost:8789/health
```

上面三行手動跑法要**自己帶 `ALADDIN_ADMIN_API_URL`**（見下），launchd 常駐時
則由 plist 提供，例如：

```bash
ALADDIN_ADMIN_API_URL=https://admin.alddev.com \
  zsh /Users/user/aladdin/obsidian/mcps/aladdin-admin/launchd/run-server.sh
```

**三個環境的 `ALADDIN_ADMIN_API_URL` 一律由各自 plist 的 `EnvironmentVariables`
提供**（dev `https://admin.alddev.com`、pre `https://abu-admin.ald777.com`、evi
`https://admin.godev2.com`），啟動腳本**不讀任何設定檔**：不讀根目錄 `.mcp.json`
（那是 stdio 模式的設定來源，見本檔上面「環境變數」一節）、也不讀
`/Users/user/aladdin/.env`。原本 dev 用 `jq` 從 `.mcp.json` 現讀、pre 現讀 `.env`
的 `CQA_ADMIN_URL`、evi 寫死在腳本裡，已全部統一到 plist——常駐服務的存活不該
綁在「給 stdio 用的」設定區塊上（有人清掉那個 key，服務會在下次重啟時才死、當下
毫無徵兆），且部署到新機器時不必為了起服務而先備妥一份含帳密的 `.mcp.json`。
換站台＝改 plist，改完要重新 `cp` 到 `~/Library/LaunchAgents/` 然後 bootout + bootstrap（只用 kickstart 不會重讀 plist，實測踩過）。
三支腳本皆刻意不匯出帳密（`ALADDIN_ADMIN_USER`/`ALADDIN_ADMIN_PASSWORD`），
理由見腳本內註解——hosted 模式一律走 per-token 登入態 + `POST /login`。

**部署到 launchd 常駐（dev 已於 H15、pre/evi 已於 2026-08-20 執行並常駐中；
步驟保留供換機器/重新部署參考）**：
plist 正本放在 repo（`ProgramArguments` 用 repo 絕對路徑），但 launchd
只認 `~/Library/LaunchAgents/` 底下的檔案，不會直接讀 repo 裡的路徑
（比照 `telegram-dispatcher/README.md:34-40` 的既有慣例），部署時要（以 dev 為例，
pre/evi 把檔名換成對應的 `com.aladdin.mcp-admin-<env>-server.plist` 即可）：

```bash
cp /Users/user/aladdin/obsidian/mcps/aladdin-admin/launchd/com.aladdin.mcp-admin-server.plist \
   ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.aladdin.mcp-admin-server.plist
# 停止：launchctl bootout gui/$(id -u)/com.aladdin.mcp-admin-server
```

H13 只驗證手動執行 `run-server.sh` 能起能停；H15 已完成 dev 的 `cp` 與
`launchctl bootstrap`，dev 現在是 launchd 常駐服務，且已透過
telegram-dispatcher proxy 對外開放（見 `_hosted-rollout/` H15 記錄）。pre/evi
比照同一步驟於 2026-08-20 完成常駐化（H38 完成後解鎖，使用者確認；部署前已
清除 H35 遺留在 `tokens.pre.json`/`tokens.evi.json` 的測試 token，避免常駐後
變成沒人追蹤的活憑證）。log 檔位置：`mcps/aladdin-admin/logs/launchd-{server,
pre-server,evi-server}.{out,err}.log`（已加入 `.gitignore`）。

**維運者必讀（H15）**：

- **改完程式碼要 kickstart，不要手動跑 `bun run src/http.ts`**：常駐行程佔用
  port 8789，手動再跑一次會撞 `EADDRINUSE`；就算改用別的 port 起來測，launchd
  底下那個行程仍是舊碼在跑，容易讓人誤判「怎麼改了沒生效」。正確做法是改完
  程式碼後執行：
  ```bash
  launchctl kickstart -k gui/$(id -u)/com.aladdin.mcp-admin-server
  ```
- **重開機後不會自動啟動**：這是 LaunchAgent（`gui/` domain），只有使用者登入
  桌面 session 後才會被拉起（本機未開 FileVault、未設自動登入），純重開機、
  未登入桌面前服務是下線的。`telegram-dispatcher` 既有的常駐 job 是同一種結構，
  屬同級行為、不是本次退步。
- **緊急止血（撤銷存取）**：
  - 只下線這一個環境：`launchctl bootout gui/$(id -u)/com.aladdin.mcp-admin-server`
  - **整體對外下線最快路徑**（連 platform 一起斷公網入口）：
    `launchctl bootout gui/$(id -u)/com.aladdin.tg-dispatch-tunnel`（停 ngrok，
    公網入口立即消失，本機常駐服務不受影響）
  - 撤銷單一 token：編輯對應 `tokens.json`（或 `tokens.pre.json`/`tokens.evi.json`）
    移除條目存檔即生效、不需重啟——但**務必用「暫存檔 + `mv`」，不要就地覆寫**，
    理由與正確/錯誤做法見下方「名冊維護操作規範」。

**名冊維護操作規範（M3：`auth.ts` 拿掉 mtime 快取，改成每個 request 都重讀
`tokens.json`）**：

- **一律用「暫存檔 + `mv`」修改名冊，不要就地覆寫**。既然每個 request 都重讀
  檔案，任何就地覆寫的寫法（`vim` 預設 `:w`、`jq '...' tokens.json > tokens.json`
  這類先 truncate 再寫的重導向）都會在「檔案為空或只寫了一半」的那幾毫秒到數十
  毫秒空窗內，讓某個 request 讀到殘缺內容而 fail-closed——**該 server 的所有使
  用者一起收到 401**（自癒：寫完後下一個 request 就恢復，但沒必要承擔這個代價）。
  - 正確（`mv` 在同一個檔案系統上是原子操作，讀取端永遠看到完整的舊檔或完整的
    新檔，空窗為 0）：
    ```bash
    python3 -c "..." > tokens.json.tmp && mv tokens.json.tmp tokens.json
    ```
  - 錯誤（就地覆寫，會製造空窗期）：
    ```bash
    vim tokens.json                      # 預設 backupcopy 行為是就地存檔
    jq '...' tokens.json > tokens.json   # shell 先把目標檔 truncate 成空才執行 jq
    ```
- **改完務必驗證**：`python3 -m json.tool tokens.json > /dev/null` 確認 JSON
  合法；並實打一次確認行為符合預期（撤銷的 token 回 401、保留的仍可用）。
- **fail-closed 語意要講清楚**（見 `src/auth.ts` 檔頭與 `loadRegistry`）：名冊
  只要有任何一點問題——檔案不存在、JSON 解析失敗、`tokens` 不是陣列、任一條目
  缺 `id` 或 `token`、`id` 或 `token` 重複——**該 server 的所有 token 一起失
  效**，不是只有壞掉那一筆。這是刻意設計（撤銷必須在所有誤操作下都生效），會
  自癒（改好後下一個 request 即恢復、不必重啟、`session.ts` 的 per-token 登入
  態容器不受影響、沒有人需要重新登入），但維運者要知道會發生什麼。
- **緊急止血的正確順序**：要立刻斷掉對外存取，用上面的
  `launchctl bootout gui/$(id -u)/com.aladdin.tg-dispatch-tunnel`（停 ngrok，
  公網入口立即消失）比編輯名冊更快更確定；撤銷單一 token 才用編輯名冊（暫存檔
  + `mv`）的方式。
- **fail-closed 發生時去哪裡看**：stderr 會印
  `[auth] 名冊載入失敗，已進入拒絕所有請求狀態（所有 token 一律 401，直到名冊
  修好）：<原因>（<名冊路徑>）`，`<原因>` 只帶固定字串/條目 index/id，刻意不含
  token 值；修好後下一次成功載入會印
  `[auth] 名冊已重新載入成功（N 筆條目），恢復正常認證`。落在
  `logs/launchd-server.err.log`。
