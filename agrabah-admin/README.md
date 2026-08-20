# agrabah-admin MCP

讓 Claude Code 直接呼叫 agrabah **admin** 後台的 RPC method。架構、Stateless/Stateful 說明、新增 tool 的公版流程、安裝與連線方式，一律看 `../README.md`（不要在這裡重複維護）。

## 已支援 tool

| Tool | rajah method | 說明 |
|---|---|---|
| `agrabah_admin_login` | `Auth.Login` | 登入，token 存 process 記憶體 |
| `agrabah_admin_create_game_vendor` | `GameVendorAdmin.CreateOrUpdateGameVendor` | 建立三方遊戲場館，成功後自動讀回驗證 |
| `agrabah_admin_create_game` | `GameVendorAdmin.CreateOrUpdateGameVendorGame` | **唯一真正能建立全新廠商遊戲的入口**（寫進全平台共用的廠商遊戲母表）；platform 後台沒有這個能力，只能對母表已存在的遊戲做「上架到某平台」（見 `agrabah-platform` 的 `agrabah_platform_onboard_vendor_game`）；不支援圖片/多語系欄位，建完要設圖改用 `agrabah_admin_edit_game` |
| `agrabah_admin_edit_game` | `ListGames`（定位）+ `GetGameVendorGameForEdit` + `CreateOrUpdateGameVendorGame`（更新） | 編輯**既有**遊戲，用 gameVendorId+gameId 業務鍵定位（不用先知道內部流水號）。讀既有資料當基準值、只覆蓋有帶的欄位，支援方形圖/直方圖/橫幅圖上傳、`localizedNames` 多語系名稱 |
| `agrabah_admin_list_vendor_games` | `GameVendorAdmin.ListGames` | 查某廠商在「廠商遊戲母表」的遊戲清單（全平台共用視角，不是某個 platform 的上架清單）；只有分頁，沒有 name/gameId 篩選 |
| `agrabah_admin_list_platforms` | `PlatformManagement.ListPlatformDetails` | 列出全部平台（id/code/status...），供其他兩支平台化 tool 取得合法 platformId；刻意未綁 `@Permission` |
| `agrabah_admin_list_platform_game_vendors` | `GameVendorAdmin.ListPlatformGameVendors` | 查指定 platformId 底下的廠商場館清單與各自 status——真正平台化的查詢（RPC 簽名有明確 platformId） |
| `agrabah_admin_update_platform_game_vendor_status` | `GameVendorAdmin.UpdatePlatformGameVendorStatus` | 把某場館在某平台底下的 status 改成指定值（需要權限節點 `PlatformManagementAdmin.PlatformList.Vendor.Status`），補上「幫平台啟用場館」這一步 |

## src/ 結構

```
src/
  stdio.ts          — MCP entry point（stdio transport）
  http.ts            — MCP entry point（hosted，Streamable HTTP；Bearer 認證、/login、/files、/health、/mcp，見 ../README.md「Hosted 模式」）
  auth.ts             — Bearer token 名冊載入與認證 middleware（hosted 專用）
  session.ts         — 登入態管理（Client.encoded、Remote 實例、login/ensureLoggedIn/withAutoRelogin/uploadFile，per-identity 容器），所有 tool 共用；也是 IS_PROD/confirm 閘門所在
  const.ts            — 所有 tool 共用的 rajah enum 對照表與錯誤碼（WALLET_TYPE_MAP、GAME_TAG_MAP、IMAGE_SHAPE_MAP...），集中管理避免各 tool 各自重複一份
  files.ts            — POST /files 暫存目錄管理（型別白名單、身分綁定、配額、週期清理），hosted 專用
  instructions.ts     — hosted `/mcp` 的 McpServer instructions（依 IS_PROD 動態組字）
  login_throttle.ts   — /login 帳號層節流（冷卻期），hosted 專用
  audit_log.ts        — 稽核 log（H32；每個通過認證的 request 寫一行，含 tool 名稱/結果/agrabah identifier）
  mcp_result.ts       — MCP tool 回傳值包裝
  tools/
    index.ts           — 聚合所有 register*Tool，不放業務邏輯
    login.ts            — agrabah_admin_login
    create_game_vendor.ts
    create_game.ts
    edit_game.ts         — 含圖片上傳邏輯（uploadLocalizedImages）與多語名稱合併（mergeLocalizedStrings）
    list_vendor_games.ts
    list_platforms.ts
    list_platform_game_vendors.ts
    update_platform_game_vendor_status.ts
```

