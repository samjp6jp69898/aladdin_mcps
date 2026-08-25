# aladdin-platform MCP

讓 Claude Code 直接呼叫 agrabah **platform** 後台的 RPC method。架構、Stateless/Stateful 說明、新增 tool 的公版流程、安裝與連線方式，一律看 `../README.md`（不要在這裡重複維護）。

## 已支援 tool

Tool 命名規則：`<server>_<service>_<method>`（server/service/method 各自轉 snake_case），命名規則全文見 `../tool-naming-convention.md`。

| Tool | rajah method | 說明 |
|---|---|---|
| `aladdin_platform_auth_login` | `Auth.Login` | 登入，token 存 process 記憶體 |
| `aladdin_platform_game_vendor_platform_list_game_vendors` | `GameVendorPlatform.ListGameVendors` / `ListAllGameVendors` | 查本平台的廠商清單；不帶篩選條件時自動改用一次拿全部的版本 |
| `aladdin_platform_game_vendor_platform_list_games` | `GameVendorPlatform.ListGames` | 查某廠商在本平台**已上架**的遊戲清單 |
| `aladdin_platform_game_vendor_platform_update_game_vendor_game` | `GameVendorPlatform.GetGameVendorGameForEdit` + `UpdateGameVendorGame` | 把廠商遊戲母表已存在、但本平台還沒設定過的遊戲上架到本平台（或更新既有設定），**含方形圖/直方圖/橫幅圖上傳、`localizedNames` 多語系名稱**——不是建立全新遊戲 |
| `aladdin_platform_message_board_platform_get_message_board_post_setting` | `MessageBoardPlatform.GetMessageBoardPostSetting` | 讀取「大舞台中心」→「大舞台設定」頁籤「基本設置」分頁目前的設定內容（單例設定，無參數，不吃 platformId） |
| `aladdin_platform_message_board_platform_set_message_board_post_setting` | `MessageBoardPlatform.GetMessageBoardPostSetting` + `SetMessageBoardPostSetting` | 修改「大舞台中心」→「大舞台設定」頁籤「基本設置」分頁的設定並儲存，所有欄位皆 optional，只覆蓋有帶到的欄位，其餘先讀現值原樣帶回 |
| `aladdin_platform_game_vendor_platform_get_localizations` | `GameVendorPlatform.GetLocalizations` | 批次取得遊戲/廠商/品牌的多語名稱（不分頁全撈，即使已停用仍查得到，用於解析歷史紀錄；gameName 實測近 5000 筆，5 分鐘快取） |
| `aladdin_platform_game_vendor_platform_list_all_two_eight_games` | 列出本平台可用的「二八遊戲」全部清單（in_house adapter、vendor_category=TwoEight），無參數、不分頁，2026-08-24 dev 實測回傳 20 筆 |
| `aladdin_platform_game_vendor_platform_list_all_in_house_vendors` | 列出 adapter=InHouse 的三方廠商 id 全集，無參數、不分頁，2026-08-24 dev 實測回傳 4 筆；注意回傳是全平台共用母表全集，不保證都已上架給目前平台（實測發現其中 1 筆不在本平台 ListAllGameVendors 結果內） |
| `aladdin_platform_game_vendor_platform_get_game_vendor_for_edit` | `GameVendorPlatform.GetGameVendorForEdit` | 讀單一廠商的可編輯詳情（`UpdateGameVendor` 的讀現值搭配方法），2026-08-24 dev 實測含存在/不存在 id 邊界案例 |
| `aladdin_platform_game_vendor_platform_update_game_vendor` | `GameVendorPlatform.GetGameVendorForEdit` + `UpdateGameVendor` | 更新單一廠商可編輯欄位（`localizedNames`/`sortOrder`/廠商方形圖），先讀現值、只覆寫有帶到的欄位、寫入後 round-trip 驗證；2026-08-24 dev 實測發現後端不會擋下超出宣告範圍的 `sortOrder`、對不存在 id 也會靜默回成功（不會真的寫入），description 已如實揭露此限制 |
| `aladdin_platform_game_vendor_platform_get_game_ids_by_in_house_play_group_ids` | `GameVendorPlatform.GetGameIdsByInHousePlayGroupIds` | 把 in-house 遊戲的 playGroupId 批次回推成 game_vendor_games.id（gameVendorGameId）與 brandId；查不到的 id 列在回傳的 `unresolvedPlayGroupIds`，2026-08-25 dev 實測涵蓋存在/不存在/混合/重複輸入四種情境 |
| `aladdin_platform_game_vendor_platform_update_game_vendor_status` | `GameVendorPlatform.ListAllGameVendors` + `UpdateGameVendorStatus` | 切換單一廠商狀態（enabled/disabled/frozen/deleted），先讀現值、同值短路不呼叫後端，寫入後 round-trip 驗證；2026-08-25 dev 實測含不存在 id（errorCode=14）、非法列舉值（errorCode=9）、同值呼叫（實測結果 errorCode=0 成功，非原先擔心的失敗）三種邊界情境 |
| `aladdin_platform_activity_platform_get_activity_tabs` | `ActivityPlatform.GetActivityTabs` | 查詢當前平台的活動頁籤清單（後台「優惠中心 > 活動管理」的活動欄目管理彈窗），無參數、不分頁全撈（小型設定表），已排除軟刪除項目；2026-08-25 dev 實測回傳 16 筆真實資料，status 僅出現 1/2（enabled/disabled，不會出現 deleted） |
| `aladdin_platform_activity_platform_create_or_update_activity_tabs` | `ActivityPlatform.CreateOrUpdateActivityTabs` | 新增或修改本平台一筆活動頁籤；先讀現值只覆蓋有帶到的欄位（含逐語系合併 name），id 不存在時客戶端先擋不送 RPC，新增因後端無回傳 id 靠寫入前後差異反推；2026-08-25 dev 實測 6 種情境（新增預設值、逐欄修改、逐語系合併、不存在 id、缺 name）全過，唯這組 service 無 Delete 方法，測試資料只能設 disabled 無法真正刪除 |
| `aladdin_platform_activity_platform_toggle_activity_tab` | `ActivityPlatform.ToggleActivityTab` | 把單一活動頁籤設為明確目標狀態（enabled/disabled/deleted，deleted 是這組 method 唯一的軟刪除入口）；後端連線走 mysql2 預設 `CLIENT_FOUND_ROWS`，同值呼叫天生冪等成功、objectNotFound 可放心解讀為 id 不存在，工具因此不需要先讀現值再判斷；2026-08-25 dev 實測 8 種情境（含對已軟刪除的 id 重複刪除、復原軟刪除）全過，測試資料已用本工具設回 deleted 清理 |
| `aladdin_platform_activity_platform_get_activity_configs` | `ActivityPlatform.GetActivityConfigs` | 查詢本平台活動配置清單（後台「優惠中心 > 活動管理 > 活動配置」），無 id 篩選欄位、靠 status/name/activityTabIds 三個條件組合縮小範圍，已排除軟刪除；pageSize 雖無 `@Validate` 但 jasmine 對 enum 參數自動生成成員檢查，2026-08-25 dev 實測繞過 zod 直打 RPC 確認非法值真的被後端拒絕（errorCode=9）；另發現並記錄一個後端分頁陷阱：`totalPage` 只有 page=1 才會計算，其餘頁一律回 0 |
| `aladdin_platform_activity_platform_get_user_id_by_identifier` | `ActivityPlatform.GetUserIdByIdentifier` | 用會員帳號（精準比對，限本平台 app 會員、非後台管理員帳號）查對應的內部 userId；⚠️ 這支 RPC 沒有掛任何權限節點、無法確認是否刻意設計，任何登入後台的帳號皆可呼叫且可能被用來探測帳號是否存在；rajah 還有另外兩支同名但不同 service 的 `GetUserIdByIdentifier`（admin.rajah、platform.rajah），簽名不同不可假設一致；2026-08-25 dev 實測查無帳號（含後台帳號、亂數帳號）與空字串防呆皆正確，唯未取得已知存在的真實會員帳號驗證成功路徑，已誠實記錄此限制 |
| `aladdin_platform_activity_platform_get_fission_activity_options` | `ActivityPlatform.GetFissionActivityOptions` | 查詢本平台裂變活動下拉選項（後台活動編輯彈窗的裂變活動選單來源），讀自平台設定 `fission.activity.list`；不掛權限節點是 rajah 明文刻意設計（同 roulette GetConfigNameList 模式），不是漏掛；平台未設定時回空陣列而非錯誤；2026-08-25 dev 實測回傳 3 筆真實資料（key/name/url），與源碼解析邏輯吻合 |
| `aladdin_platform_ad_home_page_pop_up_platform_get_configs` | `AdHomePagePopUpPlatform.GetConfigs` | 查「廣告管理」→「首頁彈窗」清單，支援 title 部分比對/status/展示時間區間/noExpired 篩選；status 未帶或 unknown 時預設排除 deleted；displayType 欄位對此 method 無效（只有浮窗列表那支不同 method 會用到，兩者共用同一個 AdSearch model）；**totalPage 只有 page=1 時才會計算，其餘頁固定回 0**，2026-08-25 dev 實測 6 個情境（預設排除 deleted / 非第1頁 totalPage=0 / status=deleted 篩選生效 / title 部分比對命中 / displayType 確認無效果 / 查無結果不報錯）全數 PASS |
| `aladdin_platform_ad_home_page_pop_up_platform_create_config` | `AdHomePagePopUpPlatform.CreateConfig` | 新增「廣告管理」→「首頁彈窗」廣告；**新建立的廣告後端寫死強制為 disabled 狀態**，不會出現在前台；CreateConfig 無回傳值（無 id），改用 title+sortOrder 反查 GetConfigs 做 round-trip；rolesVisible 的 StatusEnum 三態欄位簡化成 mode: all\|specific；forward（@Union）開放 9 個 variant（none/external/embedded/activity/internal/announce/games/live/fission），**customer/roulette 因 abu/platform 生成程式碼目前缺這兩個欄位（codegen 落後於 rajah 源碼）刻意不開放**，帶了會被協定層靜默丟棄、導致後端回誤導性的錯誤；thumbnails 固定每筆上傳 forPC+forMobile 兩張圖（{filePath\|fileId} 二選一，H9 同構模式）。2026-08-25 dev 實測（改用真正的 `@modelcontextprotocol/sdk` `StdioClientTransport` + `tools/call`，非繞過 MCP 層直打 remote.gen.ts）：`tools/list` 確認兩支新 tool 已註冊 → 開放的 9 個 forward variant 逐一建立並 round-trip 反查命中、欄位內容正確持久化 → 確認皆強制 disabled → 全數用 SetStatus 軟刪除清理（此 service 無硬刪除 API），全數 PASS，dev 無殘留可見資料。**過程中一支獨立 reviewer 抓到 activity/games/live 三個 variant 缺 wrapper 物件、internal 未做字串轉數字這兩個真實 bug，已修正並重新實測確認**；customer/roulette 的協定層缺陷是修正過程中另外發現、非本工具程式錯誤，已記錄在原始碼檔頭 |
| `aladdin_platform_ad_home_page_pop_up_platform_set_status` | `AdHomePagePopUpPlatform.SetStatus` | 切換「廣告管理」→「首頁彈窗」某筆廣告的狀態；**status=deleted 是本 service 唯一的刪除入口（軟刪除，無獨立 Delete method）**；status=unknown 一定被拒（errorCode=adInvalidConfig）；**非冪等**——底層 `updateObject(existing, notModifiedIsError=true)`，目標狀態與現值相同時原本會回 errorCode=10（nothingChanged），本工具已攔截改回成功回應；id 不存在或不屬於本平台統一回 errorCode=adConfigNotFound；本 service 無帶 id 的單筆查詢，round-trip 改用目標 status 篩選 GetConfigs 掃前 3 頁找該 id（儘力而為，非精準單筆）。2026-08-25 dev 實測（真 MCP StdioClientTransport + tools/call）9 個情境：enabled/disabled 正常切換、同值重複呼叫（發現並修正 errorCode=10）、status=unknown 被拒、不存在 id 被拒、status=deleted 軟刪除，全數 PASS |
| `aladdin_platform_ad_home_page_pop_up_platform_edit_config` | `AdHomePagePopUpPlatform.EditConfig` | 編輯「廣告管理」→「首頁彈窗」某筆廣告內容；**不會**動到啟用/停用狀態（狀態切換另有 set_status）；本 service 無帶 id 的單筆查詢，先分頁掃描 GetConfigs（上限 20 頁 × 200 筆）找現值當基準，未指定欄位原樣沿用；**rolesVisible 尤其重要**——底層 `RoleConfigManager.syncRoleConfigs` 是差異運算（diff），不完整帶出現值會把使用者原本設定的角色可見性刪掉，本工具永遠帶完整陣列；thumbnails 不指定則沿用現有圖片 URL（不重新上傳），指定則整組替換；forward/rolesVisible 的 schema 與轉換邏輯直接重用 create_config 已 export 的函式，避免兩處定義漂移。2026-08-25 dev 實測（真 MCP StdioClientTransport + tools/call）16 個情境：只改 title（forward/sortOrder/status/rolesVisible 皆確認沿用現值不受影響）、只改 forward（title 確認保留）、只改 thumbnails（title/forward 確認保留、圖片 URL 確認變更）、不存在的 id 在掃描階段就被擋下（不會呼叫後端 EditConfig），全數 PASS |
| `aladdin_platform_ad_home_page_pop_up_platform_get_fission_activity_options` | `AdHomePagePopUpPlatform.GetFissionActivityOptions` | 列出本平台可用的裂變活動選項（無參數），回傳的 key 供 create_config/edit_config 的 `forward.fission` 欄位使用；平台未配置時回空陣列、不是錯誤；per-platform 5 分鐘快取，剛改過設定可能查到舊值。2026-08-25 dev 實測（真 MCP StdioClientTransport + tools/call）：呼叫成功、dev 平台實測回傳 3 筆真實裂變活動選項，PASS |
| `aladdin_platform_ad_floating_window_platform_get_configs` | `AdFloatingWindowPlatform.GetConfigs` | 查「廣告管理」→「浮窗設置」清單；跟首頁彈窗的 get_configs 共用同一套底層快取邏輯，但 **displayType 對這支真的會篩選**（首頁彈窗那支被忽略）、title 是多語系陣列（JSON_SEARCH 部分比對，非單一 string LIKE）；status 預設排除 deleted、totalPage 只有 page=1 才計算，行為與首頁彈窗版本相同。2026-08-25 dev 實測（真 MCP StdioClientTransport + tools/call）5 個情境：預設排除 deleted / page=2 時 totalPage=0 / status=deleted 篩選 / **displayType 篩選確認真的生效**（15 筆→1 筆 Standalone） / title 部分比對命中，全數 PASS |
| `aladdin_platform_ad_floating_window_platform_create_config` | `AdFloatingWindowPlatform.CreateConfig` | 新增「廣告管理」→「浮窗設置」廣告；跟首頁彈窗的 create_config 共用同一套底層邏輯（rolesVisible/platformVisible/thumbnails/forward 規則完全相同、schema 直接重用 create_home_page_popup.ts 已 export 的函式），但 **title 是多語系陣列**（非單一字串）、**沒有 displayCondition/displayMoment，改成必填的 displayType**；新建立同樣強制 disabled、同樣無回傳值改用 title+sortOrder 反查 round-trip；GetCreateUploadToken 是浮窗專屬的獨立 method（跟首頁彈窗版本不同 token 來源）。2026-08-25 dev 實測（真 MCP StdioClientTransport + tools/call）：上傳圖片 → 建立（displayType=Standalone/forward=none）→ round-trip 反查命中、確認強制 disabled、displayType 與多語系 title 正確持久化，全數 PASS，測試資料以 SetStatus 軟刪除清理 |
| `aladdin_platform_room_platform_update_room_sort_order` | `RoomPlatform.UpdateRoomSortOrder` | 把房間搬移到另一個房間目前的位置（插入式搬移，不是兩筆互換，會連帶位移區間內其他房間），寫入後改用 `GetRoomList` 讀回核對 fromId/toId 目前順位；2026-08-25 dev 實測含不存在 id（errorCode=11 idNotExists，AgrabahErrorCodeEnum 無此碼故 errorName 顯示未知）、fromId===toId 無動作、真實搬移呼叫三種情境——本平台當下 4 筆測試房間 sort_order 皆為預設值 1000，搬移呼叫成功但無實質變化，符合 description 揭露的「預設值皆 1000 時呼叫等同無效果」，未能在 dev 實測到真正產生位移的情境（該邏輯僅靠讀原始碼 + 兩輪獨立 review 交叉驗證，未經 runtime 實測） |
| `aladdin_platform_room_moderation_get_mute_history` | `RoomModeration.GetMuteHistory` | 查禁言歷史（含已解除，查 `room_mute_history` 表，跟目前生效中的 `GetMuteList` 是不同資料源，本 MCP 尚未提供 `GetMuteList`）；`roomId` 只有單場禁言（status=2）的紀錄會是真實房號，其餘為空字串；2026-08-25 dev 實測含無篩選條件、不存在 identifier（空陣列）、非法 pageSize（zod 正確擋下）、超出範圍頁碼（page=999，rows 為空但 totalPage 回 0 而非實際總頁數，非本工具邏輯造成、疑為後端分頁 helper 在頁碼超界時的既有行為）四種情境，並用真實資料驗證 roomId 只在 status=2 時有值 |
| `aladdin_platform_room_moderation_create_or_update_room_mute` | `RoomModeration.CreateOrUpdateRoomMute` | 新增禁言（不查詢直接 insert，同一會員本可同時存在多筆生效中禁言，這是正常設計）或編輯既有一筆（呼叫端須明確帶 id——只能來自本工具自己的 readBack、不可用 get_mute_history 的 id，兩者是不同號碼空間——本工具反查最新 version）；不支援 pass（後端一律拒絕）；status=all 時 statusValue 由本工具強制清空；userId/id 皆加 i32 上限（超過會被 protobuf 無聲截斷成別的數字，2026-08-25 review 實測確認會禁言到錯的人，已用 zod max(2147483647) 擋下）；**重大修正**：`RoomMuteEdit` 的第 4 欄 `.d.ts` 宣告是 snake_case `status_value`，但 runtime protobuf descriptor 實際用 camelCase `statusValue`，用 `.create({status_value:...})` 會讓值被無聲丟棄，本工具改用 `.fromObject({statusValue:...})`（已用本機 bun encode/decode round-trip 實測驗證此修正生效，與下方 dev e2e 測試各自獨立佐證）；2026-08-25 dev 實測：zod 正確擋下 pass、編輯不存在 id 正確回錯、status=all 完整新增→讀回→（用直接 RPC 呼叫 RemoveRoomMute 清理，本 MCP 無對應 tool）刪除清理全部成功；status=roomId 分支在本機 encode/decode 已驗證參數正確送達，但實際呼叫 dev 時因測試房間擁有者帳號在後端 GetUserDetailsWithIds 查無資料（環境資料特性、非本工具或後端邏輯缺陷）回 roomOwnerUserIdInvalid，未能觀察到 roomId/ownerId 分支的成功案例，如實記錄 |
| `aladdin_platform_game_vendor_platform_update_game_vendor_maintenance_status` | `GameVendorPlatform.ListAllGameVendors` + `UpdateGameVendorMaintenanceStatus` | 切換單一廠商維護狀態（enabled/disabled/frozen/deleted），姊妹工具是上面的 `update_game_vendor_status`（改的是上下架 status，本工具改 maintenanceStatus）；2026-08-25 dev 實測發現**不存在的 id 呼叫會靜默回 errorCode=0 成功、實際未寫入**（跟姊妹工具的 errorCode=14 不同，底層 UPDATE 未檢查 affectedRows），本工具已在呼叫前用讀清單方式檢查 id 是否存在來防呆；非法列舉值 254 → errorCode=9；同值呼叫 → errorCode=0 成功且短路；round-trip 切換 + 復原皆通過；並已用真正 MCP stdio Client 打 tools/call 補測，行為一致 |
| `aladdin_platform_game_vendor_platform_update_game_vendor_game_status` | `GameVendorPlatform.ListGames` + `UpdateGameVendorGameStatus` | 用 gameVendorId+gameId 業務鍵切換單一遊戲在本平台的上下架狀態；**重要風險**：底層對「母表存在、本平台尚未上架」的遊戲會靜默先上架再套用狀態，本工具預設用唯讀清單掃描防呆、找不到就拒絕執行，需明確帶 `forceOnboard:true` 才會略過；沒有 gameId 精確查找欄位，改用 gameVendorId 逐頁掃描比對（單頁 200 筆、最多 20 頁／4000 筆、整體逾時 30 秒、單頁逾時 5 秒）；2026-08-25 dev 實測含不存在業務鍵（errorCode=303）、非法列舉值（errorCode=9）、round-trip；並用真正 MCP stdio Client 補測時發現並修正 `totalPage` 只有第 1 頁正確、後續頁回 0 的分頁陷阱，同時驗證 zod schema 會在 MCP 層擋下非法 status 字串 |
| `aladdin_platform_game_vendor_platform_list_all_brands` | `GameVendorPlatform.ListAllBrands` | 查詢本平台遊戲品牌清單（廠商底下再細分的子分類），依 gameVendorId/tag/title 篩選、支援分頁；這支 method 沒有 `@Permission`（rajah 原始碼該行整行被註解掉，含 service 級 fallback 也一併被註解，確認過並非遺漏），任何已登入使用者皆可查詢；tag=-1 表全部、0 是合法值不可用 truthy 判斷；title 為 LIKE 模糊比對非精確查找，本工具直接暴露原始分頁不做內部掃描定位；純查詢無寫入；2026-08-25 已通過真正 MCP stdio Client 打 tools/call 實測 |
| `aladdin_platform_game_vendor_platform_get_brand_for_edit` | `GameVendorPlatform.GetBrandForEdit` | 用品牌 id 讀取本平台單一遊戲品牌的編輯用資料（title/code/gameVendorId/tag/squareImage/rectangleImage/bannerImage，**沒有 status 欄位**）；後端查詢帶 `platform_id = ? AND id = ?`，SQL 層即有租戶隔離；id 不存在（含 id=0）回 `errorCode=11`（idNotExists）；純讀取，可安全重複呼叫；2026-08-25 已通過真正 MCP stdio Client 打 tools/call 實測（存在 id / 不存在 id / id=0） |
| `aladdin_platform_game_vendor_platform_update_brand_status` | `GameVendorPlatform.ListAllBrands` + `UpdateBrandStatus` | 切換單一品牌啟用/停用狀態；後端有正確檢查存在性（`objectNotFound`）並用帶 platformId 的 `updateStatus()` helper（跟 service 內 `CreateOrUpdateBrands` 缺 null 檢查的問題不同，本方法沒有該風險）；`GetBrandForEdit` 無 status 欄位，改用 `ListAllBrands` 讀現值（品牌為小型列舉表，一次查全部不分頁）；2026-08-25 已通過真正 MCP stdio Client 打 tools/call 實測（不存在 brandId、同值短路、round-trip 切換 + 復原） |
| `aladdin_platform_game_vendor_platform_list_all_game_display_tags` | `GameVendorPlatform.ListAllGameDisplayTags` | 查詢本平台前端遊戲分類標籤（如「熱門」「新遊戲」，非品牌分類），這支 method 沒有 `@Permission`；不帶 page（或帶 0）時後端回傳全部不分頁（原始碼明確支援）；status 篩選在後端 SQL WHERE 層過濾（僅 enabled/disabled 兩態），name 為應用層模糊比對；純查詢無寫入；2026-08-25 已通過真正 MCP stdio Client 打 tools/call 實測（不分頁全撈 30 筆、status 篩選、name 模糊比對、page>0 真分頁） |
| `aladdin_platform_game_vendor_platform_update_game_tag_status` | `GameVendorPlatform.UpdateGameTagStatus` | 用 tagType+tag 複合鍵切換遊戲標籤狀態，tagType 涵蓋 vendorFee/appDisplay/rebate/frontendGroup 四種；依 tagType 分流呼叫對應查詢 RPC（ListAllGameDisplayTags/ListAllGameRebateTags/ListAllGameFrontendGroupTags）做讀回驗證，**唯獨 vendorFee 沒有對應查詢 RPC**，readBack 固定回 null 並附註原因；後端有正確檢查 affectedRows（objectNotFound）；獨立 review 第一輪 FAIL（誤稱 3 種 tagType 都無查詢方法、缺 readBack），修正後 PASS；2026-08-25 已通過真正 MCP stdio Client 打 tools/call 實測（用 appDisplay tag=1：不存在 tag、合法邊界值 unknown(0)、同值呼叫、round-trip 切換 + 復原 + 讀回驗證，測完確認無殘留髒資料） |
| `aladdin_platform_game_vendor_platform_update_game_tag_sort_order` | `GameVendorPlatform.UpdateGameTagSortOrder` | 批次更新同一 tagType 底下多個標籤的排序值；**重要風險**：後端逐筆處理 orders 時只檢查 SQL 錯誤、沒檢查 affectedRows，orders 裡不存在的 tag 會靜默 no-op 但整支 RPC 仍回傳成功；本工具寫入後對 appDisplay/rebate/frontendGroup 三種有查詢 RPC 的 tagType 自動讀回逐筆比對，回傳 applied/mismatched 陣列（vendorFee 無查詢 RPC，回 verified:false）；獨立 review 第一輪 FAIL（草稿階段誤宣稱已測，實際尚未掛進 index.ts），修正後 PASS；2026-08-25 已通過真正 MCP stdio Client 打 tools/call 實測（appDisplay tag=1：全部存在成功情境 + 混入不存在 tag 999999 時正確抓出 mismatched，直接證實靜默 no-op 風險真實存在，測完復原） |
| `aladdin_platform_game_vendor_platform_create_or_update_game_display_tag` | `GameVendorPlatform.CreateOrUpdateGameDisplayTag` | 新增/編輯前端遊戲分類標籤，isNew 布林明確分流；**關鍵風險**：這個 MCP server 依賴的已生成 client 缺少 betSlipTemplate 欄位（codegen 落後於 rajah 定義），導致編輯自訂標籤（tag 101-200）會把該欄位靜默重置成 unknown(0)——本工具要求編輯自訂標籤時必須明確帶 `acknowledgeBetSlipTemplateReset:true` 才會執行，系統原生標籤（tag 1-100）不受影響不需要此參數；label/sortOrder 為整包覆蓋語意已自動先讀現值合併，name 為安全的逐語言合併；新增時 RPC 不回傳新 tag id，本工具用寫入前後 diff 清單回推附在 createdTag；v1 不支援圖片上傳；獨立 review 第一輪 FAIL（發現 betSlipTemplate 是真實資料破壞副作用而非單純不支援、且誤宣稱已測），修正後已加技術防呆並補做真實測試；2026-08-25 已通過真正 MCP stdio Client 打 tools/call 實測（新增自訂標籤、編輯自訂標籤不帶/帶 acknowledgeBetSlipTemplateReset、編輯不存在 tag、編輯系統原生標籤不需 acknowledge，皆符合預期） |

