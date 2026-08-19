# H33 查證筆記 — `platform-code` header 能否在 admin session 內動態切換平台（D13 前置查證）

> 純查證，未改動任何 repo 內既有程式碼。所有結論皆為本次 session 實際 Read/Grep + 真實 dev 環境唯讀 RPC 實測得出，未沿用舊筆記。實測腳本寫在 session scratchpad，未進 repo。
>
> 對應：`plan.md` D13；`tasks.json` H33。實測環境：`https://admin.alddev.com`（dev），僅呼叫 List 類唯讀 RPC。

## 結論（TL;DR）

**D13 的技術假設不成立（REFUTED）。**

1. agrabah 全系統沒有任何一行程式碼讀取名為 `platform-code` 的 header。後端真正使用的 header 名稱是 **`aladdin-platform-code`**（`genie/src/common/request_header.ts:7`）。現行 `mcps/agrabah-admin/src/const.ts:16` 送出的 `platform-code: '0'` 是一個**沒有任何人讀的 header**，送什麼值都不影響行為。
2. 就算改送正確名稱 `aladdin-platform-code`，也一樣無效：Gate 在轉發給內部 server **之前**會用「Host → domains 表 → platformCode」的結果**無條件覆寫**這個 header（`agrabah/src/servers/gate/handlers/gate_handler_base.ts:305-306`）。client 端無法從外部影響平台判定——這是安全設計，不是 bug。
3. `platform.rajah:83` 那句註解（「由 Gate 依 Host 判定後蓋進 request header」）本身是**正確**的，只是它描述的是 Gate→內部 server 這一段，不是 client→Gate。task 描述懷疑的方向正確：那句話從來沒有承諾 client 可以自己指定平台。
4. admin 角色的平台切換**本來就不是靠 header**，而是靠 **RPC 明確帶 `platformId` 參數**（如 `GameVendorAdmin.ListPlatformGameVendors(platformId, page)`、`UpdatePlatformGameVendorStatus(platformId, ...)`）。這條路已實測可行且真的會依平台回傳不同資料。

---

## 問題 1（最關鍵）：admin 角色的 RPC 是否用 `platform-code` header 做平台 scope？

**否。完整證據鏈如下。**

### 1a. header 名稱對不上

`genie/src/common/request_header.ts:1-22` 是全系統 header 名稱的唯一定義來源：

```
platformCode: 'aladdin-platform-code',
platformId:   'aladdin-platform-id',
```

在 `agrabah/src`、`genie/src`、`abu/admin/src`、`abu/platform/src` 四處 grep 字面 `'platform-code'` / `"platform-code"`，**零命中**。`mcps/agrabah-admin/src/const.ts:16` 的 `ADMIN_HEADER_PLATFORM_CODE = '0'` 送出的是一個沒人消費的 header（該檔註解自己也寫了「不確定是否必要，先保留」——本次查證確認：不必要）。

### 1b. Gate 無條件覆寫平台 header

`agrabah/src/servers/gate/handlers/gate_handler_base.ts`：

- `:316-324` `getPlatformCodeByHost(host)`：拿 HTTP `host` header 去 `this._domains` 查 domain，查不到回 `'0'`；查到則以 `domain.platformId` 反查 code。**唯一輸入是 Host，不看任何 client 自訂 header。**
- `:141-173` `_authorizationByJwt()`：`platformCode` 一律先由 Host 決定（`:143`）；`:168` 再要求「Host 判定的 platformCode **必須等於** JWT 內的 platformCode」，不相等就退回未登入狀態（`userCode: '0'`）。
- `:305-306` 轉發前執行：
  ```ts
  requestContext.headers.set(RequestHeader.platformCode, platformCode);
  requestContext.headers.set(RequestHeader.platformId, platformId.toString());
  ```
  `requestContext.headers` 就是**進來的那個 Request 的 headers 物件本身**（`agrabah/src/common/request_context.ts:27`：`get headers(): Headers { return this._request.headers; }`），而 `agrabah/src/servers/gate/handlers/http_handler.ts:70` 直接把它整份 `headers: requestContext.headers` 丟給內部 server。所以 client 若自己塞 `aladdin-platform-code`，會在轉發前被 `set()` 蓋掉。

