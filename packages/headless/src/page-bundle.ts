import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { EngineError } from './errors.js';

export interface BundleOptions {
    /** The project entry, e.g. `<root>/src/project.ts`. */
    entry: string;
    /** Where the built bundle is cached. Defaults to `<entry dir>/../node_modules/.cache`. */
    cacheDir?: string;
}

export interface BuiltBundle {
    /** The bundled IIFE, ready to be served to the page. */
    code: string;
    /** Absolute paths esbuild resolved. The cache key is derived from these. */
    inputs: string[];
    /** Whether this came from the cache rather than a build. */
    cached: boolean;
}

/**
 * Bundle a project entry plus the page harness into one IIFE.
 *
 * **One file, not a module graph.** The previous Playwright driver served the
 * project through a Vite dev server, which meant a dependency-optimizer scan and
 * a per-module HTTP transform before anything drew — and a `warmOptimizer()`
 * whose whole job was to pre-pay that, best-effort, and which still raced. A
 * static bundle has none of it: the `three` and `mediabunny` dynamic imports that
 * scan existed to discover are simply inlined.
 *
 * The entry is imported by path rather than having its exports passed in, because
 * node types are **classes** — code, not JSON — and nothing survives a process
 * boundary as a class. This is the one place the browser and server factories
 * genuinely cannot share a signature.
 */
export async function bundlePage(options: BundleOptions): Promise<BuiltBundle> {
    const entry = path.resolve(options.entry);
    if (!fs.existsSync(entry)) {
        throw new EngineError(
            'PROJECT_NOT_FOUND',
            `No project entry at ${entry}. \`createServerEngine\` renders a project ` +
            `entry: a module exporting the nodes and shaders its documents name.`,
        );
    }

    const cacheDir = options.cacheDir
        ?? path.join(path.dirname(entry), '..', 'node_modules', '.cache', 'motionscript');

    // Built once with `metafile` so the cache key can be derived from the exact
    // files esbuild resolved, rather than from a guess at the dependency graph.
    const result = await build(entry);
    const inputs = Object.keys(result.metafile?.inputs ?? {})
        .map(p => path.resolve(p))
        .sort();
    // The builder itself too: how the bundle is made is as much its input as the files are.
    const key = cacheKey([...inputs, fileURLToPath(import.meta.url)]);
    const cachePath = path.join(cacheDir, `${key}.js`);

    if (fs.existsSync(cachePath)) {
        return { code: fs.readFileSync(cachePath, 'utf8'), inputs, cached: true };
    }

    const code = result.outputFiles?.[0]?.text;
    if (!code) {
        throw new EngineError('START_FAILED', 'esbuild produced no output for the page bundle.');
    }
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(cachePath, code);
    return { code, inputs, cached: false };
}

/**
 * Node built-ins a dependency names behind a `typeof process` guard but never
 * reaches in a page. A bundler must still resolve them, and in a browser target
 * there is nothing to resolve them to, so they are stubbed with an empty module.
 */
const NODE_BUILTIN_STUBS = ['fs', 'path', 'crypto', 'os', 'module', 'worker_threads'];

function stubNodeBuiltins(): esbuild.Plugin {
    const filter = new RegExp(`^(node:)?(${NODE_BUILTIN_STUBS.join('|')})$`);
    return {
        name: 'motion-script:stub-node-builtins',
        setup(build) {
            build.onResolve({ filter }, (args) => ({ path: args.path, namespace: 'ms-stub' }));
            build.onLoad({ filter: /.*/, namespace: 'ms-stub' }, () => ({
                contents: 'export default {}; export const promises = {};',
                loader: 'js',
            }));
        },
    };
}

function build(entry: string): Promise<esbuild.BuildResult> {
    // A synthetic entry via `stdin`, so nothing is written next to the user's
    // source. `resolveDir` is what lets its relative import of the project work.
    //
    // The project is imported **dynamically**. A static import is hoisted, so the
    // project's top-level code would run before `installBridge` and a throw there
    // would escape the catch below: the `failed` attribute is never set and the
    // driver waits out the whole bridge timeout. Bundled without splitting,
    // esbuild inlines `import()` as a promise that runs the module on first use,
    // so a load failure becomes a rejection and is reported like any other.
    return esbuild.build({
        stdin: {
            contents: [
                `import { installBridge } from ${JSON.stringify(harnessPath())};`,
                `import(${JSON.stringify(entry)}).then(installBridge).catch((err) => {`,
                `  document.documentElement.setAttribute('data-motion-script', 'failed');`,
                `  document.documentElement.setAttribute('data-motion-script-error', String(err && err.stack || err));`,
                `});`,
            ].join('\n'),
            resolveDir: path.dirname(entry),
            loader: 'ts',
        },
        bundle: true,
        write: false,
        format: 'iife',
        platform: 'browser',
        target: 'chrome120',
        metafile: true,
        // `sideEffects: false` ignored on purpose. Honouring it, esbuild starts a
        // module the lazy project shares with the engine only from the project's
        // side; the engine reaches it through an `export *` barrel that never
        // starts it, so an engine class extends `undefined` whenever the project's
        // first import is the SDK (evanw/esbuild#1490).
        ignoreAnnotations: true,
        // The wasm is served separately rather than inlined: it is ~7MB, and a
        // base64 data URI would be a third larger again on every page load.
        external: ['*.wasm'],
        loader: { '.json': 'json' },
        plugins: [stubNodeBuiltins()],
        logLevel: 'silent',
    }).catch((err: unknown) => {
        throw new EngineError(
            'START_FAILED',
            `Could not bundle the project entry: ${err instanceof Error ? err.message : String(err)}`,
            { cause: err },
        );
    });
}

/**
 * The harness source, which `files` ships beside `dist/`.
 *
 * Always the `.ts` source: the harness is browser code and is excluded from this
 * package's Node build (see `tsconfig.page.json`), so there is no `.js` beside
 * it — esbuild compiles it as part of the bundle. One path for the monorepo and
 * an install alike, so a file the tarball leaves out fails here too.
 */
function harnessPath(): string {
    const here = path.dirname(fileURLToPath(import.meta.url));
    return path.resolve(here, '..', 'src', 'page', 'harness.ts');
}

/**
 * A key over the resolved inputs' identity, not their content.
 *
 * `mtime` + `size` rather than a hash of every byte: the graph is thousands of
 * files, hashing them costs more than the build it is meant to skip, and a
 * source edit changes both.
 */
function cacheKey(inputs: string[]): string {
    const hash = crypto.createHash('sha256');
    for (const file of inputs) {
        hash.update(file);
        try {
            const stat = fs.statSync(file);
            hash.update(String(stat.mtimeMs));
            hash.update(String(stat.size));
        } catch {
            // A file esbuild resolved but that has since gone is itself a
            // difference worth keying on.
            hash.update('missing');
        }
    }
    return hash.digest('hex').slice(0, 16);
}