帳號/URL 只走 `.mcp.json` 的 `env`（`process.env.*`），`session.ts`/`const.ts` 都不寫死任何 fallback 值。

## 環境變數（根目錄 `.mcp.json` 的 `env`）

| 變數 | 說明 |
|---|---|
| `AGRABAH_ADMIN_API_URL` | admin 後台 dev 站台，例如 `https://admin.alddev.com` |
| `AGRABAH_ADMIN_USER` | 預設測試帳號 |
| `AGRABAH_ADMIN_PASSWORD` | 預設測試密碼 |
| `AGRABAH_ADMIN_IS_PROD` | H36：這個實例是否是正式環境。prod 實例**必須**設為 `true`，其餘環境（dev/pre/evi）不設定或設 `false`——設為 `true` 時，四支寫入 tool（`create_game_vendor`/`create_game`/`edit_game`/`update_platform_game_vendor_status`）會強制要求呼叫端帶上精確字串 `confirm="CONFIRM_PROD_WRITE"` 才會執行，否則回錯誤且不打任何下游 RPC；未設定或非 `true`/`false`（大小寫、前後空白不拘）的值會讓行程啟動時直接失敗，不會被靜默當成非 prod。詳見 `src/session.ts` 的 `assertProdConfirmed`。 |

TOTP：dev 環境目前不需要。若未來需要，`agrabah_admin_login` 保留 `totpCode` 選填參數——由 agent 在對話中向操作者當場索取當下驗證碼再帶入，不寫死、不落地存檔。

## 已知限制 / 系統行為陷阱（都已實測驗證，不是推論）

- `adapter`（建場館）只在 tool description 列出某次實測的已知合法值供參考，沒有對應查詢 tool，清單會過期。
- **場館建立後不會自動出現在任何 platform**：`agrabah_admin_create_game_vendor` 建出來的場館，要先由 admin 端呼叫 `agrabah_admin_update_platform_game_vendor_status`（platformId、gameVendorId、status=enabled）幫它啟用特定 platform，`agrabah-platform` 的 `agrabah_platform_list_game_vendors` 才查得到——場館內部 id 是全域共用沒錯，但「該 id 在哪些 platform 可見」是另一張獨立的關聯表（2026-08-18 實測發現，之前文件誤寫成「id 通用即可直接用」，已修正；2026-08-19 H34 補上這支啟用 tool）。
- **admin 角色沒有平台切換 header**：H33 查證確認 `platform-code` header 後端無人讀取（真名是 `aladdin-platform-code`，Gate 轉發前無條件依 Host 覆寫，AdminGate 結構上不載入 domains 表故 platformId 恆為 0），H34 已移除該 header。admin 角色的平台 scope 一律走 RPC 明確的 `platformId` 參數——只有 `agrabah_admin_list_platform_game_vendors` 與 `agrabah_admin_update_platform_game_vendor_status` 這兩支是真正平台化的；其餘 tool（`create_game_vendor`/`create_game`/`edit_game`/`list_vendor_games`）操作的都是全平台共用母表，與平台無關。詳見 `../_hosted-rollout/multi-env-platform-code-findings.md`。
- `squareImage`/`rectangleImage`/`bannerImage` 圖片欄位是「每個語言各自一張圖」，沒有「一張圖套用全部語言」的機制；`agrabah_admin_edit_game` 要求呼叫端明確帶每個語言各自的本機檔案路徑（stdio 模式）或 fileId（hosted 模式，見下）。每次上傳都要重新拿 token（單次使用、1 小時過期）。
- **H9：`edit_game.ts` 的圖片參數 `{code, filePath}` / `{code, fileId}` 二選一**（D5/§4.3）：stdio 模式帶 `filePath`（本機絕對路徑），hosted 模式先呼叫 `POST /files` 上傳拿到 `fileId` 再帶入；同時帶或都不帶都回明確錯誤，整個圖片欄位不帶則沿用既有值（不受影響）。`fileId → 本機路徑` 的解析（`files.ts` 的 `resolveFileIdForIdentity`）先過 regex 格式白名單、再用 `Map` 精確比對、再用 `realpath` 二次確認落在暫存目錄內，三層防護擋路徑逃逸——已用 `../../../../Users/user/aladdin/.env`、絕對路徑、含 `/` 的 fileId 三種輸入實測全部被拒且無檔案被讀取。既有的「圖片一旦設定過就只能覆蓋、不能清空成未設定狀態」限制同樣適用（同下方 localizedName 的 proto3 限制）。
- **`localizedName`（多語系名稱）只能覆蓋、不能清空**：proto3 對「空陣列」與「欄位沒帶」無法區分，後端的部分更新邏輯會把明確傳入的空陣列當成「沒帶這個欄位」直接忽略，不會拿它去清掉既有值（2026-08-18 用真實遊戲資料 JDB/gameId=9024 實測驗證：設值成功，但事後想還原成空陣列失敗，只能改覆蓋成別的文字）。這是 rajah/protobuf 層的限制，不是本工具的 bug；langue tag 一旦設定過，之後只能用 `localizedNames` 覆蓋成別的值。
- 只支援 admin 後台；platform 後台的能力見 `agrabah-platform`。