## 一個重要的架構限制：platform 沒有「建立全新遊戲」的能力

`UpdateGameVendorGame` 背後依賴 agrabah 的 `ensurePlatformGameVendorGame()`：會先查全平台共用的「廠商遊戲母表」（`game_vendor_games`）有沒有這個 `gameVendorId + gameId`，**沒有就直接回錯**（`errorCode=303 gameVendorGameNotExists`），不會憑空建立。母表資料正常是由廠商同步 job 自動帶入。真正能建立全新遊戲、寫進母表的是 **admin** 後台的 `GameVendorAdmin.CreateOrUpdateGameVendorGame`（見 `aladdin-admin` MCP 的 `aladdin_admin_game_vendor_admin_create_or_update_game_vendor_game`）。

所以完整流程是：
1. 若廠商遊戲母表已有這款遊戲（廠商同步 job 帶入的，或 admin 手動建過）→ 直接用這裡的 `aladdin_platform_game_vendor_platform_update_game_vendor_game` 上架到本平台。
2. 若母表也沒有（真正的全新遊戲）→ 先用 `aladdin-admin` 的 `aladdin_admin_game_vendor_admin_create_or_update_game_vendor_game` 建立，再回來用這裡的 tool 上架到各平台。

`aladdin_platform_game_vendor_platform_update_game_vendor_game` 呼叫失敗且 `errorCode=303` 時，回傳會帶 `hint` 明確告訴 agent 該去用哪支 tool，不會讓 agent 自己瞎猜重試。

