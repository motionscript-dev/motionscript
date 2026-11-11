import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';
import { EngineError, isEngineError } from './errors.js';
import { bundlePage } from './page-bundle.js';
import type { Bridge, ConcatRequest, ExportRequest, ScreenshotRequest } from './page-bridge.js';
import { splitFrames } from './segments.js';

/** `globalThis`, not `window`: callbacks' source is compiled here where there is no DOM lib, and in the page the two are the same object. */
type BridgeHost = typeof globalThis & { __motionScript?: Bridge };

const BRIDGE_READY_TIMEOUT_MS = 60_000;

/** A synthetic origin: unlike `about:blank`/`data:` it can carry headers and host relative asset URLs, and unlike a localhost server it needs no port (so no free-port-then-bind race). `page.route` fulfils from memory. */
const ORIGIN = 'https://motion-script.local';

export interface ServerEngineOptions {
    /** The project entry to render. Defaults to `<projectRoot>/src/project.ts`. */
    entry?: string;
    projectRoot?: string;
    assetsDir?: string;
    /** Draw on SwiftShader's WebGPU adapter rather than the GPU (needed on CI, deterministic for pixel diffs). A GPU frame and a SwiftShader frame **do not match**, so comparisons must fix this and record which mode made a baseline. */
    softwareRender?: boolean;
    /** Launch windowed Chromium (needs a display; on Linux run under `xvfb-run`). Headless Chromium on Linux reads a WebGPU canvas back empty on SwiftShader's adapter, so a WebGPU renderer draws blank frames there. */
    headed?: boolean;
    cacheDir?: string;
    /** Asset metadata the page's catalog resolves `src` against. Required for fonts: an undeclared family is never fetched and the browser shapes against a fallback. */
    manifest?: unknown;
    /** Extra files to serve at the origin, by path. Overrides `assetsDir`. */
    serve?: Record<string, string>;
    /** Called for every warning and error the page logs. Browser failures are mostly **soft** (an undeclared font shapes against a fallback, an undeclared image draws nothing), so a pixel-comparing harness needs this to turn them back into failures. */
    onPageMessage?: (message: { type: string; text: string }) => void;
}

export interface ServerImageOptions {
    /** The document to render, as JSON. See {@link ScreenshotRequest.document}. */
    document?: unknown;
    frame?: number | 'first' | 'last';
    scale?: number;
    format?: 'png' | 'jpeg';
}

export interface ServerImage {
    bytes: Uint8Array;
    frame: number;
    totalFrames: number;
}

export interface ServerVideoOptions extends Omit<ExportRequest, 'frames'> {
    /** Pages to render in at once, each encoding one contiguous run of frames, joined without re-encoding (default 1). Extra pages stay open for the next export. */
    concurrency?: number;
}

/**
 * Renders a project from Node by driving the **browser** engine in a headless page, so a server export and a user's
 * preview are the same code (`Canvas3D` draws nothing under an in-process CPU path and `loadAudio` throws there).
 *
 * An RPC client, not a `core.Engine`: the platform seams live inside the page, so every operation is async and this
 * deliberately does not extend `Engine`. Bytes cross base64-encoded (Playwright cannot round-trip a `Uint8Array`
 * through `evaluate`), a third larger than the frame: size it before trusting it for a long video.
 */
export class MotionScriptServerEngine {
    private browser: Browser | null = null;
    private page: Page | null = null;
    /** The pages a split export added to the first, kept for the next one. */
    private workers: Promise<Page>[] = [];
    /** What a page boots from, kept for the pages a split export adds. */
    private source: { projectRoot: string; code: string } | null = null;
    private starting: Promise<void> | null = null;
    private closed = false;

    constructor(private readonly options: ServerEngineOptions = {}) { }

    get started(): boolean {
        return this.page !== null;
    }

    /** Bundle the project, launch the browser, and wait for the bridge. Idempotent. */
    start(): Promise<void> {
        if (this.closed) throw new EngineError('CLOSED', 'The engine was closed.');
        if (this.page) return Promise.resolve();
        this.starting ??= this.boot().catch((err: unknown) => {
            this.starting = null;
            throw err;
        });
        return this.starting;
    }

    async listTracks(): Promise<string[]> {
        const page = await this.ready();
        return page.evaluate(() => (globalThis as BridgeHost).__motionScript!.listTracks());
    }

    async projectName(): Promise<string> {
        const page = await this.ready();
        return page.evaluate(() => (globalThis as BridgeHost).__motionScript!.projectName);
    }

    async fps(): Promise<number> {
        const page = await this.ready();
        return page.evaluate(() => (globalThis as BridgeHost).__motionScript!.fps);
    }

