import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import minimist from 'minimist';
import { spawnSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import prompts from 'prompts';
import { runAdd } from './add.js';
import { LOCK_FILENAME, hashContent, type ComponentsLock } from './lock.js';
import { installDependencies } from './package-manager.js';
import { discardInjectedAnswers } from './prompts.fixtures.js';
import type { RegistryItem } from './protocol.js';
import { printed, snapshot } from './workspace.fixtures.js';

// Only the install step is replaced: it would otherwise run a real package
// manager, and a test needs it to fail on demand.
vi.mock('./package-manager.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('./package-manager.js')>()),
    installDependencies: vi.fn(),
}));

// The spawn underneath it, for the tests that run the real install step.
vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }));

vi.mock('prompts', async (importOriginal) =>
    (await import('./prompts.fixtures.js')).spyingPrompts(await importOriginal<{ default: typeof import('prompts') }>()),
);

describe('runAdd', () => {
    let dir: string;
    let registry: string;
    let project: string;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-cli-add-'));
        registry = path.join(dir, 'registry');
        project = path.join(dir, 'project');
        fs.mkdirSync(registry);
        fs.mkdirSync(project);
        fs.writeFileSync(
            path.join(project, 'motionscript.json'),
            JSON.stringify({
                project: 'src/project.ts',
                aliases: { components: '@/components' },
                paths: { components: 'src/components' },
            }),
        );
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        vi.mocked(prompts).mockClear();
        // Nothing here may reach the network: a bare name with no --registry resolves against the default one.
        vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('fetch failed'))));
    });

    afterEach(() => {
        discardInjectedAnswers(prompts);
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    function publish(item: RegistryItem, into = registry): void {
        fs.mkdirSync(into, { recursive: true });
        fs.writeFileSync(path.join(into, `${item.name}.json`), JSON.stringify(item));
    }

    function add(...args: string[]): Promise<void> {
        return runAdd(project, minimist(['add', ...args, '--registry', registry]));
    }

    function readLock(): ComponentsLock {
        return JSON.parse(fs.readFileSync(path.join(project, LOCK_FILENAME), 'utf8')) as ComponentsLock;
    }

    const output = (): string => vi.mocked(console.log).mock.calls.flat().join('\n');

    it('writes nothing when any requested item declares a path outside the components root', async () => {
        publish({ name: 'good', type: 'registry:component', files: [{ path: 'good.ts', content: 'good' }] });
        publish({ name: 'evil', type: 'registry:component', files: [{ path: '../../../escaped.txt', content: 'x' }] });

        const argv = minimist(['add', 'good', 'evil', '--yes', '--skip-install', '--registry', registry]);
        await expect(runAdd(project, argv)).rejects.toThrow(/Registry item "evil" declares a file at "\.\.\/\.\.\/\.\.\/escaped\.txt"/);

        expect(fs.existsSync(path.join(project, 'src', 'components', 'good.ts'))).toBe(false);
        expect(fs.existsSync(path.join(dir, 'escaped.txt'))).toBe(false);
        expect(fs.existsSync(path.join(project, 'motionscript.lock.json'))).toBe(false);
    });

    describe('the lock key', () => {
        it('records a dependency under its own name, not under the requested item it is a suffix of', async () => {
            publish({ name: 'chart', type: 'registry:component', files: [{ path: 'chart.ts', content: 'chart' }] });
            publish({
                name: 'line-chart',
                type: 'registry:component',
                files: [{ path: 'line-chart.ts', content: 'line' }],
                registryDependencies: ['chart'],
            });

            await add('line-chart', '--yes', '--skip-install');

            const { components } = readLock();
            expect(Object.keys(components).sort()).toEqual(['chart', 'line-chart']);
            expect(components['chart']?.files['chart.ts']?.target).toBe('src/components/chart.ts');
            expect(components['line-chart']?.files['line-chart.ts']?.target).toBe('src/components/line-chart.ts');
        });

        it('records a namespaced dependency under its namespace and its own registry URL', async () => {
            const acme = path.join(dir, 'acme');
            publish({ name: 'chart', type: 'registry:component', files: [{ path: 'chart.ts', content: 'acme chart' }] }, acme);
            publish({
                name: 'app',
                type: 'registry:component',
                files: [{ path: 'app.ts', content: 'app' }],
                registryDependencies: ['@acme/chart'],
            });
            fs.writeFileSync(
                path.join(project, 'motionscript.json'),
                JSON.stringify({
                    project: 'src/project.ts',
                    aliases: { components: '@/components' },
                    paths: { components: 'src/components' },
                    registries: { '@acme': path.join(acme, '{name}.json') },
                }),
            );

            await add('app', '--yes', '--skip-install');

            const { components } = readLock();
            expect(Object.keys(components).sort()).toEqual(['@acme/chart', 'app']);
            expect(components['@acme/chart']).toMatchObject({
                registry: '@acme',
                item: 'chart',
                url: path.join(acme, 'chart.json'),
            });
        });
    });

    describe('a file left alone because the user declined to overwrite it', () => {
        const files = [
            { path: 'gauge/index.ts', content: 'index v1' },
            { path: 'gauge/needle.ts', content: 'needle v1' },
        ];

        it('stays in the lock entry, so it still reads as modified', async () => {
            publish({ name: 'gauge', type: 'registry:component', files });
            await add('gauge', '--yes', '--skip-install');

            const edited = path.join(project, 'src', 'components', 'gauge', 'index.ts');
            fs.writeFileSync(edited, 'my edit');
            publish({ name: 'gauge', type: 'registry:component', files: files.map(f => ({ ...f, content: `${f.content} v2` })) });

            prompts.inject([false]);
            await add('gauge', '--skip-install');

            const entry = readLock().components['gauge'];
            expect(Object.keys(entry?.files ?? {}).sort()).toEqual(['gauge/index.ts', 'gauge/needle.ts']);
            expect(fs.readFileSync(edited, 'utf8')).toBe('my edit');
            // The unchanged record of the file that was kept still describes
            // the bytes written at install, so the edit is still seen.
            const { changedFiles } = await import('./lock.js');
            expect(changedFiles(project, entry!)).toEqual(['gauge/index.ts']);
        });

        it('is not reported as added when every file was skipped', async () => {
            publish({ name: 'gauge', type: 'registry:component', files });
            await add('gauge', '--yes', '--skip-install');
            for (const file of files) fs.writeFileSync(path.join(project, 'src', 'components', file.path), 'mine');
            const before = fs.readFileSync(path.join(project, LOCK_FILENAME), 'utf8');

            vi.mocked(console.log).mockClear();
            prompts.inject([false, false]);
            await add('gauge', '--skip-install');

            expect(output()).not.toMatch(/Added: gauge/);
            expect(output()).toMatch(/Skipped: gauge/);
            expect(fs.readFileSync(path.join(project, LOCK_FILENAME), 'utf8')).toBe(before);
        });
    });

    describe('installing npm dependencies', () => {
        const withDependency: RegistryItem = {
            name: 'gauge',
            type: 'registry:component',
            files: [{ path: 'gauge.ts', content: 'gauge' }],
            dependencies: ['left-pad@^1.3.0'],
        };

        beforeEach(() => {
            vi.mocked(installDependencies).mockReset();
        });

        it('records the lock before the install, so a failed install leaves tracked files', async () => {
            publish(withDependency);
            fs.writeFileSync(path.join(project, 'package.json'), '{}');
            vi.mocked(installDependencies).mockImplementation(() => {
                throw new Error('"npm install" failed (exit code 1).');
            });

            await expect(add('gauge', '--yes')).rejects.toThrow(/npm install/);

            expect(fs.existsSync(path.join(project, 'src', 'components', 'gauge.ts'))).toBe(true);
            expect(readLock().components['gauge']?.files['gauge.ts']).toBeDefined();
        });

        it('fails before writing anything when there is no package.json to add them to', async () => {
            publish(withDependency);

            await expect(add('gauge', '--yes')).rejects.toThrow(/no package\.json/i);

            expect(fs.existsSync(path.join(project, 'src', 'components', 'gauge.ts'))).toBe(false);
            expect(fs.existsSync(path.join(project, LOCK_FILENAME))).toBe(false);
            expect(installDependencies).not.toHaveBeenCalled();
        });

        it('does not need a package.json when the install is skipped', async () => {
            publish(withDependency);

            await add('gauge', '--yes', '--skip-install');

            expect(readLock().components['gauge']).toBeDefined();
        });
    });

    describe('a project with no motionscript.json', () => {
        const gauge: RegistryItem = { name: 'gauge', type: 'registry:component', files: [{ path: 'gauge.ts', content: 'gauge' }] };
        const configPath = (): string => path.join(project, 'motionscript.json');

        beforeEach(() => {
            fs.rmSync(configPath());
            publish(gauge);
        });

        it('runs init without asking under --yes, then adds', async () => {
            fs.writeFileSync(path.join(project, 'tsconfig.json'), '{}\n');

            await add('gauge', '--yes', '--skip-install');

            expect(prompts).not.toHaveBeenCalled();
            expect(JSON.parse(fs.readFileSync(configPath(), 'utf8'))).toMatchObject({
                aliases: { components: '@/components' },
                paths: { components: 'src/components' },
            });
            expect(fs.readFileSync(path.join(project, 'tsconfig.json'), 'utf8')).toContain('"@/components/*"');
            expect(fs.readFileSync(path.join(project, 'src', 'components', 'gauge.ts'), 'utf8')).toBe('gauge');
            expect(readLock().components['gauge']).toBeDefined();
        });

        it('asks first without --yes, and on a yes goes on to init\'s own questions', async () => {
            prompts.inject([true, 'ui', '~/ui']);

            await add('gauge', '--skip-install');

            expect(prompts).toHaveBeenNthCalledWith(1, {
                type: 'confirm',
                name: 'proceed',
                message: 'No motionscript.json found. Run `ms init` now?',
                initial: true,
            });
            expect(JSON.parse(fs.readFileSync(configPath(), 'utf8'))).toMatchObject({
                aliases: { components: '~/ui' },
                paths: { components: 'ui' },
            });
            expect(fs.readFileSync(path.join(project, 'ui', 'gauge.ts'), 'utf8')).toBe('gauge');
        });

        it('says "Aborted." on a no, and writes nothing', async () => {
            prompts.inject([false]);
            const before = snapshot(dir);

            await expect(add('gauge', '--skip-install')).resolves.toBeUndefined();

            expect(printed(console.log as never)).toContain('Aborted.');
            expect(snapshot(dir)).toEqual(before);
            expect(process.exitCode).toBeUndefined();
        });

        it('does not ask when a project still has a legacy-named config, and uses its paths', async () => {
            fs.writeFileSync(
                path.join(project, 'components.json'),
                JSON.stringify({ project: 'src/project.ts', aliases: { components: '@/legacy' }, paths: { components: 'src/legacy' } }),
            );

            await add('gauge', '--skip-install');

            expect(prompts).not.toHaveBeenCalled();
            expect(fs.existsSync(configPath())).toBe(false);
            expect(fs.readFileSync(path.join(project, 'src', 'legacy', 'gauge.ts'), 'utf8')).toBe('gauge');
        });
    });

    describe('what it writes and says', () => {
        it('records the lock the way the other commands read it', async () => {
            publish({
                name: 'gauge',
                type: 'registry:component',
                version: '1.2.0',
                kit: '@motionscript/charts@^0.1.0',
                files: [
                    { path: 'gauge/index.ts', content: 'index' },
                    { path: 'gauge/needle.ts', content: 'needle' },
                ],
            });

            await add('gauge', '--yes', '--skip-install');

            const text = fs.readFileSync(path.join(project, LOCK_FILENAME), 'utf8');
            expect(text).toBe(`${JSON.stringify(JSON.parse(text), null, 2)}\n`);
            const lock = JSON.parse(text) as ComponentsLock;
            expect(lock).toMatchObject({ $schema: 'https://motionscript.dev/schema/motionscript.lock.json', lockfileVersion: 1 });
            const { installedAt, ...entry } = lock.components['gauge']!;
            expect(entry).toEqual({
                registry: 'default',
                url: path.join(registry, 'gauge.json'),
                item: 'gauge',
                version: '1.2.0',
                kit: '@motionscript/charts@^0.1.0',
                files: {
                    'gauge/index.ts': { target: 'src/components/gauge/index.ts', installed: hashContent('index') },
                    'gauge/needle.ts': { target: 'src/components/gauge/needle.ts', installed: hashContent('needle') },
                },
            });
            expect(new Date(installedAt).toISOString()).toBe(installedAt);
        });

        it('prints what it is adding, a line per file written, and what it added', async () => {
            publish({
                name: 'gauge',
                type: 'registry:component',
                files: [
                    { path: 'gauge/index.ts', content: 'index' },
                    { path: 'gauge/needle.ts', content: 'needle' },
                ],
            });

            await add('gauge', '--yes', '--skip-install');

            expect(printed(console.log as never).split('\n')).toEqual([
                'Adding gauge...',
                `  ✓ ${path.join('src', 'components', 'gauge', 'index.ts')}`,
                `  ✓ ${path.join('src', 'components', 'gauge', 'needle.ts')}`,
                'Done. Added: gauge.',
            ]);
        });

        it('lists a dependency before the item that asked for it, among the ones it added', async () => {
            publish({ name: 'chart', type: 'registry:component', files: [{ path: 'chart.ts', content: 'c' }] });
            publish({ name: 'line', type: 'registry:component', files: [{ path: 'line.ts', content: 'l' }], registryDependencies: ['chart'] });

            await add('line', '--yes', '--skip-install');

            expect(printed(console.log as never)).toMatch(/^Adding line\.\.\.$/m);
            expect(printed(console.log as never)).toMatch(/^Done\. Added: chart, line\.$/m);
        });

        it('lists each skipped file, and splits the summary into what was added and what was kept', async () => {
            publish({ name: 'fresh', type: 'registry:component', files: [{ path: 'fresh.ts', content: 'fresh' }] });
            publish({ name: 'kept', type: 'registry:component', files: [{ path: 'kept.ts', content: 'kept v1' }] });
            await add('kept', '--yes', '--skip-install');
            fs.writeFileSync(path.join(project, 'src', 'components', 'kept.ts'), 'mine');
            publish({ name: 'kept', type: 'registry:component', files: [{ path: 'kept.ts', content: 'kept v2' }] });
            vi.mocked(console.log).mockClear();
            prompts.inject([false]);

            await add('fresh', 'kept', '--skip-install');

            const lines = printed(console.log as never).split('\n');
            expect(lines).toContain(`  – ${path.join('src', 'components', 'kept.ts')} (skipped)`);
            expect(lines).toContain(`  ✓ ${path.join('src', 'components', 'fresh.ts')}`);
            expect(lines.at(-1)).toBe('Done. Added: fresh. Skipped: kept (your files were kept).');
        });

        it.each([['--yes'], ['--overwrite']])('overwrites an edited file under %s without asking, and records the new bytes', async (flag) => {
            publish({ name: 'gauge', type: 'registry:component', files: [{ path: 'gauge.ts', content: 'v1' }] });
            await add('gauge', '--yes', '--skip-install');
            fs.writeFileSync(path.join(project, 'src', 'components', 'gauge.ts'), 'my edit');
            publish({ name: 'gauge', type: 'registry:component', files: [{ path: 'gauge.ts', content: 'v2' }] });

            await add('gauge', flag, '--skip-install');

            expect(prompts).not.toHaveBeenCalled();
            expect(fs.readFileSync(path.join(project, 'src', 'components', 'gauge.ts'), 'utf8')).toBe('v2');
            expect(readLock().components['gauge']?.files['gauge.ts']?.installed).toBe(hashContent('v2'));
        });

        it('asks about a file the lock does not know, and records it when the answer is yes', async () => {
            publish({ name: 'gauge', type: 'registry:component', files: [{ path: 'gauge.ts', content: 'v1' }] });
            fs.mkdirSync(path.join(project, 'src', 'components'), { recursive: true });
            fs.writeFileSync(path.join(project, 'src', 'components', 'gauge.ts'), 'written before the lock existed');
            prompts.inject([true]);

            await add('gauge', '--skip-install');

            expect(vi.mocked(prompts).mock.calls[0]?.[0]).toMatchObject({
                message: `${path.join('src', 'components', 'gauge.ts')} already exists. Overwrite?`,
            });
            expect(readLock().components['gauge']?.files['gauge.ts']?.installed).toBe(hashContent('v1'));
        });
    });

    describe('with no names', () => {
        const index = (entries: unknown): void => {
            fs.writeFileSync(path.join(registry, 'registry.json'), JSON.stringify(entries));
        };

        beforeEach(() => {
            publish({ name: 'gauge', type: 'registry:component', files: [{ path: 'gauge.ts', content: 'gauge' }] });
            publish({ name: 'chart', type: 'registry:component', files: [{ path: 'chart.ts', content: 'chart' }] });
        });

        it('offers the registry\'s index, at least one pick, and adds what was picked', async () => {
            index([
                { name: 'gauge', type: 'registry:component', description: 'A gauge' },
                { name: 'chart', type: 'registry:component', description: 'A chart' },
            ]);
            prompts.inject([['chart']]);

            await add('--skip-install');

            expect(prompts).toHaveBeenCalledExactlyOnceWith({
                type: 'multiselect',
                name: 'selected',
                message: 'Select components to add',
                choices: [
                    { title: 'gauge', description: 'A gauge', value: 'gauge' },
                    { title: 'chart', description: 'A chart', value: 'chart' },
                ],
                min: 1,
            });
            expect(fs.existsSync(path.join(project, 'src', 'components', 'chart.ts'))).toBe(true);
            expect(fs.existsSync(path.join(project, 'src', 'components', 'gauge.ts'))).toBe(false);
            expect(Object.keys(readLock().components)).toEqual(['chart']);
        });

        it('says so, and writes nothing, when the registry has no components', async () => {
            index([]);
            const before = snapshot(dir);

            await add('--skip-install');

            expect(printed(console.log as never)).toContain('The registry has no components to add.');
            expect(prompts).not.toHaveBeenCalled();
            expect(snapshot(dir)).toEqual(before);
        });

        it.each([[[[]]], [[new Error('cancelled')]]])('says "Aborted." and writes nothing when nothing is picked (%#)', async (answers) => {
            index([{ name: 'gauge', type: 'registry:component' }]);
            const before = snapshot(dir);
            prompts.inject(answers);

            await add('--skip-install');

            expect(printed(console.log as never)).toContain('Aborted.');
            expect(snapshot(dir)).toEqual(before);
        });

        it('fails when --registry has no index', async () => {
            await expect(add('--skip-install')).rejects.toThrow(/Registry source not found: .*registry\.json/);
        });
    });

    describe('--registry', () => {
        it('is where a bare name is read, and what the lock records as its url', async () => {
            publish({ name: 'gauge', type: 'registry:component', files: [{ path: 'gauge.ts', content: 'gauge' }] });

            await add('gauge', '--yes', '--skip-install');

            expect(fetch).not.toHaveBeenCalled();
            expect(readLock().components['gauge']?.url).toBe(path.join(registry, 'gauge.json'));
        });

        it('is not given: a bare name is read from the default registry', async () => {
            vi.stubGlobal(
                'fetch',
                vi.fn(() =>
                    Promise.resolve(
                        new Response(JSON.stringify({ name: 'gauge', type: 'registry:component', files: [{ path: 'gauge.ts', content: 'from the default' }] })),
                    ),
                ),
            );

            await runAdd(project, minimist(['add', 'gauge', '--yes', '--skip-install']));

            expect(fetch).toHaveBeenCalledExactlyOnceWith('https://motionscript.dev/r/gauge.json', { headers: undefined });
            expect(fs.readFileSync(path.join(project, 'src', 'components', 'gauge.ts'), 'utf8')).toBe('from the default');
            expect(readLock().components['gauge']?.url).toBe('https://motionscript.dev/r/gauge.json');
        });

        it('does not change where a namespaced name is read', async () => {
            const acme = path.join(dir, 'acme');
            publish({ name: 'chart', type: 'registry:component', files: [{ path: 'chart.ts', content: 'acme chart' }] }, acme);
            publish({ name: 'chart', type: 'registry:component', files: [{ path: 'chart.ts', content: 'default chart' }] });
            fs.writeFileSync(
                path.join(project, 'motionscript.json'),
                JSON.stringify({
                    project: 'src/project.ts',
                    aliases: { components: '@/components' },
                    paths: { components: 'src/components' },
                    registries: { '@acme': path.join(acme, '{name}.json') },
                }),
            );

            await add('@acme/chart', '--yes', '--skip-install');

            expect(fs.readFileSync(path.join(project, 'src', 'components', 'chart.ts'), 'utf8')).toBe('acme chart');
            expect(readLock().components['@acme/chart']?.url).toBe(path.join(acme, 'chart.json'));
        });
    });

    describe('installing through a package manager that exits non-zero', () => {
        const withDependencies: RegistryItem = {
            name: 'gauge',
            type: 'registry:component',
            files: [{ path: 'gauge.ts', content: 'gauge' }],
            dependencies: ['left-pad@^1.3.0'],
        };

        beforeEach(async () => {
            vi.mocked(spawnSync).mockReset();
            vi.mocked(installDependencies).mockReset();
            const actual = await vi.importActual<typeof import('./package-manager.js')>('./package-manager.js');
            vi.mocked(installDependencies).mockImplementation(actual.installDependencies);
            fs.writeFileSync(path.join(project, 'package.json'), '{ "name": "mine" }');
            fs.writeFileSync(path.join(project, 'pnpm-lock.yaml'), '');
            publish(withDependencies);
        });

        it('keeps the files, the lock and the merged package.json, and fails with the exit code', async () => {
            vi.mocked(spawnSync).mockReturnValue({ status: 1 } as ReturnType<typeof spawnSync>);

            await expect(add('gauge', '--yes')).rejects.toThrow('"pnpm install" failed (exit code 1).');

            expect(spawnSync).toHaveBeenCalledExactlyOnceWith('pnpm install', { cwd: project, stdio: 'inherit', shell: true });
            expect(fs.existsSync(path.join(project, 'src', 'components', 'gauge.ts'))).toBe(true);
            expect(readLock().components['gauge']).toBeDefined();
            expect(JSON.parse(fs.readFileSync(path.join(project, 'package.json'), 'utf8'))).toMatchObject({
                dependencies: { 'left-pad': '^1.3.0' },
            });
            expect(printed(console.log as never)).not.toContain('Done.');
        });

        it('says which package manager it is using and finishes when the install succeeds', async () => {
            vi.mocked(spawnSync).mockReturnValue({ status: 0 } as ReturnType<typeof spawnSync>);

            await add('gauge', '--yes');

            expect(printed(console.log as never)).toContain('Installing dependencies with pnpm...');
            expect(printed(console.log as never)).toContain('Done. Added: gauge.');
        });

        it('installs once for all of an add\'s items, with their dependencies merged', async () => {
            vi.mocked(spawnSync).mockReturnValue({ status: 0 } as ReturnType<typeof spawnSync>);
            publish({
                name: 'chart',
                type: 'registry:component',
                files: [{ path: 'chart.ts', content: 'chart' }],
                dependencies: ['kleur@^4.1.5'],
            });

            await add('gauge', 'chart', '--yes');

            expect(spawnSync).toHaveBeenCalledOnce();
            expect(JSON.parse(fs.readFileSync(path.join(project, 'package.json'), 'utf8'))).toMatchObject({
                dependencies: { 'left-pad': '^1.3.0', kleur: '^4.1.5' },
            });
        });

        it('runs nothing, and leaves package.json alone, under --skip-install', async () => {
            await add('gauge', '--yes', '--skip-install');

            expect(spawnSync).not.toHaveBeenCalled();
            expect(fs.readFileSync(path.join(project, 'package.json'), 'utf8')).toBe('{ "name": "mine" }');
        });
    });
});