## 支援環境清單（D13；H35 落實 pre/evi）

`agrabah-admin` 角色支援多環境，每個環境是**同一份 `src/http.ts` 程式碼、不同
一組 env 值**（port / `AGRABAH_ADMIN_API_URL` / `AGRABAH_ADMIN_TOKENS_PATH`），
新增一個環境只需要複製一份 `launchd/run-server-<env>.sh` + plist + 一份
`tokens.<env>.json` 名冊，不需要改任何 `src/` 程式碼。**若新環境是 prod，必須
額外 export `AGRABAH_ADMIN_IS_PROD=true`（見上方環境變數表），否則寫入 tool 的
confirm 閘門不會生效**——這是唯一區分「這是 prod」與其他環境的旗標，複製骨架
時最容易漏掉，起 server 後可從 stdout/`logs/launchd-server.out.log` 看
`prod 寫入閘門：啟用/停用` 這一行確認有沒有生效。

| 環境 | 後台網址 | port | tokens 名冊 | 狀態 |
|---|---|---|---|---|
| dev | `https://admin.alddev.com` | 8789 | `tokens.json` | 已部署（H1 起），**H15 已 launchctl 常駐並對外開放** |
| pre（企劃口中的 cqa） | `https://abu-admin.ald777.com` | 8791 | `tokens.pre.json` | H35 落實，手動驗證通過，**未** launchctl 常駐 |
| evi | `https://admin.godev2.com` | 8792 | `tokens.evi.json` | H35 落實，手動驗證通過，**未** launchctl 常駐 |
| uat / prod | 待補 | 待補 | 待補 | 網址未知，本輪不部署（見 plan.md D13、§5 非目標） |

三個環境的 tokens 名冊互不相交：dev 名冊被授權者不會自動獲得 pre/evi 存取權，
反之亦然（各自獨立 JSON 檔，格式與撤銷/新增語意見 `src/auth.ts` 檔頭）。三組
port（8789 dev / 8791 pre / 8792 evi，另 agrabah-platform dev 佔 8790）可
同時啟動、互不衝突，已用 `lsof` 實測驗證。

## launchd 常駐骨架（H13 dev；H35 擴充 pre/evi；H15 dev 已常駐上線）

`launchd/` 內含三組 `run-server*.sh` + plist，同一套骨架（比照已上線的
`telegram-dispatcher/launchd/`），只有 env 值不同：

**現況（H15 實測確認）**：只有 **dev** 已 `launchctl bootstrap` 常駐並對外開放（經 ngrok
→ telegram-dispatcher proxy(8787) 前綴分流）。**pre / evi 仍未 launchctl 常駐**，
下表與上方「支援環境清單」表的「未常駐」狀態仍正確，只是手動起停可用。

| 環境 | 腳本 | plist Label |
|---|---|---|
| dev | `run-server.sh` | `com.aladdin.agrabah-admin-server` |
| pre | `run-server-pre.sh` | `com.aladdin.agrabah-admin-pre-server` |
| evi | `run-server-evi.sh` | `com.aladdin.agrabah-admin-evi-server` |

**本機手動跑**（開發、除錯用，不透過 launchd；會一直佔用這個 terminal，
Ctrl-C 停止）：