    async renderImage(options: ServerImageOptions = {}): Promise<ServerImage> {
        const page = await this.ready();
        const request: ScreenshotRequest = {
            document: options.document,
            frame: options.frame ?? 'last',
            scale: options.scale,
            format: options.format,
        };
        const result = await page.evaluate(
            (req: ScreenshotRequest) => (globalThis as BridgeHost).__motionScript!.screenshot(req),
            request,
        );
        return {
            bytes: Buffer.from(result.base64, 'base64'),
            frame: result.frame,
            totalFrames: result.totalFrames,
        };
    }

    async renderVideo(options: ServerVideoOptions = {}): Promise<Uint8Array> {
        const { concurrency = 1, ...rest } = options;
        // As JSON text: Playwright walks an object argument on this thread, which
        // takes over a second for a document of 5000 nodes, and a string a fifth of it.
        const request: ExportRequest = { ...rest, document: jsonText(rest.document) };
        const page = await this.ready();
        if (concurrency > 1) {
            const joined = await this.renderSplit(page, request, concurrency);
            if (joined) return joined;
        }
        return Buffer.from(await exportOn(page, request), 'base64');
    }

    async close(): Promise<void> {
        this.closed = true;
        // The browser takes the extra pages down with it.
        this.workers = [];
        this.source = null;
        await this.page?.close().catch(() => undefined);
        await this.browser?.close().catch(() => undefined);
        this.page = null;
        this.browser = null;
    }

    private async ready(): Promise<Page> {
        await this.start();
        if (!this.page) throw new EngineError('START_FAILED', 'The page failed to start.');
        return this.page;
    }

    /** Each range of frames encoded in a page of its own, joined in the first under one audio track mixed over the whole timeline. `null` when there is nothing to split or the segments came out encoded differently. */
    private async renderSplit(page: Page, request: ExportRequest, concurrency: number): Promise<Uint8Array | null> {
        const { document } = request;
        const totalFrames = await page.evaluate(
            (req: { document?: unknown }) => (globalThis as BridgeHost).__motionScript!.countFrames(req),
            { document },
        );
        const ranges = splitFrames(totalFrames, concurrency);
        if (ranges.length < 2) return null;
        const pages = await this.pages(ranges.length);

        // A container holds one decoder configuration per track, so every segment asks for the same encoder.
        const segment: ExportRequest = {
            ...request,
            codec: request.codec ?? 'avc',
            hardwareAcceleration: request.hardwareAcceleration ?? 'no-preference',
            includeAudio: false,
        };
        // Settled before a failure is thrown, so no page is still rendering when the call returns.
        const settled = await Promise.allSettled(ranges.map((frames, i) => exportOn(pages[i], { ...segment, frames })));
        const failed = settled.find((result) => result.status === 'rejected');
        if (failed) throw failed.reason;
        const concat: ConcatRequest = {
            document,
            segments: settled.map((result) => (result as PromiseFulfilledResult<string>).value),
            includeAudio: request.includeAudio,
        };
        const joined = await page.evaluate(
            (req: ConcatRequest) => (globalThis as BridgeHost).__motionScript!.concatSegments(req),
            concat,
        );
        if ('mismatch' in joined) {
            process.stderr.write(`[motionscript] ${joined.mismatch} Exporting in one page instead.\n`);
            return null;
        }
        return Buffer.from(joined.base64, 'base64');
    }

    /** The first page and `count - 1` more, booting the ones not open yet. */
    private async pages(count: number): Promise<Page[]> {
        const first = await this.ready();
        while (this.workers.length < count - 1) this.workers.push(this.bootWorker());
        return [first, ...await Promise.all(this.workers.slice(0, count - 1))];
    }

    private bootWorker(): Promise<Page> {
        const { browser, source } = this;
        if (!browser || !source) return Promise.reject(new EngineError('CLOSED', 'The engine was closed.'));
        const booting: Promise<Page> = this.bootPage(browser, source.projectRoot, source.code).catch((err: unknown) => {
            // Forgotten, so the next split export boots that page afresh.
            this.workers = this.workers.filter((worker) => worker !== booting);
            if (this.closed && !isEngineError(err)) {
                throw new EngineError('CLOSED', 'The engine was closed.', { cause: err });
            }
            throw err;
        });
        return booting;
    }

