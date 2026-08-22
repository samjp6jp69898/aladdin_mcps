# MCP Tool 命名規則

給「新增一個 tool 的公版流程」(見 `README.md` 第二節) 與 `aladdin-toolsmith` 的自動生成流程共同遵守。**新 tool 的註冊名稱（`server.registerTool()` 第一個參數）一律照這份規則命名，不是自己選一個順口、好記的名字。**

## 規則本體

```
<server>_<service>_<method>
```

三段各自轉 `snake_case`（PascalCase → 每個大寫字母前插底線、全部轉小寫），用單一底線相接，不重複、不省略任何一段：

- `server`：這個 MCP server 的短名，取自 `.mcp.json` 的 server key／`stdio.ts` 裡 `{ name: '...' }` 的值，把 `-` 換成 `_`。目前三支：`aladdin_admin`、`aladdin_platform`、`aladdin_kit_admin`。
- `service`：這支 tool 實際呼叫的 rajah `service Xxx { ... }` 名稱（`GameVendorAdmin`、`MessageBoardPlatform`、`Auth`……），不是憑印象猜的業務分類。
- `method`：該 service 底下實際呼叫的 rajah method 名稱（`CreateOrUpdateGameVendorGame`、`ListGameVendors`……），一樣轉 `snake_case`。

例：`GameVendorAdmin.ListPlatformGameVendors` 在 `aladdin-admin` server 上包成 tool，名稱是：

```
aladdin_admin_game_vendor_admin_list_platform_game_vendors
```

**為什麼 service/method 段不能省**：這個 codebase 同名 method 分散在多個 service 是常態（`method-category-checklist.md` 第 0 節「同名 method 陷阱」、第 11 節都有實例，如 `EnableConfig`/`DisableConfig` 就有至少 11 個 service、22 處同名）。只用 method 名字（例如單純叫 `list_game_vendors`）在多 server 情境下無法唯一識別呼叫的是哪一支，`service` 段是必要的消歧義資訊，不是裝飾。

## 選 method 的原則

### 一支 tool 只真的呼叫一支 rajah method 時

直接照規則命名，不需要額外判斷。

### 一支 tool 內部呼叫多支 method（Get 讀現值 + 另一支 method 寫入）

用**寫入的那一支**命名，Get 只是內部合併現值的手段，不是這支 tool 對外的身分。例：`aladdin_platform_message_board_platform_set_message_board_post_setting` 內部會先呼叫 `GetMessageBoardPostSetting` 讀現值，但對外身分是 `Set`。

### 一支 tool 內部依參數 dispatch 到兩支語意相同、只差「有沒有篩選條件」的 method（如 `List` vs `ListAll`）

用語意較泛的那一支命名，另一支視為它的內部最佳化分支，在檔頭註解說明即可，不需要在 tool 名稱裡反映這個內部分流。例：`ListGameVendors`/`ListAllGameVendors` 統一命名為 `..._list_game_vendors`。

### 兩支不同 tool 的底層寫入呼叫的其實是同一支 method（真正的撞名）

**不要**用字尾（`_create`/`_update` 之類）勉強把一支 RPC 拆成兩個命名層面的分身。如果底層本來就是同一支 upsert method（method 名字本身是 `CreateOrUpdateXxx`/`UpsertXxx`，且沒有另一支獨立的 `CreateXxx`/`UpdateXxx`），代表這在後端設計上就是**一個操作**，tool 邊界要忠實反映這個結構性事實：合併成一支 upsert tool（`<server>_<service>_<method>`，`method` 就是那支 `CreateOrUpdateXxx`），工具內部自己判斷是新增還是更新（通常靠業務鍵定位現有資料、找不到才走新增分支）。

2026-08-22 的實際案例：`aladdin-admin` 原本有 `create_game.ts`（直接建立）與 `edit_game.ts`（用業務鍵定位後編輯）兩支分開的 tool，兩者底層都呼叫 `GameVendorAdmin.CreateOrUpdateGameVendorGame`。套用本規則命名時撞名，因此合併成一支 `aladdin_admin_game_vendor_admin_create_or_update_game_vendor_game`（`upsert_game.ts`），用 gameVendorId+gameId 業務鍵判斷新增/更新，不再用命名層面的字尾分身。

反例（不要這樣做）：兩支 tool 分別呼叫兩支**不同**的 rajah method（例如一支呼叫 `CreateXxx`、另一支呼叫 `UpdateXxx`，這兩支在 rajah 裡本來就是獨立定義的 method），即使功能上都是「新增或修改 Xxx」，也不算「同一支 RPC 撞名」，各自照自己呼叫的 method 命名即可，不需要合併。

## 沒有對應 rajah RPC 的 tool（例外）

少數 tool 包的不是 agrabah RPC，而是本機腳本或其他機制（例如 `aladdin-kit-admin` 的 `aladdin_kit_issue`/`aladdin_kit_list`，包的是 `make-starter-kit.ts`）。這類 tool 沒有 `service`/`method` 可以套，維持語意化的簡短命名即可，不強套三段式規則；新增這類 tool 時在檔頭註解寫明「無對應 rajah RPC」，方便之後查證時不會誤以為漏查了 service/method。

## 命名前的必要步驟

命名前必須先完成 `method-category-checklist.md` 「用法」一節要求的動作：讀 `rajah/services/*.rajah` 確認實際的 `service`/`method` 名稱與簽名，**不能只憑方法名或業務描述猜**（該檔第 0 節「同名 method 陷阱」「Placeholder 陷阱」都是「光看名字會判斷錯」的真實案例）。命名規則的 `service`/`method` 段，就是這一步查到的真實名稱，不是另外再想一個。

## 與其他文件的關係

- `method-category-checklist.md`：決定這支 method 屬於哪個分類、套用哪些強制檢查項——命名規則不取代它，是它「選定 method 之後」的下一步。
- 各 server 的 `README.md`「已支援 tool」表：每次新增/更名 tool 都要同步更新，包含跨 tool description 互相提及對方名稱的地方（cross-reference）——改一支 tool 的名字，記得全域搜尋舊名稱確認沒有其他 tool 的 description、README、測試檔還在用舊名字。
