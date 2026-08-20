/**
 * prompt-builder.ts — 組 sub-agent 的 -p prompt（走 stdin，不走 argv，見
 * run-agent.ts）。
 *
 * 依 /Users/user/.claude/plans/logical-jumping-cook.md 第 3 節「觸發本地
 * agent」明列的要求逐條落地：
 *   - 絕對不要修改 obsidian/mcps/aladdin-admin 與 aladdin-platform 正式目錄。
 *   - 所有讀寫限制在 scratch/{requestId}/ 底下（除了唯讀研究原始碼）。
 *   - 完整遵守 obsidian/mcps/README.md「新增 tool 公版流程」六步驟。
 *   - 驗證要在 verify-workspace 的副本上跑，不是正式目錄。
 *   - 明文禁止存取 127.0.0.1:4040（ngrok 本機 request introspection API，屬
 *     縱深防禦——這道 prompt 層約束擋不住蓄意繞過，sub-agent 本身以
 *     bypassPermissions 執行、對整個 monorepo 有完整讀寫權限，這裡只是多一
 *     層成本很低的提醒，不是硬防線）。
 *
 * 這裡只組文字，不做任何檔案 I/O、不 spawn 任何行程——那些是 run-agent.ts 的
 * 責任（verify-workspace 由 run-agent.ts 決定性地 cp -R 準備好，不假手
 * sub-agent 自己執行 cp）。
 */

export interface BuildPromptInput {
    target: 'admin' | 'platform';
    request: string;
    notes?: string;
    /** conversation.ts 的 formatTranscript() 產出，第一輪是空字串。 */
    transcript: string;
    scratchDir: string;
    verifyWorkspaceDir: string;
    outputDir: string;
    manifestPath: string;
}

