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
| `aladdin_platform_message_board_platform_get_message_board_posts` | `MessageBoardPlatform.GetMessageBoardPosts` | 查詢大舞台動態列表；uid/userId/nickname 可精確鎖定單一使用者，type/commentStatus 省略時固定送 all |
| `aladdin_platform_message_board_platform_get_post_comments` | `MessageBoardPlatform.GetPostComments` | 查詢單一貼文底下的評論；postId 必填頂層參數，options.uid/nickname 是死欄位（後端未使用）；pageSize 省略時工具層固定送 100（後端無自我保護，送 0 會 LIMIT 0,0 回空清單） |
| `aladdin_platform_message_board_platform_get_post_gift_records` | `MessageBoardPlatform.GetPostGiftRecords` | 查詢單一貼文底下的打賞送禮紀錄；無 pageSize 參數（後端固定用預設值）；uid 是會員 UID 數字（非帳號字串） |
| `aladdin_platform_message_board_platform_get_message_board_comments` | `MessageBoardPlatform.GetMessageBoardComments` | 跨貼文評論管理列表（評論管理頁用），postId 選填篩選；同樣有 pageSize=0 陷阱，工具層固定送 100 |
| `aladdin_platform_message_board_platform_review_post` | `MessageBoardPlatform.ReviewPost` | 單筆審核（approved/rejected）待審核貼文，僅一般會員貼文；rajah 無真實 `@Permission`（service 標頭的權限敘述是死註解），可能完全無後端權限保護 |
| `aladdin_platform_message_board_platform_batch_review_posts` | `MessageBoardPlatform.BatchReviewPosts` | 批量審核 1~100 筆貼文，fail-fast 逐筆處理、已成功不回滾、RPC 無法得知哪些成功，失敗需另外查詢確認；rajah 同樣無真實 `@Permission`（見 review_post） |
| `aladdin_platform_message_board_platform_delist_post` | `MessageBoardPlatform.DelistPost` | 下架已通過審核的貼文，支援官方/一般會員貼文；id 不存在時因後端死碼 bug 回泛用 unknown(1) 而非 messageBoardPostNotExists |
| `aladdin_platform_message_board_platform_relist_post` | `MessageBoardPlatform.RelistPost` | 已下架貼文重新上架回 approved，delist_post 的鏡像操作，同樣受上述 id 不存在死碼 bug 影響 |
| `aladdin_platform_message_board_platform_set_is_pinned_post` | `MessageBoardPlatform.SetIsPinnedPost` | 設定/取消貼文置頂，僅一般會員貼文；平台 globalPinMode 關閉時一律拒絕；已是目標狀態回 nothingChanged |
| `aladdin_platform_message_board_platform_remove_post` | `MessageBoardPlatform.RemovePost` | 軟刪除貼文（status 改為 removeXxx，非真刪除），支援官方/一般會員貼文；同樣無真實 `@Permission`（見 review_post） |
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
| `aladdin_platform_customer_platform_list_details` | `CustomerPlatform.ListDetails` | 查本平台某客服連線類型（komi/wbgcorp/dotcloud）底下已設定的連線項目清單；安全考量刻意不回傳後端解密後的 `data` 欄位（三方客服系統連線密鑰） |
| `aladdin_platform_customer_platform_update_category_sort_order` | `CustomerPlatform.UpdateCategorySortOrder` | 交換同一客服連線類型底下兩筆連線項目的顯示排序；後端是兩筆一組的 optimistic-lock 交換，tool 內部自動掃描現值組 payload、寫入後 round-trip 驗證 |
| `aladdin_platform_customer_platform_update_category_status` | `CustomerPlatform.UpdateCategoryStatus` | 啟用/停用某個客服連線類型底下的一筆連線項目；冪等操作，寫入後掃描回讀驗證 |
| `aladdin_platform_customer_platform_get_customer_config_restrict` | `CustomerPlatform.GetCustomerConfigRestrict` | 讀「客服設置」通用設定的「訪問受限制」選項清單；無參數，本平台全部客服連線類型不分頁一次回傳 |
| `aladdin_platform_customer_platform_set_customer_config_restrict` | `CustomerPlatform.SetCustomerConfigRestrict` | 設定「訪問受限制」目前選中的連線項目；同 platformId 單選語意（設某筆 enabled 會讓其餘全部 disabled），id=0 為清除選擇，寫入後自動回讀驗證 |
| `aladdin_platform_customer_platform_get_customer_tickets` | `CustomerPlatform.GetCustomerTickets` | 查詢「問題處理」→「客服工單」列表；受登入角色所屬部門可視範圍限制，未指定的篩選欄位一律送 -1（不誤篩成該欄位的 0 值） |
| `aladdin_platform_inventory_platform_create_or_update_item` | `InventoryPlatform.CreateOrUpdateItem` | 新增/編輯「商城 → 道具」，upsert 語意（id=0 新增／id>0 更新），先讀現值（逐頁掃描 `ListItems`，無 id 篩選欄位可用）、只覆寫有帶到的欄位（含 commonDetail/depositWithdrawDetail 巢狀物件內部），category 決定要不要帶哪個 detail、兩者互斥；**category 選項刻意排除 unknown/realStuff（後端無對應實作）與 roomMount（後端 validate 邏輯有無窮遞迴 bug，帶此值必定 stack overflow，2026-08-25 fable5 獨立審查發現並複驗證實，非本工具限制）**；icon 走 `GetUploadItemImageToken`（支援 filePath/fileId 二選一），commonDetail.lottie 走 `GetUploadLottieToken`（**只支援 filePath**，hosted 模式的 `POST /files` 型別白名單不接受 lottie 的 JSON 格式）；2026-08-25 dev 實測含新增/改名 round-trip、category 變更攔截、分類必填欄位缺漏、更新不存在 id 四種情境 |
| `aladdin_platform_inventory_platform_list_items` | `InventoryPlatform.ListItems` | 查「商城 → 道具」總表，依 category/name（模糊）/status 篩選分頁；**method-category-checklist B 級**——搜尋條件沒有 id 欄位，無法精確鎖定單一道具；`pageSize` 是 `PageSizeEnum` 只接受 10/20/30/50/100/200（2026-08-25 dev 實測帶 1 會回 errorCode=9，已用 zod enum 收斂輸入避免呼叫端帶出未定義行為）；2026-08-25 dev 實測含分頁翻到底、category 篩選正確性、不存在名稱回空陣列三種情境 |
| `aladdin_platform_inventory_platform_list_enabled_items_all` | `InventoryPlatform.ListEnabledItemsAll` | 取得本平台啟用中道具全集，無參數、不分頁；**回傳不含 commonDetail/depositWithdrawDetail**（底層查詢只查道具本體表，讀 agrabah 原始碼證實），需要完整細項請改用 list_items；2026-08-25 dev 實測（33 筆）含全部 enabled、不含 detail 欄位、與 list_items(status=enabled) 交叉比對 id 集合一致三種情境 |
| `aladdin_platform_inventory_platform_get_item_names_by_id` | `InventoryPlatform.GetItemNamesById` | 依道具 id 陣列批次查名稱；回傳與輸入 ids **同長度、同順序**（讀 agrabah 原始碼證實，先用輸入 id 建骨架列再補 name，非查到才回傳），不存在的 id 該筆 name 為空陣列、不報錯；2026-08-25 dev 實測含混合真實/不存在 id 情境 |
| `aladdin_platform_inventory_platform_update_item_status` | `InventoryPlatform.UpdateItemStatus` | 切換道具啟用/停用狀態；只接受 enabled/disabled（後端拒絕其他值）；**目標狀態與現值相同時必須短路不呼叫後端**（後端對同值呼叫回 needRefresh 錯誤，非可有可無的最佳化，2026-08-25 dev 實測證實）；讀現值/讀回驗證共用 create_or_update_item.ts 的 findItemById；2026-08-25 dev 實測含同值短路、切換+復原 round-trip、不存在 id 三種情境 |
| `aladdin_platform_room_platform_get_room_list` | `RoomPlatform.GetRoomList` | 列出本平台全部房間的分頁清單，**無任何篩選欄位**（後端 search 參數是空 model 且完全未使用）；`pageSize` 只開放 10/20/30/50/100/200 這幾個 rajah `PageSizeEnum` 合法值（後端 jasmine 生成層確實有 enum 驗證會拒絕非法值，2026-08-25 review 修正先前「後端無夾限」的錯誤宣稱——那只讀了 manager 層漏看了生成層）；`totalPage` 為真實 `COUNT(*)`，`moduleResult`/`realMemberCount` 需額外查詢組出；`roomCreatedAt`/`moduleResult.chat.chatRoomId` 這兩個 i64 欄位已轉成一般數字（原始 protobuf 解碼會是字串/Long 物件）。2026-08-25 dev 實測：page=1/2 邊界、超出 totalPage、pageSize=200、非法 pageSize 均通過（dev 站台當下僅 4 筆房間，totalPage=1，未能實測「目標不在第一頁」的真實跨頁情境，但已用真實資料驗證翻頁機制本身正確） |
| `aladdin_platform_room_platform_get_room_name_list` | `RoomPlatform.GetRoomNameList` | 依 roomId 批次查詢房間標題，一次最多 100 個 id（超過直接拒絕不查 DB，錯誤碼 2235）；**查不到的 roomId 會被靜默省略**（不存在或不屬於目前平台都一樣被過濾，無法區分），工具自行比對輸入/輸出算出 `missingRoomIds` 方便呼叫端判斷；**輸入重複的 roomId 不會去重**，回傳陣列會依輸入次數重複出現（後端內部去重只為了查 DB 效率，2026-08-25 dev 實測驗證此行為，與原先預期不同）。2026-08-25 dev 實測涵蓋混合存在/不存在、全部不存在、重複輸入、剛好 100 筆邊界、超過 100 筆、空陣列六種情境 |
| `aladdin_platform_room_platform_get_room_announcement` | `RoomPlatform.GetRoomAnnouncement` | 查詢指定房間的公告發送歷史，**無分頁、一次全撈**（後端 SQL 無 LIMIT），依時間新到舊排序；roomId 不存在或不屬於目前平台會直接報錯（`roomNotFound`），不是回空陣列。`createdAtTimestamp` 已轉成一般數字——2026-08-25 dev 實測發現即使後端來源是 JS number，client 端 protobuf 解碼仍是字串（`toPlainNumber` 修正前實測拿到 `"1777970431000"`），不能只看伺服器端型別就跳過轉換。`userName` 實際上是帳號 identifier 不是暱稱（後端檔頭註解明寫）。2026-08-25 dev 實測涵蓋存在 roomId（含真實歷史資料）、不存在 roomId、空字串三種情境 |
| `aladdin_platform_room_platform_get_room_members` | `RoomPlatform.GetRoomMembers` | 列出指定房間目前仍在房內（未離開）的成員，不含房主，每頁固定 20 筆（呼叫端不能調整）；**totalPage 只有 page=1 才是真的算出來的，其餘頁固定回 0**；`status` 只反映單場禁言（全場/主播禁言不會顯示 Muted，屬後端刻意的業務決策，非查詢遺漏）；roomId 不存在或不屬於目前平台會直接報錯，不回空清單。**同一頁內順序是依帳號字典序，不是入房先後順序**（分頁切片用入房序，組成最終結果的查詢改依帳號排序）。**`createdAt` 是該會員的帳號註冊時間，不是加入房間的時間**（依既有 i64 慣例用 `toPlainNumber` 轉換）。2026-08-25 dev 實測涵蓋 page=1/2、預設 page、不存在 roomId 四種情境；**當下 4 個已知測試房間皆無在線成員**，未能用非空 rows 驗證欄位轉換的實際輸出形狀 |
| `aladdin_platform_room_platform_get_muted_members_by_user_ids` | `RoomPlatform.GetMutedMembersByUserIds` | 從一批 userId 篩出「在指定房間被單場禁言」的子集，只看單場禁言（同 `get_room_members` 的 status 語意，底層共用 `getUsersMutedOnlyByRoom`）；**roomId 完全不驗證是否存在**——傳不存在的 roomId 不報錯，靜默回空陣列；userIds 無長度上限但不能是空陣列。2026-08-25 dev 實測涵蓋真實 roomId、不存在 roomId、空陣列三種情境；**當下 dev 站台沒有任何被單場禁言的測試帳號**，未能驗證非空 mutedUserIds 的實際輸出形狀 |
| `aladdin_platform_room_platform_kick_room_member` | `RoomPlatform.KickRoomMember` | 把會員踢出房間，**只是單純踢出、不會禁止對方之後再加入同一房間**（沒有黑名單，要永久禁入請用另一支 `BanRoomMember`，本工具不涵蓋）；RPC 只送非同步 job、不等待真正踢人完成，成功回應不代表真的踢到人。**對真實在線使用者的實際影響比字面「踢出」輕**：2026-08-25 review 查證現版前端對這個踢出原因沒有 UI 反應，畫面不會被強制移出，只有伺服器端成員資格與聊天/禮物頻道訂閱失效，無持久化影響、無需撤銷。2026-08-25 dev 實測**刻意只用不存在的 userId**（避免影響任何真實使用者），驗證真實/不存在 roomId 皆安全成功、userId 非正數被擋下三種情境；未對任何真實在線帳號呼叫過 |
| `aladdin_platform_room_platform_mute_room_member` | `RoomPlatform.MuteRoomMember` | 把會員在某房間單場禁言（不影響其他房間，不是全站/主播禁言），**被禁言者仍能留在房間看直播，只是不能發言**；永久生效需另呼叫 `unmute_room_member` 解除；roomId/userId 不存在、或對方是防禁言特權帳號/房主本人/房間管理員，都會直接報錯不落庫；**重複對同一人呼叫會報錯**（唯一鍵衝突，非冪等）。已知後端落差：寫入後不保證立刻同步聊天室發言權限快取。2026-08-25 dev 測試沒能找到可安全測試成功路徑的真實 userId（測試房間 ownerUserId 也回 userNotExists），只驗證了錯誤路徑，未驗證成功禁言的完整 round-trip |
| `aladdin_platform_room_platform_unmute_room_member` | `RoomPlatform.UnmuteRoomMember` | 解除單場禁言，**無法解除全站禁言或主播禁言**——對被那兩種禁言的人呼叫會靜默回成功但對方仍不能發言，success 不代表恢復發言能力；對沒被禁言的人呼叫同樣是冪等靜默成功，但仍會寫 audit log（操作紀錄不保證代表真的有狀態變更）。2026-08-25 dev 實測驗證冪等/靜默成功路徑，因同上限制未能驗證「真的解除某筆禁言」的完整效果 |
| `aladdin_platform_room_platform_get_chat_history` | `RoomPlatform.GetChatHistory` | 取得房間近期聊天訊息快照（記憶體 LRU，每房間上限約 50 筆，快取沒命中 fallback 查 DB 最多 100 筆），**無分頁**；完整分頁歷史請改用 `aladdin_platform_room_platform_get_chat_records`（同 service，已另外包成 tool）。roomId 不存在會直接報錯不回空陣列。**回傳內容故意移除 `chatRoomId`**（chat 系統內部數字 id，跟輸入的 roomId 是不同體系的值，保留只會誤導呼叫端拿去錯誤代換）。`messageId`/`createdTimestamp` 及曬單訊息的 `showOrderPayload.{orderId,betAmount,payoutAmount}` 皆為 i64，已用 `toPlainNumber` 轉換。2026-08-25 dev 實測涵蓋 4 個測試房間（2 房有真實聊天紀錄、2 房無訊息）與不存在 roomId，皆確認正常；兩位獨立 fable5 reviewer 先 FAIL、交叉抓到「引用不存在的 tool」問題後修正 |
| `aladdin_platform_room_platform_get_chat_records` | `RoomPlatform.GetChatRecords` | 分頁查詢房間完整聊天訊息歷史，直查 DB（不吃 `get_chat_history` 那支的 LRU 快取）；`pageSize` 後端無上限（同 `GameVendorAdmin.ListGames` 出過包的模式），工具層自行收斂到 1~100、預設 20；**totalPage 只有 page=1 才是真的算出來的**，其餘頁固定回 0；roomId 不存在直接報錯不回空陣列；回傳的 `bypassSensitiveWord` 一律是預設值不反映實際狀況；同 `get_chat_history` 故意移除 `chatRoomId`；只想查曬單類型訊息改用 `aladdin_platform_room_platform_get_show_order_records`。2026-08-25 dev 實測涵蓋 page=1（roomId=5usAxZpxTEH4SLzuDLHbn4，totalPage=2 正確）、page=2（totalPage=0 驗證已知坑，且目標訊息 messageId=1735 剛好不在第一頁）、預設值、不存在 roomId、pageSize 超上限五種情境；另有獨立 reviewer 用別的房間（74 則訊息、totalPage=4）重現同一行為，交叉驗證一致 |
| `aladdin_platform_room_platform_get_show_order_records` | `RoomPlatform.GetShowOrderRecords` | 分頁查詢房間「曬單」類型聊天訊息（依 `message_kind` 篩選），與 `get_chat_records` 是同一套分頁機制、共用同一支底層函式，只差固定帶曬單篩選條件；pageSize/totalPage/roomId 錯誤/chatRoomId 移除等行為完全一致，細節見該 tool。2026-08-25 dev 實測：4 個測試房間皆無曬單訊息（rows 皆空、totalPage=0，符合預期），未能用真實資料驗證 showOrderPayload 巢狀 i64 轉換，僅驗證空清單/不存在 roomId/pageSize 超上限三種路徑 |
| `aladdin_platform_room_moderation_get_monitor_list` | `RoomModeration.GetMonitorList` | 依類型（anchor 主播房間/external 三方房間）列出直播監控列表，**type=video 目前後端未實作、呼叫必定失敗**；只有 `type` 一個篩選條件，無房間名稱/roomId 篩選，會撈出目前平台下該類型全部房間；`pageSize` 後端無上限，工具層收斂到 1~100；**totalPage 只有 page=1 才是真的算出來的**；`gameName`/`roomTemplateName` 後端固定回空字串（尚未接遊戲/房間模板模組）；`streamData` 只有 external 類型有內容。`createdAtTimestamp` 為 i64 已轉換。2026-08-25 dev 實測涵蓋 anchor（真實資料）、external（真實資料含 streamData）、video（確認 notImplemented）、非法 type、pageSize 超上限五種情境 |
| `aladdin_platform_room_moderation_get_mute_list` | `RoomModeration.GetMuteList` | 查詢目前生效中的禁言名單，**涵蓋全站/單場/主播三種類型混在一起**，無法用參數篩選類型（要看回傳 status 欄位自行判斷）；`roomId` 只有單場禁言（status=2）才有值；`createdStartAtTimestamp`/`createdEndAtTimestamp` 雖名為建立時間，**實際比對的是最後更新時間**（後端既有語意落差）；`pageSize` 型別是 PageSizeEnum，後端 jasmine 生成層確實有 enum 驗證（非法值拒絕），工具層收斂到同一組合法值 10/20/30/50/100/200；**totalPage 只有 page=1 才是真的算出來的**。2026-08-25 dev 實測涵蓋無篩選（同時看到 status=1 永久/全站與 status=2 單場兩種真實資料）、pageSize 非法值、不存在 identifier 三種情境；兩位獨立 fable5 reviewer 一 PASS 一 FAIL，FAIL 抓到「pageSize 後端無夾限」的錯誤宣稱（生成層其實有 enum 驗證），已修正 |
| `aladdin_platform_module_platform_get_platform_modules` | `ModulePlatform.GetPlatformModules` | 查詢目前登入平台已啟用的模組清單（無參數，自動取 context.platformId；只回已啟用的子集，欄位比 admin 端精簡）；platform 後台本身無寫入能力，調整模組啟停需改用 `aladdin-admin` |
| `aladdin_platform_point_platform_list_point_transactions` | `PointPlatform.ListPointTransactions` | 分頁查詢本平台會員的積分交易紀錄，identifier 查無會員回空陣列（非錯誤），orderId 為 LIKE 模糊比對 |
| `aladdin_platform_point_platform_list_app_user_total_points` | `PointPlatform.ListAppUserTotalPoints` | 分頁查詢本平台會員目前積分餘額；帶 identifier 且會員存在但無積分紀錄時回一筆 quantity=0（非空陣列） |
| `aladdin_platform_point_platform_list_vip_point_settings` | `PointPlatform.ListVipPointSettings` | 列出本平台每個 VIP 層級的積分返利設定摘要，無參數、固定小量列舉 |
| `aladdin_platform_point_platform_get_point_setting` | `PointPlatform.GetPointSetting` | 取得本平台全局積分設定（單例），無參數 |
| `aladdin_platform_point_platform_update_point_setting` | `PointPlatform.GetPointSetting` + `UpdatePointSetting` | 更新全局積分設定，先讀現值、只覆蓋帶到的欄位、round-trip 讀回；dueType=absoluteTime/relativeTime 分別要求搭配 dueAtTimestamp/dueDay |
| `aladdin_platform_point_platform_get_vip_point_setting` | `PointPlatform.GetVipPointSetting` | 取得指定 VIP 層級的積分返利完整編輯資料，是 update_vip_point_setting 的讀現值搭配方法 |
| `aladdin_platform_point_platform_update_vip_point_setting` | `PointPlatform.GetVipPointSetting` + `UpdateVipPointSetting` | 更新指定 VIP 層級的積分返利設定，先讀現值、只覆蓋帶到的欄位（displayTagPointRebates 依 displayTag 逐分類覆蓋，未帶到的分類沿用現值）、round-trip 讀回 |
| `aladdin_platform_point_platform_get_point_sign_in_setting` | `PointPlatform.GetPointSignInSetting` | 取得「積分活動 > 簽到獎勵」設定（單例，尚未設定過時各欄位回零值/空陣列、不會自動建立預設值） |
| `aladdin_platform_point_platform_update_point_sign_in_setting` | `PointPlatform.GetPointSignInSetting` + `UpdatePointSignInSetting` | 更新「簽到獎勵」設定；⚠️ streakBonuses 若帶入是整組全量替換（DELETE+INSERT），非增量新增 |
| `aladdin_platform_point_platform_get_point_holiday_setting` | `PointPlatform.GetPointHolidaySetting` | 取得「積分活動 > 節假日獎勵」開關 + 設置列表（只回未軟刪除的） |
| `aladdin_platform_point_platform_update_point_holiday_status` | `PointPlatform.UpdatePointHolidayStatus` | 切換「節假日獎勵」功能開關，不影響已設定的節假日清單 |
| `aladdin_platform_point_platform_create_or_update_point_holiday_bonus` | `PointPlatform.CreateOrUpdatePointHolidayBonus` | 新增/編輯一筆節假日設置（id=0 新增、id>0 編輯）；期間僅精確到天、不可與其他設置重疊；回傳值是 Empty，新增後改用 name 比對 round-trip，找不到精準匹配時如實回報非失敗 |
| `aladdin_platform_point_platform_delete_point_holiday_bonus` | `PointPlatform.DeletePointHolidayBonus` | 刪除一筆節假日設置（軟刪除，非冪等，重複刪除回 pointHolidayBonusNotFound） |
| `aladdin_platform_vip_level_platform_get_vip_setting_equity_icons` | `VipLevelPlatform.GetVipSettingEquityIcons` | 列出本平台全部「VIP 權益圖標」選項（新版 VIP 體系，需權限 AppUser.Vip），無參數、固定小量列舉；⚠️ 回傳的 isSelect 恆為 disabled（此公開 API 不會帶 vipLevelSettingId，無法用來判斷某等級是否已勾選某圖標） |
| `aladdin_platform_vip_level_platform_get_vip_level_settings` | `VipLevelPlatform.GetVipLevelSettings` | 列出本平台全部啟用中的 VIP 等級設定（新版 VIP 體系，此 method 無 @Permission），無參數、走快取、固定小量列舉；⚠️ 舊版體系 `VipPlatform.GetVipLevelConfigs` 資料已無人維護（dev 實測 0 筆），本 tool 才是現行來源 |
| `aladdin_platform_vip_level_platform_delete_vip_level_setting` | `VipLevelPlatform.DeleteVipLevelSetting` | 軟刪除一筆 VIP 等級設定，等級仍有真實會員時會擋下（errorCode=vipLevelSettingHasUsers）；⚠️ 對不存在/已刪除的 id 重複呼叫都回成功，需用回傳的 readBack 欄位（read_back_failed/still_present/confirmed_removed）判斷實際狀態，讀回走快取可能有極短暫假陰性 |
| `aladdin_platform_vip_level_platform_get_vip_setting` | `VipLevelPlatform.GetVipSetting` | 取得本平台 VIP 全域設定（單例），無參數、內部用 context.platformId（無跨租戶風險）；⚠️ 五個 `*AuditMultiple` 欄位原始值為實際倍數 ×10000，`*ValidityTime` 單位是小時 |
| `aladdin_platform_vip_level_platform_update_vip_setting` | `VipLevelPlatform.GetVipSetting` + `UpdateVipSetting` | 更新 VIP 全域設定，先讀現值、只覆蓋帶到的欄位；⚠️ 刻意不開放編輯 equityIcons（後端對它是「未在傳入清單即軟刪」）一律原樣帶回；userLevels 整批覆蓋且會額外 round-trip 比對（後端 SyncTargetIdsForSource 失敗時會被吞掉，見程式內註解） |
| `aladdin_platform_chat_speech_setting_platform_get_chat_speech_setting` | `ChatSpeechSettingPlatform.GetChatSpeechSetting` | 讀取「房間管理」→「房間限制設定」→「房間功能設定」→「聊天室發言設定」目前的設定內容（單例設定，無參數，不吃 platformId；查無資料時回傳全 0／空陣列預設值，不是錯誤） |
| `aladdin_platform_chat_speech_setting_platform_save_chat_speech_setting` | `ChatSpeechSettingPlatform.GetChatSpeechSetting` + `SaveChatSpeechSetting` | 修改聊天室發言設定並儲存，所有欄位皆 optional，只覆蓋有帶到的欄位，其餘先讀現值原樣帶回；memberLevels 陣列為整包覆蓋（後端整批刪除重建關聯表），非差異運算 |
| `aladdin_platform_platform_captcha_config_get_platform_verification_config` | `PlatformCaptchaConfig.GetPlatformVerificationConfig` | 讀取本平台的驗證碼設定（可用類型清單 + 目前類型），無參數，平台由連線本身判定 |
| `aladdin_platform_platform_captcha_config_set_platform_verification_captcha_type` | `PlatformCaptchaConfig.SetPlatformVerificationCaptchaType` | 切換本平台目前使用的驗證碼類型（須屬於 availableCaptchaTypes 清單），後端自己會保留清單不受影響，工具直接單參數呼叫 |
| `aladdin_platform_common_info_platform_get_configs` | `CommonInfoPlatform.GetConfigs` | 分頁查詢本平台後台信息系統（公告/緊急通知/最新消息/必讀……共用同一支查詢），A 級（`ids` 可精準查找）；`status`/`pageSize` 不帶時工具內部分別改送 `-1`/`50`，不能直接不帶（送 `undefined` 會分別落到「精準比對 status=0」「LIMIT 0,0」兩個地雷，見工具檔頭說明），2026-08-25 dev 實測含 156 筆真實資料、A 級目標記錄不在第一頁情境 |
| `aladdin_platform_common_info_platform_get_read_count` | `CommonInfoPlatform.GetReadCount` | 批次查詢多筆信息各自的已讀人數，回傳陣列與輸入 `infoIds` 陣列結構性保證同長度同順序（不需自行比對 id），不存在/0已讀/別平台的 id 皆回 0（三者不可區分，但不會洩漏別平台數字），`infoIds` 上限 1000 筆（工具自加防呆） |
| `aladdin_platform_urgent_info_platform_create_config` | `UrgentInfoPlatform.CreateConfig` | 新增一筆緊急通知，新建立的紀錄一律強制 disabled（要生效需另外呼叫 EnableConfig，尚未包裝成 tool），只寫操作日誌不觸發背景 job/快取；RPC 不回傳 id，工具改用 title 完全比對做 best-effort 讀回（title 非唯一鍵，找不到不代表失敗） |
| `aladdin_platform_in_house_game_back_office_get_vendor_list` | `InHouseGameBackOffice.GetVendorList` | 分頁查詢自研遊戲廠商清單，可用 gameId（精確比對但非唯一，一個遊戲可對應多個廠商）或 vendorName（模糊比對）篩選；與 aladdin-admin 同名 tool 共用同一份底層資料，2026-08-25 dev 實測兩端結果逐筆一致（9 筆） |
| `aladdin_platform_in_house_game_back_office_get_play_group_list` | `InHouseGameBackOffice.GetPlayGroupList` | 分頁查詢自研遊戲「玩法組」清單，可用 vendorId（精確但非唯一）、name（模糊）、status（enabled/disabled）篩選；與 aladdin-admin 同名 tool 共用同一份底層資料，2026-08-25 dev 實測兩端結果逐筆一致（25 筆） |
| `aladdin_platform_wallet_platform_get_show_category` | `WalletPlatform.GetShowCategory` | 讀取本平台「錢包交易紀錄」列表要顯示哪些交易分類（TransactionCategoryEnum 字串 key 陣列），純讀取；2026-08-25 dev 實測 |
| `aladdin_platform_wallet_platform_update_show_category` | `WalletPlatform.UpdateShowCategory` | 設定要顯示的交易分類，**整批覆蓋**（後端先 DELETE 再 INSERT，非增量 diff），完成後自動讀回驗證；2026-08-25 dev 實測完整 round-trip（改值→驗證→復原→驗證已復原） |
| `aladdin_platform_wallet_platform_list_classification_categories` | `WalletPlatform.ListClassificationCategories` | 列出本平台已建立的「運營歸類」（交易類型分組），無參數、不分頁、一次回傳全部；2026-08-25 dev 實測 |
| `aladdin_platform_wallet_platform_create_or_update_classification` | `WalletPlatform.CreateOrUpdateClassification` | 新增/更新歸類，`id` 省略或 0 走新增；更新時 name/remark/categories 皆整包覆蓋，但省略欄位會先讀現值沿用（要清空 categories 需明確傳 `[]`）；新增時後端不回 id，改用 name 比對清單找出新建的那筆（同名多筆會如實列出全部候選）；2026-08-25 dev 實測含新增/更新/欄位沿用/明確清空四種情境 |
| `aladdin_platform_wallet_platform_delete_classification` | `WalletPlatform.DeleteClassification` | 刪除歸類，**硬刪除、不冪等**（對已刪除 id 再刪一次會回錯誤），刪除前先確認記錄存在；2026-08-25 dev 實測含正常刪除與重複刪除兩種情境 |
| `aladdin_platform_wallet_platform_get_categories_by_classification` | `WalletPlatform.GetCategoriesByClassification` | 把一批歸類 id 解析成涵蓋的交易類型去重聯集，純讀取；2026-08-25 dev 實測 |
| `aladdin_platform_wallet_platform_list_user_transactions` | `WalletPlatform.ListUserTransactions` | 查詢會員錢包交易紀錄，搜尋區間上限 93 天（未帶時預設查最久可查區間）；金額欄位為 stored 整數（依 currencyCode 換算，本工具不做正規化）；**`status` 不支援 "pending"**（後端 `searchNotEmpty()` 對數字 0 視為未帶，篩選會被靜默忽略，2026-08-25 review 發現並修正）；i64 欄位（amount/beforeBalance/afterBalance/createdAtTimestamp/registerTimestamp）已轉成一般 number，避免印出 protobufjs 內部 Long 物件；2026-08-25 dev 實測含預設查詢、超過 93 天區間報錯、空結果集三種情境 |
| `aladdin_platform_audit_platform_get_audit_logs` | `AuditPlatform.GetAuditLogs` | 查詢本平台的操作紀錄；`systemId` 省略內部固定送 -1（0 是合法值 core，不能當不篩選）；`actionId` 是 PlatformActionIdEnum 字串 key（723 個值，改用字串 + 呼叫前驗證，不塞進 z.enum）；`pageSize` 只接受 10/20/30/50/100/200；2026-08-25 dev 實測 |
| `aladdin_platform_room_gift_platform_list_room_gifts` | `RoomGiftPlatform.ListRoomGifts` | 列出直播間送禮商品清單，無參數；2026-08-25 dev 實測（本 dev 站台目前無資料，回空陣列） |
| `aladdin_platform_room_gift_platform_get_room_gift_statistic_summary` | `RoomGiftPlatform.GetRoomGiftStatisticSummary` | 讀取送禮整體統計摘要，無參數；2026-08-25 dev 實測（本 dev 站台目前無資料） |
| `aladdin_platform_room_gift_platform_list_records` | `RoomGiftPlatform.ListRecords` | 查詢送禮紀錄；**status 省略時內部固定送 "all"**（後端把「省略」與「明確傳 pending」在協定層視為同一件事，皆等於 0，省略若不處理會被誤判成只篩 pending，見程式碼註解）；2026-08-25 dev 實測 RPC 呼叫與非法輸入正確不出錯（本 dev 站台目前無送禮紀錄資料，無法實測驗證 all/pending 篩選結果確實不同，此限制已誠實記錄在程式碼註解） |
| `aladdin_platform_room_gift_platform_get_anchor_statistic_summary` | `RoomGiftPlatform.GetAnchorStatisticSummary` | 查詢主播月度送禮收益統計（依主播維度聚合），searchStartDate/currencyCode 皆必填；2026-08-25 dev 實測含合法月份、非法格式（回 errorCode=7 requestNotValid）兩種情境 |
| `aladdin_platform_room_gift_platform_get_platform_statistic_summary` | `RoomGiftPlatform.GetPlatformStatisticSummary` | 查詢平台月度送禮收入統計（依月份+幣別聚合，不分主播），searchStartDate/currencyCode 皆必填；2026-08-25 dev 實測含 "YYYY-MM"/"YYYY/MM" 兩種日期格式 |
| `aladdin_platform_currency_platform_get_currencies` | `CurrencyPlatform.GetCurrencies` | 列出幣別清單（平台視角）；回傳的 `status` 是平台級啟停狀態，跟 aladdin-admin 那支的全域 `status` 是不同概念；被 admin 端全域停用的幣別會整批從清單消失（`enabledOnly=false` 也一樣查不到），兩端清單集合可能不同；2026-08-25 dev 實測 |
| `aladdin_platform_currency_platform_update_currency_status` | `CurrencyPlatform.UpdateCurrencyStatus` | 切換某幣別在本平台底下的啟停狀態；平台目前的 defaultCurrencyCode 無法被停用（後端回 requestNotValid，特判給明確訊息）；先讀現值、同值短路不呼叫後端；2026-08-25 dev 實測含 defaultCurrencyCode 保護、round-trip、不存在 code 三種情境 |
| `aladdin_platform_otp_code_setting_platform_get_sms_settings` | `OtpCodeSettingPlatform.GetSmsSettings` | 讀取本平台簡訊驗證碼（OTP SMS）發送限制設定（單例，無參數）；設定不存在時後端自動建立預設值，不會回空值 |
| `aladdin_platform_otp_code_setting_platform_update_sms_settings` | `OtpCodeSettingPlatform.GetSmsSettings` + `UpdateSmsSettings` | 修改本平台 OTP SMS 發送限制設定，所有欄位皆 optional，先讀現值、只覆蓋有帶到的欄位、寫入後 round-trip 驗證；2026-08-25 dev 實測 limitCount round-trip 成功且其餘欄位不受影響 |
| `aladdin_platform_security_restriction_platform_get_registration_field_configs` | `SecurityRestrictionPlatform.GetRegistrationFieldConfigs` | 讀取「產品系統/安全管理/註冊規則」各 registrationType（user/agent）下各欄位的顯示要求（hidden/optional/required）；無參數不分頁；2026-08-26 dev 實測資料庫另有一筆不在列舉定義內的 registrationType=0 既有列，原樣回傳數字不視為異常 |
| `aladdin_platform_security_restriction_platform_create_or_update_registration_field_config` | `SecurityRestrictionPlatform.GetRegistrationFieldConfigs` + `CreateOrUpdateRegistrationFieldConfig` | 以 registrationType 為業務鍵新增/修改上述欄位顯示設定，先讀現值只覆蓋帶到的欄位；找不到既有列時要求 11 個欄位全帶齊；2026-08-26 dev 實測 round-trip 成功並已復原 |
| `aladdin_platform_security_restriction_platform_get_registration_limit_config` | `SecurityRestrictionPlatform.GetRegistrationLimitConfig` | 讀取「產品系統/安全管理/註冊規則」的 IP/裝置註冊上限設定（單例，無參數） |
| `aladdin_platform_security_restriction_platform_update_registration_limit_config` | `SecurityRestrictionPlatform.GetRegistrationLimitConfig` + `UpdateRegistrationLimitConfig` | 修改 IP/裝置註冊上限設定，所有欄位 optional，先讀現值只覆蓋帶到的欄位；2026-08-26 dev 實測 round-trip 成功並已復原 |
| `aladdin_platform_security_restriction_platform_get_login_rules` | `SecurityRestrictionPlatform.GetLoginRules` | 讀取「產品系統/安全管理/登入規則」完整設定（登入提示+登入驗證+找回密碼三組子設定，單例，無參數） |
| `aladdin_platform_security_restriction_platform_update_login_prompt_config` | `SecurityRestrictionPlatform.GetLoginRules` + `UpdateLoginPromptConfig` | 修改登入提示（手機號註冊/登入開關），先讀現值只覆蓋帶到的欄位；2026-08-26 dev 實測 round-trip 成功並已復原 |
| `aladdin_platform_security_restriction_platform_update_login_verification_config` | `SecurityRestrictionPlatform.GetLoginRules` + `UpdateLoginVerificationConfig` | 修改登入異常驗證規則（IP/異地/設備/密碼錯誤四組獨立開關），先讀現值只覆蓋帶到的欄位；2026-08-26 dev 實測 round-trip 成功並已復原 |
| `aladdin_platform_security_restriction_platform_update_password_reset_config` | `SecurityRestrictionPlatform.GetLoginRules` + `UpdatePasswordResetConfig` | 修改找回密碼限制週期與次數，先讀現值只覆蓋帶到的欄位；2026-08-26 dev 實測 round-trip 成功並已復原 |
| `aladdin_platform_security_restriction_platform_list_trade_password_lock_record` | `SecurityRestrictionPlatform.ListTradePasswordLockRecord` | 分頁查詢交易密碼錯誤鎖定紀錄；identifier 為後端 LIKE 模糊比對；status 篩選只接受 lock/unlock 兩態；2026-08-26 dev 實測含 identifier 篩選 |
| `aladdin_platform_security_restriction_platform_unlock_trade_password_lock_record` | `SecurityRestrictionPlatform.UnlockTradePasswordLockRecord` | 解鎖指定的鎖定紀錄；2026-08-26 dev 實測確認重複呼叫冪等，但對不存在的 id 呼叫後端一樣回成功（不驗證存在性），呼叫端需看回傳的 currentStatus 核對而非只看 success |
| `aladdin_platform_security_restriction_platform_get_trade_password_lock_config` | `SecurityRestrictionPlatform.GetTradePasswordLockConfig` | 讀取「資金密碼管理」的交易密碼設置（哪些操作需驗證交易密碼 + 驗證失敗鎖定規則，單例，無參數） |
| `aladdin_platform_security_restriction_platform_create_or_update_trade_password_lock_config` | `SecurityRestrictionPlatform.GetTradePasswordLockConfig` + `CreateOrUpdateTradePasswordLockConfig` | 修改交易密碼設置，所有欄位 optional，先讀現值只覆蓋帶到的欄位（後端走通用 ORM assignKey 合併，工具層先讀現值可在任何合併模式下安全）；2026-08-26 dev 實測 round-trip 成功並已復原 |
| `aladdin_platform_security_restriction_platform_get_freeze_config` | `SecurityRestrictionPlatform.GetFreezeConfig` | 讀取「凍結管理」設定（passwordError/cancelOrder 兩組凍結規則，單例，無參數） |
| `aladdin_platform_security_restriction_platform_update_freeze_config` | `SecurityRestrictionPlatform.GetFreezeConfig` + `UpdateFreezeConfig` | 修改凍結管理設定，passwordError/cancelOrder 兩組規則各自獨立、可只改其中一組；2026-08-26 dev 實測 round-trip 成功並已復原 |

