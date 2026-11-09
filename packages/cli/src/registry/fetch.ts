import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
    assertRegistryItem,
    joinRegistryPath,
    resolveItemUrl as resolvePure,
    type ComponentsConfig,
    type RegistryIndexEntry,
    type RegistryItem,
    type ResolvedRegistryTarget,
} from './protocol.js';
import { DEFAULT_REGISTRY_URL } from './config.js';

/**
 * Reading a registry: the transport half.
 *
 * Everything about *which* URL a name resolves to — namespaces, the `{name}`
 * template, `${VAR}` expansion in headers — lives in `./protocol.js`, kept
 * pure and separate. That split is deliberate rather than tidy: an editor
 * installing `@acme/gauge` and `ms add @acme/gauge` must reach the same URL,
 * and two implementations of one rule is a bug with nowhere single to look.
 * What is left here is `fs` and `fetch`, which is exactly the part a
 * browser-based client cannot share.
 */

function isRemote(url: string): boolean {
    return /^https?:\/\//i.test(url);
}

/** Resolve a (possibly namespaced) name to its item URL, headers and bare name. */
export function resolveItemUrl(
    name: string,
    config: ComponentsConfig | null,
    defaultRegistryUrl: string = DEFAULT_REGISTRY_URL,
): ResolvedRegistryTarget {
    return resolvePure(name, config, defaultRegistryUrl, (key) => process.env[key]);
}

/**
 * Read a registry URL's JSON content. Remote (`http(s)://`) URLs are
 * fetched; anything else is treated as a local filesystem path (a bare path
 * or a `file:` URL) and read directly. This isn't just a testing
 * convenience — it's genuinely how a private/unpublished registry is
 * served.
 */
export async function readRegistrySource(url: string, headers?: Record<string, string>): Promise<unknown> {
    if (isRemote(url)) {
        const response = await fetch(url, { headers });
        if (!response.ok) {
            throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
        }
        return response.json();
    }
    const filePath = url.startsWith('file:') ? fileURLToPath(url) : url;
    if (!fs.existsSync(filePath)) {
        throw new Error(`Registry source not found: ${filePath}`);
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
}

export async function fetchRegistryIndex(
    defaultRegistryUrl: string = DEFAULT_REGISTRY_URL,
): Promise<RegistryIndexEntry[]> {
    const data = await readRegistrySource(joinRegistryPath(defaultRegistryUrl, 'registry.json'));
    if (!Array.isArray(data)) {
        throw new Error('Malformed registry index (expected an array).');
    }
    return data as RegistryIndexEntry[];
}

export async function fetchRegistryItem(
    name: string,
    config: ComponentsConfig | null,
    defaultRegistryUrl: string = DEFAULT_REGISTRY_URL,
): Promise<RegistryItem> {
    const { url, headers, itemName } = resolveItemUrl(name, config, defaultRegistryUrl);
    const data = await readRegistrySource(url, headers);
    assertRegistryItem(data, itemName);
    return data;
}