**另一個容易誤踩的點（2026-08-18 實測發現，2026-08-19 H34 更新）**：`aladdin-admin` 剛建立的場館（`aladdin_admin_game_vendor_admin_create_or_update_game_vendor`）**不會自動出現**在 `aladdin_platform_game_vendor_platform_list_game_vendors` 裡——場館要先被 admin 端呼叫 `GameVendorAdmin.UpdatePlatformGameVendorStatus(platformId, gameVendorId, enabled)` 啟用給特定 platform 才查得到；`aladdin-admin` 現在已提供這支啟用 tool（`aladdin_admin_game_vendor_admin_update_platform_game_vendor_status`，H34，見 `../aladdin-admin/README.md` 的「已支援 tool」），直接呼叫即可，不需要離開 MCP 手動處理。本 MCP（`aladdin-platform`）本身沒有對應的啟用 tool。

## src/ 結構

```
src/
  stdio.ts          — MCP entry point（stdio transport）
  http.ts            — MCP entry point（hosted，Streamable HTTP；Bearer 認證、/login、/files、/health、/mcp，見 ../README.md「Hosted 模式」；結構同 aladdin-admin，各自獨立一份，未共用套件）
  auth.ts             — Bearer token 名冊載入與認證 middleware（hosted 專用）
  session.ts         — 登入態管理（含 uploadFile，per-identity 容器），所有 tool 共用（結構同 aladdin-admin，各自獨立一份，未共用套件；H38 已補上與 admin 對稱的 IS_PROD/confirm 閘門，見下方環境變數表）
  const.ts            — 所有 tool 共用的 rajah enum 對照表與錯誤碼（ACTIVE_STATUS_MAP、IMAGE_SHAPE_MAP...），集中管理避免各 tool 各自重複一份
  files.ts            — POST /files 暫存目錄管理（型別白名單、身分綁定、配額、週期清理），hosted 專用
  instructions.ts     — hosted `/mcp` 的 McpServer instructions
  login_throttle.ts   — /login 帳號層節流（冷卻期），hosted 專用
  audit_log.ts        — 稽核 log（H32；每個通過認證的 request 寫一行）
  mcp_result.ts       — MCP tool 回傳值包裝
  tools/
    index.ts           — 聚合所有 register*Tool
    login.ts
    list_game_vendors.ts
    list_vendor_games.ts
    onboard_vendor_game.ts  — 含圖片上傳邏輯（uploadLocalizedImages）
    get_message_board_setting.ts     — 另外 export formatMessageBoardSetting()，update 工具的回傳共用同一支格式化函式
    update_message_board_setting.ts  — 讀現值 + 只覆蓋有帶到的欄位 + round-trip 讀回，比照 onboard_vendor_game.ts 的模式
```