| `aladdin_platform_risk_platform_list_platform_risk_strategies` | `RiskPlatform.ListPlatformRiskStrategies` | 分頁查詢當前登入平台的風控策略（含 status/riskLevel，不含 riskStrategyCode）；與 aladdin-admin 端超管版本回傳的欄位不對稱，見 tool description。**已知分頁陷阱**：`totalPage` 只有 `page=1` 才會真的計算，翻頁到底要改用 `rows.length < pageSize` |
| `aladdin_platform_risk_platform_get_platform_risk_strategies` | `RiskPlatform.GetPlatformRiskStrategies` | 無參數、不分頁一次取回當前平台**全部**風控策略，設計用途是前端下拉選單/篩選器的 select option 來源（管理員維護的小型清單，可安全全撈）。欄位同分頁版 |
| `aladdin_platform_risk_platform_get_platform_risk_strategy_for_edit` | `RiskPlatform.GetPlatformRiskStrategyForEdit` | 依 id 讀取單筆策略完整編輯資料，**正確做平台隔離**（`id = ? AND platform_id = ?`，與 admin 端超管版本不同）。多帶 `riskStrategyCurrencyConditions`（各幣別觸發門檻條件 JSON），不含 status。查無此 id 回業務錯誤 errorCode=11（idNotExists，非例外） |
| `aladdin_platform_risk_platform_update_platform_risk_strategy_status` | `RiskPlatform.UpdatePlatformRiskStrategyStatus` | 切換單一策略啟用/停用，只改 status，不動其他欄位；寫入後用不分頁的 `get_platform_risk_strategies` 讀回驗證。2026-08-25 dev 實測：不存在 id/跨平台 id 回 errorCode=14（objectNotFound）、同值呼叫成功（不會誤判失敗） |
| `aladdin_platform_risk_platform_list_platform_risk_events` | `RiskPlatform.ListPlatformRiskEvents` | 分頁查詢風控事件（策略命中紀錄，對應「風控 → 出款標籤日誌」頁）。搜尋條件皆選填：userId/platformRiskStrategyId 精確比對、identifier LIKE 模糊比對、時間區間、riskLevel。**已知分頁陷阱**：`totalPage` 只有 `page=1` 才會真的計算 |
| `aladdin_platform_risk_platform_ip_region_get_ip_region_list` | `RiskPlatformIpRegion.GetIpRegionList` | 分頁查詢「限制遊戲 IP/地區」規則。**limitContent 搜尋是逗號分隔多值 FIND_IN_SET OR 查詢，不是子字串模糊比對**（remark 才是 LIKE）；pageSize 為固定選項（PageSizeEnum）。回傳含後台表單標 @Hide 但 API 仍會給的 status/promptText/customerId。**已知分頁陷阱**：`totalPage` 只有 `page=1` 才會真的計算 |
| `aladdin_platform_risk_platform_ip_region_create_or_update_ip_region` | `RiskPlatformIpRegion.CreateOrUpdateIpRegion` | 新增或更新一筆規則（upsert，id=0/留空為新增）。limitItem/limitMethod/limitContent/gameType/ids 五欄必填、每次都要帶齊；remark 只在呼叫端明確帶時才覆蓋（省略時完全不觸碰該欄位，避開 assignKey 零值覆蓋地雷）；promptText 逐語系 upsert；**customerId 是唯一有零值覆蓋風險的欄位**，此 service 無 GetForEdit，更新前會自動掃描 `get_ip_region_list` 取得現值當基準。更新完成後會讀回完整現值（`verified`）供核對；新增無法拿新 id，改用前後 id 集合 diff |
| `aladdin_platform_risk_platform_ip_region_update_ip_region_status` | `RiskPlatformIpRegion.UpdateIpRegionStatus` | 切換單一規則啟用/停用。同值呼叫是明確 no-op（後端先查現況、相同直接回成功不執行 UPDATE），可放心重複呼叫 |
| `aladdin_platform_risk_platform_ip_region_batch_update_ip_region_status` | `RiskPlatformIpRegion.BatchUpdateIpRegionStatus` | 批量切換多筆規則狀態。**部分成功語意**：回傳的 success 只含真的被改變的 id，沒出現的 id 可能是不存在/不屬於當前平台/已是目標狀態三者之一，無法進一步區分 |
| `aladdin_platform_risk_platform_ip_region_delete_ip_region` | `RiskPlatformIpRegion.DeleteIpRegion` | **硬刪除**單一規則，無法復原。id 不存在/屬於別平台回業務錯誤，不會誤刪 |
| `aladdin_platform_risk_platform_ip_region_batch_delete_ip_region` | `RiskPlatformIpRegion.BatchDeleteIpRegion` | **硬刪除**多筆規則，無法復原。**部分成功語意**：回傳 deleted 只含真的存在且屬於當前平台的 id，沒出現的 id 沒有被誤刪 |
| `aladdin_platform_app_user_ip_quota_platform_get_registration_ip_quota_config` | `AppUserIpQuotaPlatform.GetRegistrationIpQuotaConfig` | 讀取本平台「註冊 IP 配額限制」單例設定（總開關/初始配額/釋放配額/多語提示/客服連結）。平台從未設定過時後端回預設 disabled 值但不補寫 DB；2026-08-26 dev 實測 |
| `aladdin_platform_app_user_ip_quota_platform_update_registration_ip_quota_config` | `AppUserIpQuotaPlatform.GetRegistrationIpQuotaConfig` + `UpdateRegistrationIpQuotaConfig` | 修改上述單例設定，所有欄位皆 optional，先讀現值、只覆蓋有帶到的欄位（後端整包覆蓋非合併）、寫入後 round-trip 驗證；2026-08-26 dev 實測原值原樣寫回、round-trip 一致 |
| `aladdin_platform_app_user_ip_quota_platform_list_registration_ip_quotas` | `AppUserIpQuotaPlatform.ListRegistrationIpQuotas` | 分頁查詢註冊 IP 配額紀錄，ip 可精準比對（A 級安全）。**已知分頁陷阱**：`totalPage` 只有 `page=1` 才會真的計算；pageSize 為裸 i32、上限 200（後端明確拒絕超過 200，非截斷）。2026-08-26 dev 實測 |
| `aladdin_platform_app_user_ip_quota_platform_export_registration_ip_quotas` | `AppUserIpQuotaPlatform.ExportRegistrationIpQuotas` | 與上述 List 完全共用同一段查詢邏輯，僅獨立掛 `.Export` 權限節點、不寫 audit，供匯出任務分批取資料。同步直出，非非同步 Job |
| `aladdin_platform_app_user_ip_quota_platform_toggle_registration_ip_quota_status` | `AppUserIpQuotaPlatform.ToggleRegistrationIpQuotaStatus` | 設定單筆紀錄啟用/停用（名為 Toggle 實際要帶明確目標狀態）。同值呼叫 no-op；不存在 id 回業務錯誤（errorCode=11）。2026-08-26 dev 實測 round-trip（disabled→enabled 復原）、同值 no-op、不存在 id 三種情境 |
| `aladdin_platform_app_user_ip_quota_platform_release_registration_ip_quota` | `AppUserIpQuotaPlatform.ReleaseRegistrationIpQuota` | 釋放單筆紀錄已使用註冊數：`usedCount` 覆寫為 0、`remainingCount` 覆寫為目前平台設定的 releaseQuotaCount，不動 status。此 service 無依 id 查單筆的方法，無法嚴格 round-trip，改用呼叫前後的 list 查詢核對；2026-08-26 dev 實測（id=6：usedCount 1→0、remainingCount 24→25，數值與平台設定 releaseQuotaCount=25 吻合） |
| `aladdin_platform_app_user_ip_quota_platform_list_registration_ip_users` | `AppUserIpQuotaPlatform.ListRegistrationIpUsers` | 查詢使用指定 IP 註冊的會員清單，ip 必填精準比對。rajah 有 totalPage/totalRow，但後端 `getPageData` 只在 page=1 才計算，page>1 恆為 0；page=1 優先用 totalPage 判斷，其餘 fallback 用 `rows.length >= pageSize`；2026-08-26 dev 實測 |
| `aladdin_platform_user_enter_history_platform_get_app_domains` | `UserEnterHistoryPlatform.GetAppDomains` | 取得訪問報表可用的域名清單（無參數）。⚠️ 與 `CorePlatform.GetAppDomains`（不同 service，帶分頁，App 網域管理用途）是不同 RPC，不要混淆；2026-08-26 dev 實測 |
| `aladdin_platform_user_enter_history_platform_get_domain_report` | `UserEnterHistoryPlatform.GetDomainReport` | 依域名分組的訪問報表。domains 選填（空/省略＝查全部）；endTimestamp 須大於 startTimestamp 且區間上限 92 天（程式碼字面量，鄰近 doc 註解誤寫 31 天），超過回業務錯誤 errorCode=9；2026-08-26 dev 實測含合法查詢、時間倒置、超過 92 天三種情境 |
| `aladdin_platform_user_enter_history_platform_get_device_report` | `UserEnterHistoryPlatform.GetDeviceReport` | 依設備類型分組的訪問報表，device 欄位為 LoginDeviceEnum（ios/android/pc/mac/unknown），其餘限制與 domain report 相同；2026-08-26 dev 實測 |
| `aladdin_platform_agent_platform_get_phone_number_visibility` | `AgentPlatform.GetPhoneNumberVisibility` | 查詢目前登入操作者對代理會員手機號碼欄位的臨時可視性授權（Redis cache key，TTL 1 小時）是否仍有效；無參數，只認目前登入身分 |
| `aladdin_platform_agent_platform_view_phone_number` | `AgentPlatform.ViewPhoneNumber` | 開通目前登入操作者查看代理會員手機號碼明碼的授權，效期 1 小時，冪等（重複呼叫只延長效期）；本身不回傳手機號碼，只影響其他清單 method（尚未包裝）的遮罩行為；掛 `@Permission` + `@Totp`；無撤銷機制 |
| `aladdin_platform_agent_platform_get_reports` | `AgentPlatform.GetReports` | 分頁查詢代理數據報表，所有搜尋欄位選填，agentId/agentName 可精確鎖定單一代理；⚠️ rajah 定義比目前 abu/platform 生成的 client 多 6 個較新搜尋欄位（淨利潤/負盈利/新增直屬有效人數），本 tool 尚未支援；`realName` 預設遮罩，`revealRealName=true` 才回傳完整姓名；⚠️ 省略 statisticsDateStart/End 會回 errorCode=2778 agentReportCrossMonthNotAllowed |
| `aladdin_platform_agent_platform_get_report_details` | `AgentPlatform.GetReportDetails` | 分頁查詢某代理的直屬/團隊成員個別統計列，agentId/agentName 可精確鎖定目標代理（須為已註冊代理帳號，非任意會員 id），relationType 篩直屬/團隊；回傳含 summary 彙總；`lastLoginIp` 預設遮罩，`revealLastLoginIp=true` 才回傳完整值；⚠️ 省略 statisticsDateStart/End 同樣會回 errorCode=2778 agentReportCrossMonthNotAllowed |
| `aladdin_platform_agent_platform_get_report_statistics` | `AgentPlatform.GetReportStatistics` | 取得單一代理在指定區間的直屬/團隊兩套口徑統計數據，agentId/startTimestamp/endTimestamp 皆必填；無 PII 欄位 |
| `aladdin_platform_agent_platform_get_agent_game_reports` | `AgentPlatform.GetAgentGameReports` | 分頁查詢某代理團隊會員的遊戲報表（每列一個遊戲品牌），agentId 必填，可用 displayTag/brandId 篩選；⚠️ displayTag 省略在後端會被誤判成 0 而非全部，本 tool 已用 default(-1) 防呆；statisticsDateStart/End 省略只抓最近 7 天；無 PII 欄位 |
| `aladdin_platform_agent_platform_get_agent_bet_records` | `AgentPlatform.GetAgentBetRecords` | 分頁查詢某代理團隊會員的投注紀錄，agentId 必填，可用 accountName/userId 精確鎖定會員；⚠️ totalBetAmount 等彙總欄位是當頁合計非全條件彙總；userAccountName 非真實姓名，無 PII 遮罩需求 |
| `aladdin_platform_agent_platform_get_agent_member_game_reports` | `AgentPlatform.GetAgentMemberGameReports` | 分頁查詢某代理團隊會員的遊戲報表（每列一會員），agentId 必填，accountName 可精確鎖定；`lastLoginIp` 預設遮罩，`revealLastLoginIp=true` 才回傳完整值 |
| `aladdin_platform_agent_platform_get_agent_login_histories` | `AgentPlatform.GetAgentLoginHistories` | 分頁查詢會員登入紀錄；⚠️ 儘管掛在代理權限模組，實作完全沒有 agentId 篩選，是整個平台範圍的查詢，非限定某代理團隊；`ip` 預設遮罩，`revealIp=true` 才回傳完整值 |
| `aladdin_platform_agent_platform_list_referral_domains` | `AgentPlatform.ListReferralDomains` | 列出指定代理目前綁定的推廣域名清單，無分頁、無 PII |
| `aladdin_platform_statistic_platform_get_daily_payment_high_net_worth_statistics` | `StatisticPlatform.GetDailyPaymentHighNetWorthStatistics` | 查詢指定單一天符合高淨值門檻的存提統計摘要；startedAtTimestamp 為精確等值比對（該表日期切點，非區間）；金額欄位為 DB 原始 stored 單位，未經 rateBase 換算；2026-08-26 dev 呼叫成功（基本路徑，未逐一覆蓋金額邊界情境） |
| `aladdin_platform_statistic_platform_get_daily_payment_high_net_worth_users` | `StatisticPlatform.GetDailyPaymentHighNetWorthUsers` | 查詢符合同一組高淨值門檻的會員 userId 清單，與上一支共用完全相同的篩選條件；**無 @Permission 節點**；2026-08-26 dev 呼叫成功（基本路徑） |
| `aladdin_platform_statistic_platform_get_daily_user_game_vendor_tag_bet_summary` | `StatisticPlatform.GetDailyUserGameVendorTagBetSummary` | 全平台日投注統計摘要（依幣別分組）；startTimestamp/endTimestamp **皆為必填**（endTimestamp 帶 0 會在驗證層報錯，帶晚於今日的真實時間戳才會被靜默改成今日 00:00）；totalProfit = win − bet；2026-08-26 dev 實測含 endTimestamp=0（報錯）與晚於今日（成功）兩種情境 |
| `aladdin_platform_statistic_platform_get_daily_user_game_vendor_tag_bet_user_summary` | `StatisticPlatform.GetDailyUserGameVendorTagBetUserSummary` | 單一會員日投注統計（依廠商+分類+幣別分組）；startTimestamp/endTimestamp **皆為必填**（endTimestamp 雖然 method 內部程式碼註解稱選填，但 rajah Required 驗證擋在前面，2026-08-26 dev 實測證實 endTimestamp=0 會報錯）；totalProfit = bet − win（與平台總計版本方向相反）；**無 @Permission 節點** |
| `aladdin_platform_statistic_platform_get_today_platform_statistic` | `StatisticPlatform.GetTodayPlatformStatistic` | 今日每小時平台統計（Dashboard 走勢圖），固定回傳 24 筆補零資料；type="platformProfitRate" 會回全 0 假資料；2026-08-26 dev 呼叫成功（基本路徑，未逐一覆蓋每個 type 值） |
| `aladdin_platform_statistic_platform_get_yesterday_platform_statistic` | `StatisticPlatform.GetYesterdayPlatformStatistic` | 昨日每小時平台統計，邏輯同上一支；回應**沒有** lastUpdatedAtTimestamp 欄位（rajah 定義本來就沒有）；2026-08-26 dev 呼叫成功（基本路徑） |
| `aladdin_platform_statistic_platform_list_daily_vip_statistics` | `StatisticPlatform.ListDailyVipStatistics` | 日期數據分析 - VIP 等級視圖（每天 × 每個 VIP 等級一列）；**無分頁、後端無日期區間上限**，建議查詢範圍控制在週/月級別；2026-08-26 dev 呼叫成功（基本路徑，回傳真實資料） |
| `aladdin_platform_statistic_platform_list_deposit_method_statistics` | `StatisticPlatform.ListDepositMethodStatistics` | 充值通道統計列表（依充值方式×支付平台×幣別分組）；固定只統計一般充值（不含代理體系）；successRate rateBase=10000；2026-08-26 dev 呼叫成功（基本路徑，回傳真實分頁資料） |
| `aladdin_platform_statistic_platform_list_deposit_daily_report` | `StatisticPlatform.ListDepositDailyReport` | 充值報表（每日一列，拆分三方/公司/人工充值）；日期區間為**閉區間**（含結束當天）；manualSuccessAmount 可能為負值；2026-08-26 dev 呼叫成功（基本路徑，回傳真實分頁資料） |
| `aladdin_platform_statistic_platform_list_deposit_withdraw_daily_report` | `StatisticPlatform.ListDepositWithdrawDailyReport` | 充提報表（每日一列，並列充值/提現雙側統計）；充值成功口徑併入人工充值，提現側無此併入邏輯，兩側口徑不對稱；2026-08-26 dev 呼叫成功（回傳真實資料，且逐欄核對過一筆 row 的計算邏輯與描述一致） |
| `aladdin_platform_platform_get_supported_languages` | `Platform.GetSupportedLanguages` | 取得當前平台（依登入 token 綁定的 platformId）支援的語言設定；無輸入參數，回傳 defaultLanguageCode + languages 陣列；無 `@Permission`；純讀取、可安全重複呼叫；2026-08-26 dev 實測回傳 defaultLanguageCode=zh-CN、languages=[en-US, zh-CN, zh-TW] |
| `aladdin_platform_platform_get_timezone` | `Platform.GetTimezone` | 取得當前平台的時區設定；無輸入參數，回傳 timezone（整數，原樣透傳，未在 rajah 找到明文單位定義）；無 `@Permission`；純讀取、可安全重複呼叫；2026-08-26 dev 實測回傳 28800（pk-platform 位於 UTC+8，數值與「UTC 偏移秒數」的假設吻合，但屬單一平台歸納推測，非明文定義） |
| `aladdin_platform_platform_get_platform_code` | `Platform.GetPlatformCode` | 取得當前這次呼叫所屬平台的 platform code；無輸入參數；code 由 Gate 依請求 Host 判定後灌進 context，不查 DB；無 `@Permission`；純讀取、可安全重複呼叫；2026-08-26 dev 實測回傳 code="PK"（與 pk-platform 環境相符） |
| `aladdin_platform_platform_list_users` | `Platform.ListUsers` | 分頁查詢本平台「後台管理員帳號」清單（非 app 一般會員），需要 `@Permission "AdminManagement.Permission.Users"`；account 為 LIKE 模糊比對；⚠️ 非 super 角色登入時只看得到自己子角色底下建立的帳號，這是後端依身分自動套用的可見範圍限制，非本工具可控；roleId 原樣回傳數字 id（無內建角色名稱對照）；2026-08-26 dev 實測發現並修正 loggedInAtTimestamp/updatedAtTimestamp 這兩個 i64 欄位被 protobufjs decode 成 Long 物件的 bug（已用既有 toPlainNumber() 轉換），4 種情境（無篩選/帳號模糊比對命中/狀態篩選/查無資料）全數 PASS |
| `aladdin_platform_platform_update_user_status` | `Platform.UpdateUserStatus` | 把某個「platform 後台管理員帳號」的狀態改成指定值，需要 `@Permission "AdminManagement.Permission.Users.Status.Toggle"`；不可對自己操作（canNotDisableSelf）；只能操作登入者角色的子角色帳號；**⚠️ id 不存在時回傳 errorCode=1（unknown）而非預期的 objectNotFound——後端既有 bug**（`loadObject` 查無資料回傳 `success+null`、後續對 `null.roleId` 解參照拋例外，2026-08-26 dev 實測確認），objectNotFound(14) 實際只會在「id 存在但屬於別平台」時觸發（未實測）；`ListUsers` 無 id 篩選，本工具不做先讀現值短路；2026-08-26 dev 實測：對自己操作被拒、不存在 id 回 errorCode=1、對測試帳號 claude-dev-04 完整 round-trip（enabled→disabled→讀回確認→復原→讀回確認已復原），全數 PASS 且無殘留髒資料 |
| `aladdin_platform_platform_list_platform_supported_languages` | `Platform.ListPlatformSupportedLanguages` | 查詢語言支援設定完整明細（無 `@Permission`），無參數不分頁全撈；回傳 supportLanguages（系統全域語言母表，來自 `supported_languages` 表）+ platformLanguages（本平台目前設定，含 id/languageCode/可讀 status 字串）；是 create_or_update_support_language 的讀現值搭配工具；2026-08-26 dev 實測，pk-platform 回傳 en-US/zh-CN/zh-TW 三筆皆 enabled |
| `aladdin_platform_platform_create_or_update_support_language` | `Platform.CreateOrUpdateSupportLanguage` | 新增或修改平台語言支援設定，需要 `@Permission "AdminManagement.Setting.Language.Status.Toggle"`；**⚠️ 不是通用欄位合併 upsert，是兩條互斥分支各自忽略一個參數**：id>0（更新）只寫入 status、languageCode 被完全忽略，對預設語言的 id 操作一律拒絕（errorCode=7）；id<=0（新增）languageCode 必須落在全域母表內（否則 errorCode=9）、新增一律強制 enabled、status 被完全忽略，且不查重（重複新增同語言代碼會產生重複資料）；description 已完整揭露上述行為，回應額外附 `note` 告知該次呼叫哪個參數被忽略；2026-08-26 dev 實測 3 種情境（新增非法 languageCode 拒絕／更新預設語言拒絕／非預設語言 enabled↔disabled round-trip 並確認 languageCode 確實被忽略）全數 PASS 且已復原無殘留（過程中因測試腳本誤判一度短暫留下髒資料，已即時修正並復原，見 list 工具檔頭記錄） |
| `aladdin_platform_platform_get_backoffice_supported_languages` | `Platform.GetBackofficeSupportedLanguages` | 取得後台介面語言鎖設定（無 `@Permission`），⚠️ 跟 get_supported_languages/list_platform_supported_languages 是完全不同概念（本工具管後台管理頁面本身可切換的語言，非 app 前台支援語言），底層呼叫不同的 agrabah method；不回傳 id（對應寫入方法 ToggleBackofficeLanguageStatus/SetBackofficeDefaultLanguage 皆以 languageCode 定位）；status 是 ActiveStatusEnum（非本 server 多數欄位用的 StatusEnum，enabled/disabled 數值剛好相同但是不同列舉）；2026-08-26 dev 實測，pk-platform 回傳 en-US/zh-CN(預設)/zh-TW 三筆皆 enabled |
| `aladdin_platform_platform_toggle_backoffice_language_status` | `Platform.ToggleBackofficeLanguageStatus` | 啟用/停用後台介面語言，需要 `@Permission "AdminManagement.Setting.PlatformLang"`；停用預設語言、或停用到剩 0 個啟用語言皆拒絕（同回 errorCode=7，無法從錯誤碼分辨是哪一種）；languageCode 不存在回 idNotExists（errorCode=11）；後端全域鎖搶鎖失敗回 exceedRequestLimit（errorCode=23，非驗證錯誤，可稍後重試）；2026-08-26 dev 實測 4 種情境（停用預設語言拒絕／不存在語言碼拒絕／非預設語言 disable→enable round-trip）全數 PASS 且已復原無殘留 |
| `aladdin_platform_platform_set_backoffice_default_language` | `Platform.SetBackofficeDefaultLanguage` | 設定後台介面預設語言，需要 `@Permission "AdminManagement.Setting.PlatformLang"`；目標語言必須是 enabled 狀態，否則拒絕（errorCode=7）；languageCode 不存在回 idNotExists（errorCode=11）；交易內原子切換（清除舊預設 + 設定新預設，任何時刻都剛好一筆預設語言）；跟 toggle_backoffice_language_status 共用同一把全域鎖（exceedRequestLimit=23，非驗證錯誤，可稍後重試）；設為新預設後，該語言在被停用前須先把預設轉移給其他語言；2026-08-26 dev 實測 4 種情境（不存在語言碼拒絕／停用中語言拒絕／round-trip 切換預設語言）全數 PASS 且已復原無殘留 |
| `aladdin_platform_role_get_platform_id_roles` | `Role.GetPlatformIdRoles` | 列出當前平台底下的全部後台角色（無 `@Permission`），無參數不分頁全撈，含已停用角色；回傳 id/name/isSuper/status/parentId；是 `aladdin_platform_platform_new_user` 的 roleId 合法值來源；⚠️ 不要跟同檔無參數的 `Role.GetChildRoles()` 混淆，那支在 platform gate 是未實作 stub（errorCode=2，2026-08-26 dev 實測確認）；2026-08-26 dev 實測回傳 32 筆真實角色資料 |
| `aladdin_platform_platform_new_user` | `Platform.NewUser` | 建立新的「platform 後台管理員帳號」（真正可登入），需要 `@Permission "AdminManagement.Permission.Users.Add"`；roleId 須為登入者角色的子角色（後端 ensureChildRole 把關，非子角色回 invalidData=9）；**⚠️ roleId 完全不存在時是後端既有 bug，回 errorCode=1（unknown）而非 invalidData**（`IsChildRole` 內對不存在角色的 `loadObject` 結果做 `.parentId` 解參照拋例外，2026-08-26 dev 實測確認），呼叫前務必先用 `aladdin_platform_role_get_platform_id_roles` 確認 roleId 存在；account 已存在回 userExists；密碼雜湊儲存、無回傳值（需另呼叫 list_users 讀回取得新 id）；後端無密碼強度驗證，MCP 層加 `min(8)` 防禦性補強；建立後無法刪除只能停用；此任務曾先 needs_clarification（誤判無 roleId 查詢管道），經批次總體 review 指出查證有誤後更正為正式實作；2026-08-26 dev 實測：建立測試帳號 → round-trip 讀回確認 → 立即停用，並驗證不合法 roleId／重複帳號兩種拒絕情境 |
| `aladdin_platform_ranking_platform_list_activity_ranking_setting` | `RankingPlatform.ListActivityRankingSetting` | 分頁查詢當前平台的全部活動排行榜設定，無 search 條件；2026-08-26 dev 實測回傳 14 筆真實資料 |
| `aladdin_platform_ranking_platform_get_platform_ranking_activity_list` | `RankingPlatform.GetPlatformRankingActivityList` | 取得展示期間**尚未結束**的活動排行榜 id+名稱精簡清單（非全部），供下拉選單使用；2026-08-26 dev 實測 14 筆全量中只有 5 筆展示中 |
| `aladdin_platform_ranking_platform_change_activity_ranking_setting_status` | `RankingPlatform.ChangeActivityRankingSettingStatus` | 切換單一活動排行榜設定狀態；後端有做 affectedRows 檢查，id 不存在正確回 objectNotFound（不是靜默成功）；2026-08-26 dev 實測含不存在 id、非法列舉值、round-trip 三種情境 |
| `aladdin_platform_ranking_platform_create_or_update_activity_ranking_setting` | `RankingPlatform.CreateOrUpdateActivityRankingSetting` | 新增或編輯活動排行榜設定；編輯時 5 個時間欄位與 status 一律沿用建立時原值（呼叫端傳什麼都無效），**periodReset 是已驗證的後端保護缺口**（rajah 標 @NoEdit 但編輯時實測真的能改動）；先讀現值只覆蓋有帶到的欄位；新增無回傳 id，靠清單 id 集合差異反推；此 service 無 Delete，下架用狀態切換工具。2026-08-26 dev 實測含過去時間新增被拒絕、不存在 id 編輯被拒絕、真實新增/編輯/periodReset 缺口驗證，測試資料已設回 disabled |
| `aladdin_platform_fixed_ranking_platform_list_fixed_ranking_settings` | `FixedRankingPlatform.ListFixedRankingSettings` | 列出本平台三種固定榜單（流水/盈利/等級）設定，無參數；2026-08-26 dev 實測回傳 3 筆，`updatedAtTimestamp`（protobufjs Long 物件）已用 `toPlainNumber` 轉成一般數字 |
| `aladdin_platform_fixed_ranking_platform_change_fixed_ranking_status` | `FixedRankingPlatform.ChangeFixedRankingStatus` | 啟用/停用整張固定榜單；kind 不存在（如 unknown）回 invalidData（不是 objectNotFound，跟同 domain 慣例不同）；2026-08-26 dev 實測含 round-trip |
| `aladdin_platform_fixed_ranking_platform_update_fixed_ranking_setting` | `FixedRankingPlatform.UpdateFixedRankingSetting` | 編輯固定榜單設定（name/supportedPeriods/maxDisplayCount/showUser），業務鍵 kind，只能編輯不能新增；後端整包覆蓋這四個欄位、無 partial merge，本工具先讀現值只覆蓋有帶到的；supportedPeriods 依 kind 有合法組合限制（turnover/profit 限週/月，contribution 限 allTime），帶不合法組合回 invalidData；2026-08-26 dev 實測含非法週期組合、round-trip |
| `aladdin_platform_fixed_ranking_platform_list_fixed_ranking_entries` | `FixedRankingPlatform.ListFixedRankingEntries` | 查詢固定榜單指定週期的排行資料（跨服務取 statistic 真實數據）；kind/period 語意不合時不報錯、靜默回空清單；userId/identifier 精確篩選；page/pageSize 為裸整數，本工具 zod schema 已擋 <1（後端本身對 <=0 回 invalidData，但透過 MCP 呼叫看不到這條路徑）；i64 欄位（protobufjs Long 物件）已用 `toPlainNumber` 轉成一般數字；2026-08-26 dev 實測含不存在 identifier、contribution+allTime 真實回傳 10 筆資料 |
| `aladdin_platform_roulette_platform_get_config_name_list` | `RoulettePlatform.GetConfigNameList` | 取得本平台轉盤配置 id+多語名稱清單，無權限節點限制（跨一級菜單共用下拉來源），無參數不分頁；2026-08-26 dev 實測回傳真實資料 |
| `aladdin_platform_roulette_platform_get_reward_name_list` | `RoulettePlatform.GetRewardNameList` | 取得本平台轉盤獎勵設定 id+名稱清單（單一語系字串，非多語陣列），無參數不分頁；2026-08-26 dev 實測回傳真實資料 |
| `aladdin_platform_rebate_platform_get_rebate_config_name_list` | `RebatePlatform.GetRebateConfigNameList` | 取得本平台全部返水配置的 id+名稱對照，無參數、不分頁（後端 SQL 無 LIMIT，`id asc`）。⚠️ 後端條件只有 `platform_id`、**不排除軟刪除**，所以會回到已刪除的配置（與 `get_rebate_configs` 的 `deleted = 0` 不一致，也因此這裡拿到的 id 不保證能用 `get_rebate_config_by_id` 查到）；又因為刪除是軟刪除、本 method 不濾，這張表對本 tool 而言只增不減。abu 前端查無任何呼叫端（grep 排除 generated 為 0），實際對應頁面未經證實。2026-08-28 dev 實測 25 筆，與 `get_rebate_configs` 的 13 筆差集 12 筆 |
| `aladdin_platform_rebate_platform_get_rebate_configs` | `RebatePlatform.GetRebateConfigs` | 分頁查詢本平台未刪除的返水配置列表。method-category-checklist 第 2 節 **B 級**：只有 page/pageSize、無任何篩選欄位——定位單筆請改用 `get_rebate_config_by_id` 或 `get_rebate_config_name_list`。⚠️ 三個已驗證陷阱：(1) 分頁 SQL **沒有 ORDER BY**，跨頁順序無保證；(2) `totalPage` 只有 page=1 才計算，第 2 頁起一律 0；(3) rajah model 宣告的 `operator` 後端從未指派，實際永遠不存在。六個金額欄位（含 `wageringMultiplier`）都是 `[CurrencyLink]` 多幣別陣列，i64 已用 `deepFixLongs` 轉一般數字。2026-08-28 dev 實測含「目標不在第一頁」情境 |
| `aladdin_platform_rebate_platform_get_rebate_config_by_id` | `RebatePlatform.GetRebateConfigById` | 依 id 讀單一返水配置的完整編輯內容（`RebateConfigEdit`，比列表版多 note/rebateTagRatioList/rebateGameRatioList/ratio）。後端條件 `id AND platform_id AND deleted = 0`，platformId 取自登入態故無跨租戶風險；⚠️ 已軟刪除或不存在的 id **都回同一種錯誤**（errorCode=1 genie unknown、message 空），無法區分，本工具已附 requestedId+hint。`ratio` 系欄位是 Percent:10000（10000 = 1%）。2026-08-28 dev 實測含正常/不存在/已軟刪除三種 id |
| `aladdin_platform_rebate_platform_get_rebate_global_setting` | `RebatePlatform.GetRebateGlobalSetting` | 讀本平台全域返水設定（返水產生/領取開關、審核開關、領取週期與方式、有效期限、全局返水模式、階梯式返水配置）。⚠️ **不是完全唯讀**：後端每讀一筆階梯配置會非同步 INSERT 一筆 `rebate_debug_logs` 除錯紀錄（不動業務資料），別拿它當零成本輪詢對象。⚠️ `steppedConfigList` 可能是空陣列，也可能是後端補的一筆 id=0 內建預設，兩種都要處理。i64 已用 `deepFixLongs` 轉一般數字。2026-08-28 dev 實測回傳 6 筆真實階梯配置 |
| `aladdin_platform_rebate_platform_get_rebate_record_list` | `RebatePlatform.GetRebateRecordList` | 分頁查詢**一般返水**紀錄（後端固定 `stepped_settlement_id = 0`；階梯式請用 stepped 版）。checklist 第 2 節 **A 級**：`orderId`/`userId` 可鎖定單筆，13 個篩選欄位全開放。⚠️ 已驗證陷阱：(1) `account` 打錯回 errorCode=11 `account not exists`，不是空清單；(2) `account` 與 `userId` 同時帶會 AND，指向不同人必回 0 筆；(3) `verified`/`expired` 是後端依領取期限即時判定並就地改寫，DB 沒有 status=5；(4) 未領取/未審核/無期限的時間欄位回 **0** 不是 null；(5) `totalPage`/`totalRow` 只有 page=1 才算。排序 id desc（跨頁穩定）。2026-08-28 dev 實測 7 種情境含 orderId 精確命中、不存在帳號、狀態改寫、翻第 2 頁 |
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
    create_or_update_item.ts  — 另外 export formatItemRow()（CurrencyLink i64 欄位轉一般數字），list_items.ts 共用同一支格式化函式
    list_items.ts              — B 級清單（無 id 篩選欄位），pageSize 用 zod enum 收斂為合法 PageSizeEnum 離散值
    list_enabled_items_all.ts  — 無分頁全撈，回傳不含 commonDetail/depositWithdrawDetail
    get_item_names_by_id.ts    — 批次查名稱，回傳與輸入 ids 同長度同順序（讀原始碼證實的特例）
    update_item_status.ts      — 同值短路是必要邏輯（後端同值回錯誤），非最佳化；共用 create_or_update_item.ts 的 findItemById
    get_chat_speech_setting.ts       — 另外 export formatChatSpeechSetting()，同 get_message_board_setting.ts 模式
    update_chat_speech_setting.ts    — 讀現值 + 只覆蓋有帶到的欄位 + round-trip 讀回，同 update_message_board_setting.ts 模式
    get_platform_verification_config.ts            — 單例設定，platformId 隱式帶入，查無資料回預設值
    update_platform_verification_captcha_type.ts    — 後端自己保留 availableCaptchaTypes，工具直接單參數呼叫，不需自己讀現值合併
    get_otp_sms_settings.ts          — 另外 export formatOtpSmsSettings()，update 工具的回傳共用同一支格式化函式
    update_otp_sms_settings.ts       — 讀現值 + 只覆蓋有帶到的欄位 + round-trip 讀回，同 update_message_board_setting.ts 的模式
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
| `ALADDIN_PLATFORM_IS_PROD` | H38：這個實例是否是正式環境，設計與 admin 端的 `ALADDIN_ADMIN_IS_PROD` 完全同構（見 `../aladdin-admin/README.md` 同一節）。prod 實例**必須**設為 `true`，其餘環境不設定或設 `false`——設為 `true` 時，所有寫入型 tool（`aladdin_platform_game_vendor_platform_update_game_vendor_game`、`aladdin_platform_message_board_platform_set_message_board_post_setting`、`aladdin_platform_otp_code_setting_platform_update_sms_settings`）都會強制要求呼叫端帶上精確字串 `confirm="CONFIRM_PROD_WRITE"` 才會執行；未設定或非 `true`/`false` 的值會讓行程啟動時直接失敗。`session.ts` 同時會交叉檢查 `ALADDIN_PLATFORM_API_URL` 是否符合已知非 prod 網域特徵，URL 看起來像 prod 卻沒設這個旗標一樣會啟動失敗，不會靜默放行。詳見 `src/session.ts` 的 `assertProdConfirmed`。 |