內部 server 讀到的值：`agrabah/src/common/request_context.ts:191`（`_platformCode = request.headers.get(RequestHeader.platformCode) || '0'`）、`:72-74`（`platformId` 讀 `aladdin-platform-id`）。

### 1c. JWT 本身綁死平台

`agrabah/src/common_services/auth.ts:160` 發 token 時把 `context.platformCode` 寫進 JWT payload（`agrabah/src/managers/user_manager.ts:260-263`：`signData = { identifier, platformCode, userCode, iat }`）。配合 1b 的 `:168` 檢查，**一個登入態在協議層就綁定單一平台**，不存在「同一 token 換平台」的合法路徑。

### 1d. GameVendorAdmin / PlatformManagement handler 實際怎麼 scope

- `GameVendorAdmin.ListGames`（`agrabah/src/servers/game_back_office/services/game_vendor_admin.ts:387-409`）：主查詢條件是 `'game_vendor_id = ?'`（`:390-391`），**完全沒有平台條件**——這是全平台共用的廠商遊戲母表。只有附掛的 tag / 多語名稱有帶 `context.platformId`（`:395-403`），而該值來自 Gate 覆寫後的 header，client 改不動。
- `PlatformManagement.ListPlatformDetails`（`agrabah/src/servers/admin/services/platform_management.ts:26-50`）：轉呼叫 `core.main.GetPlatformDetails`，其實作 `agrabah/src/servers/core/services/core.ts:105-115` 是 `loadObjects(DbPlatform, '', [], 'id', '')`——**where 條件為空字串，撈全表**。
- 對照組（真正的平台 scope 手法）：`rajah/services/game_back_office.rajah:297` `ListPlatformGameVendors(platformId i32 1, page i32 2)`、`:305` `UpdatePlatformGameVendorStatus(platformId i32 1, ...)` —— 平台是**明確的 RPC 參數**。

---

## 問題 2：兩個不同 `platform-code` header 值實測比對

用真實 dev 帳密（讀自 `/Users/user/aladdin/.mcp.json` 的 `agrabah-admin` env，未落地、未列印）登入一次，之後只換 header 值重打同一支 RPC。

`GameVendorAdmin.ListGames(gameVendorId=1 /* Jili */, page=1, pageSize=5)`：

| # | 送出的 header | 結果 |
|---|---|---|
| 1 | `platform-code: PK` | 5 筆，id 87-91（Bingo Empire / Bingo Carnaval / Calaca Bingo / Lucky Bingo / Super Bingo），三種 tag 全 0，`localizedName` 齊備 en-US/zh-CN/zh-TW |
| 2 | `platform-code: 6T` | 與 #1 **逐字元完全相同**（JSON.stringify 比對 `true`） |
| 3 | 完全不送 `platform-code` | 與 #1 **完全相同**（`true`） |
| 4 | 偽造內部 header `aladdin-platform-id: 4`（PK） | 與 #1 **完全相同**（`true`）→ 佐證 1b 的覆寫確實生效 |

另一組（`gameVendorId=1050`，`platform-code` 分別為 `MAIN` / `TEST`，以及偽造 `aladdin-platform-code: TEST`）三次結果亦完全相同。

**排除「兩平台資料本來就一樣」的誤判**：同一登入態下改用帶 `platformId` 參數的 `ListPlatformGameVendors`，回傳確實隨平台不同：

- `platformId=1`（MAIN）：廠商 id=3「體育(ks003-CNY-FF)」`status: 1`、id=4「Ameba (廠商)」`status: 1`
- `platformId=2`（TEST）：同兩筆皆 `status: 2`
- `platformId=3`（FF）：同 `platformId=2`

也就是說 dev 環境的平台間**確實有可觀測差異**，只是這差異由 RPC 參數驅動，不由 header 驅動。

---

## 問題 3：`ListPlatformDetails` 是否受 header 影響（雞生蛋問題）

**不受影響，沒有雞生蛋問題。**

程式碼依據：`agrabah/src/servers/core/services/core.ts:106` 撈全表無平台條件（見 1d）。

實測：同一登入態下，`platform-code` header 分別設為 `0` / `MAIN` / `TEST` / `PK` / `6T` 各呼叫一次，**五次都回傳同一份 14 個平台的完整清單**，順序一致：

