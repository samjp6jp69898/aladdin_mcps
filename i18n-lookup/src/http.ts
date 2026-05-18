#!/usr/bin/env bun
/**
 * http.ts — MCP server over Streamable HTTP transport.
 *
 * Streamable HTTP is the modern MCP transport (replaces legacy SSE).
 * Single endpoint /mcp serves:
 *   - POST  → client JSON-RPC requests; response is either inline JSON
 *            or an SSE stream depending on whether the server needs to
 *            push notifications back during handling.
 *   - GET   → optional server-initiated SSE stream (unused here).
 *   - DELETE→ end session (unused in stateless mode).
 *
 * Stateless design: each incoming request gets a fresh McpServer +
 * Transport pair. Cheaper to reason about; required if you want to
 * scale horizontally without sticky sessions.
 *
 * Quick test from another terminal:
 *   curl -s -X POST http://localhost:3333/mcp \
 *     -H 'Content-Type: application/json' \
 *     -H 'Accept: application/json, text/event-stream' \
 *     -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'
 */

import { createServer, type IncomingMessage } from 'node:http';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { registerI18nTools } from './tools.ts';

const PORT = Number(process.env.PORT ?? 3333);

function readBody(req: IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
            try {
                const raw = Buffer.concat(chunks).toString('utf-8');
                resolve(raw ? JSON.parse(raw) : undefined);
            } catch (e) { reject(e); }
        });
        req.on('error', reject);
    });
}

const httpServer = createServer(async (req, res) => {
    if (!req.url?.startsWith('/mcp')) {
        res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not Found');
        return;
    }

    const server = new McpServer(
        { name: 'i18n-lookup', version: '0.1.0' },
        { capabilities: { tools: {} } },
    );
    registerI18nTools(server);

    // Stateless: pass `undefined` so the transport does not assign or
    // validate session IDs.
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

    res.on('close', () => {
        transport.close().catch(() => { /* ignore */ });
        server.close().catch(() => { /* ignore */ });
    });

    try {
        await server.connect(transport);
        const body = req.method === 'POST' ? await readBody(req) : undefined;
        await transport.handleRequest(req, res, body);
    } catch (err) {
        console.error('[i18n-lookup MCP http] error:', err);
        if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                jsonrpc: '2.0',
                error: { code: -32603, message: 'Internal error' },
                id: null,
            }));
        }
    }
});

httpServer.listen(PORT, () => {
    console.error(`[i18n-lookup MCP] HTTP listening on http://localhost:${ PORT }/mcp`);
});
