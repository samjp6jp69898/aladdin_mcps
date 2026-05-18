/**
 * tools.ts — Register all i18n-lookup tools on a McpServer instance.
 *
 * Shared by stdio.ts and http.ts so both transports expose the same
 * tool surface. Each tool is one of the 5 sub-commands from the original
 * i18n-lookup CLI skill.
 *
 * MCP tool result convention: every handler returns
 *   { content: [{ type: 'text', text: <JSON-stringified payload> }] }
 * Clients render `content` to the model; we put the structured payload
 * as a single JSON text block (the most reliable shape today).
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { lookupError, lookupEnum, lookupModel, lookupKey, listProjects } from './lookup.ts';

function asTextResult(payload: unknown) {
    return {
        content: [ { type: 'text' as const, text: JSON.stringify(payload, null, 2) } ],
    };
}

export function registerI18nTools(server: McpServer): void {
    server.registerTool(
        'i18n_error',
        {
            title: 'Lookup error code translation',
            description: 'Look up the i18n translation of an error code across all frontend projects. Also reports the source (genie ErrorCode 1~25 vs AgrabahErrorCodeEnum 100+).',
            inputSchema: {
                code: z.string().regex(/^\d+$/).describe('Error code as an integer string, e.g. "211"'),
            },
        },
        async ({ code }) => asTextResult(lookupError(code)),
    );

    server.registerTool(
        'i18n_enum',
        {
            title: 'Lookup enum translations',
            description: 'Look up translations for a rajah enum. With only `enumName`, lists all values. With both `enumName` and `valueName`, returns one value (with fallback suffix search if direct key misses).',
            inputSchema: {
                enumName: z.string().describe('PascalCase enum name from rajah, e.g. "TransactionStatusEnum"'),
                valueName: z.string().optional().describe('Optional value name in camelCase or kebab, e.g. "success"'),
            },
        },
        async ({ enumName, valueName }) => asTextResult(lookupEnum(enumName, valueName)),
    );

    server.registerTool(
        'i18n_model',
        {
            title: 'Lookup model field translation',
            description: 'Look up a model field translation under .model section (kebab-case keys).',
            inputSchema: {
                fieldKey: z.string().describe('Kebab-case field key, e.g. "account-name"'),
            },
        },
        async ({ fieldKey }) => asTextResult(lookupModel(fieldKey)),
    );

    server.registerTool(
        'i18n_key',
        {
            title: 'Generic section.key lookup',
            description: 'Generic lookup for any top-level section + key, e.g. section="common" key="all", section="route" key="agent-back-office".',
            inputSchema: {
                section: z.string().describe('Top-level section name, e.g. "common", "menu", "route", "permission"'),
                key: z.string().describe('Key within the section (usually kebab-case)'),
            },
        },
        async ({ section, key }) => asTextResult(lookupKey(section, key)),
    );

    server.registerTool(
        'i18n_list_projects',
        {
            title: 'List all frontend projects',
            description: 'List all 7 frontend projects with their available locales, top-level sections, and whether the file is obfuscated (lago projects use base64+XOR-128).',
            inputSchema: {},
        },
        async () => asTextResult(listProjects()),
    );
}
