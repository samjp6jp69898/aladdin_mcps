# H33 查證筆記 — `platform-code` header 能否在 admin session 內動態切換平台（D13 前置查證）

> 純查證，未改動任何 repo 內既有程式碼。所有結論皆為本次 session 實際 Read/Grep + 真實 dev 環境唯讀 RPC 實測得出，未沿用舊筆記。實測腳本寫在 session scratchpad，未進 repo。
>
> 對應：`plan.md` D13；`tasks.json` H33。實測環境：`https://admin.alddev.com`（dev），僅呼叫 List 類唯讀 RPC。
>
> **修訂紀錄**：初版（commit `7c0b52b2`）後經三份獨立審查（對抗審查 CONFIRMED、驗收 PASSED、替代機制獵尋 NO_ALTERNATIVE_FOUND），本版補入 `GateWithDomain` 結構性證據、修正一處過度絕對化的附帶觀察、並將「對 H34 的建議」由單一推薦改寫為三候選中立呈現。所有新增引用皆於修訂時重新逐一讀過。

## 結論（TL;DR）

**D13 的技術假設不成立（REFUTED）。**

1. agrabah 全系統沒有任何一行程式碼**讀取**名為 `platform-code` 的 header。後端真正使用的名稱是 **`aladdin-platform-code`**（`genie/src/common/request_header.ts:7`）。現行 `mcps/agrabah-admin/src/const.ts:16` 送出的 `platform-code: '0'` 是一個**沒有任何人消費的 header**，送什麼值都不影響行為。
2. 就算改送正確名稱 `aladdin-platform-code`，也一樣無效：Gate 在轉發給內部 server **之前**會用「Host → domains 表 → platformCode」的結果**無條件覆寫**（`agrabah/src/servers/gate/handlers/gate_handler_base.ts:305-306`）。
3. 連「偽造 Host」這條理論破口也在結構上被堵死：**AdminGate 根本不載入 domains 表**（`gate_handler_base.ts:30` 的 `GateWithDomain` 集合不含 `GateId.admin`），因此 `getPlatformCodeByHost(任何 host)` 恆回 `'0'`、platformId 恆 0。
4. `platform.rajah:83` 那句註解（「由 Gate 依 Host 判定後蓋進 request header」）本身是**正確**的，只是它描述的是 Gate→內部 server 這一段，且其適用對象是有 domain 機制的 PlatformGate，不是 AdminGate。task 描述懷疑的方向正確：那句話從來沒有承諾 client 可以自己指定平台。
5. admin 角色的平台切換**本來就不是靠 header**，而是靠 **RPC 明確帶 `platformId` 參數**。但**現有 5 支 admin tool 觸及的 RPC 全都沒有這個參數**——它們本質上就是全平台共用的母表操作（詳見「對 H34 的三個候選方向」）。

---

## 問題 1（最關鍵）：admin 角色的 RPC 是否用 `platform-code` header 做平台 scope？

**否。四層獨立證據如下，任何一層單獨成立即可推翻假設。**

### 1a. header 名稱對不上：沒有任何後端程式碼讀它

`genie/src/common/request_header.ts:1-22` 是全系統 header 名稱的唯一定義來源：

```
platformCode: 'aladdin-platform-code',
platformId:   'aladdin-platform-id',
```

以精確 pattern `['"]platform-code['"]`（排除 `aladdin-` 前綴的子字串誤命中）搜 `agrabah/src` 與 `genie/src`：**零命中**。

**寫出端（誰在送這個 header）則確實存在，但沒人接**：

- `abu/common/api/index.ts:89-91`：`if (this.platformCode) header['platform-code'] = this.platformCode;`
- `abu/admin/src/api/index.ts:33-35`：admin 前端把 `platformCode` getter **覆寫成回傳空字串** ⇒ 條件為假 ⇒ **真實的 admin 後台前端根本不送這個 header**。
- `abu/platform/src/api/index.ts:33-35`：platform 前端回傳 `Setting.platformCode`，會送出——但後端同樣沒人讀，屬殘留。
- `abu/.claude/skills/test-method/SKILL.md:96`：`const h: Record<string, string> = { 'platform-code': '0' };` —— 這就是 MCP 那行的來源。`const.ts:14-16` 的註解自己寫著「沿用既有 test-method 腳本的慣例（…不確定是否必要，先保留）」，本次查證確認：不必要，且該慣例本身即源自一個沒人讀的 header。

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

### 1c. AdminGate 連 domains 表都不載入 —— 堵死「偽造 Host」這條路

這是比 1b 更強的結構性證據：即使攻擊者/呼叫端能任意指定 Host，AdminGate 也永遠算不出非 0 的平台。

- `gate_handler_base.ts:30`：
  ```ts
  export const GateWithDomain = new Set([ GateId.app, GateId.platform, GateId.agent, GateId.paymentCallback, GateId.gameCallback, GateId.customerService, GateId.externalStream, GateId.sport ]);
  ```
  **不含 `GateId.admin`。**