帳號/URL 只走 `.mcp.json` 的 `env`（`process.env.*`），`session.ts`/`const.ts` 都不寫死任何 fallback 值。

## 環境變數（stdio 模式：根目錄 `.mcp.json` 的 `env`）

> hosted（launchd 常駐）模式**不讀 `.mcp.json`**：`ALADDIN_PLATFORM_API_URL` 由
> `com.aladdin.mcp-platform-server.plist` 的 `EnvironmentVariables` 提供，帳密則完全不給
> 常駐行程。詳見下方「launchd 常駐骨架」。

| 變數 | 說明 |
|---|---|
| `ALADDIN_PLATFORM_API_URL` | platform 後台 dev 站台，例如 `https://pk-platform.alddev.com` |
| `ALADDIN_PLATFORM_USER` | 預設測試帳號 |
| `ALADDIN_PLATFORM_PASSWORD` | 預設測試密碼 |
| `ALADDIN_PLATFORM_IS_PROD` | H38：這個實例是否是正式環境，設計與 admin 端的 `ALADDIN_ADMIN_IS_PROD` 完全同構（見 `../aladdin-admin/README.md` 同一節）。prod 實例**必須**設為 `true`，其餘環境不設定或設 `false`——設為 `true` 時，所有寫入型 tool（`aladdin_platform_game_vendor_platform_update_game_vendor_game`、`aladdin_platform_message_board_platform_set_message_board_post_setting`）都會強制要求呼叫端帶上精確字串 `confirm="CONFIRM_PROD_WRITE"` 才會執行；未設定或非 `true`/`false` 的值會讓行程啟動時直接失敗。`session.ts` 同時會交叉檢查 `ALADDIN_PLATFORM_API_URL` 是否符合已知非 prod 網域特徵，URL 看起來像 prod 卻沒設這個旗標一樣會啟動失敗，不會靜默放行。詳見 `src/session.ts` 的 `assertProdConfirmed`。 |