```bash
zsh /Users/user/aladdin/obsidian/mcps/agrabah-admin/launchd/run-server.sh      # dev :8789
zsh /Users/user/aladdin/obsidian/mcps/agrabah-admin/launchd/run-server-pre.sh  # pre :8791
zsh /Users/user/aladdin/obsidian/mcps/agrabah-admin/launchd/run-server-evi.sh  # evi :8792
curl http://localhost:8789/health
```

dev 的環境變數來源是根目錄 `.mcp.json` 的 `agrabah-admin` server `env`（用
`jq` 現讀，見 `run-server.sh` 檔頭註解），**不是** `/Users/user/aladdin/.env`——
跟 `telegram-dispatcher` 的 `TG_*` 系列變數不同源，沿用本檔上面「環境變數」
一節已記載的既有慣例，避免另開一份會漂移的拷貝。pre 的 `AGRABAH_ADMIN_API_URL`
現讀 `/Users/user/aladdin/.env` 的 `CQA_ADMIN_URL`；evi 沒有對應的
`EVI_ADMIN_URL` 可讀，`run-server-evi.sh` 直接寫定字面值（見腳本內註解）。
三支腳本皆刻意不匯出帳密（`AGRABAH_ADMIN_USER`/`AGRABAH_ADMIN_PASSWORD`），
理由見腳本內註解——hosted 模式一律走 per-token 登入態 + `POST /login`。

**部署到 launchd 常駐（dev 已於 H15 執行並常駐中；步驟保留供換機器/重新部署/
pre/evi 未來上線參考）**：
plist 正本放在 repo（`ProgramArguments` 用 repo 絕對路徑），但 launchd
只認 `~/Library/LaunchAgents/` 底下的檔案，不會直接讀 repo 裡的路徑
（比照 `telegram-dispatcher/README.md:34-40` 的既有慣例），部署時要：

```bash
cp /Users/user/aladdin/obsidian/mcps/agrabah-admin/launchd/com.aladdin.agrabah-admin-server.plist \
   ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.aladdin.agrabah-admin-server.plist
# 停止：launchctl bootout gui/$(id -u)/com.aladdin.agrabah-admin-server
```

H13 只驗證手動執行 `run-server.sh` 能起能停；H15 已完成上面的 `cp` 與
`launchctl bootstrap`，dev 現在是 launchd 常駐服務，且已透過
telegram-dispatcher proxy 對外開放（見 `_hosted-rollout/` H15 記錄）。log 檔位置：
`mcps/agrabah-admin/logs/launchd-server.{out,err}.log`（已加入 `.gitignore`）。

**維運者必讀（H15）**：

- **改完程式碼要 kickstart，不要手動跑 `bun run src/http.ts`**：常駐行程佔用
  port 8789，手動再跑一次會撞 `EADDRINUSE`；就算改用別的 port 起來測，launchd
  底下那個行程仍是舊碼在跑，容易讓人誤判「怎麼改了沒生效」。正確做法是改完
  程式碼後執行：
  ```bash
  launchctl kickstart -k gui/$(id -u)/com.aladdin.agrabah-admin-server
  ```
- **重開機後不會自動啟動**：這是 LaunchAgent（`gui/` domain），只有使用者登入
  桌面 session 後才會被拉起（本機未開 FileVault、未設自動登入），純重開機、
  未登入桌面前服務是下線的。`telegram-dispatcher` 既有的常駐 job 是同一種結構，
  屬同級行為、不是本次退步。
- **緊急止血（撤銷存取）**：
  - 只下線這一個環境：`launchctl bootout gui/$(id -u)/com.aladdin.agrabah-admin-server`
  - **整體對外下線最快路徑**（連 platform 一起斷公網入口）：
    `launchctl bootout gui/$(id -u)/com.aladdin.tg-dispatch-tunnel`（停 ngrok，
    公網入口立即消失，本機常駐服務不受影響）
  - 撤銷單一 token：編輯對應 `tokens.json`（或 `tokens.pre.json`/`tokens.evi.json`）
    移除條目存檔即生效、不需重啟——但存檔後**務必**驗證 JSON 合法
    （`python3 -m json.tool tokens.json`）並實打一次確認該 token 回 401。
    目前「整份檔案被刪掉」或「存成壞 JSON」是 fail-open（所有既有 token 繼續
    有效，另有 task 修正中），修好之前緊急止血一律用上面的 `launchctl bootout`，
    不要用刪檔頂替。