- `gate_server_external.ts:250-252`：`_loadDomains()` 開頭即 `if (!GateWithDomain.has(this._gateId)) return ErrorCode.success;` ⇒ AdminGate 的 `this._domains` **恆為空 map**。
- 兩者相乘：`getPlatformCodeByHost()` 的 `this._domains.get(host)` 恆 undefined ⇒ 恆回 `'0'` ⇒ `getPlatformId('0')` 恆 0（`:326-328`）。

**domains 表本身也不存在 admin 類型的資料**，交叉佐證上述設計是刻意而非疏漏：

- `rajah/services/core.rajah:203-207`：`enum PlatformDomainTypeEnum { platform = 1, agent = 2, promotion = 3 }` —— **無 admin**。
- 寫入端只寫三種 gate：`core_platform.ts:188`（`dbDomain.gateId = GateId.app`）、`core_admin.ts:224`（`GateId.platform` 或 `GateId.agent` 二選一）。
- 讀取端同樣只查這三種：`core_platform.ts:153-154`（`gate_id = GateId.app`）、`core_admin.ts:181`（`gate_id IN (agent, platform)`）。

另一處旁證顯示 agrabah 明確把 admin gate 當「無平台歸屬」處理：`gate_handler_base.ts:275` 的 module 檢查對 admin gate 直接跳過（`this._gateName !== GateName.admin && ...`）——因為 module 開關是 per-platform 的，而 admin 沒有平台。

**推論**：`admin.alddev.com` 這個 Host 走到 AdminGate 後 platformId 恆為 0；per-platform admin 網域在**協議層就不存在這個概念**，不是「dev 環境還沒設定」。

### 1d. JWT 本身綁死平台

`agrabah/src/common_services/auth.ts:160` 發 token 時把 `context.platformCode` 寫進 JWT payload（`agrabah/src/managers/user_manager.ts:260-263`：`signData = { identifier, platformCode, userCode, iat }`）。配合 1b 的 `:168` 檢查，**一個登入態在協議層就綁定單一平台**，不存在「同一 token 換平台」的合法路徑。

### 1e. GameVendorAdmin / PlatformManagement handler 實際怎麼 scope

- `GameVendorAdmin.ListGames`（`agrabah/src/servers/game_back_office/services/game_vendor_admin.ts:387-409`）：主查詢條件是 `'game_vendor_id = ?'`（`:390-391`），**完全沒有平台條件**——這是全平台共用的廠商遊戲母表。只有附掛的 tag / 多語名稱有帶 `context.platformId`（`:395-403`），而該值在 admin gate 恆為 0（見 1c）。
- `PlatformManagement.ListPlatformDetails`（`agrabah/src/servers/admin/services/platform_management.ts:26-50`）：轉呼叫 `core.main.GetPlatformDetails`，其實作 `agrabah/src/servers/core/services/core.ts:105-115` 是 `loadObjects(DbPlatform, '', [], 'id', '')`——**where 條件為空字串，撈全表**。
- 對照組（真正的平台 scope 手法）：`rajah/services/game_back_office.rajah:297` `ListPlatformGameVendors(platformId i32 1, page i32 2)`、`:305` `UpdatePlatformGameVendorStatus(platformId i32 1, gameVendorId i32 2, status StatusEnum 3)` —— 平台是**明確的 RPC 參數**。

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

程式碼依據：`agrabah/src/servers/core/services/core.ts:106` 撈全表無平台條件（見 1e）。

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

## 對 H34 的三個候選方向（事實與 trade-off，最終由使用者拍板）

D13 原設計（新增 `select_platform` tool 改寫 `platform-code` header）**必須改掉**，否則會做出一個「切了但什麼都沒變」的假功能——而且失敗是**靜默**的：header 送錯名稱不會報錯，送對名稱被 Gate 覆寫也不會報錯，agent 與企劃都會以為切換成功。以下三個方向並列，不預設偏好。

### 先確立一項事實：現有 tool 完全沒有可平台化的表面

現有 5 支 admin tool（`login` / `create_game_vendor` / `create_game` / `edit_game` / `list_vendor_games`）實際觸及 6 支不重複的 `GameVendorAdmin` RPC，外加 `session.ts:125` 的 `Auth.Login`：

| RPC | rajah 簽名（`game_back_office.rajah`） | 有 platformId？ |
|---|---|---|
| `ListGames` | `:300` `(gameVendorId, page, pageSize)` | 無 |
| `ListGameVendors` | `:298` `(search, page, pageSize)` | 無（`GameVendorEssentialSearch` `:161-170` 僅 status/maintenanceStatus/adapter/name） |
| `CreateOrUpdateGameVendor` | `:310` `(gameVendor)` | 無 |
| `CreateOrUpdateGameVendorGame` | `:319` `(game)` | 無 |
| `GetGameVendorGameForEdit` | `:317` `(id)` | 無 |
| `GetUploadGameVendorGameImageToken` | `:321` `(shape)` | 無 |

