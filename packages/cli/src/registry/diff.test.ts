import fs from 'node:fs';
import path from 'node:path';
import minimist from 'minimist';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runDiff } from './diff.js';
import { LOCK_FILENAME } from './lock.js';
import { TEST_CONFIG, addTo, createWorkspace, itemOf, printed, snapshot, type Workspace } from './workspace.fixtures.js';

const DEFAULT_REGISTRY = 'https://motionscript.dev/r';

describe('runDiff', () => {
    let ws: Workspace;
    let log: ReturnType<typeof vi.spyOn>;
    const file = (relative: string): string => path.join(ws.project, 'src', 'components', relative);
    const diff = (...args: string[]): Promise<void> => runDiff(ws.project, minimist(['diff', ...args, '--registry', ws.registry]));
    const lines = (): string[] => printed(log).split('\n');

    beforeEach(() => {
        ws = createWorkspace('diff');
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

    const v1 = { 'gauge/same.ts': 'same', 'gauge/up.ts': 'up v1', 'gauge/mine.ts': 'mine v1', 'gauge/both.ts': 'both v1' };

    describe('the marker of each file', () => {
        it('names every kind of movement, in the registry\'s file order, and the dropped files last', async () => {
            ws.publish(
                itemOf('gauge', { ...v1, 'gauge/gone.ts': 'gone v1', 'gauge/dropped.ts': 'dropped v1' }, { version: '1.0.0' }),
            );
            await install('gauge');
            fs.writeFileSync(file('gauge/mine.ts'), 'mine, edited');
            fs.writeFileSync(file('gauge/both.ts'), 'both, edited');
            fs.rmSync(file('gauge/gone.ts'));
            ws.publish(
                itemOf(
                    'gauge',
                    {
                        'gauge/same.ts': 'same',
                        'gauge/up.ts': 'up v2',
                        'gauge/mine.ts': 'mine v1',
                        'gauge/both.ts': 'both v2',
                        'gauge/gone.ts': 'gone v1',
                        'gauge/new.ts': 'new',
                    },
                    { version: '1.1.0' },
                ),
            );

            await diff('gauge');

            expect(lines()).toEqual([
                'gauge  1.0.0 → 1.1.0',
                '  ↑ gauge/up.ts (changed upstream)',
                '  ~ gauge/mine.ts (changed locally)',
                '  ! gauge/both.ts (changed both sides)',
                '  - gauge/gone.ts (missing locally)',
                '  + gauge/new.ts (new upstream)',
                '  × gauge/dropped.ts (dropped upstream)',
            ]);
        });

        it('prints nothing for a file that moved on neither side', async () => {
            ws.publish(itemOf('gauge', v1));
            await install('gauge');

            await diff('gauge');

            expect(lines()).toEqual(['gauge']);
        });

        it('reads a file that is missing locally as missing, whether or not upstream changed it', async () => {
            ws.publish(itemOf('gauge', v1));
            await install('gauge');
            fs.rmSync(file('gauge/up.ts'));
            fs.rmSync(file('gauge/same.ts'));
            ws.publish(itemOf('gauge', { ...v1, 'gauge/up.ts': 'up v2' }));

            await diff('gauge');

            expect(lines()).toEqual(['gauge', '  - gauge/same.ts (missing locally)', '  - gauge/up.ts (missing locally)']);
        });

        it.todo('recognises a local file that already equals upstream, instead of "changed both sides"');
    });

    describe('the version header', () => {
        beforeEach(() => {
            ws.publish(itemOf('gauge', { 'gauge.ts': 'g' }, { version: '1.0.0' }));
        });

        it('shows the installed and the upstream version', async () => {
            await install('gauge');
            ws.publish(itemOf('gauge', { 'gauge.ts': 'g' }, { version: '2.0.0' }));
            await diff('gauge');
            expect(lines()[0]).toBe('gauge  1.0.0 → 2.0.0');
        });

        it('shows "?" for the side that has none', async () => {
            await install('gauge');
            ws.publish(itemOf('gauge', { 'gauge.ts': 'g' }));
            await diff('gauge');
            expect(lines()[0]).toBe('gauge  1.0.0 → ?');

            ws.publish(itemOf('gauge', { 'gauge.ts': 'g' }));
            await install('gauge');
            ws.publish(itemOf('gauge', { 'gauge.ts': 'g' }, { version: '2.0.0' }));
            await diff('gauge');
            expect(lines()[0]).toBe('gauge  ? → 2.0.0');
        });

        it('shows no version when neither side has one', async () => {
            ws.publish(itemOf('gauge', { 'gauge.ts': 'g' }));
            await install('gauge');
            await diff('gauge');
            expect(lines()).toEqual(['gauge']);
        });
    });

    describe('which components', () => {
        beforeEach(async () => {
            for (const name of ['alpha', 'beta']) ws.publish(itemOf(name, { [`${name}.ts`]: `${name} v1` }));
            await install('alpha', 'beta');
            for (const name of ['alpha', 'beta']) ws.publish(itemOf(name, { [`${name}.ts`]: `${name} v2` }));
        });

        it('takes every installed component when none is named', async () => {
            await diff();
            expect(lines()).toEqual([
                'alpha',
                '  ↑ alpha.ts (changed upstream)',
                'beta',
                '  ↑ beta.ts (changed upstream)',
            ]);
        });

        it('takes only the ones that are named', async () => {
            await diff('beta');
            expect(lines()).toEqual(['beta', '  ↑ beta.ts (changed upstream)']);
        });

        it('says "not installed" for a name the lock does not hold, and goes on', async () => {
            await diff('nope', 'alpha');
            expect(lines()).toEqual(['nope  not installed', 'alpha', '  ↑ alpha.ts (changed upstream)']);
        });

        it('says "unreachable" with the error when the registry cannot serve one, and goes on', async () => {
            ws.unpublish('alpha');
            await diff();
            const [first, ...rest] = lines();
            expect(first).toMatch(/^alpha {2}unreachable .*Registry source not found: .*alpha\.json/);
            expect(rest).toEqual(['beta', '  ↑ beta.ts (changed upstream)']);
        });

        it('says "not installed" for a name given to a project with no components, rather than "No components installed"', async () => {
            const empty = createWorkspace('diff-empty');
            try {
                await runDiff(empty.project, minimist(['diff', 'alpha', '--registry', empty.registry]));
                expect(lines()).toEqual(['alpha  not installed']);
            } finally {
                empty.remove();
            }
        });
    });

    it('says so when no component is installed and none is named', async () => {
        await diff();
        expect(printed(log)).toBe('No components installed.');
    });

    it('writes nothing, whichever state the files are in', async () => {
        ws.publish(itemOf('gauge', { ...v1, 'gauge/gone.ts': 'gone' }, { version: '1.0.0' }));
        await install('gauge');
        fs.writeFileSync(file('gauge/mine.ts'), 'mine, edited');
        fs.writeFileSync(file('gauge/both.ts'), 'both, edited');
        fs.rmSync(file('gauge/gone.ts'));
        ws.publish(itemOf('gauge', { ...v1, 'gauge/both.ts': 'both v2', 'gauge/up.ts': 'up v2', 'gauge/new.ts': 'new' }, { version: '2.0.0' }));
        const before = snapshot(ws.dir);
        const lock = fs.readFileSync(path.join(ws.project, LOCK_FILENAME), 'utf8');

        await diff();

        expect(snapshot(ws.dir)).toEqual(before);
        expect(fs.readFileSync(path.join(ws.project, LOCK_FILENAME), 'utf8')).toBe(lock);
    });

    describe('--registry', () => {
        beforeEach(async () => {
            ws.publish(itemOf('gauge', { 'gauge.ts': 'v1' }));
            await install('gauge');
            ws.publish(itemOf('gauge', { 'gauge.ts': 'v2' }));
        });

        const stubFetch = () => {
            const stub = vi.fn((_url: string, _init?: RequestInit) =>
                Promise.resolve(new Response('', { status: 404, statusText: 'Not Found' })),
            );
            vi.stubGlobal('fetch', stub);
            return stub;
        };

        it('is where a bare name is looked up, instead of the default registry', async () => {
            const stub = stubFetch();
            await diff('gauge');
            expect(lines()).toEqual(['gauge', '  ↑ gauge.ts (changed upstream)']);
            expect(stub).not.toHaveBeenCalled();
        });

        it('leaves a bare name on the default registry when it is not given', async () => {
            const stub = stubFetch();
            await runDiff(ws.project, minimist(['diff', 'gauge']));
            expect(stub).toHaveBeenCalledExactlyOnceWith(`${DEFAULT_REGISTRY}/gauge.json`, { headers: undefined });
            expect(lines()[0]).toMatch(/^gauge {2}unreachable .*Failed to fetch .*gauge\.json: 404 Not Found/);
        });

        it('does not change where a namespaced name is looked up', async () => {
            const acme = path.join(ws.dir, 'acme');
            ws.publish(itemOf('chart', { 'chart.ts': 'c v1' }), acme);
            fs.writeFileSync(
                path.join(ws.project, 'motionscript.json'),
                JSON.stringify({ ...TEST_CONFIG, registries: { '@acme': path.join(acme, '{name}.json') } }),
            );
            await install('@acme/chart');
            ws.publish(itemOf('chart', { 'chart.ts': 'c v2' }), acme);
            const elsewhere = path.join(ws.dir, 'elsewhere');
            fs.mkdirSync(elsewhere);

            await runDiff(ws.project, minimist(['diff', '@acme/chart', '--registry', elsewhere]));

            expect(lines()).toEqual(['@acme/chart', '  ↑ chart.ts (changed upstream)']);
        });
    });
});