## 已知限制

- `aladdin_platform_game_vendor_platform_list_games` 只開放 `gameVendorId`/`name`/`status` 三個篩選欄位；`displayTag`/`frontendGroupTag`/`rebateTag`/`badgeId` 這些下拉篩選需要另外查對應清單，其中 `ListAllGameDisplayTags` 已實作為 `aladdin_platform_game_vendor_platform_list_all_game_display_tags`；`ListAllGameRebateTags`/`GetBadgeList` 等仍尚未實作。
- `aladdin_platform_game_vendor_platform_update_game_vendor_game` 的圖片欄位是「每個語言各自一張圖」，沒有「一張圖套用全部語言」的機制；呼叫端要明確帶每個語言各自的本機檔案路徑（stdio 模式）或 fileId（hosted 模式，先呼叫 `POST /files` 上傳取得，見 `../README.md`「Hosted 模式」）。每次上傳都要重新拿 token（單次使用、1 小時過期）。
- **H9：`onboard_vendor_game.ts` 的圖片參數 `{code, filePath}` / `{code, fileId}` 二選一**，設計與實測方式與 `aladdin-admin` 的 `upsert_game.ts` 逐字相同，完整說明見 `../aladdin-admin/README.md` 同一段（D5/§4.3；`fileId → 本機路徑` 的三層防護：regex 格式白名單 + registry `Map` 精確比對 + realpath 二次確認）。
- **`localizedName`（多語系名稱）只能覆蓋、不能清空**：proto3 對「空陣列」與「欄位沒帶」無法區分，後端的部分更新邏輯會把明確傳入的空陣列當成「沒帶這個欄位」直接忽略，不會拿它去清掉既有值（在 admin 端用真實遊戲資料實測驗證過，platform 端邏輯相同，推論同樣適用）。language code 一旦設定過，之後只能用 `localizedNames` 覆蓋成別的值，沒辦法清空回未設定狀態。
- **i64 欄位經 protobufjs decode 後是 Long 物件，不是一般數字**（2026-08-20 實測發現）：`MessageBoardPostSetting` 的 `postsChangeUserDetailMinChargeTotal`/`postsGiftReceiveTotalAmount` 是 rajah `i64`，直接把 decode 出來的物件塞進 `JSON.stringify` 會印出 `{low, high, unsigned}`（且依呼叫路徑不同，有時反而印成十進位字串，形狀不一致）。`genie/src/common/index.ts` 其實有 `fixObjectInteger()` 專門處理這個問題，但 `genie/client` 目前沒有自動套用（呼叫處被註解掉）。`get_message_board_setting.ts`/`update_message_board_setting.ts` 已用 `const.ts` 的 `toPlainNumber()` 手動轉成一般數字再回傳；**未來任何新 tool 若回傳的 rajah model 含 `i64` 欄位，都要留意同樣的問題**，不能假設 decode 出來就是可以直接塞進 JSON 的數字。
- `aladdin_platform_message_board_platform_set_message_board_post_setting` 的 `postsGiftWageringMultiplier` 是後端實際儲存值（顯示倍率 × 10000 的整數），比照 admin 端 `exchangeRate` 的既有慣例（見 `../aladdin-admin/README.md`），工具本身不做單位換算，由呼叫端自行乘/除 10000。
- **`MessageBoardPlatform` 的 `SetPostRecommend`/`SetIsReceiveGift`/`SetIsHotPost` 三支 method 有真實跨租戶寫入漏洞，刻意未包成 tool（2026-08-26 讀原始碼發現，未實測）**：`message_board_platform.ts` 的這三支方法查詢/更新 SQL 完全沒有 `platform_id` 篩選（`SET*`/`Toggle*` 系列裡的 `SetIsPinnedPost`/`DelistPost`/`RemovePost` 都有正確加 `platform_id = ?`，這三支明顯是疏漏），任一平台登入身分帶任意 postId 即可實際修改其他平台的貼文資料（`recommendVal`/`isReceiveGift`/`isHot`）。已個別在 `mcp-rajah-tasks.sh` 標記 `needs_clarification`，等後端修 `platform_id` 篩選或使用者明確裁示要不要仍要建 tool。`GetPost`（查詢單筆貼文）同樣沒有 `platform_id`，是讀取而非寫入，風險較低但也已撤回不出貨。
- **多支 method（`DelistPost`/`RelistPost`/`RemovePost`）對「id 不存在」的判斷有真實後端 bug**：`loadObject()` 查無資料回傳 `failed:false, data:null`，這些方法的 `if (post.failed)` 因此永遠不為 true，緊接著讀 `post.data.xxx` 對 `null` 會丟未捕捉例外，實測回傳泛用的 `unknown`（errorCode=1）而非文件原意的 `messageBoardPostNotExists`（已用繞過 MCP tool、直接呼叫底層 remote client 的 raw script 交叉驗證）。對應 tool 已在 description/hint 誠實反映此行為，不是本工具的包裝層問題。
- **`ReviewPost`/`BatchReviewPosts`/`RemovePost` 在 rajah 裡沒有真實生效的 `@Permission`**：`MessageBoardPlatform` 服務標頭上方的 `# @Permission "MessageBoard"` 是 `#` 開頭的死註解（真正的 rajah attribute 語法是行首直接 `@Xxx`），並非會被 jasmine 解析的真實 attribute；這幾支方法本身也沒有各自的 `@Permission`，代表它們很可能在後端完全不受權限檢查保護。已在對應 tool 的 description 中誠實標註，不宣稱受權限保護。

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