    private async boot(): Promise<void> {
        const projectRoot = this.options.projectRoot ?? process.cwd();
        const entry = this.options.entry ?? path.join(projectRoot, 'src', 'project.ts');
        const bundle = await bundlePage({ entry, cacheDir: this.options.cacheDir });
        this.assertOpen();

        const browser = await chromium.launch(this.launchOptions());
        this.browser = browser;
        try {
            this.assertOpen();
            this.page = await this.bootPage(browser, projectRoot, bundle.code);
            this.source = { projectRoot, code: bundle.code };
        } catch (err) {
            // A failed boot owns nothing: close what it opened so a retry starts clean and `close()` has no orphan.
            this.page = null;
            this.browser = null;
            await browser.close().catch(() => undefined);
            if (this.closed && !isEngineError(err)) {
                throw new EngineError('CLOSED', 'The engine was closed.', { cause: err });
            }
            throw err;
        }
    }

    private assertOpen(): void {
        if (this.closed) throw new EngineError('CLOSED', 'The engine was closed.');
    }

    /** Open a page with the bundle loaded and the bridge checked; one that fails to get there is closed. */
    private async bootPage(browser: Browser, projectRoot: string, bundleCode: string): Promise<Page> {
        const page = await browser.newPage();
        try {
            await this.setUpPage(page, projectRoot, bundleCode);
            return page;
        } catch (err) {
            await page.close().catch(() => undefined);
            throw err;
        }
    }

    private async setUpPage(page: Page, projectRoot: string, bundleCode: string): Promise<void> {
        this.assertOpen();

        page.on('pageerror', (err) => {
            process.stderr.write(`[motionscript page] ${err.message}\n`);
        });
        // Forwarded too, not just uncaught errors: a render that silently draws nothing reports itself via `console.warn` (missing font, undeclared asset).
        page.on('console', (message) => {
            if (message.type() !== 'error' && message.type() !== 'warning') return;
            if (this.options.onPageMessage) {
                this.options.onPageMessage({ type: message.type(), text: message.text() });
                return;
            }
            process.stderr.write(`[motionscript page] ${message.type()}: ${message.text()}\n`);
        });

        const assetsDir = this.options.assetsDir ?? path.join(projectRoot, 'public');
        await page.route(`${ORIGIN}/**`, async (route) => {
            const url = new URL(route.request().url());
            if (url.pathname === '/') {
                return route.fulfill({
                    status: 200,
                    contentType: 'text/html; charset=utf-8',
                    body: '<!doctype html><meta charset="utf-8"><title>motion-script</title><body></body>',
                });
            }
            if (url.pathname === '/ms_renderer_bg.wasm') {
                return route.fulfill({
                    status: 200,
                    contentType: 'application/wasm',
                    body: fs.readFileSync(rendererWasmPath()),
                });
            }
            if (url.pathname === '/esbuild.wasm') {
                // Only fetched if a project registers a source-string node; the lazy default compiler (dynamic-nodes.ts) otherwise never imports esbuild-wasm.
                return route.fulfill({
                    status: 200,
                    contentType: 'application/wasm',
                    body: fs.readFileSync(esbuildWasmPath()),
                });
            }
            if (url.pathname === '/bundle.js') {
                return route.fulfill({
                    status: 200,
                    contentType: 'text/javascript; charset=utf-8',
                    body: bundleCode,
                });
            }
            const extra = this.options.serve?.[url.pathname];
            if (extra) {
                return route.fulfill({
                    status: 200,
                    body: fs.readFileSync(extra),
                    contentType: contentTypeOf(extra),
                });
            }
            return serveFile(route, assetsDir, url.pathname);
        });

        await page.goto(`${ORIGIN}/`, { waitUntil: 'load' });
        this.assertOpen();
        await page.addScriptTag({ url: `${ORIGIN}/bundle.js` });
        this.assertOpen();

        await page.waitForSelector(
            'html[data-motion-script]',
            { timeout: BRIDGE_READY_TIMEOUT_MS, state: 'attached' },
        ).catch(() => {
            throw new EngineError(
                'BRIDGE_TIMEOUT',
                `The page did not publish a bridge within ${BRIDGE_READY_TIMEOUT_MS}ms.`,
            );
        });

        this.assertOpen();

        const state = await page.getAttribute('html', 'data-motion-script');
        if (state === 'failed') {
            const detail = await page.getAttribute('html', 'data-motion-script-error');
            throw new EngineError('START_FAILED', `The project entry failed to load: ${detail}`);
        }

        // Checked by capability, not version number: a stale cache entry is exactly what a version would miss.
        const missing = await page.evaluate(() => {
            const bridge = (globalThis as unknown as { __motionScript?: Partial<Bridge> }).__motionScript;
            if (!bridge) return 'bridge not installed';
            const required: string[] = [];
            if (typeof bridge.screenshot !== 'function') required.push('screenshot()');
            if (typeof bridge.exportVideo !== 'function') required.push('exportVideo()');
            if (typeof bridge.countFrames !== 'function') required.push('countFrames()');
            if (typeof bridge.concatSegments !== 'function') required.push('concatSegments()');
            if (typeof bridge.listTracks !== 'function') required.push('listTracks()');
            if (typeof bridge.fps !== 'number') required.push('fps');
            return required.length > 0 ? required.join(', ') : null;
        });
        this.assertOpen();
        if (missing) {
            throw new EngineError('BRIDGE_INCOMPATIBLE', `The page bridge is missing: ${missing}.`);
        }

        if (this.options.manifest) {
            await page.evaluate(
                (m: unknown) => (globalThis as BridgeHost).__motionScript!.setManifest(m),
                this.options.manifest,
            );
            this.assertOpen();
        }
    }

