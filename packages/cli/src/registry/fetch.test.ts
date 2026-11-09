import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchRegistryIndex, fetchRegistryItem, readRegistrySource, resolveItemUrl } from './fetch.js';
import type { ComponentsConfig, RegistryItem } from './protocol.js';

describe('registry fetch', () => {
    let dir: string;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-cli-fetch-'));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        delete process.env.MS_TEST_REMOTE_TOKEN;
        fs.rmSync(dir, { recursive: true, force: true });
    });

    describe('resolveItemUrl', () => {
        it('resolves a bare name against the default registry', () => {
            const { url, itemName } = resolveItemUrl('code', null, 'https://example.com/r');
            expect(url).toBe('https://example.com/r/code.json');
            expect(itemName).toBe('code');
        });

        it('resolves a bare name against a local default registry path', () => {
            const { url } = resolveItemUrl('code', null, dir);
            expect(url).toBe(path.join(dir, 'code.json'));
        });

        it('resolves a namespaced name against motionscript.json registries, interpolating env headers', () => {
            const config: ComponentsConfig = {
                project: 'src/project.ts',
                aliases: { components: '@/components' },
                paths: { components: 'src/components' },
                registries: {
                    '@acme': {
                        url: 'https://registry.acme.dev/{name}.json',
                        headers: { Authorization: 'Bearer ${MS_TEST_TOKEN}' },
                    },
                },
            };
            process.env.MS_TEST_TOKEN = 'secret123';
            const { url, headers, itemName } = resolveItemUrl('@acme/button', config);
            expect(url).toBe('https://registry.acme.dev/button.json');
            expect(itemName).toBe('button');
            expect(headers).toEqual({ Authorization: 'Bearer secret123' });
            delete process.env.MS_TEST_TOKEN;
        });

        it('accepts a bare string registry entry (no headers)', () => {
            const config: ComponentsConfig = {
                project: 'src/project.ts',
                aliases: { components: '@/components' },
                paths: { components: 'src/components' },
                registries: { '@acme': 'https://registry.acme.dev/{name}.json' },
            };
            const { url, headers } = resolveItemUrl('@acme/button', config);
            expect(url).toBe('https://registry.acme.dev/button.json');
            expect(headers).toBeUndefined();
        });

        it('throws for an unknown namespace', () => {
            const config: ComponentsConfig = {
                project: 'src/project.ts',
                aliases: { components: '@/components' },
                paths: { components: 'src/components' },
            };
            expect(() => resolveItemUrl('@missing/button', config)).toThrow(/Unknown registry namespace/);
        });

        it('throws when a registry URL has no "{name}" placeholder', () => {
            const config: ComponentsConfig = {
                project: 'src/project.ts',
                aliases: { components: '@/components' },
                paths: { components: 'src/components' },
                registries: { '@acme': 'https://registry.acme.dev/static.json' },
            };
            expect(() => resolveItemUrl('@acme/button', config)).toThrow(/must contain a literal/);
        });
    });

    describe('readRegistrySource', () => {
        it('reads a local file path', async () => {
            const file = path.join(dir, 'thing.json');
            fs.writeFileSync(file, JSON.stringify({ hello: 'world' }));
            expect(await readRegistrySource(file)).toEqual({ hello: 'world' });
        });

        it('reads a file:// URL', async () => {
            const file = path.join(dir, 'thing.json');
            fs.writeFileSync(file, JSON.stringify({ hello: 'world' }));
            expect(await readRegistrySource(pathToFileURL(file).href)).toEqual({ hello: 'world' });
        });

        it('throws a clear error for a missing local file', async () => {
            await expect(readRegistrySource(path.join(dir, 'missing.json'))).rejects.toThrow(/not found/);
        });
    });

    describe('readRegistrySource (remote)', () => {
        function stubFetch(response: () => Response) {
            const stub = vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(response()));
            vi.stubGlobal('fetch', stub);
            return stub;
        }

        it('fetches the URL with the headers it was given, and parses the body as JSON', async () => {
            const stub = stubFetch(() => new Response(JSON.stringify({ hello: 'world' })));
            const headers = { Authorization: 'Bearer abc' };

            expect(await readRegistrySource('https://registry.acme.dev/gauge.json', headers)).toEqual({ hello: 'world' });

            expect(stub).toHaveBeenCalledExactlyOnceWith('https://registry.acme.dev/gauge.json', { headers });
        });

        it('sends no headers when it has none', async () => {
            const stub = stubFetch(() => new Response('[]'));
            await readRegistrySource('https://registry.acme.dev/registry.json');
            expect(stub).toHaveBeenCalledExactlyOnceWith('https://registry.acme.dev/registry.json', { headers: undefined });
        });

        it.each([['http://localhost:4000/gauge.json'], ['HTTPS://registry.acme.dev/gauge.json']])(
            'treats %s as remote, whatever the case of the scheme',
            async (url) => {
                const stub = stubFetch(() => new Response('{}'));
                await readRegistrySource(url);
                expect(stub).toHaveBeenCalledOnce();
                expect(stub.mock.calls[0]?.[0]).toBe(url);
            },
        );

        it.each([
            [404, 'Not Found'],
            [500, 'Internal Server Error'],
            [401, 'Unauthorized'],
        ])('throws "Failed to fetch <url>: %i %s" for a non-OK response', async (status, statusText) => {
            stubFetch(() => new Response('', { status, statusText }));
            await expect(readRegistrySource('https://registry.acme.dev/gauge.json')).rejects.toThrow(
                `Failed to fetch https://registry.acme.dev/gauge.json: ${status} ${statusText}`,
            );
        });

        it('lets a network failure through unchanged', async () => {
            const failure = new TypeError('fetch failed');
            vi.stubGlobal('fetch', vi.fn(() => Promise.reject(failure)));
            await expect(readRegistrySource('https://registry.acme.dev/gauge.json')).rejects.toBe(failure);
        });

        it('rejects with the parse error when an OK response is not JSON', async () => {
            stubFetch(() => new Response('<html>not a registry</html>'));
            await expect(readRegistrySource('https://registry.acme.dev/gauge.json')).rejects.toThrow(SyntaxError);
        });

        it('does not go to the network for a local path or a file: URL', async () => {
            const stub = stubFetch(() => new Response('{}'));
            const file = path.join(dir, 'thing.json');
            fs.writeFileSync(file, '{}');
            await readRegistrySource(file);
            await readRegistrySource(pathToFileURL(file).href);
            expect(stub).not.toHaveBeenCalled();
        });

        it('fetchRegistryItem asks the resolved URL, with the namespace\'s headers and their ${VAR} expanded', async () => {
            const item: RegistryItem = { name: 'gauge', type: 'registry:component', files: [] };
            const stub = stubFetch(() => new Response(JSON.stringify(item)));
            process.env.MS_TEST_REMOTE_TOKEN = 'token-from-env';
            const config: ComponentsConfig = {
                project: 'src/project.ts',
                aliases: { components: '@/components' },
                paths: { components: 'src/components' },
                registries: {
                    '@acme': {
                        url: 'https://registry.acme.dev/r/{name}.json',
                        headers: { Authorization: 'Bearer ${MS_TEST_REMOTE_TOKEN}' },
                    },
                },
            };

            expect(await fetchRegistryItem('@acme/gauge', config, 'https://elsewhere.example/r')).toEqual(item);

            expect(stub).toHaveBeenCalledExactlyOnceWith('https://registry.acme.dev/r/gauge.json', {
                headers: { Authorization: 'Bearer token-from-env' },
            });
        });

        it('fetchRegistryIndex asks <registry>/registry.json', async () => {
            const stub = stubFetch(() => new Response(JSON.stringify([{ name: 'gauge', type: 'registry:component' }])));
            expect(await fetchRegistryIndex('https://registry.acme.dev/r/')).toEqual([
                { name: 'gauge', type: 'registry:component' },
            ]);
            expect(stub.mock.calls[0]?.[0]).toBe('https://registry.acme.dev/r/registry.json');
        });
    });

    describe('fetchRegistryIndex / fetchRegistryItem (local registry)', () => {
        it('reads an index and an item from a local registry directory', async () => {
            fs.writeFileSync(
                path.join(dir, 'registry.json'),
                JSON.stringify([{ name: 'code', type: 'registry:component' }]),
            );
            const item: RegistryItem = {
                name: 'code',
                type: 'registry:component',
                files: [{ path: 'node.ts', content: 'x' }],
            };
            fs.writeFileSync(path.join(dir, 'code.json'), JSON.stringify(item));

            expect(await fetchRegistryIndex(dir)).toEqual([{ name: 'code', type: 'registry:component' }]);
            expect(await fetchRegistryItem('code', null, dir)).toEqual(item);
        });

        it('rejects a malformed item', async () => {
            fs.writeFileSync(path.join(dir, 'broken.json'), JSON.stringify({ name: 'broken' }));
            await expect(fetchRegistryItem('broken', null, dir)).rejects.toThrow(/Malformed registry item/);
        });

        it('rejects a malformed index', async () => {
            fs.writeFileSync(path.join(dir, 'registry.json'), JSON.stringify({ not: 'an array' }));
            await expect(fetchRegistryIndex(dir)).rejects.toThrow(/Malformed registry index/);
        });
    });
});
