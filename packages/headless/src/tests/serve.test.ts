import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { MotionScriptServerEngine } from '../server-engine.js';
import { BOOT_TIMEOUT_MS, pageMessages, scratchProject, type ScratchProject } from './headless.fixtures.js';

/**
 * The page's origin, asked from inside the page: a project entry that fetches
 * a list of paths when it loads and reports what came back through the console.
 * That is the only way to see the route as the page does, and it also puts a
 * warning, an error and an uncaught throw through the real diagnostics.
 */

interface Reply {
    status: number;
    type: string | null;
    length: number;
    /** The first four bytes, hex. */
    head: string;
    /** The start of the body as text. */
    text: string;
}

const PATHS = [
    '/',
    '/bundle.js',
    '/ms_renderer_bg.wasm',
    '/esbuild.wasm',
    '/dup.txt',
    '/dup.txt?v=2',
    '/noslash.txt',
    '/only-assets.txt',
    '/img/a.png',
    '/data.json',
    '/clip.WAV',
    '/blob.bin',
    '/missing.txt',
    '/..%2Fpublic-secret%2Fx.txt',
    '/..%2Foutside.txt',
];

const ENTRY = `
console.log('quiet log');
console.info('quiet info');
console.debug('quiet debug');
console.error('an error from the entry');
setTimeout(() => { throw new Error('thrown in the page'); }, 0);
const paths = ${JSON.stringify(PATHS)};
const replies = {};
Promise.all(paths.map(async (path) => {
    const response = await fetch(path);
    const bytes = new Uint8Array(await response.arrayBuffer());
    replies[path] = {
        status: response.status,
        type: response.headers.get('content-type'),
        length: bytes.length,
        head: Array.from(bytes.slice(0, 4), (b) => b.toString(16).padStart(2, '0')).join(''),
        text: new TextDecoder().decode(bytes.slice(0, 40)),
    };
})).then(() => console.warn('REPLIES ' + JSON.stringify(replies)));
export const nodes = [];
`;

const sizeOfPackageFile = (specifier: string) => fs.statSync(fileURLToPath(import.meta.resolve(specifier))).size;

