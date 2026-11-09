import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { detectPackageManager, installDependencies, mergePackageJsonDependencies } from './package-manager.js';

// A real install would run a package manager against the network.
vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }));

describe('package manager', () => {
    let dir: string;
    let originalUa: string | undefined;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-cli-pm-'));
        originalUa = process.env.npm_config_user_agent;
        delete process.env.npm_config_user_agent;
    });

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
        if (originalUa === undefined) delete process.env.npm_config_user_agent;
        else process.env.npm_config_user_agent = originalUa;
    });

    describe('detectPackageManager', () => {
        it('falls back to npm when nothing is detectable', () => {
            expect(detectPackageManager(dir)).toBe('npm');
        });

        it('detects pnpm from a pnpm-lock.yaml in the project root', () => {
            fs.writeFileSync(path.join(dir, 'pnpm-lock.yaml'), '');
            expect(detectPackageManager(dir)).toBe('pnpm');
        });

        it('detects yarn from a yarn.lock in the project root', () => {
            fs.writeFileSync(path.join(dir, 'yarn.lock'), '');
            expect(detectPackageManager(dir)).toBe('yarn');
        });

        it.each([
            ['bun.lockb', 'bun'],
            ['bun.lock', 'bun'],
            ['package-lock.json', 'npm'],
        ])('detects %s as %s', (lockfile, expected) => {
            fs.writeFileSync(path.join(dir, lockfile), '');
            expect(detectPackageManager(dir)).toBe(expected);
        });

        it('takes the first lockfile in the order pnpm, yarn, bun, npm when a project has several', () => {
            fs.writeFileSync(path.join(dir, 'package-lock.json'), '');
            expect(detectPackageManager(dir)).toBe('npm');
            fs.writeFileSync(path.join(dir, 'bun.lock'), '');
            expect(detectPackageManager(dir)).toBe('bun');
            fs.writeFileSync(path.join(dir, 'yarn.lock'), '');
            expect(detectPackageManager(dir)).toBe('yarn');
            fs.writeFileSync(path.join(dir, 'pnpm-lock.yaml'), '');
            expect(detectPackageManager(dir)).toBe('pnpm');
        });

        it.each([
            ['yarn/1.22.0 npm/? node/v20 linux x64', 'yarn'],
            ['bun/1.1.0 npm/? node/v20 linux x64', 'bun'],
            ['npm/10.0.0 node/v20 linux x64', 'npm'],
            ['deno/2.0.0 npm/? node/v20 linux x64', 'npm'],
            ['', 'npm'],
        ])('reads the program from the user agent %j: %s', (agent, expected) => {
            process.env.npm_config_user_agent = agent;
            expect(detectPackageManager(dir)).toBe(expected);
        });

        it('does not look at a lockfile in a parent directory', () => {
            const nested = path.join(dir, 'project');
            fs.mkdirSync(nested);
            fs.writeFileSync(path.join(dir, 'pnpm-lock.yaml'), '');
            // Deliberately not walking up avoids misdetecting from an
            // unrelated ancestor lockfile — falls through to npm here.
            expect(detectPackageManager(nested)).toBe('npm');
        });

        it('prefers a lockfile over npm_config_user_agent', () => {
            fs.writeFileSync(path.join(dir, 'pnpm-lock.yaml'), '');
            process.env.npm_config_user_agent = 'yarn/1.22.0 npm/? node/v20 win32 x64';
            expect(detectPackageManager(dir)).toBe('pnpm');
        });

        it('falls back to npm_config_user_agent when no lockfile is present', () => {
            process.env.npm_config_user_agent = 'pnpm/9.0.0 npm/? node/v20 win32 x64';
            expect(detectPackageManager(dir)).toBe('pnpm');
        });
    });

    describe('mergePackageJsonDependencies', () => {
        it('merges new dependencies into an existing package.json', () => {
            fs.writeFileSync(
                path.join(dir, 'package.json'),
                JSON.stringify({ name: 'demo', dependencies: { 'motion-script': '^1.0.0' } }),
            );
            mergePackageJsonDependencies(dir, { '@lezer/common': '^1.5.2' });

            const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as {
                dependencies: Record<string, string>;
            };
            expect(pkg.dependencies).toEqual({
                'motion-script': '^1.0.0',
                '@lezer/common': '^1.5.2',
            });
        });

        it('is a no-op for an empty dependency map', () => {
            const pkgPath = path.join(dir, 'package.json');
            fs.writeFileSync(pkgPath, JSON.stringify({ name: 'demo' }));
            const before = fs.readFileSync(pkgPath, 'utf8');
            mergePackageJsonDependencies(dir, {});
            expect(fs.readFileSync(pkgPath, 'utf8')).toBe(before);
        });
    });

    describe('installDependencies', () => {
        const pkgPath = (): string => path.join(dir, 'package.json');
        const readDependencies = (): Record<string, string> =>
            (JSON.parse(fs.readFileSync(pkgPath(), 'utf8')) as { dependencies: Record<string, string> }).dependencies;

        beforeEach(() => {
            vi.mocked(spawnSync).mockReset();
            fs.writeFileSync(pkgPath(), JSON.stringify({ name: 'demo' }));
        });

        it('does nothing for an empty map: no spawn, and no package.json needed', () => {
            fs.rmSync(pkgPath());
            installDependencies('pnpm', {}, dir);
            expect(spawnSync).not.toHaveBeenCalled();
        });

        it.each([['pnpm'], ['yarn'], ['bun'], ['npm']] as const)(
            'merges the map into package.json, then runs "%s install" in the project root with inherited output',
            (pm) => {
                let mergedWhenRun: Record<string, string> | undefined;
                vi.mocked(spawnSync).mockImplementation(() => {
                    mergedWhenRun = readDependencies();
                    return { status: 0 } as ReturnType<typeof spawnSync>;
                });

                installDependencies(pm, { 'left-pad': '^1.3.0' }, dir);

                expect(spawnSync).toHaveBeenCalledExactlyOnceWith(`${pm} install`, { cwd: dir, stdio: 'inherit', shell: true });
                expect(mergedWhenRun).toEqual({ 'left-pad': '^1.3.0' });
            },
        );

        it.each([
            [1, 'exit code 1'],
            [127, 'exit code 127'],
            [null, 'exit code unknown'],
        ])('throws when the install exits with %s, naming the package manager and the code', (status, text) => {
            vi.mocked(spawnSync).mockReturnValue({ status } as ReturnType<typeof spawnSync>);

            expect(() => installDependencies('yarn', { 'left-pad': '^1.3.0' }, dir)).toThrow(
                `"yarn install" failed (${text}).`,
            );
            // The merge is done before the install runs, and stays when it fails.
            expect(readDependencies()).toEqual({ 'left-pad': '^1.3.0' });
        });
    });
});
