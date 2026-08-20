import { describe, expect, test } from 'bun:test';

/**
 * aladdin_admin_list_game_vendors 的註冊契約與分流測試。
 *
 * 這支 tool 的存在理由是「admin 端沒有任何一支能列出母表全部場館的查詢」——真人測試中
 * agent 因此跑去 aladdin-platform server 找廠商 id。所以要釘住的正是那兩件事：
 *   1. 六個參數全部選填（不帶任何參數就能列出全部，否則缺口沒補到）；
 *   2. 無篩選條件且無 page 時走 ListAllGameVendors，其餘情況走 ListGameVendors 且
 *      search 欄位對得上 ActiveStatusEnum。
 *
 * 全程不發網路請求：先用假的 Auth.Login 建立 stdio 身分的登入態（withAutoRelogin 的
 * ensureLoggedIn 便會直接放行），再把 gameVendorAdmin 的兩支查詢方法換成記錄呼叫參數的
 * 假實作。API URL 只是為了滿足 session.ts 的啟動檢查，指到一個明顯不是真實環境的值
 * （比照 session.test.ts / http.test.ts）。
 */
process.env.ALADDIN_ADMIN_API_URL = 'http://127.0.0.1:1/never-called-in-this-test';

const { remote, login } = await import('../session.ts');
const { registerListGameVendorsTool } = await import('./list_game_vendors.ts');

type ToolHandler = (input: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>;

let captured: { name: string; config: { description: string; inputSchema: Record<string, { isOptional(): boolean }> }; handler: ToolHandler } | null = null;
registerListGameVendorsTool({
    registerTool: (name: string, config: never, handler: never) => { captured = { name, config, handler }; },
} as never);
const tool = captured!;

// 假登入：只換掉 Auth.Login，login() 其餘流程（把 token 存進 stdio 身分的 sessions）照跑。
remote.admin.auth.Login = (async () => ({
    failed: false, errorCode: 0, message: '',
    data: { loginToken: 'test-token', mustBindTotp: false },
})) as never;
await login({ identifier: 'tester', password: 'not-a-real-password' });

const calls: Array<{ method: string; args: unknown[] }> = [];
remote.gameBackOffice.gameVendorAdmin.ListAllGameVendors = (async (...args: unknown[]) => {
    calls.push({ method: 'ListAllGameVendors', args });
    return { failed: false, errorCode: 0, message: '', data: { rows: [ { id: 7, name: 'ZZZ_TEST' } ] } };
}) as never;
remote.gameBackOffice.gameVendorAdmin.ListGameVendors = (async (...args: unknown[]) => {
    calls.push({ method: 'ListGameVendors', args });
    return { failed: false, errorCode: 0, message: '', data: { rows: [], totalPage: 3 } };
}) as never;

async function run(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    calls.length = 0;
    const result = await tool.handler(input);
    return JSON.parse(result.content[ 0 ]!.text);
}

describe('註冊契約', () => {
    test('tool 名稱是 aladdin_admin_list_game_vendors', () => {
        expect(tool.name).toBe('aladdin_admin_list_game_vendors');
    });

    test('六個參數全部選填——不帶任何參數就能列出母表全部場館，這正是本 tool 要補的缺口', () => {
        const schema = tool.config.inputSchema;
        expect(Object.keys(schema).sort()).toEqual(
            [ 'adapter', 'maintenanceStatus', 'name', 'page', 'pageSize', 'status' ],
        );
        for (const [ key, field ] of Object.entries(schema)) {
            expect(`${ key }:${ field.isOptional() }`).toBe(`${ key }:true`);
        }
    });

    test('description 講明母表視角、id 語意、與相鄰 tool 的分工（含不要跨到 platform server 找場館）', () => {
        const d = tool.config.description;
        expect(d).toContain('母表');
        expect(d).toContain('gameVendorId');
        expect(d).toContain('aladdin_admin_list_platform_game_vendors');
        expect(d).toContain('aladdin_platform_list_game_vendors');
    });
});

describe('查詢分流', () => {
    test('無篩選條件且無 page：走 ListAllGameVendors 一次拿全部，回傳不帶 totalPage', async () => {
        const payload = await run({});
        expect(calls).toEqual([ { method: 'ListAllGameVendors', args: [] } ]);
        expect(payload[ 'success' ]).toBe(true);
        expect(payload[ 'rows' ]).toEqual([ { id: 7, name: 'ZZZ_TEST' } ]);
        expect(payload).not.toHaveProperty('totalPage');
    });

    test('只帶 page：走 ListGameVendors 分頁查詢，pageSize 預設 50', async () => {
        const payload = await run({ page: 2 });
        expect(calls[ 0 ]!.method).toBe('ListGameVendors');
        expect(calls[ 0 ]!.args[ 1 ]).toBe(2);
        expect(calls[ 0 ]!.args[ 2 ]).toBe(50);
        expect(payload[ 'totalPage' ]).toBe(3);
    });

    test('帶篩選條件：走 ListGameVendors，status/maintenanceStatus 轉成 ActiveStatusEnum 數值，page 預設 1', async () => {
        await run({ name: 'BG', adapter: 'BGLive', status: 'enabled', maintenanceStatus: 'disabled' });
        expect(calls[ 0 ]!.method).toBe('ListGameVendors');
        const search = calls[ 0 ]!.args[ 0 ] as Record<string, unknown>;
        expect(search[ 'name' ]).toBe('BG');
        expect(search[ 'adapter' ]).toBe('BGLive');
        expect(search[ 'status' ]).toBe(1);
        expect(search[ 'maintenanceStatus' ]).toBe(2);
        expect(calls[ 0 ]!.args[ 1 ]).toBe(1);
    });

    test('後端回錯誤時原樣轉成 asErrorResult 格式，不吞掉也不改寫', async () => {
        remote.gameBackOffice.gameVendorAdmin.ListAllGameVendors = (async () => ({
            failed: true, errorCode: 403, message: '權限不足', data: null,
        })) as never;
        const payload = await run({});
        expect(payload[ 'success' ]).toBe(false);
        expect(payload[ 'errorCode' ]).toBe(403);
        expect(payload[ 'message' ]).toBe('權限不足');
    });
});
