import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import prompts from 'prompts';
import { collectDependencies, resolveComponents, writeComponentFiles } from './install.js';
import { emptyLock, recordInstall, type LockedComponent } from './lock.js';
import { discardInjectedAnswers } from './prompts.fixtures.js';
import type { ComponentsConfig, RegistryItem } from './protocol.js';

vi.mock('prompts', async (importOriginal) =>
    (await import('./prompts.fixtures.js')).spyingPrompts(await importOriginal<{ default: typeof import('prompts') }>()),
);

describe('install', () => {
    let dir: string;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-cli-install-'));
        vi.mocked(prompts).mockClear();
    });

    afterEach(() => {
        discardInjectedAnswers(prompts);
        vi.unstubAllGlobals();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    describe('collectDependencies', () => {
        it('merges "pkg@range" specs across items, deduping', () => {
            const items: RegistryItem[] = [
                { name: 'a', type: 'registry:component', files: [], dependencies: ['@lezer/common@^1.5.2', 'kleur@^4.1.5'] },
                { name: 'b', type: 'registry:component', files: [], dependencies: ['kleur@^4.1.5'] },
            ];
            expect(collectDependencies(items)).toEqual({
                '@lezer/common': '^1.5.2',
                kleur: '^4.1.5',
            });
        });

        it('returns an empty map when no item declares dependencies', () => {
            const items: RegistryItem[] = [{ name: 'a', type: 'registry:component', files: [] }];
            expect(collectDependencies(items)).toEqual({});
        });

        it('throws on a malformed spec', () => {
            const items: RegistryItem[] = [{ name: 'a', type: 'registry:component', files: [], dependencies: ['no-version'] }];
            expect(() => collectDependencies(items)).toThrow(/Invalid dependency spec/);
        });
    });

    describe('resolveComponents (local registry, registryDependencies)', () => {
        it('resolves dependencies before the item that needs them, deduping shared ones', async () => {
            const a: RegistryItem = { name: 'a', type: 'registry:component', files: [{ path: 'a.ts', content: 'a' }] };
            const b: RegistryItem = {
                name: 'b',
                type: 'registry:component',
                files: [{ path: 'b.ts', content: 'b' }],
                registryDependencies: ['a'],
            };
            const c: RegistryItem = {
                name: 'c',
                type: 'registry:component',
                files: [{ path: 'c.ts', content: 'c' }],
                registryDependencies: ['a'],
            };
            fs.writeFileSync(path.join(dir, 'a.json'), JSON.stringify(a));
            fs.writeFileSync(path.join(dir, 'b.json'), JSON.stringify(b));
            fs.writeFileSync(path.join(dir, 'c.json'), JSON.stringify(c));

            const resolved = await resolveComponents(['b', 'c'], null, dir);
            // "a" resolves once (deduped) and appears before both items that need it.
            expect(resolved.map(r => r.item.name)).toEqual(['a', 'b', 'c']);
            expect(resolved.map(r => r.requested)).toEqual(['a', 'b', 'c']);
        });
    });

    describe('resolveComponents (a registryDependencies cycle)', () => {
        const REGISTRY = 'https://registry.test/r';

        /** A remote registry holding `items`, and the URLs asked of it. */
        function serve(...items: RegistryItem[]): string[] {
            const asked: string[] = [];
            vi.stubGlobal(
                'fetch',
                vi.fn((url: string) => {
                    asked.push(url);
                    const item = items.find((candidate) => url === `${REGISTRY}/${candidate.name}.json`);
                    return Promise.resolve(item ? new Response(JSON.stringify(item)) : new Response('', { status: 404, statusText: 'Not Found' }));
                }),
            );
            return asked;
        }

        const item = (name: string, ...registryDependencies: string[]): RegistryItem => ({
            name,
            type: 'registry:component',
            files: [{ path: `${name}.ts`, content: name }],
            registryDependencies,
        });

        it('terminates, fetches each name once, and puts the dependency before the item that asked', async () => {
            const asked = serve(item('a', 'b'), item('b', 'a'));

            const resolved = await resolveComponents(['a'], null, REGISTRY);

            expect(resolved.map((r) => r.requested)).toEqual(['b', 'a']);
            expect(asked).toEqual([`${REGISTRY}/a.json`, `${REGISTRY}/b.json`]);
        });

        it('terminates on an item that depends on itself', async () => {
            const asked = serve(item('a', 'a'));
            const resolved = await resolveComponents(['a'], null, REGISTRY);
            expect(resolved.map((r) => r.requested)).toEqual(['a']);
            expect(asked).toEqual([`${REGISTRY}/a.json`]);
        });

        it('keeps first-visit order through a cycle of three', async () => {
            const asked = serve(item('a', 'b'), item('b', 'c'), item('c', 'a'));

            const resolved = await resolveComponents(['c'], null, REGISTRY);

            // c is visited first, then a, then b; b is finished first, since a is waiting on it.
            expect(asked).toEqual([`${REGISTRY}/c.json`, `${REGISTRY}/a.json`, `${REGISTRY}/b.json`]);
            expect(resolved.map((r) => r.requested)).toEqual(['b', 'a', 'c']);
        });

        it('resolves a name asked for twice, and one reached through a cycle and by request, once', async () => {
            const asked = serve(item('a', 'b'), item('b', 'a'));
            const resolved = await resolveComponents(['a', 'b', 'a'], null, REGISTRY);
            expect(resolved.map((r) => r.requested)).toEqual(['b', 'a']);
            expect(asked).toHaveLength(2);
        });
    });

    describe('writeComponentFiles', () => {
        const config: ComponentsConfig = {
            project: 'src/project.ts',
            aliases: { components: '@/components' },
            paths: { components: 'src/components' },
        };

        it('writes a single-file component flat, at paths.components/<file.path>', async () => {
            const item: RegistryItem = {
                name: 'code',
                type: 'registry:component',
                files: [{ path: 'code.ts', content: 'export const x = 1;' }],
            };
            const { written, skipped } = await writeComponentFiles(item, config, dir);
            expect(skipped).toEqual([]);
            expect(written).toHaveLength(1);
            const dest = path.join(dir, 'src', 'components', 'code.ts');
            expect(fs.readFileSync(dest, 'utf8')).toBe('export const x = 1;');
            // No implicit <item.name>/ subfolder — the flat path is the whole story.
            expect(fs.existsSync(path.join(dir, 'src', 'components', 'code', 'code.ts'))).toBe(false);
        });

        it('writes a multi-file component into whatever subfolder its own file paths declare', async () => {
            const item: RegistryItem = {
                name: 'line-chart',
                type: 'registry:component',
                files: [
                    { path: 'line-chart/chart.ts', content: 'chart' },
                    { path: 'line-chart/axis.ts', content: 'axis' },
                ],
            };
            const { written, skipped } = await writeComponentFiles(item, config, dir);
            expect(skipped).toEqual([]);
            expect(written).toHaveLength(2);
            expect(fs.readFileSync(path.join(dir, 'src', 'components', 'line-chart', 'chart.ts'), 'utf8')).toBe('chart');
            expect(fs.readFileSync(path.join(dir, 'src', 'components', 'line-chart', 'axis.ts'), 'utf8')).toBe('axis');
        });

        it('skips an existing file when the user declines to overwrite', async () => {
            const dest = path.join(dir, 'src', 'components', 'code.ts');
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.writeFileSync(dest, 'original');

            const item: RegistryItem = {
                name: 'code',
                type: 'registry:component',
                files: [{ path: 'code.ts', content: 'replacement' }],
            };

            prompts.inject([false]);
            const { written, skipped } = await writeComponentFiles(item, config, dir);
            expect(written).toEqual([]);
            expect(skipped).toEqual([dest]);
            expect(fs.readFileSync(dest, 'utf8')).toBe('original');
        });

        it('refuses a file path that leaves the components root, writing nothing', async () => {
            const project = path.join(dir, 'project');
            const item: RegistryItem = {
                name: 'evil',
                type: 'registry:component',
                files: [
                    { path: 'evil/ok.ts', content: 'ok' },
                    { path: '../../../escaped.txt', content: 'escaped' },
                ],
            };
            await expect(writeComponentFiles(item, config, project)).rejects.toThrow(
                /Registry item "evil" declares a file at "\.\.\/\.\.\/\.\.\/escaped\.txt", outside src\/components/,
            );
            expect(fs.existsSync(path.join(dir, 'escaped.txt'))).toBe(false);
            expect(fs.existsSync(path.join(project, 'src', 'components', 'evil', 'ok.ts'))).toBe(false);
        });

        it('refuses a file path that stays in the project but leaves the components root', async () => {
            const item: RegistryItem = {
                name: 'sneaky',
                type: 'registry:component',
                files: [{ path: '../project.ts', content: 'overwritten' }],
            };
            await expect(writeComponentFiles(item, config, dir)).rejects.toThrow(/outside src\/components/);
            expect(fs.existsSync(path.join(dir, 'src', 'project.ts'))).toBe(false);
        });

        it('refuses an absolute file path, even one that points inside the components root', async () => {
            const inside = path.join(dir, 'src', 'components', 'abs.ts');
            const item: RegistryItem = {
                name: 'abs',
                type: 'registry:component',
                files: [{ path: inside, content: 'abs' }],
            };
            await expect(writeComponentFiles(item, config, dir)).rejects.toThrow(/Registry item "abs" declares a file at/);
            expect(fs.existsSync(inside)).toBe(false);
        });

        it('accepts a path whose ".." segments stay inside the components root', async () => {
            const item: RegistryItem = {
                name: 'dotted',
                type: 'registry:component',
                files: [{ path: 'dotted/../dotted.ts', content: 'dotted' }],
            };
            const { written } = await writeComponentFiles(item, config, dir);
            expect(written).toEqual([path.join(dir, 'src', 'components', 'dotted.ts')]);
        });

        it('refuses a components root outside the project', async () => {
            const outside: ComponentsConfig = { ...config, paths: { components: '../shared/components' } };
            const item: RegistryItem = {
                name: 'code',
                type: 'registry:component',
                files: [{ path: 'code.ts', content: 'code' }],
            };
            const project = path.join(dir, 'project');
            await expect(writeComponentFiles(item, outside, project)).rejects.toThrow(
                /paths\.components "\.\.\/shared\/components" in motionscript\.json is outside the project/,
            );
            expect(fs.existsSync(path.join(dir, 'shared'))).toBe(false);
        });

        it('force-overwrites without prompting', async () => {
            const dest = path.join(dir, 'src', 'components', 'code.ts');
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.writeFileSync(dest, 'original');

            const item: RegistryItem = {
                name: 'code',
                type: 'registry:component',
                files: [{ path: 'code.ts', content: 'replacement' }],
            };

            const { written } = await writeComponentFiles(item, config, dir, { force: true });
            expect(written).toEqual([dest]);
            expect(fs.readFileSync(dest, 'utf8')).toBe('replacement');
        });

        describe('the overwrite policy for a file that is already there', () => {
            const rel = path.join('src', 'components', 'gauge.ts');
            const v1: RegistryItem = {
                name: 'gauge',
                type: 'registry:component',
                version: '3.1.0',
                files: [{ path: 'gauge.ts', content: 'gauge v1' }],
            };
            const v2: RegistryItem = { ...v1, version: '3.2.0', files: [{ path: 'gauge.ts', content: 'gauge v2' }] };
            let dest: string;
            let previous: LockedComponent;

            beforeEach(async () => {
                dest = path.join(dir, rel);
                const first = await writeComponentFiles(v1, config, dir);
                const lock = emptyLock();
                recordInstall(lock, 'gauge', v1, 'u', first.recorded);
                previous = lock.components['gauge']!;
            });

            it('rewrites a file that still matches the lock, without asking', async () => {
                const { written, skipped, recorded } = await writeComponentFiles(v2, config, dir, { previous });

                expect(prompts).not.toHaveBeenCalled();
                expect(written).toEqual([dest]);
                expect(skipped).toEqual([]);
                expect(fs.readFileSync(dest, 'utf8')).toBe('gauge v2');
                expect(recorded['gauge.ts']).toEqual({ target: 'src/components/gauge.ts', content: 'gauge v2' });
            });

            it('asks, with the installed version, when the file was edited, and keeps the edit on a no', async () => {
                fs.writeFileSync(dest, 'my edit');
                prompts.inject([false]);

                const { written, skipped, recorded } = await writeComponentFiles(v2, config, dir, { previous });

                expect(prompts).toHaveBeenCalledOnce();
                expect(prompts).toHaveBeenCalledWith({
                    type: 'confirm',
                    name: 'overwrite',
                    message: `${rel} has local changes since 3.1.0. Overwrite?`,
                    initial: false,
                });
                expect(written).toEqual([]);
                expect(skipped).toEqual([dest]);
                expect(recorded).toEqual({});
                expect(fs.readFileSync(dest, 'utf8')).toBe('my edit');
            });

            it('overwrites an edited file, and records it, on a yes', async () => {
                fs.writeFileSync(dest, 'my edit');
                prompts.inject([true]);

                const { written, recorded } = await writeComponentFiles(v2, config, dir, { previous });

                expect(written).toEqual([dest]);
                expect(fs.readFileSync(dest, 'utf8')).toBe('gauge v2');
                expect(recorded['gauge.ts']?.content).toBe('gauge v2');
            });

            it('says "since it was installed" when the lock holds no version', async () => {
                fs.writeFileSync(dest, 'my edit');
                prompts.inject([false]);

                await writeComponentFiles(v2, config, dir, { previous: { ...previous, version: undefined } });

                expect(vi.mocked(prompts).mock.calls[0]?.[0]).toMatchObject({
                    message: `${rel} has local changes since it was installed. Overwrite?`,
                });
            });

            it('writes a recorded file that is missing from disk, without asking', async () => {
                fs.rmSync(dest);

                const { written, recorded } = await writeComponentFiles(v2, config, dir, { previous });

                expect(prompts).not.toHaveBeenCalled();
                expect(written).toEqual([dest]);
                expect(fs.readFileSync(dest, 'utf8')).toBe('gauge v2');
                expect(recorded['gauge.ts']).toBeDefined();
            });

            it('asks only that the file "already exists" when the lock has no record of it', async () => {
                prompts.inject([false, false]);

                await writeComponentFiles(v2, config, dir);
                await writeComponentFiles(v2, config, dir, { previous: { ...previous, files: {} } });

                expect(prompts).toHaveBeenCalledTimes(2);
                for (const [question] of vi.mocked(prompts).mock.calls) {
                    expect(question).toMatchObject({ message: `${rel} already exists. Overwrite?` });
                }
                expect(fs.readFileSync(dest, 'utf8')).toBe('gauge v1');
            });

            it('does not ask about an edited file under force', async () => {
                fs.writeFileSync(dest, 'my edit');

                const { written } = await writeComponentFiles(v2, config, dir, { previous, force: true });

                expect(prompts).not.toHaveBeenCalled();
                expect(written).toEqual([dest]);
                expect(fs.readFileSync(dest, 'utf8')).toBe('gauge v2');
            });

            it('judges each file of an item on its own', async () => {
                const two: RegistryItem = {
                    name: 'two',
                    type: 'registry:component',
                    files: [
                        { path: 'two/a.ts', content: 'a v1' },
                        { path: 'two/b.ts', content: 'b v1' },
                    ],
                };
                const installed = await writeComponentFiles(two, config, dir);
                const lock = emptyLock();
                recordInstall(lock, 'two', two, 'u', installed.recorded);
                fs.writeFileSync(path.join(dir, 'src', 'components', 'two', 'b.ts'), 'b edited');
                prompts.inject([false]);

                const next: RegistryItem = {
                    ...two,
                    files: [
                        { path: 'two/a.ts', content: 'a v2' },
                        { path: 'two/b.ts', content: 'b v2' },
                    ],
                };
                const { written, skipped } = await writeComponentFiles(next, config, dir, { previous: lock.components['two'] });

                expect(prompts).toHaveBeenCalledOnce();
                expect(written.map((file) => path.basename(file))).toEqual(['a.ts']);
                expect(skipped.map((file) => path.basename(file))).toEqual(['b.ts']);
            });
        });
    });
});
