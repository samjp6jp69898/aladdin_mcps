/**
 * lookup.ts — Core i18n lookup logic for the MCP server.
 *
 * Logic mirrors obsidian/skills/i18n-lookup/i18n-lookup.ts but returns
 * structured objects instead of printing to stdout. The CLI version is
 * kept untouched (per "雙檔並存" decision).
 *
 * If the lago XOR-128 decoding algorithm is ever changed in the source
 * (genie/src/common/code_helper.ts), this file MUST be updated in sync
 * with the original CLI skill.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ALADDIN = process.env.ALADDIN_ROOT_AT_DATE ?? '/Users/user/aladdin';
const LOCALES = [ 'zh-TW', 'zh-CN', 'en-US' ] as const;

interface Project {
    name: string;
    root: string;
    localizations: string;
}

const PROJECTS: Project[] = [
    { name: 'abu-admin', root: 'abu/admin', localizations: 'abu/admin/localizations' },
    { name: 'abu-platform', root: 'abu/platform', localizations: 'abu/platform/localizations' },
    { name: 'lago-agent-backend', root: 'lago/agent-backend', localizations: 'lago/agent-backend/localizations' },
    { name: 'lago-landing-page', root: 'lago/landing-page', localizations: 'lago/landing-page/localizations' },
    { name: 'lago-n8-gaming', root: 'lago/n8-gaming', localizations: 'lago/n8-gaming/localizations' },
    { name: 'lago-ny-gaming', root: 'lago/ny-gaming', localizations: 'lago/ny-gaming/localizations' },
    { name: 'lago-pk-gaming', root: 'lago/pk-gaming', localizations: 'lago/pk-gaming/localizations' },
];

const cache = new Map<string, unknown>();

function xorDecodeMod128(buf: Buffer): Buffer {
    const out = Buffer.alloc(buf.length);
    for (let i = 0; i < buf.length; i += 1) {
        out[i] = buf[i] ^ (i % 128);
    }
    return out;
}

function isLikelyBase64Key(key: string): boolean {
    return /^[A-Za-z0-9+/]+=*$/.test(key) && key.length >= 4 && key.length % 4 === 0;
}

function tryDecryptLagoLocalization(raw: unknown): unknown {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) { return raw; }
    const obj = raw as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length === 0) { return raw; }
    const obfuscatedRatio = keys.filter(isLikelyBase64Key).length / keys.length;
    if (obfuscatedRatio < 0.8) { return raw; }
    const decoded: Record<string, unknown> = {};
    for (const encKey of keys) {
        try {
            const decKey = xorDecodeMod128(Buffer.from(encKey, 'base64')).toString('utf-8');
            const value = obj[encKey];
            if (typeof value === 'string') {
                decoded[decKey] = xorDecodeMod128(Buffer.from(value, 'base64')).toString('utf-8');
            } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                decoded[decKey] = tryDecryptLagoLocalization(value);
            } else {
                decoded[decKey] = value;
            }
        } catch {
            decoded[encKey] = obj[encKey];
        }
    }
    return decoded;
}

function loadJson(file: string): Record<string, unknown> | null {
    if (cache.has(file)) { return cache.get(file) as Record<string, unknown> | null; }
    if (!existsSync(file)) { cache.set(file, null); return null; }
    const raw = JSON.parse(readFileSync(file, 'utf-8'));
    const json = tryDecryptLagoLocalization(raw) as Record<string, unknown>;
    cache.set(file, json);
    return json;
}

export interface Hit {
    project: string;
    locale: string;
    value: unknown;
    file: string;
    jqPath: string;
}

function lookupSection(section: string, key: string): Hit[] {
    const hits: Hit[] = [];
    for (const p of PROJECTS) {
        for (const locale of LOCALES) {
            const file = join(ALADDIN, p.localizations, `${ locale }.json`);
            const json = loadJson(file);
            if (!json) { continue; }
            const sectionData = json[section] as Record<string, unknown> | undefined;
            if (!sectionData || typeof sectionData !== 'object') { continue; }
            if (key in sectionData) {
                hits.push({
                    project: p.name,
                    locale,
                    value: sectionData[key],
                    file,
                    jqPath: `.${ section }["${ key }"]`,
                });
            }
        }
    }
    return hits;
}

function toKebab(name: string): string {
    return name
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
        .toLowerCase();
}

export function lookupError(code: string) {
    const hits = lookupSection('error', code);
    const codeNum = parseInt(code, 10);
    let source: string;
    if (Number.isNaN(codeNum)) {
        source = 'unknown (non-numeric)';
    } else if (codeNum === 0) {
        source = 'genie ErrorCode.success';
    } else if (codeNum >= 1 && codeNum <= 25) {
        source = 'genie ErrorCode (file: /Users/user/aladdin/genie/src/common/error_code.ts)';
    } else if (codeNum >= 100) {
        source = 'AgrabahErrorCodeEnum (file: /Users/user/aladdin/rajah/services/common.rajah, see enum AgrabahErrorCodeEnum)';
    } else {
        source = `unknown range (${ codeNum })`;
    }
    return { code, source, translationsFound: hits.length, hits };
}

export function lookupEnum(enumName: string, valueName?: string) {
    const enumKebab = toKebab(enumName);

    if (valueName) {
        const valueKebab = toKebab(valueName);
        const fullKey = `${ enumKebab }-${ valueKebab }`;
        const hits = lookupSection('enum', fullKey);

        const fallbackHits: Hit[] = [];
        if (hits.length === 0) {
            const tail = `${ enumKebab }-${ valueKebab }`;
            for (const p of PROJECTS) {
                for (const locale of LOCALES) {
                    const file = join(ALADDIN, p.localizations, `${ locale }.json`);
                    const json = loadJson(file);
                    const enumSection = json?.enum as Record<string, unknown> | undefined;
                    if (!enumSection) { continue; }
                    for (const k of Object.keys(enumSection)) {
                        if (k.endsWith(tail) && k !== tail) {
                            fallbackHits.push({
                                project: p.name,
                                locale,
                                value: enumSection[k],
                                file,
                                jqPath: `.enum["${ k }"]`,
                            });
                        }
                    }
                }
            }
        }

        return {
            enum: enumName,
            value: valueName,
            kebabKey: fullKey,
            translationsFound: hits.length,
            hits,
            fallbackSuffixHitsFound: fallbackHits.length,
            fallbackSuffixHits: fallbackHits,
        };
    }

    const prefix = `${ enumKebab }-`;
    const grouped: Record<string, Hit[]> = {};
    for (const p of PROJECTS) {
        for (const locale of LOCALES) {
            const file = join(ALADDIN, p.localizations, `${ locale }.json`);
            const json = loadJson(file);
            const enumSection = json?.enum as Record<string, unknown> | undefined;
            if (!enumSection) { continue; }
            for (const k of Object.keys(enumSection)) {
                if (!k.startsWith(prefix)) { continue; }
                if (!grouped[k]) { grouped[k] = []; }
                grouped[k].push({
                    project: p.name,
                    locale,
                    value: enumSection[k],
                    file,
                    jqPath: `.enum["${ k }"]`,
                });
            }
        }
    }
    const valueKeys = Object.keys(grouped).sort();
    return {
        enum: enumName,
        kebabPrefix: prefix,
        valuesFound: valueKeys.length,
        values: valueKeys.map(k => ({
            kebabKey: k,
            valueName: k.slice(prefix.length),
            translations: grouped[k],
        })),
    };
}

export function lookupModel(fieldKey: string) {
    const hits = lookupSection('model', fieldKey);
    return { section: 'model', key: fieldKey, translationsFound: hits.length, hits };
}

export function lookupKey(section: string, key: string) {
    const hits = lookupSection(section, key);
    return { section, key, translationsFound: hits.length, hits };
}

export function listProjects() {
    const KNOWN_SECTIONS = new Set([ 'error', 'enum', 'model', 'common', 'menu', 'permission', 'route', 'country', 'user' ]);
    const result = PROJECTS.map(p => {
        const dir = join(ALADDIN, p.localizations);
        const locales = existsSync(dir)
            ? readdirSync(dir).filter(f => f.endsWith('.json')).map(f => f.replace('.json', ''))
            : [];
        let topSections: string[] = [];
        let wasObfuscated = false;
        const tw = join(dir, 'zh-TW.json');
        if (existsSync(tw)) {
            try {
                const rawObj = JSON.parse(readFileSync(tw, 'utf-8'));
                const rawKeys = Object.keys(rawObj);
                wasObfuscated = rawKeys.length > 0
                    && rawKeys.filter(isLikelyBase64Key).length / rawKeys.length >= 0.8;
                const decoded = loadJson(tw);
                topSections = Object.keys(decoded ?? {});
            } catch { /* swallow */ }
        }
        const plaintext = topSections.some(s => KNOWN_SECTIONS.has(s));
        return {
            project: p.name,
            dir: p.localizations,
            locales,
            topSections,
            plaintext,
            wasObfuscated,
            note: plaintext
                ? (wasObfuscated ? 'OBFUSCATED (now decryptable) — base64+XOR-128 auto-decoded by skill v3.' : null)
                : 'OBFUSCATED — keys/values are base64-encoded and further obfuscated; this skill cannot resolve translations for this project.',
        };
    });
    const plaintextCount = result.filter(p => p.plaintext).length;
    return {
        projects: result,
        summary: {
            total: result.length,
            plaintext: plaintextCount,
            obfuscated: result.length - plaintextCount,
            note: 'V3 skill auto-decrypts lago obfuscated localizations via base64+XOR-128.',
        },
    };
}