## 已知限制

- `aladdin_platform_game_vendor_platform_list_games` 只開放 `gameVendorId`/`name`/`status` 三個篩選欄位；`displayTag`/`frontendGroupTag`/`rebateTag`/`badgeId` 這些下拉篩選需要另外查對應清單，其中 `ListAllGameDisplayTags` 已實作為 `aladdin_platform_game_vendor_platform_list_all_game_display_tags`；`ListAllGameRebateTags`/`GetBadgeList` 等仍尚未實作。
- `aladdin_platform_game_vendor_platform_update_game_vendor_game` 的圖片欄位是「每個語言各自一張圖」，沒有「一張圖套用全部語言」的機制；呼叫端要明確帶每個語言各自的本機檔案路徑（stdio 模式）或 fileId（hosted 模式，先呼叫 `POST /files` 上傳取得，見 `../README.md`「Hosted 模式」）。每次上傳都要重新拿 token（單次使用、1 小時過期）。
- **H9：`onboard_vendor_game.ts` 的圖片參數 `{code, filePath}` / `{code, fileId}` 二選一**，設計與實測方式與 `aladdin-admin` 的 `upsert_game.ts` 逐字相同，完整說明見 `../aladdin-admin/README.md` 同一段（D5/§4.3；`fileId → 本機路徑` 的三層防護：regex 格式白名單 + registry `Map` 精確比對 + realpath 二次確認）。
- **`localizedName`（多語系名稱）只能覆蓋、不能清空**：proto3 對「空陣列」與「欄位沒帶」無法區分，後端的部分更新邏輯會把明確傳入的空陣列當成「沒帶這個欄位」直接忽略，不會拿它去清掉既有值（在 admin 端用真實遊戲資料實測驗證過，platform 端邏輯相同，推論同樣適用）。language code 一旦設定過，之後只能用 `localizedNames` 覆蓋成別的值，沒辦法清空回未設定狀態。
- **i64 欄位經 protobufjs decode 後是 Long 物件，不是一般數字**（2026-08-20 實測發現）：`MessageBoardPostSetting` 的 `postsChangeUserDetailMinChargeTotal`/`postsGiftReceiveTotalAmount` 是 rajah `i64`，直接把 decode 出來的物件塞進 `JSON.stringify` 會印出 `{low, high, unsigned}`（且依呼叫路徑不同，有時反而印成十進位字串，形狀不一致）。`genie/src/common/index.ts` 其實有 `fixObjectInteger()` 專門處理這個問題，但 `genie/client` 目前沒有自動套用（呼叫處被註解掉）。`get_message_board_setting.ts`/`update_message_board_setting.ts` 已用 `const.ts` 的 `toPlainNumber()` 手動轉成一般數字再回傳；**未來任何新 tool 若回傳的 rajah model 含 `i64` 欄位，都要留意同樣的問題**，不能假設 decode 出來就是可以直接塞進 JSON 的數字。
- `aladdin_platform_message_board_platform_set_message_board_post_setting` 的 `postsGiftWageringMultiplier` 是後端實際儲存值（顯示倍率 × 10000 的整數），比照 admin 端 `exchangeRate` 的既有慣例（見 `../aladdin-admin/README.md`），工具本身不做單位換算，由呼叫端自行乘/除 10000。

