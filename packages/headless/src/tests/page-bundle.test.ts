import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isEngineError } from '../errors.js';
import { bundlePage } from '../page-bundle.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** What `npm publish` would ship, as package-relative `/`-separated paths. */
function packedFiles(): Set<string> {
    const json = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
        cwd: packageRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        shell: process.platform === 'win32',
    });
    const [pack] = JSON.parse(json) as { files: { path: string }[] }[];
    return new Set(pack.files.map((file) => file.path));
}

describe('bundlePage', () => {
    let dir: string;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-headless-bundle-'));
    });

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    // Inside the monorepo every file exists whether it is packed or not, so a
    // page bundle that reads an unpacked file builds here and fails for anyone
    // who installs the package.
    it('reads nothing from this package that its tarball leaves out', { timeout: 30_000 }, async () => {
        const entry = path.join(dir, 'src', 'project.ts');
        fs.mkdirSync(path.dirname(entry), { recursive: true });
        fs.writeFileSync(entry, 'export const nodes = [];\n');

        const { inputs } = await bundlePage({ entry, cacheDir: path.join(dir, 'cache') });
        const own = inputs
            .filter((file) => fs.existsSync(file))
            .map((file) => path.relative(packageRoot, file))
            .filter((rel) => rel !== '' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel))
            .filter((rel) => rel.split(path.sep)[0] !== 'node_modules')
            .map((rel) => rel.split(path.sep).join('/'));

        expect(own).toContain('src/page/harness.ts');
        const packed = packedFiles();
        expect(own.filter((rel) => !packed.has(rel))).toEqual([]);
    });

    describe('the entry', () => {
        const write = (name: string, source: string) => {
            const entry = path.join(dir, 'src', name);
            fs.mkdirSync(path.dirname(entry), { recursive: true });
            fs.writeFileSync(entry, source);
            return entry;
        };
        const failureOf = (work: Promise<unknown>) => work.then(() => null, (error: unknown) => error);

        it('says PROJECT_NOT_FOUND, naming the resolved path, when nothing is there', async () => {
            const missing = path.join(dir, 'src', 'project.ts');

            const failure = await failureOf(bundlePage({ entry: path.relative(process.cwd(), missing), cacheDir: path.join(dir, 'cache') }));

            expect(isEngineError(failure)).toBe(true);
            expect(failure).toMatchObject({ code: 'PROJECT_NOT_FOUND' });
            expect((failure as Error).message).toContain(`No project entry at ${missing}.`);
            expect(fs.existsSync(path.join(dir, 'cache'))).toBe(false);
        });

        it('says START_FAILED, with esbuild\'s error as the cause, when the entry does not build', async () => {
            const broken = write('broken.ts', 'export const nodes = ;\n');
            const missingImport = write('missing-import.ts', "import './nowhere';\nexport const nodes = [];\n");

            const syntax = await failureOf(bundlePage({ entry: broken, cacheDir: path.join(dir, 'cache') }));
            const unresolved = await failureOf(bundlePage({ entry: missingImport, cacheDir: path.join(dir, 'cache') }));

            for (const failure of [syntax, unresolved]) {
                expect(isEngineError(failure)).toBe(true);
                expect(failure).toMatchObject({ code: 'START_FAILED' });
                expect((failure as Error).message).toMatch(/^Could not bundle the project entry: /);
                expect(((failure as Error).cause as { errors?: unknown[] }).errors).toHaveLength(1);
            }
            expect((syntax as Error).message).toContain('Unexpected ";"');
            expect((unresolved as Error).message).toContain('Could not resolve "./nowhere"');
            expect(fs.existsSync(path.join(dir, 'cache'))).toBe(false);
        });
    });

    describe('Node built-ins', () => {
        const stubbed = ['fs', 'path', 'crypto', 'os', 'module', 'worker_threads'];

        it('are replaced with an empty module, with or without `node:`, so a UMD file that names them bundles for a browser', { timeout: 30_000 }, async () => {
            const entry = path.join(dir, 'src', 'project.ts');
            fs.mkdirSync(path.dirname(entry), { recursive: true });
            fs.writeFileSync(entry, [
                ...stubbed.flatMap((name, i) => [`import * as plain${i} from '${name}';`, `import * as prefixed${i} from 'node:${name}';`]),
                `export const nodes = [${stubbed.flatMap((_, i) => [`plain${i}`, `prefixed${i}`]).join(', ')}];`,
            ].join('\n'));

            const { code, inputs } = await bundlePage({ entry, cacheDir: path.join(dir, 'cache') });

            expect(code).not.toMatch(/require\(["'](node:)?(fs|path|crypto|os|module|worker_threads)["']\)/);
            expect(inputs.filter((input) => /^(node:)?(fs|path|crypto|os|module|worker_threads)$/.test(input))).toEqual([]);
        });

        it('are refused when they are not one of those six', async () => {
            const entry = path.join(dir, 'src', 'project.ts');
            fs.mkdirSync(path.dirname(entry), { recursive: true });
            fs.writeFileSync(entry, "import * as net from 'node:net';\nexport const nodes = [net];\n");

            const failure = await bundlePage({ entry, cacheDir: path.join(dir, 'cache') }).then(() => null, (error: unknown) => error);

            expect(failure).toMatchObject({ code: 'START_FAILED' });
            expect((failure as Error).message).toContain('Could not resolve "node:net"');
        });
    });

    describe('the cache', () => {
        let entry: string;
        let cacheDir: string;
        const cached = () => fs.readdirSync(cacheDir).sort();

        beforeEach(() => {
            entry = path.join(dir, 'src', 'project.ts');
            cacheDir = path.join(dir, 'cache');
            fs.mkdirSync(path.dirname(entry), { recursive: true });
            fs.writeFileSync(entry, 'export const nodes = [];\n');
        });

        it('writes the bundle under a sixteen-character key in `cacheDir`, and reports a first build as not cached', async () => {
            const built = await bundlePage({ entry, cacheDir });

            expect(built.cached).toBe(false);
            expect(cached()).toHaveLength(1);
            expect(cached()[0]).toMatch(/^[0-9a-f]{16}\.js$/);
            expect(fs.readFileSync(path.join(cacheDir, cached()[0]), 'utf8')).toBe(built.code);
            expect(built.inputs).toContain(fs.realpathSync(entry));
        });

        it('keeps its cache beside the project, under node_modules, when no `cacheDir` is given', async () => {
            await bundlePage({ entry });

            const beside = path.join(dir, 'node_modules', '.cache', 'motionscript');
            expect(fs.readdirSync(beside)).toHaveLength(1);
            expect(fs.existsSync(cacheDir)).toBe(false);
        });

        it('answers an unchanged entry from the cache, with the cached file\'s text', async () => {
            const first = await bundlePage({ entry, cacheDir });
            const second = await bundlePage({ entry, cacheDir });
            expect(second).toEqual({ code: first.code, inputs: first.inputs, cached: true });

            // The text comes from the file, not from the build that just ran beside it.
            fs.writeFileSync(path.join(cacheDir, cached()[0]), '/* what the cache holds */');
            const third = await bundlePage({ entry, cacheDir });
            expect(third.cached).toBe(true);
            expect(third.code).toBe('/* what the cache holds */');
            expect(cached()).toHaveLength(1);
        });

        it('builds again, under a new key, once an input changes: its size or its modified time', async () => {
            await bundlePage({ entry, cacheDir });
            const [first] = cached();

            fs.writeFileSync(entry, 'export const nodes = [];\n// a longer entry\n');
            const resized = await bundlePage({ entry, cacheDir });
            expect(resized.cached).toBe(false);
            expect(cached()).toHaveLength(2);

            const then = new Date(Date.now() + 60_000);
            fs.utimesSync(entry, then, then);
            const touched = await bundlePage({ entry, cacheDir });
            expect(touched.cached).toBe(false);
            expect(cached()).toHaveLength(3);
            expect(cached()).toContain(first);
        });
    });
});
