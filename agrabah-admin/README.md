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

## src/ 結構

```
src/
  stdio.ts          — MCP entry point
  session.ts         — 登入態管理（Client.encoded、Remote 實例、login/ensureLoggedIn/withAutoRelogin/uploadFile），所有 tool 共用
  const.ts            — 所有 tool 共用的 rajah enum 對照表與錯誤碼（WALLET_TYPE_MAP、GAME_TAG_MAP、IMAGE_SHAPE_MAP...），集中管理避免各 tool 各自重複一份
  mcp_result.ts       — MCP tool 回傳值包裝
  tools/
    index.ts           — 聚合所有 register*Tool，不放業務邏輯
    login.ts            — agrabah_admin_login
    create_game_vendor.ts
    create_game.ts
    edit_game.ts         — 含圖片上傳邏輯（uploadLocalizedImages）與多語名稱合併（mergeLocalizedStrings）
    list_vendor_games.ts
```

帳號/URL 只走 `.mcp.json` 的 `env`（`process.env.*`），`session.ts`/`const.ts` 都不寫死任何 fallback 值。

## 環境變數（根目錄 `.mcp.json` 的 `env`）

| 變數 | 說明 |
|---|---|
| `AGRABAH_ADMIN_API_URL` | admin 後台 dev 站台，例如 `https://admin.alddev.com` |
| `AGRABAH_ADMIN_USER` | 預設測試帳號 |
| `AGRABAH_ADMIN_PASSWORD` | 預設測試密碼 |

TOTP：dev 環境目前不需要。若未來需要，`agrabah_admin_login` 保留 `totpCode` 選填參數——由 agent 在對話中向操作者當場索取當下驗證碼再帶入，不寫死、不落地存檔。

## 已知限制 / 系統行為陷阱（都已實測驗證，不是推論）

- `adapter`（建場館）只在 tool description 列出某次實測的已知合法值供參考，沒有對應查詢 tool，清單會過期。
- **場館建立後不會自動出現在任何 platform**：`agrabah_admin_create_game_vendor` 建出來的場館，要先由 admin 端呼叫 `GameVendorAdmin.UpdatePlatformGameVendorStatus(platformId, gameVendorId, enabled)` 幫它啟用特定 platform，`agrabah-platform` 的 `agrabah_platform_list_game_vendors` 才查得到——場館內部 id 是全域共用沒錯，但「該 id 在哪些 platform 可見」是另一張獨立的關聯表，本 MCP 目前沒有提供這支啟用 tool（2026-08-18 實測發現，之前文件誤寫成「id 通用即可直接用」，已修正）。
- `squareImage`/`rectangleImage`/`bannerImage` 圖片欄位是「每個語言各自一張圖」，沒有「一張圖套用全部語言」的機制；`agrabah_admin_edit_game` 要求呼叫端明確帶每個語言各自的本機檔案路徑。每次上傳都要重新拿 token（單次使用、1 小時過期）。
- **`localizedName`（多語系名稱）只能覆蓋、不能清空**：proto3 對「空陣列」與「欄位沒帶」無法區分，後端的部分更新邏輯會把明確傳入的空陣列當成「沒帶這個欄位」直接忽略，不會拿它去清掉既有值（2026-08-18 用真實遊戲資料 JDB/gameId=9024 實測驗證：設值成功，但事後想還原成空陣列失敗，只能改覆蓋成別的文字）。這是 rajah/protobuf 層的限制，不是本工具的 bug；langue tag 一旦設定過，之後只能用 `localizedNames` 覆蓋成別的值。
- 只支援 admin 後台；platform 後台的能力見 `agrabah-platform`。