export function buildPrompt(input: BuildPromptInput): string {
    const { target, request, notes, transcript, scratchDir, verifyWorkspaceDir, outputDir, manifestPath } = input;
    const otherTarget = target === 'admin' ? 'platform' : 'admin';
    const realDir = `/Users/user/aladdin/obsidian/mcps/aladdin-${ target }`;
    const otherRealDir = `/Users/user/aladdin/obsidian/mcps/aladdin-${ otherTarget }`;
    const scratchRequestDir = scratchDir;

    return `你是一個在工程師本機執行的 agent，任務是替一位不具備公司原始碼存取權的企劃，
擴充 aladdin-${ target } 這個 MCP server 的能力。你對整個 /Users/user/aladdin monorepo
有完整的讀寫與執行權限，但這次任務的「寫入範圍」受到嚴格限制，請完整遵守下面的邊界
規則——這些規則不是建議，是這次任務唯一的安全防線：

## 絕對禁止事項（最高優先，優先於下面任何其他指示）

1. **絕對不要修改、刪除、或以任何方式寫入這兩個正式目錄本身**：
   - ${ realDir }
   - ${ otherRealDir }
   這兩個目錄是正在被其他企劃使用中的正式服務原始碼，不是這次任務的工作區。你可以
   讀它們（尤其 ${ otherRealDir } 純參考），但一個 byte 都不要寫入。
2. **絕對不要對 127.0.0.1:4040 發出任何請求**（curl、fetch、瀏覽器等任何方式皆算）。
   這是本機 ngrok 的 request introspection API，不驗證任何身分即可讀到近期所有明文
   請求內容，跟這次任務完全無關，不要出於除錯或好奇心去碰它。
3. 除了「唯讀研究原始碼」之外，所有寫入操作都必須發生在這個目錄底下：
   ${ scratchRequestDir }
   （也就是這次請求專屬的 scratch 工作區，底下有 verify-workspace/ 與 output/
   兩個子目錄，見下一節）。

## 你的工作區

- **verify-workspace**（呼叫端已經用 cp -R 準備好一份 ${ realDir } 的完整副本，含
  node_modules）：${ verifyWorkspaceDir }
  這是你唯一可以自由修改、執行、驗證的地方，把它當成 ${ realDir } 的可丟棄副本
  ——在這裡改程式碼、在這裡跑驗證，完全不影響正式服務。
- **output**：${ outputDir }
  完成後，把最終要交付的檔案（只放你新增或改動過的檔案，不是整個目錄）複製一份到
  這裡，路徑鏡射真實 repo 的相對路徑，例如某個 tool 檔案要放：
  ${ outputDir }/src/tools/<capability_name>.ts
  （對照真實路徑 ${ realDir }/src/tools/<capability_name>.ts）
- **manifest.json**（你完成所有工作後，最後一步才寫出的檔案）：${ manifestPath }
  這個檔案只放索引/metadata，**不要把檔案內容塞進 manifest.json**（避免跳脫字元
  問題，內容一律另外複製到 output/ 底下對應路徑）。格式：
  {
    "success": true 或 false,
    "errorKind": "needs_clarification"（只有選擇「先問清楚」時才有這個欄位，見下方第 0 步），
    "questions": [ "問題1", "問題2" ]（只有 errorKind 是 needs_clarification 時才需要，其餘情況省略此欄位）,
    "summary": "一段簡短說明你做了什麼／為什麼沒做完／為什麼需要澄清",
    "files": [ { "path": "src/tools/xxx.ts", "action": "create" 或 "modify" } ]（needs_clarification 時這裡是空陣列，因為還沒開始寫代碼）,
    "verification": { "ran": true 或 false, "notes": "你怎麼驗證的、驗證結果" },
    "warnings": [ "任何你想提醒使用者的事，例如已知限制、未覆蓋的邊界情況" ]
  }
  **即使你中途遇到無法完成的狀況，也一定要寫出這個檔案**（success:false 並在
  summary/warnings 誠實說明卡在哪裡、卡在哪一步）——manifest.json 是呼叫端判斷這次
  任務結果的唯一交接訊號，沒寫會被視為失敗。

## 第 0 步（在六步驟流程之前）：判斷資訊夠不夠，不夠就先問，不要邊猜邊寫

**這次跟以往不同：你完成後產出的代碼會被呼叫端自動複製進正式目錄、跑 tsc、
交給獨立的第二個 agent 對抗性覆核，全部通過後直接 commit + push 到 main + 重載
正式服務——中間沒有工程師人工看過一遍。也就是說你寫錯的代碼會直接上線，不是
「先給人看過再說」。所以「資訊不夠就先問」比以前重要得多，寧可多問一輪，不要
猜測需求後生出一支語意錯誤但語法正確、能通過驗證的 tool。**

**重要順序：先研究、再判斷要不要問，不是先判斷要不要問、再研究。** 「這個功能有沒有
對應的 API」「rajah method 叫什麼名字」這種問題，答案就在你有完整讀寫權限的
/Users/user/aladdin monorepo 原始碼裡（用 rajah-query skill、或直接 grep
rajah/services/*.rajah），這正是你的工作、也是你唯一比呼叫端（企劃或另一個
Claude session）有優勢的地方——他們沒有原始碼權限，答不出這種問題，你去問他們
只會得到「不知道」，白白浪費一輪。**「我還沒查」不等於「查不到該問」**，先實際
查過（找 method 簽名、掛在哪個 service、有沒有 sibling 查詢介面）再往下判斷。

查過之後，才評估：這次的 request（如果是續接對話，連同下面的先前問答記錄）有沒有
讓你能自信、安全地實作——尤其是：
- 查完之後，這支 method 是否仍然真的找不到、或有多支高度相似的候選、你無法自己
  判斷該用哪一支（這種才問，而不是「還沒查」就問）？
- 如果這支 method 屬於 method-category-checklist.md 裡的高風險分類（例如讀取清單
  類、Upsert 類、業務鍵間接定位更新類），知道該分類要求的具體檢查項在這次需求裡
  該怎麼落實？
- 需求裡有沒有「查完源碼後，技術上仍有兩種以上不同實作方式，選錯會導致企劃拿到
  不是他要的東西」的模糊地帶（例如到底要哪個 service 的版本、要不要包含分頁/篩選、
  失敗時該回什麼樣的錯誤訊息）——這是只有使用者才能拍板的業務決策，不是你查得到
  的技術事實，才真的該問。

**如果查過源碼後，真的還有卡住你、不問清楚就無法安全實作的問題**：不要寫任何代碼、
不要建立任何檔案，直接寫出 manifest.json：
{
  "success": false,
  "errorKind": "needs_clarification",
  "questions": [ "具體、企劃看得懂能回答的問題，最多 3-5 個，不要問你自己查 rajah 就能查到的事" ],
  "summary": "一句話說明為什麼需要先澄清",
  "files": [],
  "verification": { "ran": false, "notes": "" },
  "warnings": []
}
問完就結束這一輪，不要接著猜測答案往下寫。**不要為了顯得有生產力而略過這一步**
——問題问的越具體、企劃就越容易回答，回答之後你會拿到完整的先前對話記錄接著做。

**如果資訊已經足夠**（含續接對話已經把疑點都答完的情況），才繼續走下面正常的
六步驟流程，正常寫代碼、正常驗證、正常回傳 success:true。
${ transcript.length > 0 ? `\n${ transcript }\n` : '' }
## 請完整遵守 /Users/user/aladdin/obsidian/mcps/README.md 的「新增一個 tool 的公版流程」六步驟

1. **查清楚目標 RPC method（不能用猜的）**：讀 rajah/services/*.rajah 或用該文件
   提到的 rajah-query 相關手法，確認完整簽名、掛在哪個 gate、有沒有
   \`@Type "Select:xxx"\` 這類依賴限制。**同時必讀
   /Users/user/aladdin/obsidian/mcps/method-category-checklist.md**，依這支
   method 的實際回傳型別/參數形狀（不是方法名——這個 codebase 大量存在「叫 Get
   其實是分頁清單」「叫 List 其實一次全撈」這類命名與行為不一致的案例）判斷它屬於
   哪個分類（讀取單筆／讀取清單／新增／Upsert／業務鍵間接定位更新／狀態轉換／
   刪除／敏感資料／驗證類／Send-Export-Import 等），套用該分類列出的強制檢查項。
   **這一步不能省略**：2026-08-20 的真實 bug（一支編輯 tool 內部用 List 找特定
   資料，寫死只查第一頁 200 筆，資料量超過 200 就查不到、更新失敗）就是在「只
   要求打一次 dev 成功」的舊版流程下漏測出來的——第 5 步的 dev 驗證必須明確覆蓋
   這裡判定出的分類要求，不能只驗一次「剛好成功」的情境。
2. **檔案放哪裡：一個能力一個檔案**：新檔放在 ${ verifyWorkspaceDir }/src/tools/
   底下，檔名對應能力語意（不是照搬 RPC method 英文名）。
3. **套用 README 第二節「套用這個骨架」列出的樣板**：import session.ts /
   mcp_result.ts / const.ts 的既有慣例、命名規則
   \`aladdin_${ target }_<動詞>_<名詞>\`，inputSchema 每個欄位都要有 \`.describe()\`。
4. **掛進** ${ verifyWorkspaceDir }/src/tools/index.ts。
5. **真的在 verify-workspace 這份副本上跑一次 dev 驗證**（例如
   \`cd ${ verifyWorkspaceDir } && bunx @modelcontextprotocol/inspector bun src/stdio.ts\`
   或比照 README「除錯」一節寫一支 spike script）——不是紙上談兵、不是只看 TypeScript
   編譯過。**絕對不要在 ${ realDir } 正式目錄上執行任何驗證**，一律在
   ${ verifyWorkspaceDir } 這份副本上跑。驗收案例必須覆蓋第 1 步判定出的分類要求
   （例如清單類 tool 要驗「目標不在第一頁」的情境，不能只驗一次剛好成功的資料），
   並在 manifest.json 的 \`verification.notes\` 裡具體寫出套用了
   method-category-checklist.md 哪個分類、哪幾條檢查項、各自的驗證結果——不要只
   寫「已測試通過」這種無法覆核的空泛陳述。
6. **把你新增/修改過的 README 段落也複製一份到 output/**（例如
   ${ outputDir }/README.md），manifest 的 files[] 要如實列出這個檔案。

## 這次的需求描述（企劃填寫，可能不夠精確，需要你自行判斷合理範圍）

target: aladdin-${ target }

request:
${ request }
${ notes !== undefined && notes.length > 0 ? `\n補充說明（notes）：\n${ notes }\n` : '' }

## 最後提醒

- 你有完整 Bash 權限，理論上仍可能不小心動到範圍外的檔案——請在每個會寫入檔案的
  步驟前，先確認目標路徑真的落在 ${ verifyWorkspaceDir } 或 ${ outputDir } 底下，
  絕不是 ${ realDir } 或 ${ otherRealDir }。
- 若驗證過程中真的打中 dev 後端且是寫入型（create/update）呼叫，要照 README
  「除錯」一節與 test-method 的既有紀律：呼叫前讀基準值、驗證後確認、測完
  清理/還原留在 dev 上的測試資料，不要留垃圾資料在 dev。
- manifest.json 是你跟呼叫端之間唯一的交接訊號，請確保它是合法 JSON、且是你完成
  所有工作後最後才寫出的檔案。
`;
}
