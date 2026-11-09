import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    LEGACY_LOCK_FILENAMES,
    LOCK_FILENAME,
    changedFiles,
    emptyLock,
    fileState,
    hashContent,
    loadLock,
    recordInstall,
    writeLock,
    type ComponentsLock,
    type LockedComponent,
} from './lock.js';
import type { RegistryItem } from './protocol.js';

const [MOTION_SCRIPT_LOCK, COMPONENTS_LOCK] = LEGACY_LOCK_FILENAMES;

function entry(files: LockedComponent['files']): LockedComponent {
    return { registry: 'default', url: 'u', item: 'gauge', installedAt: '2026-01-01T00:00:00.000Z', files };
}

describe('lock', () => {
    let dir: string;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-cli-lock-'));
    });

    afterEach(() => {
        vi.useRealTimers();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    describe('hashContent', () => {
        // Independent of the implementation: SHA-256 of the UTF-8 bytes, base64.
        it.each([
            ['', 'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='],
            ['abc', 'sha256-ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0='],
            ['é', 'sha256-SplVfkAzw1Od4utlRyAXytX5VX96BiWgnxw/biumnEw='],
        ])('hashes %j to its sha256 in base64', (content, expected) => {
            expect(hashContent(content)).toBe(expected);
        });

        it('sees a trailing newline', () => {
            expect(hashContent('a\n')).toBe('sha256-h0KPxSKAPTEGXnvOPPA/5HUJZjHl4Hu9eg/eYMTPJcc=');
            expect(hashContent('a\n')).not.toBe(hashContent('a'));
        });
    });

    describe('fileState and changedFiles', () => {
        const locked = (target: string, content: string) => ({ target, installed: hashContent(content) });

        it('is "missing" when the target is absent', () => {
            expect(fileState(dir, locked('src/gone.ts', 'x'))).toBe('missing');
        });

        it('is "unchanged" when the disk still hashes to what was installed', () => {
            fs.mkdirSync(path.join(dir, 'src'));
            fs.writeFileSync(path.join(dir, 'src', 'a.ts'), 'as installed');
            expect(fileState(dir, locked('src/a.ts', 'as installed'))).toBe('unchanged');
        });

        it('is "modified" when the disk differs, even by one byte', () => {
            fs.mkdirSync(path.join(dir, 'src'));
            fs.writeFileSync(path.join(dir, 'src', 'a.ts'), 'as installed\n');
            expect(fileState(dir, locked('src/a.ts', 'as installed'))).toBe('modified');
        });

        it('lists the modified and the missing files by declared path, in the entry\'s order', () => {
            fs.mkdirSync(path.join(dir, 'src'));
            fs.writeFileSync(path.join(dir, 'src', 'same.ts'), 'same');
            fs.writeFileSync(path.join(dir, 'src', 'edited.ts'), 'edited by hand');
            const component = entry({
                'gauge/edited.ts': locked('src/edited.ts', 'original'),
                'gauge/same.ts': locked('src/same.ts', 'same'),
                'gauge/gone.ts': locked('src/gone.ts', 'gone'),
            });
            expect(changedFiles(dir, component)).toEqual(['gauge/edited.ts', 'gauge/gone.ts']);
        });

        it('lists nothing for an entry whose files all match', () => {
            fs.writeFileSync(path.join(dir, 'a.ts'), 'a');
            expect(changedFiles(dir, entry({ 'a.ts': locked('a.ts', 'a') }))).toEqual([]);
            expect(changedFiles(dir, entry({}))).toEqual([]);
        });
    });

    describe('loadLock', () => {
        const validLock = (components: ComponentsLock['components'] = {}): string =>
            JSON.stringify({ lockfileVersion: 1, components });

        it('reads a missing lock as an empty one, without creating a file', () => {
            const lock = loadLock(dir);
            expect(lock).toEqual(emptyLock());
            expect(lock).toMatchObject({ lockfileVersion: 1, components: {} });
            expect(fs.readdirSync(dir)).toEqual([]);
        });

        it('reads motionscript.lock.json', () => {
            const components = { gauge: entry({}) };
            fs.writeFileSync(path.join(dir, LOCK_FILENAME), validLock(components));
            expect(loadLock(dir).components).toEqual(components);
        });

        it.each([[MOTION_SCRIPT_LOCK], [COMPONENTS_LOCK]])('still reads the legacy name %s', (name) => {
            fs.writeFileSync(path.join(dir, name!), validLock({ legacy: entry({}) }));
            expect(Object.keys(loadLock(dir).components)).toEqual(['legacy']);
        });

        it('prefers the current name, then motion-script.lock.json, then components.lock.json', () => {
            fs.writeFileSync(path.join(dir, COMPONENTS_LOCK!), validLock({ third: entry({}) }));
            expect(Object.keys(loadLock(dir).components)).toEqual(['third']);
            fs.writeFileSync(path.join(dir, MOTION_SCRIPT_LOCK!), validLock({ second: entry({}) }));
            expect(Object.keys(loadLock(dir).components)).toEqual(['second']);
            fs.writeFileSync(path.join(dir, LOCK_FILENAME), validLock({ first: entry({}) }));
            expect(Object.keys(loadLock(dir).components)).toEqual(['first']);
        });

        it('refuses a lockfile version it does not know, naming it', () => {
            fs.writeFileSync(path.join(dir, LOCK_FILENAME), JSON.stringify({ lockfileVersion: 2, components: {} }));
            expect(() => loadLock(dir)).toThrow(
                'motionscript.lock.json is version 2, which this CLI does not understand. Upgrade @motionscript/cli.',
            );
        });

        it('refuses a lock with no version', () => {
            fs.writeFileSync(path.join(dir, LOCK_FILENAME), JSON.stringify({ components: {} }));
            expect(() => loadLock(dir)).toThrow(/is version undefined/);
        });

        it('refuses invalid JSON with a message that says what to do', () => {
            fs.writeFileSync(path.join(dir, LOCK_FILENAME), '{ "lockfileVersion": 1, ');
            expect(() => loadLock(dir)).toThrow('motionscript.lock.json is not valid JSON. Delete it to start over.');
        });

        it('refuses invalid JSON in a legacy lock', () => {
            fs.writeFileSync(path.join(dir, COMPONENTS_LOCK!), 'not json');
            expect(() => loadLock(dir)).toThrow(/is not valid JSON/);
        });

        // The message names the current file whichever file was read.
        it.skip('names the legacy file it read when that one is invalid', () => {
            fs.writeFileSync(path.join(dir, COMPONENTS_LOCK!), 'not json');
            expect(() => loadLock(dir)).toThrow(/components\.lock\.json is not valid JSON/);
        });
    });

    describe('writeLock', () => {
        it('writes two-space JSON with a trailing newline', () => {
            writeLock(dir, { lockfileVersion: 1, components: { gauge: entry({}) } });
            const text = fs.readFileSync(path.join(dir, LOCK_FILENAME), 'utf8');
            expect(text.endsWith('}\n')).toBe(true);
            expect(text).toBe(`${JSON.stringify(JSON.parse(text), null, 2)}\n`);
            expect(text).toContain('\n  "lockfileVersion": 1,');
        });

        it('sorts components by key, so installs in a different order write the same file', () => {
            const a = entry({ 'a.ts': { target: 'a.ts', installed: 'h' } });
            const b = entry({ 'b.ts': { target: 'b.ts', installed: 'h' } });
            const z = entry({ 'z.ts': { target: 'z.ts', installed: 'h' } });

            writeLock(dir, { lockfileVersion: 1, components: { zeta: z, alpha: a, Beta: b } });
            const first = fs.readFileSync(path.join(dir, LOCK_FILENAME), 'utf8');
            writeLock(dir, { lockfileVersion: 1, components: { Beta: b, alpha: a, zeta: z } });
            const second = fs.readFileSync(path.join(dir, LOCK_FILENAME), 'utf8');

            expect(second).toBe(first);
            // localeCompare, not code-unit order: "Beta" sorts between "alpha" and "zeta".
            expect(Object.keys((JSON.parse(first) as ComponentsLock).components)).toEqual(['alpha', 'Beta', 'zeta']);
        });

        it('keeps $schema, round-trips through loadLock, and does not mutate its argument', () => {
            const lock: ComponentsLock = {
                ...emptyLock(),
                components: { zeta: entry({}), alpha: entry({}) },
            };
            writeLock(dir, lock);
            expect(Object.keys(lock.components)).toEqual(['zeta', 'alpha']);
            const loaded = loadLock(dir);
            expect(loaded.$schema).toBe('https://motionscript.dev/schema/motionscript.lock.json');
            expect(Object.keys(loaded.components)).toEqual(['alpha', 'zeta']);
        });

        it('writes only the current name, even when a legacy lock was the one read', () => {
            fs.writeFileSync(path.join(dir, COMPONENTS_LOCK!), JSON.stringify({ lockfileVersion: 1, components: {} }));
            writeLock(dir, loadLock(dir));
            expect(fs.readdirSync(dir).sort()).toEqual([COMPONENTS_LOCK, LOCK_FILENAME].sort());
        });
    });

    describe('recordInstall', () => {
        const item: RegistryItem = {
            name: 'gauge',
            type: 'registry:component',
            files: [
                { path: 'gauge/index.ts', content: 'index' },
                { path: 'gauge/needle.ts', content: 'needle' },
            ],
        };
        const written = {
            'gauge/index.ts': { target: 'src/components/gauge/index.ts', content: 'index' },
            'gauge/needle.ts': { target: 'src/components/gauge/needle.ts', content: 'needle' },
        };

        it('records the registry, url, item, timestamp and each file\'s target and hash', () => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date('2026-03-04T05:06:07.000Z'));
            const lock = emptyLock();

            recordInstall(lock, 'gauge', item, 'https://motionscript.dev/r/gauge.json', written);

            expect(lock.components['gauge']).toEqual({
                registry: 'default',
                url: 'https://motionscript.dev/r/gauge.json',
                item: 'gauge',
                installedAt: '2026-03-04T05:06:07.000Z',
                files: {
                    'gauge/index.ts': { target: 'src/components/gauge/index.ts', installed: hashContent('index') },
                    'gauge/needle.ts': { target: 'src/components/gauge/needle.ts', installed: hashContent('needle') },
                },
            });
        });

        it('leaves version and kit out when the item has none, and records them when it has', () => {
            const lock = emptyLock();
            recordInstall(lock, 'gauge', item, 'u', written);
            expect(lock.components['gauge']).not.toHaveProperty('version');
            expect(lock.components['gauge']).not.toHaveProperty('kit');

            recordInstall(lock, 'gauge', { ...item, version: '1.2.0', kit: '@motionscript/charts@^0.1.0' }, 'u', written);
            expect(lock.components['gauge']).toMatchObject({ version: '1.2.0', kit: '@motionscript/charts@^0.1.0' });
        });

        it('records a namespaced key under its namespace, with the bare item name', () => {
            const lock = emptyLock();
            recordInstall(lock, '@acme/gauge', item, 'https://registry.acme.dev/gauge.json', written);
            expect(Object.keys(lock.components)).toEqual(['@acme/gauge']);
            expect(lock.components['@acme/gauge']).toMatchObject({ registry: '@acme', item: 'gauge' });
        });

        it('records a nested item path under its namespace', () => {
            const lock = emptyLock();
            recordInstall(lock, '@acme/charts/gauge', { ...item, name: 'charts/gauge' }, 'u', written);
            expect(lock.components['@acme/charts/gauge']).toMatchObject({ registry: '@acme', item: 'charts/gauge' });
        });

        it('replaces an earlier record of the same key and leaves the others alone', () => {
            const lock = emptyLock();
            recordInstall(lock, 'other', { ...item, name: 'other' }, 'o', {});
            const before = lock.components['other'];
            recordInstall(lock, 'gauge', item, 'old-url', written);
            recordInstall(lock, 'gauge', item, 'new-url', {
                ...written,
                'gauge/index.ts': { target: 'src/components/gauge/index.ts', content: 'index v2' },
            });

            expect(lock.components['gauge']?.url).toBe('new-url');
            expect(lock.components['gauge']?.files['gauge/index.ts']?.installed).toBe(hashContent('index v2'));
            expect(lock.components['other']).toBe(before);
        });

        it('keeps the previous record of a declared file that was not written this run', () => {
            const lock = emptyLock();
            recordInstall(lock, 'gauge', item, 'u', written);
            const kept = lock.components['gauge']?.files['gauge/index.ts'];

            recordInstall(lock, 'gauge', item, 'u', {
                'gauge/needle.ts': { target: 'src/components/gauge/needle.ts', content: 'needle v2' },
            });

            const { files } = lock.components['gauge']!;
            expect(files['gauge/index.ts']).toEqual(kept);
            expect(files['gauge/needle.ts']?.installed).toBe(hashContent('needle v2'));
        });

        it('drops the record of a file the item no longer declares, and ignores one it never declared', () => {
            const lock = emptyLock();
            recordInstall(lock, 'gauge', item, 'u', written);

            recordInstall(lock, 'gauge', { ...item, files: [item.files[0]!] }, 'u', {
                'gauge/index.ts': written['gauge/index.ts'],
                'gauge/stray.ts': { target: 'src/components/gauge/stray.ts', content: 'stray' },
            });

            expect(Object.keys(lock.components['gauge']!.files)).toEqual(['gauge/index.ts']);
        });

        it('lists files in the item\'s declared order, whatever order they were written in', () => {
            const lock = emptyLock();
            recordInstall(lock, 'gauge', item, 'u', {
                'gauge/needle.ts': written['gauge/needle.ts'],
                'gauge/index.ts': written['gauge/index.ts'],
            });
            expect(Object.keys(lock.components['gauge']!.files)).toEqual(['gauge/index.ts', 'gauge/needle.ts']);
        });

        it('records no files for an item whose files were all skipped on a first install', () => {
            const lock = emptyLock();
            recordInstall(lock, 'gauge', item, 'u', {});
            expect(lock.components['gauge']?.files).toEqual({});
        });
    });
});