**這不是疏漏，是語意**：`GetGameVendorGameForEdit` 的實作 `game_vendor_admin.ts:510-512` 讀三種 tag 時把平台**硬寫成 0**；`localization_manager.ts:462-463` 顯示平台 0 在 localization 層是「預設層」語意（該平台查無資料時回退到 0）。這些 RPC 操作的就是全平台共用母表，平台概念在此不適用。

### 方向 A：session state 存 platformId，由 tool 呼叫時帶入

- 代價：**對現有 5 支 tool 100% 空轉**——沒有任何一支的 RPC 吃這個參數，切換後行為完全不變，等於把 D13 的靜默假功能換一種形式保留。
- 只有在同時新增平台化 tool 時才有意義，但那時 platformId 已是該 tool 的必要輸入，是否還需要 session state 是獨立問題。

### 方向 A'：per-call `platformId` 明確必填參數 + 新增平台化 tool

- 真正平台化的 RPC 目前有兩支且**都還沒包成 tool**：`ListPlatformGameVendors(platformId, page)`（`:297`）與 `UpdatePlatformGameVendorStatus(platformId, gameVendorId, status)`（`:305`）。後者的缺席已被現有程式碼自己記錄：`mcps/agrabah-admin/src/tools/create_game.ts:29-32` 的 description 明寫「要先由 admin 端呼叫 `GameVendorAdmin.UpdatePlatformGameVendorStatus` 為該場館啟用特定 platform（本 MCP 目前未提供這支 tool）」。
- 與後端機制一致，也與 abu/admin 前端實況一致（見下節）。
- 代價：沒有「一次選定、全程沿用」的便利性；每次呼叫都要帶 platformId，agent 需自行從 `list_platforms` 的結果挑選。

### 方向 C：本輪放棄 admin 平台切換

- 依據是「現有 tool 集本質全平台、無可切換之物」。代價是 D13 的原始需求（企劃要能在指定環境+平台下操作）在 admin 角色上本輪不被滿足；環境切換部分仍可獨立完成。

### abu/admin 前端實況（可作為方向選擇的參考基準）

- **沒有全域平台切換 UI**：`abu/admin/src/api/index.ts:33-35` 把 API 層的 `platformCode` 直接回傳空字串；`abu/admin/src` 內其餘 `platformCode` 出現處僅為 `platform_management` 頁面的顯示欄位（如 `dialogs/PlatformMaintenanceSetting.vue:48,151,305`），無任何全域平台狀態。
- **所有切平台都是單頁查詢參數**：`abu/admin/src/pages` 底下有 22 個頁面檔案使用 `platformId`。典型例 `pages/risk/PlatformRiskStrategyList.vue`：`:22` `const platformId = ref(0)`、`:39` `ListPlatformRiskStrategies(platformId.value, page)`、`:64` `CreateOrUpdatePlatformRiskStrategy(platformId.value, data)`。
- 對照組 `abu/platform/src/api/index.ts:34` 才回傳 `Setting.platformCode`——「平台屬於 session」是 platform 後台的模型，不是 admin 的。

### 與方向無關的收尾項

- `mcps/agrabah-admin/src/const.ts:16` 的 `ADMIN_HEADER_PLATFORM_CODE` 與 `session.ts:101` 送它的那行應移除或改寫。保留一個沒人讀的 header 只會讓後續維護者再次誤判——D13 本身就是這麼發生的。（本次 task 依「不改程式碼」的指示未動。）
- 環境切換（dev/pre/evi）**不受本結論影響**：那是換 `AGRABAH_ADMIN_API_URL` 與各自登入，與 platform header 無關。

## 附帶發現（非本 task 範圍，記錄供參）

Gate 對 client 送進來的 `aladdin-*` header **沒有統一的過濾機制**，各欄位待遇不同，不能一概而論：

- **必然被覆寫**：`gate_handler_base.ts:260-262`（userCode / identifier / roleId）、`:305-309`（platformCode / platformId / requestToken / timezone / host）——這幾個 client 送什麼都無效。
- **條件覆寫**：`:263-265` 的 `currencyCode` 只在 `if (currencyCode)` 為真時才 `set()`。
- **刻意放行 client 值**：`:310-311` 的 `appType` / `deviceType` 取自 client 自己的 `x-app-type` / `x-client-device-type`（或 client 直接送的 `aladdin-app-type` / `aladdin-device-type`），是**採納**不是覆寫。
- **admin gate 完全未處理**：`aladdin-language` 由 `_gateLogic.updateHeaders()` 負責，但 `ManagementGateLogic` **沒有 override** 這支，落到 `gate_logic_base.ts:24` 的空實作（唯一有真實作的是 `app_gate_logic.ts:61`）⇒ client 送的 `aladdin-language` 會原樣進入內部 server。
- **另一個入口**：`file_handler.ts:41` 的 `/upload` 用 client 原始 request 直接建 `RequestContext`，全程不經 `_handleGenericServiceMethod`，因此**不覆寫任何平台 header**。目前無可觀測影響——其下游 `file_manager.ts:110` `upload()` 以 token 查 cache 為唯一授權依據，本次未見它呼叫平台 scope 的 RPC。

以上僅為觀察記錄，本次未做滲透驗證，**不構成安全結論**。