    /**
     * Chromium flags, each load-bearing. `--headless=new` with `headless: false`: Playwright's `headless: true` picks
     * the *old* mode, which always falls back to SwiftShader (far slower). The GPU trio is not about speed: without it
     * headless Chromium has no GPU process to encode video with, disguised because `VideoEncoder.isConfigSupported`
     * still answers true and the first `encode()` takes the page down (see `packages/browser/vitest.config.ts`).
     * GL is left at its default: `--use-angle=swiftshader` (Windows) and `--enable-features=Vulkan` (Linux) each
     * leave the page with no WebGPU adapter.
     */
    private launchOptions(): Parameters<typeof chromium.launch>[0] {
        const options = this.chromiumOptions();
        if (this.options.headed) options.args = options.args!.filter(arg => arg !== '--headless=new');
        return options;
    }

    private chromiumOptions(): Parameters<typeof chromium.launch>[0] & { args: string[] } {
        const gpu = ['--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--enable-unsafe-webgpu'];
        const adapter = this.options.softwareRender ? ['--use-webgpu-adapter=swiftshader', '--no-sandbox'] : [];
        return { args: [...gpu, ...adapter, '--headless=new'], headless: false };
    }
}

/** A document as its JSON text, which the page parses; one that already is text is left alone. */
function jsonText(document: unknown): unknown {
    return document === undefined || typeof document === 'string' ? document : JSON.stringify(document);
}

/** One export in `page`, as base64. */
function exportOn(page: Page, request: ExportRequest): Promise<string> {
    return page.evaluate(
        (req: ExportRequest) => (globalThis as BridgeHost).__motionScript!.exportVideo(req),
        request,
    );
}

/** The renderer's WASM, resolved from the installed package: the page's bundle has no `import.meta.url` to find it by. */
function rendererWasmPath(): string {
    return fileURLToPath(import.meta.resolve('@motionscript/renderer/ms_renderer_bg.wasm'));
}

/** Same resolution trick as `rendererWasmPath`, for `esbuild-wasm`'s own binary. */
function esbuildWasmPath(): string {
    const url = import.meta.resolve('esbuild-wasm/esbuild.wasm');
    return fileURLToPath(url);
}

/** Serves one file from the assets directory, or 404. A path leaving the directory is a 404 (paths come from a document), also checked on the real path so a symlink cannot reach out. */
export async function serveFile(
    route: Parameters<Parameters<Page['route']>[1]>[0],
    assetsDir: string,
    pathname: string,
): Promise<void> {
    let rel: string;
    try {
        rel = decodeURIComponent(pathname.replace(/^\//, ''));
    } catch {
        return route.fulfill({ status: 404, body: 'not found' });
    }
    const root = path.resolve(assetsDir);
    const file = path.resolve(root, rel);
    if (!isWithin(root, file)) {
        return route.fulfill({ status: 404, body: 'outside the assets directory' });
    }
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
        return route.fulfill({ status: 404, body: 'not found' });
    }
    if (!isWithin(fs.realpathSync(root), fs.realpathSync(file))) {
        return route.fulfill({ status: 404, body: 'outside the assets directory' });
    }
    return route.fulfill({ status: 200, body: fs.readFileSync(file), contentType: contentTypeOf(file) });
}

/** Whether `file` is `dir` or below it. A string prefix is not: `public-secret` starts with `public`. */
function isWithin(dir: string, file: string): boolean {
    const rel = path.relative(dir, file);
    return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

const CONTENT_TYPES: Record<string, string> = {
    '.wasm': 'application/wasm',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ttf': 'font/ttf',
    '.otf': 'font/otf',
    '.woff2': 'font/woff2',
};

function contentTypeOf(file: string): string {
    return CONTENT_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
}

/** Build a server engine. Call `start()` (or any render) to boot it. */
export function createServerEngine(options: ServerEngineOptions = {}): MotionScriptServerEngine {
    return new MotionScriptServerEngine(options);
}