## launchd 常駐骨架（H13；H15 已常駐上線）

`launchd/` 內含 `run-server.sh`（啟動 `src/http.ts`，port 8790）與
`com.aladdin.mcp-platform-server.plist`，結構比照已上線的
`telegram-dispatcher/launchd/`（同一套 run-server.sh + plist 手法），與
`aladdin-admin/launchd/` 完全對稱。**現況（H15 實測確認）**：已
`launchctl bootstrap` 常駐並對外開放（經 ngrok → telegram-dispatcher
proxy(8787) 前綴分流）。

**本機手動跑**（開發、除錯用，不透過 launchd；會一直佔用這個 terminal，
Ctrl-C 停止）：

```bash
zsh /Users/user/aladdin/obsidian/mcps/aladdin-platform/launchd/run-server.sh
curl http://localhost:8790/health
```

上面的手動跑法要**自己帶 `ALADDIN_PLATFORM_API_URL`**（例如
`ALADDIN_PLATFORM_API_URL=https://pk-platform.alddev.com zsh .../run-server.sh`）。

**`ALADDIN_PLATFORM_API_URL` 由 plist 的 `EnvironmentVariables` 提供**
（`com.aladdin.mcp-platform-server.plist`，現值 `https://pk-platform.alddev.com`），
`run-server.sh` **不讀任何設定檔**：不讀根目錄 `.mcp.json`（那是 stdio 模式的設定
來源，見本檔上面「環境變數」一節）、也不讀 `/Users/user/aladdin/.env`。原本是用
`jq` 從 `.mcp.json` 現讀，已改掉——常駐服務的存活不該綁在「給 stdio 用的」設定區塊
上，且部署到新機器時不必為了起服務而先備妥一份含帳密的 `.mcp.json`。換站台＝改
plist，改完要重新 `cp` 到 `~/Library/LaunchAgents/` 然後 bootout + bootstrap（只用 kickstart 不會重讀 plist，實測踩過）。`run-server.sh`
刻意不匯出帳密（`ALADDIN_PLATFORM_USER`/`ALADDIN_PLATFORM_PASSWORD`），理由見腳本
內註解。