describe('the page origin', () => {
    let project: ScratchProject;
    let engine: MotionScriptServerEngine;
    let replies: Record<string, Reply>;
    const messages = pageMessages();
    const stderr: string[] = [];
    let onStderr = () => { };
    const until = (predicate: () => boolean) => new Promise<void>((resolve) => {
        onStderr = () => { if (predicate()) resolve(); };
        onStderr();
    });

    beforeAll(async () => {
        project = scratchProject('serve');
        project.writeEntry(ENTRY);
        project.writeAsset('img/a.png', 'png from the assets directory');
        project.writeAsset('data.json', '{}');
        project.writeAsset('clip.WAV', 'riff');
        project.writeAsset('blob.bin', 'bin');
        project.writeAsset('only-assets.txt', 'from assets');
        project.writeAsset('dup.txt', 'from assets');
        // What the fixed routes must win against, in the assets directory and in `serve`.
        for (const name of ['bundle.js', 'ms_renderer_bg.wasm', 'esbuild.wasm']) project.writeAsset(name, 'impostor');
        const extra = path.join(project.dir, 'extra');
        fs.mkdirSync(extra);
        const served = (name: string, body: string) => {
            fs.writeFileSync(path.join(extra, name), body);
            return path.join(extra, name);
        };
        // A sibling whose name starts with the assets directory's, and a file beside it.
        fs.mkdirSync(path.join(project.dir, 'public-secret'));
        fs.writeFileSync(path.join(project.dir, 'public-secret', 'x.txt'), 'secret');
        fs.writeFileSync(path.join(project.dir, 'outside.txt'), 'outside');

        vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: string | Uint8Array) => {
            stderr.push(String(chunk));
            onStderr();
            return true;
        }) as typeof process.stderr.write);

        engine = new MotionScriptServerEngine({
            projectRoot: project.dir,
            cacheDir: project.cacheDir,
            softwareRender: true,
            onPageMessage: messages.onPageMessage,
            serve: {
                '/dup.txt': served('dup.txt', 'from serve'),
                'noslash.txt': served('noslash.txt', 'never matched'),
                '/': served('index.html', 'impostor'),
                '/bundle.js': served('bundle.js', 'impostor'),
                '/ms_renderer_bg.wasm': served('ms_renderer_bg.wasm', 'impostor'),
                '/esbuild.wasm': served('esbuild.wasm', 'impostor'),
            },
        });
        await engine.start();
        await vi.waitFor(() => expect(messages.matching(/^REPLIES /)).toHaveLength(1), { timeout: 15_000 });
        replies = JSON.parse(messages.matching(/^REPLIES /)[0].text.slice('REPLIES '.length));
    }, BOOT_TIMEOUT_MS);

    afterAll(async () => {
        await engine?.close();
        vi.restoreAllMocks();
        project?.remove();
    });

    describe('the fixed routes', () => {
        it('answers `/` with the page shell, whatever `serve` or the assets directory holds', () => {
            expect(replies['/'].status).toBe(200);
            expect(replies['/'].type).toBe('text/html; charset=utf-8');
            expect(replies['/'].text).toMatch(/^<!doctype html>/);
        });

        it('answers /bundle.js with the built bundle', () => {
            expect(replies['/bundle.js'].status).toBe(200);
            expect(replies['/bundle.js'].type).toBe('text/javascript; charset=utf-8');
            expect(replies['/bundle.js'].text).not.toContain('impostor');
            expect(replies['/bundle.js'].length).toBeGreaterThan(100_000);
        });

        it('answers /ms_renderer_bg.wasm and /esbuild.wasm with the installed binaries', () => {
            for (const [route, specifier] of [
                ['/ms_renderer_bg.wasm', '@motionscript/renderer/ms_renderer_bg.wasm'],
                ['/esbuild.wasm', 'esbuild-wasm/esbuild.wasm'],
            ] as const) {
                expect(replies[route].status).toBe(200);
                expect(replies[route].type).toBe('application/wasm');
                expect(replies[route].head).toBe('0061736d');
                expect(replies[route].length).toBe(sizeOfPackageFile(specifier));
            }
        });
    });

    describe('serve and the assets directory', () => {
        it('serves a file of `serve` before the assets directory\'s file of the same path, and matches on the pathname alone', () => {
            expect(replies['/dup.txt']).toMatchObject({ status: 200, text: 'from serve' });
            expect(replies['/dup.txt?v=2']).toMatchObject({ status: 200, text: 'from serve' });
        });

        it('matches `serve` keys exactly: one without a leading slash is never served', () => {
            expect(replies['/noslash.txt']).toMatchObject({ status: 404, text: 'not found' });
        });

        it('serves what only the assets directory holds', () => {
            expect(replies['/only-assets.txt']).toMatchObject({ status: 200, text: 'from assets' });
            expect(replies['/img/a.png']).toMatchObject({ status: 200, text: 'png from the assets directory' });
        });

        it('labels a file by its extension, in any case, and falls back to a binary type', () => {
            expect(replies['/img/a.png'].type).toBe('image/png');
            expect(replies['/data.json'].type).toBe('application/json; charset=utf-8');
            expect(replies['/clip.WAV'].type).toBe('audio/wav');
            expect(replies['/blob.bin'].type).toBe('application/octet-stream');
            expect(replies['/dup.txt'].type).toBe('application/octet-stream');
        });

        it('answers a missing file 404, and a path out of the assets directory 404 without reading it', () => {
            expect(replies['/missing.txt']).toMatchObject({ status: 404, text: 'not found' });
            expect(replies['/..%2Fpublic-secret%2Fx.txt']).toMatchObject({ status: 404, text: 'outside the assets directory' });
            expect(replies['/..%2Foutside.txt']).toMatchObject({ status: 404, text: 'outside the assets directory' });
        });
    });

    it.todo('answers a `serve` entry whose file is missing with a 404, not an unhandled rejection and a request the page waits on for ever');

    describe('what the page logs', () => {
        it('reaches onPageMessage as errors and warnings only', () => {
            const notFound = /^Failed to load resource: the server responded with a status of 404/;
            // Chromium's own WebGPU notes (powerPreference is ignored on Windows) are not the entry's.
            const ours = messages.all.filter((m) => !/GL Driver|^REPLIES |powerPreference/.test(m.text) && !notFound.test(m.text));
            expect(ours).toEqual([{ type: 'error', text: 'an error from the entry' }]);
            expect(messages.all.map((m) => m.text).join('\n')).not.toMatch(/quiet (log|info|debug)/);
        });

        it('reports each 404 the page gets as an error message', () => {
            const notFound = messages.matching(/^Failed to load resource: the server responded with a status of 404/);
            expect(notFound).toHaveLength(4);
            expect(new Set(notFound.map((m) => m.type))).toEqual(new Set(['error']));
        });

        it('writes an uncaught throw to stderr even though onPageMessage is set, and does not pass it on', async () => {
            await until(() => stderr.some((line) => line === '[motionscript page] thrown in the page\n'));
            expect(messages.all.some((m) => m.text.includes('thrown in the page'))).toBe(false);
            expect(stderr.filter((line) => line.includes('an error from the entry'))).toEqual([]);
        });
    });
});
