import fs from 'node:fs';
import path from 'node:path';
import minimist from 'minimist';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runList } from './list.js';
import { LOCK_FILENAME } from './lock.js';
import { TEST_CONFIG, addTo, createWorkspace, itemOf, printed, snapshot, type Workspace } from './workspace.fixtures.js';

const DEFAULT_REGISTRY = 'https://motionscript.dev/r';

describe('runList', () => {
    let ws: Workspace;
    let log: ReturnType<typeof vi.spyOn>;
    const file = (relative: string): string => path.join(ws.project, 'src', 'components', relative);
    const list = (...args: string[]): Promise<void> => runList(ws.project, minimist(['list', ...args]));
    const lines = (): string[] => printed(log).split('\n');

    beforeEach(() => {
        ws = createWorkspace('list');
        log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        // Nothing here may reach the network: a bare name with no --registry resolves against the default one.
        vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('fetch failed'))));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        ws.remove();
    });

    async function install(...names: string[]): Promise<void> {
        await addTo(ws, ...names);
        log.mockClear();
    }

    it('says so, and writes nothing, when no component is installed', async () => {
        await list();
        expect(printed(log)).toBe('No components installed. Add one with `ms add <name>`.');
        expect(fs.existsSync(path.join(ws.project, LOCK_FILENAME))).toBe(false);
    });

    describe('the status of an entry', () => {
        beforeEach(() => {
            ws.publish(itemOf('gauge', { 'gauge/index.ts': 'index', 'gauge/needle.ts': 'needle' }));
        });

        it('is "unchanged" while every file is as it was written', async () => {
            await install('gauge');
            await list();
            expect(lines()[0]).toBe('  gauge  unchanged');
        });

        it('is "modified (N of M files)" for the files that differ', async () => {
            await install('gauge');
            fs.writeFileSync(file('gauge/needle.ts'), 'needle, tuned');
            await list();
            expect(lines()[0]).toBe('  gauge  modified (1 of 2 files)');

            fs.writeFileSync(file('gauge/index.ts'), 'index, tuned');
            log.mockClear();
            await list();
            expect(lines()[0]).toBe('  gauge  modified (2 of 2 files)');
        });

        it('counts a missing file, in the singular and the plural', async () => {
            await install('gauge');
            fs.rmSync(file('gauge/needle.ts'));
            await list();
            expect(lines()[0]).toBe('  gauge  1 file missing');

            fs.rmSync(file('gauge/index.ts'));
            log.mockClear();
            await list();
            expect(lines()[0]).toBe('  gauge  2 files missing');
        });

        it('reports a missing file ahead of a modified one', async () => {
            await install('gauge');
            fs.rmSync(file('gauge/index.ts'));
            fs.writeFileSync(file('gauge/needle.ts'), 'needle, tuned');
            await list();
            expect(lines()[0]).toBe('  gauge  1 file missing');
            expect(printed(log)).not.toContain('modified');
        });

        it('goes back to "unchanged" when an edit is put back', async () => {
            await install('gauge');
            fs.writeFileSync(file('gauge/needle.ts'), 'needle, tuned');
            fs.writeFileSync(file('gauge/needle.ts'), 'needle');
            await list();
            expect(lines()[0]).toBe('  gauge  unchanged');
        });
    });

    describe('the labels', () => {
        it('shows the version the entry was installed at', async () => {
            ws.publish(itemOf('gauge', { 'gauge.ts': 'g' }, { version: '1.0.0' }));
            await install('gauge');
            await list();
            expect(lines()[0]).toBe('  gauge  1.0.0  unchanged');
        });

        it('shows the registry an entry came from, unless it is the default one', async () => {
            const acme = path.join(ws.dir, 'acme');
            ws.publish(itemOf('chart', { 'chart.ts': 'chart' }, { version: '2.0.0' }), acme);
            ws.publish(itemOf('gauge', { 'gauge.ts': 'g' }));
            fs.writeFileSync(
                path.join(ws.project, 'motionscript.json'),
                JSON.stringify({ ...TEST_CONFIG, registries: { '@acme': path.join(acme, '{name}.json') } }),
            );
            await install('gauge', '@acme/chart');

            await list();

            expect(lines().slice(0, 2)).toEqual(['  @acme/chart  2.0.0  from @acme  unchanged', '  gauge  unchanged']);
        });

        it('lists the entries in the order the lock keeps them', async () => {
            for (const name of ['zeta', 'alpha', 'mid']) ws.publish(itemOf(name, { [`${name}.ts`]: name }));
            await install('zeta', 'alpha', 'mid');
            await list();
            expect(lines().slice(0, 3).map((line) => line.trim().split(' ')[0])).toEqual(['alpha', 'mid', 'zeta']);
        });
    });

    describe('--check', () => {
        beforeEach(() => {
            ws.publish(itemOf('gauge', { 'gauge.ts': 'g' }, { version: '1.0.0' }));
        });

        const publishVersion = (version: string | undefined): void =>
            ws.publish(itemOf('gauge', { 'gauge.ts': 'g' }, version ? { version } : {}));
        // An item installed from a local registry is looked up there again only when it is named again.
        const check = (): Promise<void> => list('--check', '--registry', ws.registry);

        it('offers the hint to pass it, and only without it', async () => {
            await install('gauge');
            await list();
            expect(lines().at(-1)).toBe('Pass --check to ask each registry whether a newer version exists.');

            log.mockClear();
            await check();
            expect(printed(log)).not.toContain('Pass --check');
        });

        it('adds "<installed> → <upstream> available" when the registry has another version', async () => {
            await install('gauge');
            publishVersion('1.1.0');
            await check();
            expect(lines()[0]).toBe('  gauge  1.0.0  unchanged  1.0.0 → 1.1.0 available');
        });

        it('shows a "?" for the version of an entry that was installed without one', async () => {
            publishVersion(undefined);
            await install('gauge');
            publishVersion('1.1.0');
            await check();
            expect(lines()[0]).toBe('  gauge  unchanged  ? → 1.1.0 available');
        });

        it('says nothing more when the versions match, or when the registry names none', async () => {
            await install('gauge');
            await check();
            expect(lines()[0]).toBe('  gauge  1.0.0  unchanged');

            publishVersion(undefined);
            log.mockClear();
            await check();
            expect(lines()[0]).toBe('  gauge  1.0.0  unchanged');
        });

        it('says "(upstream unreachable)" for an entry the registry cannot serve, and goes on to the next', async () => {
            ws.publish(itemOf('chart', { 'chart.ts': 'c' }, { version: '1.0.0' }));
            await install('gauge', 'chart');
            ws.unpublish('chart');
            publishVersion('1.1.0');

            await check();

            expect(lines().slice(0, 2)).toEqual([
                '  chart  1.0.0  unchanged  (upstream unreachable)',
                '  gauge  1.0.0  unchanged  1.0.0 → 1.1.0 available',
            ]);
        });

        it('reports an update without applying it, and writes nothing', async () => {
            await install('gauge');
            fs.writeFileSync(file('gauge.ts'), 'my edit');
            publishVersion('1.1.0');
            const before = snapshot(ws.dir);

            await check();

            expect(snapshot(ws.dir)).toEqual(before);
            expect(fs.readFileSync(file('gauge.ts'), 'utf8')).toBe('my edit');
        });

        it('does not touch the network without --check', async () => {
            await install('gauge');
            const stub = vi.fn();
            vi.stubGlobal('fetch', stub);
            await list();
            expect(stub).not.toHaveBeenCalled();
        });
    });

    describe('--registry', () => {
        beforeEach(async () => {
            ws.publish(itemOf('gauge', { 'gauge.ts': 'g' }, { version: '1.0.0' }));
            await install('gauge');
            ws.publish(itemOf('gauge', { 'gauge.ts': 'g' }, { version: '1.1.0' }));
        });

        function stubFetch(status: number) {
            const stub = vi.fn((_url: string, _init?: RequestInit) =>
                Promise.resolve(new Response('', { status, statusText: 'Not Found' })),
            );
            vi.stubGlobal('fetch', stub);
            return stub;
        }

        it('is where --check looks for a bare name, instead of the default registry', async () => {
            const stub = stubFetch(404);
            await list('--check', '--registry', ws.registry);
            expect(lines()[0]).toBe('  gauge  1.0.0  unchanged  1.0.0 → 1.1.0 available');
            expect(stub).not.toHaveBeenCalled();
        });

        it('leaves --check on the default registry when it is not given', async () => {
            const stub = stubFetch(404);
            await list('--check');
            expect(stub).toHaveBeenCalledExactlyOnceWith(`${DEFAULT_REGISTRY}/gauge.json`, { headers: undefined });
            expect(lines()[0]).toBe('  gauge  1.0.0  unchanged  (upstream unreachable)');
        });

        it('does not change where a namespaced name is looked up', async () => {
            const acme = path.join(ws.dir, 'acme');
            ws.publish(itemOf('chart', { 'chart.ts': 'c' }, { version: '3.0.0' }), acme);
            fs.writeFileSync(
                path.join(ws.project, 'motionscript.json'),
                JSON.stringify({ ...TEST_CONFIG, registries: { '@acme': path.join(acme, '{name}.json') } }),
            );
            await install('@acme/chart');
            ws.publish(itemOf('chart', { 'chart.ts': 'c' }, { version: '3.1.0' }), acme);
            const elsewhere = path.join(ws.dir, 'elsewhere');
            fs.mkdirSync(elsewhere);

            await list('--check', '--registry', elsewhere);

            expect(lines()).toContain('  @acme/chart  3.0.0  from @acme  unchanged  3.0.0 → 3.1.0 available');
            expect(lines()).toContain('  gauge  1.0.0  unchanged  (upstream unreachable)');
        });
    });
});