```
MAIN, TEST, FF, PK, NY, ASD, ADD, N8, 6T, AY, ZZZZ, XYZ, TRY, K999
（platform id 依序 1,2,3,4,5,7,9,10,11,12,13,14,15,16）
```

---

## 問題 4：`ListPlatformDetails` 的權限需求

**不需要任何 `@Permission`，測試帳號呼叫成功，無權限問題。**

`rajah/services/admin.rajah:112-116` 該 method 上方有明確註解說明為何刻意不綁：

```
# 平台清單是跨一級菜單共用的下拉來源（風控/金流/遊戲/營運/商品系統等頁面皆調用），
# 綁 @Permission 會讓只有該頁權限的非 super 帳號吃 104。跨一級菜單無共同祖先，故不綁。
# 註：service 標頭原本的 @Permission "PlatformManagementAdmin" 已移除，否則會自動綁到此 method。
method ListPlatformDetails() (platforms [PlatformDetail] 1, maintenanceStatuses [PlatformMaintenanceStatus] 2)
```

同 service 內其他 method（`:105` `PlatformManagementAdmin`、`:108`/`:118` `PlatformManagementAdmin.PlatformList`）都有綁權限，只有 `ListPlatformDetails` 例外。

實測：`.mcp.json` 內的預設 dev 測試帳號 5 次呼叫全部 `failed === false`，無 104（permissionDenied）、無 103（loginRequired）。

補充：`GameVendorAdmin` service 標頭有 `@Permission "GameVendor"`（`rajah/services/game_back_office.rajah:295`），但 `ListGames`（`:300`）、`ListAllGameVendors`（`:302`）、`ListPlatformGameVendors`（`:297`）本身未綁；本次測試帳號呼叫這三支皆成功，不構成 H34 的阻礙（若日後換成權限較窄的企劃帳號，仍需個別驗證）。

---

## 對 H34 的具體建議

D13 原設計（新增 `select_platform` tool 改寫 `platform-code` header）**必須改掉**，否則會做出一個「切了但什麼都沒變」的假功能——而且失敗是**靜默**的：header 送錯名稱不會報錯，送對名稱會被 Gate 覆寫也不會報錯，agent 與企劃都會以為切換成功。

可行方向（供裁定，本 task 不做決定）：

- **方向 A（建議）——`select_platform` 只存「當前 platformId」到 session state，由各 tool 在呼叫 RPC 時當**參數**帶入。** 這與後端實際機制一致（見 1d 對照組）。代價是：只有簽名裡本來就有 `platformId` 的 RPC 能被平台化，`ListGames` 這類母表視角的 RPC 本質上就是跨平台的，切了也不該變——這點必須寫進 tool description，避免 agent 誤導企劃。
- **方向 B——per-platform 獨立 URL。** 對 admin 角色**不可行**：admin 站是單一 Host（`admin.alddev.com`），其 platformCode 由 domains 表決定（查不到即 `'0'`），並無「每平台一個 admin 網域」的概念。這條路是 platform 角色（`agrabah-platform`）的機制，D13 已正確地把它排除在本輪之外。
- 無論走哪個方向，`mcps/agrabah-admin/src/const.ts:16` 的 `ADMIN_HEADER_PLATFORM_CODE` 與 `session.ts:101` 送它的那行都應該移除或改寫——保留一個沒人讀的 header 只會讓後續維護者再次誤判（本次 task 依「不改程式碼」的指示未動它）。
- 環境切換（dev/pre/evi）部分**不受本結論影響**：那是換 `AGRABAH_ADMIN_API_URL` 與各自登入，與 platform header 無關。

## 附帶發現（非本 task 範圍，記錄供參）

- Gate 對 client 偽造的 `aladdin-*` header 並非全面過濾，而是「凡是 Gate 自己會 `set()` 的那幾個就必然被覆寫」（`gate_handler_base.ts:260-311` 涵蓋 userCode / identifier / roleId / platformCode / platformId / requestToken / timezone / host / appType / deviceType）。`genie/src/common/request_header.ts:24` 的 `TransferHeaders` 清單中，`currencyCode` 只在 `if (currencyCode)` 為真時才覆寫（`:263-265`）、`language` 由 `_gateLogic.updateHeaders()` 另行處理。本次未進一步驗證這些欄位是否可被外部影響，僅記錄觀察，不作安全結論。