**部署到 launchd 常駐（已於 H15 執行並常駐中；步驟保留供換機器/重新部署參考）**：
plist 正本放在 repo（`ProgramArguments` 用 repo 絕對路徑），但 launchd
只認 `~/Library/LaunchAgents/` 底下的檔案，不會直接讀 repo 裡的路徑
（比照 `telegram-dispatcher/README.md:34-40` 的既有慣例），部署時要：

```bash
cp /Users/user/aladdin/obsidian/mcps/aladdin-platform/launchd/com.aladdin.mcp-platform-server.plist \
   ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.aladdin.mcp-platform-server.plist
# 停止：launchctl bootout gui/$(id -u)/com.aladdin.mcp-platform-server
```

H13 只驗證手動執行 `run-server.sh` 能起能停；H15 已完成上面的 `cp` 與
`launchctl bootstrap`，現在是 launchd 常駐服務，且已透過 telegram-dispatcher
proxy 對外開放（見 `_hosted-rollout/` H15 記錄）。log 檔位置：
`mcps/aladdin-platform/logs/launchd-server.{out,err}.log`（已加入 `.gitignore`）。

**維運者必讀（H15）**：

- **改完程式碼要 kickstart，不要手動跑 `bun run src/http.ts`**：常駐行程佔用
  port 8790，手動再跑一次會撞 `EADDRINUSE`；就算改用別的 port 起來測，launchd
  底下那個行程仍是舊碼在跑，容易讓人誤判「怎麼改了沒生效」。正確做法是改完
  程式碼後執行：
  ```bash
  launchctl kickstart -k gui/$(id -u)/com.aladdin.mcp-platform-server
  ```
- **重開機後不會自動啟動**：這是 LaunchAgent（`gui/` domain），只有使用者登入
  桌面 session 後才會被拉起（本機未開 FileVault、未設自動登入），純重開機、
  未登入桌面前服務是下線的。`telegram-dispatcher` 既有的常駐 job 是同一種結構，
  屬同級行為、不是本次退步。
- **緊急止血（撤銷存取）**：
  - 只下線這一個環境：`launchctl bootout gui/$(id -u)/com.aladdin.mcp-platform-server`
  - **整體對外下線最快路徑**（連 admin 一起斷公網入口）：
    `launchctl bootout gui/$(id -u)/com.aladdin.tg-dispatch-tunnel`（停 ngrok，
    公網入口立即消失，本機常駐服務不受影響）
  - 撤銷單一 token：編輯 `tokens.json` 移除條目存檔即生效、不需重啟——但**務必
    用「暫存檔 + `mv`」，不要就地覆寫**，理由與正確/錯誤做法見下方「名冊維護
    操作規範」。

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
