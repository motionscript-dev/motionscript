import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isEngineError } from '../errors.js';

/**
 * The engine's lifecycle and what it asks of the page, against stand-ins for
 * Playwright and the bundler, so each case is exact and nothing launches.
 *
 * The page's `evaluate` runs its callback here against a stub bridge on
 * `globalThis`, which is where the real callbacks look for it. What a real page
 * does with a request is `render.test.ts`'s business; this file is about what
 * the engine sends and what it does with the answer.
 */
const hoisted = vi.hoisted(() => ({
    launch: vi.fn(),
    bundlePage: vi.fn(),
}));

vi.mock('playwright', () => ({ chromium: { launch: hoisted.launch } }));
vi.mock('../page-bundle.js', () => ({ bundlePage: hoisted.bundlePage }));

const { MotionScriptServerEngine, createServerEngine } = await import('../server-engine.js');
type Engine = InstanceType<typeof MotionScriptServerEngine>;
type EngineOptions = ConstructorParameters<typeof MotionScriptServerEngine>[0];

interface Scenario {
    /** What `html[data-motion-script]` reads. */
    state: string | null;
    detail: string | null;
    /** `waitForSelector` rejects, as it does when the page never publishes a bridge. */
    never: boolean;
    pageCloseRejects: boolean;
    /** The bridge on the page; `null` for none. */
    bridge: Record<string, unknown> | null;
}

const calls: string[] = [];
let scenario: Scenario;
let pageListeners: Map<string, Array<(arg: unknown) => void>>;
let waitArgs: unknown[];
let launchedWith: unknown;

function stubBridge() {
    return {
        projectName: 'scratch',
        fps: 30,
        listTracks: vi.fn(() => ['a', 'b']),
        setManifest: vi.fn(),
        screenshot: vi.fn(async (_request?: unknown) => ({ base64: Buffer.from([1, 2, 3]).toString('base64'), frame: 4, totalFrames: 9 })),
        exportVideo: vi.fn(async (_request?: unknown) => Buffer.from([4, 5, 6]).toString('base64')),
        countFrames: vi.fn((_request?: unknown) => 10),
        concatSegments: vi.fn(async (_request?: unknown): Promise<{ base64: string } | { mismatch: string }> =>
            ({ base64: Buffer.from([7, 8, 9]).toString('base64') })),
    };
}

function fakePage() {
    return {
        on(event: string, listener: (arg: unknown) => void) {
            pageListeners.set(event, [...(pageListeners.get(event) ?? []), listener]);
        },
        async route(pattern: string) {
            calls.push(`route ${pattern}`);
        },
        async goto(url: string, options: unknown) {
            calls.push(`goto ${url} ${JSON.stringify(options)}`);
        },
        async addScriptTag(options: { url: string }) {
            calls.push(`addScriptTag ${options.url}`);
        },
        async waitForSelector(selector: string, options: unknown) {
            calls.push('waitForSelector');
            waitArgs = [selector, options];
            if (scenario.never) throw new Error('Timeout 60000ms exceeded');
        },
        async getAttribute(_selector: string, name: string) {
            calls.push(`getAttribute ${name}`);
            return name === 'data-motion-script' ? scenario.state : scenario.detail;
        },
        async evaluate(fn: (arg: unknown) => unknown, arg?: unknown) {
            calls.push('evaluate');
            return fn(arg);
        },
        async close() {
            calls.push('page.close');
            if (scenario.pageCloseRejects) throw new Error('page already gone');
        },
    };
}

function fakeBrowser() {
    return {
        async newPage() {
            calls.push('newPage');
            return fakePage();
        },
        async close() {
            calls.push('browser.close');
        },
    };
}

/** The bridge the page "publishes": installed on `globalThis` for `evaluate` callbacks to find. */
function publish(bridge: Record<string, unknown> | null) {
    scenario.bridge = bridge;
    if (bridge) Object.assign(globalThis, { __motionScript: bridge });
    else delete (globalThis as { __motionScript?: unknown }).__motionScript;
}

let engine: Engine | undefined;
const engineFor = (options: EngineOptions = {}) => {
    engine = new MotionScriptServerEngine({ projectRoot: '/scratch/project', ...options });
    return engine;
};

beforeEach(() => {
    calls.length = 0;
    pageListeners = new Map();
    waitArgs = [];
    launchedWith = undefined;
    scenario = { state: 'ready', detail: null, never: false, pageCloseRejects: false, bridge: null };
    hoisted.launch.mockReset().mockImplementation(async (options: unknown) => {
        calls.push('launch');
        launchedWith = options;
        return fakeBrowser();
    });
    hoisted.bundlePage.mockReset().mockImplementation(async () => {
        calls.push('bundlePage');
        return { code: 'bundle-code', inputs: [], cached: false };
    });
    publish(stubBridge());
});

afterEach(async () => {
    await engine?.close();
    engine = undefined;
    publish(null);
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

describe('createServerEngine', () => {
    it('builds an engine and does no work: no bundle, no browser, no validation of what it was given', () => {
        const created = createServerEngine({ entry: '/not/there.ts', projectRoot: 42 as never, manifest: 'not a manifest' });

        expect(created).toBeInstanceOf(MotionScriptServerEngine);
        expect(created.started).toBe(false);
        expect(hoisted.bundlePage).not.toHaveBeenCalled();
        expect(hoisted.launch).not.toHaveBeenCalled();
    });
});

describe('close()', () => {
    it('closes the page, then the browser, and clears both', async () => {
        const subject = engineFor();
        await subject.start();
        expect(subject.started).toBe(true);

        await subject.close();

        expect(calls.slice(-2)).toEqual(['page.close', 'browser.close']);
        expect(subject.started).toBe(false);
    });

    it('is safe to call twice, and closes nothing the second time', async () => {
        const subject = engineFor();
        await subject.start();
        await subject.close();
        const closes = calls.filter((call) => call.endsWith('.close')).length;

        await subject.close();

        expect(calls.filter((call) => call.endsWith('.close')).length).toBe(closes);
        expect(closes).toBe(2);
    });

    it('is safe before start(), and leaves nothing to launch', async () => {
        const subject = engineFor();
        await subject.close();
        expect(calls).toEqual([]);
        expect(subject.started).toBe(false);
    });

    it('closes the browser even when the page will not close', async () => {
        const subject = engineFor();
        await subject.start();
        scenario.pageCloseRejects = true;

        await expect(subject.close()).resolves.toBeUndefined();

        expect(calls.slice(-2)).toEqual(['page.close', 'browser.close']);
        expect(subject.started).toBe(false);
    });
});

describe('an engine that was closed', () => {
    const useIt: Array<[string, (engine: Engine) => Promise<unknown>]> = [
        ['listTracks()', (e) => e.listTracks()],
        ['projectName()', (e) => e.projectName()],
        ['fps()', (e) => e.fps()],
        ['renderImage()', (e) => e.renderImage({ document: {} })],
        ['renderVideo()', (e) => e.renderVideo({ document: {} })],
    ];

    it.each(useIt)('rejects %s with CLOSED, and launches nothing', async (_name, call) => {
        const subject = engineFor();
        await subject.close();

        const failure = await call(subject).then(() => null, (error: unknown) => error);

        expect(isEngineError(failure)).toBe(true);
        expect(failure).toMatchObject({ code: 'CLOSED' });
        expect(hoisted.launch).not.toHaveBeenCalled();
    });

    it('rejects the same way after a boot that finished', async () => {
        const subject = engineFor();
        await subject.start();
        await subject.close();
        const failure = await subject.renderImage({ document: {} }).then(() => null, (error: unknown) => error);
        expect(failure).toMatchObject({ code: 'CLOSED' });
    });

    it('throws CLOSED from start() synchronously rather than returning a rejected promise', async () => {
        const subject = engineFor();
        await subject.close();

        let returned: unknown;
        let thrown: unknown;
        try {
            returned = subject.start();
        } catch (error) {
            thrown = error;
        }

        expect(returned).toBeUndefined();
        expect(isEngineError(thrown)).toBe(true);
        expect(thrown).toMatchObject({ code: 'CLOSED' });
    });

    it.todo('returns a rejected promise from start(), so engine.start().catch(...) is reached');

    it.todo('maps a render in flight when close() runs to CLOSED rather than Playwright\'s TargetClosedError');
});

describe('the Chromium launch flags', () => {
    const GPU = ['--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--enable-unsafe-webgpu'];

    it('asks for the new headless mode through `headless: false`, with WebGPU on, by default', async () => {
        await engineFor().start();
        expect(launchedWith).toEqual({ args: [...GPU, '--headless=new'], headless: false });
    });

    it('adds SwiftShader\'s WebGPU adapter and no sandbox for `softwareRender: true`', async () => {
        await engineFor({ softwareRender: true }).start();
        expect(launchedWith).toEqual({
            args: [...GPU, '--use-webgpu-adapter=swiftshader', '--no-sandbox', '--headless=new'],
            headless: false,
        });
    });

    it('reads no environment variable', async () => {
        await engineFor().start();
        expect((launchedWith as { args: string[] }).args).not.toContain('--use-webgpu-adapter=swiftshader');
    });

    it('drops --headless=new for `headed: true`', async () => {
        await engineFor({ headed: true }).start();
        expect((launchedWith as { args: string[] }).args).not.toContain('--headless=new');
    });
});

describe('the boot sequence', () => {
    it('bundles the default entry, launches, serves the origin, loads the bundle and waits for the attribute, in that order', async () => {
        await engineFor({ cacheDir: '/scratch/cache' }).start();

        expect(hoisted.bundlePage).toHaveBeenCalledWith({
            entry: path.join('/scratch/project', 'src', 'project.ts'),
            cacheDir: '/scratch/cache',
        });
        expect(calls.slice(0, 9)).toEqual([
            'bundlePage',
            'launch',
            'newPage',
            'route https://motion-script.local/**',
            'goto https://motion-script.local/ {"waitUntil":"load"}',
            'addScriptTag https://motion-script.local/bundle.js',
            'waitForSelector',
            'getAttribute data-motion-script',
            'evaluate',
        ]);
        expect(waitArgs).toEqual(['html[data-motion-script]', { timeout: 60_000, state: 'attached' }]);
    });

    it('bundles `entry` when one is given', async () => {
        await engineFor({ entry: '/elsewhere/main.ts' }).start();
        expect(hoisted.bundlePage).toHaveBeenCalledWith(expect.objectContaining({ entry: '/elsewhere/main.ts' }));
    });

    it('defaults the project root to the working directory', async () => {
        engine = new MotionScriptServerEngine();
        await engine.start();
        expect(hoisted.bundlePage).toHaveBeenCalledWith(expect.objectContaining({
            entry: path.join(process.cwd(), 'src', 'project.ts'),
        }));
    });

    it('pushes the manifest to the page once, after the bridge checks out', async () => {
        const manifest = { image: {}, video: {}, audio: {}, font: {} };
        const bridge = stubBridge();
        publish(bridge);
        const subject = engineFor({ manifest });

        await subject.start();

        expect(bridge.setManifest).toHaveBeenCalledTimes(1);
        expect(bridge.setManifest).toHaveBeenCalledWith(manifest);
        await subject.start();
        await subject.fps();
        expect(bridge.setManifest).toHaveBeenCalledTimes(1);
    });

    it('does not touch the page\'s manifest when none was given', async () => {
        const bridge = stubBridge();
        publish(bridge);
        await engineFor().start();
        expect(bridge.setManifest).not.toHaveBeenCalled();
    });

    it('does not check for setManifest or projectName: only what a render needs', async () => {
        const { setManifest: _setManifest, projectName: _projectName, ...rest } = stubBridge();
        publish(rest);
        await engineFor().start();
        expect(engine!.started).toBe(true);
    });
});

describe('a boot that fails', () => {
    async function failureOf(subject: Engine): Promise<unknown> {
        return subject.start().then(() => null, (error: unknown) => error);
    }

    it('says BRIDGE_TIMEOUT, naming the wait, when the page never publishes the attribute', async () => {
        scenario.never = true;
        const subject = engineFor();

        const failure = await failureOf(subject);

        expect(isEngineError(failure)).toBe(true);
        expect(failure).toMatchObject({ code: 'BRIDGE_TIMEOUT' });
        expect((failure as Error).message).toBe('The page did not publish a bridge within 60000ms.');
        expect(subject.started).toBe(false);
        expect(calls).toContain('browser.close');
    });

    it.todo('lets the 60 000 ms ready timeout be set, so BRIDGE_TIMEOUT can be tested against a page that never publishes');

    it('says START_FAILED, with the page\'s own text, when the attribute reads `failed`', async () => {
        scenario.state = 'failed';
        scenario.detail = 'Error: entry blew up';

        const failure = await failureOf(engineFor());

        expect(failure).toMatchObject({ code: 'START_FAILED' });
        expect((failure as Error).message).toBe('The project entry failed to load: Error: entry blew up');
        expect(calls).toContain('browser.close');
    });

    it.each([
        ['screenshot', 'screenshot()'],
        ['exportVideo', 'exportVideo()'],
        ['countFrames', 'countFrames()'],
        ['concatSegments', 'concatSegments()'],
        ['listTracks', 'listTracks()'],
    ])('says BRIDGE_INCOMPATIBLE when the bridge has no %s', async (name, listed) => {
        const bridge: Record<string, unknown> = stubBridge();
        delete bridge[name];
        publish(bridge);

        const failure = await failureOf(engineFor());

        expect(failure).toMatchObject({ code: 'BRIDGE_INCOMPATIBLE' });
        expect((failure as Error).message).toBe(`The page bridge is missing: ${listed}.`);
        expect(calls).toContain('browser.close');
    });

    it('says BRIDGE_INCOMPATIBLE when fps is not a number, and lists everything that is missing together', async () => {
        publish({ projectName: '', fps: '30', setManifest() { } });

        const failure = await failureOf(engineFor());

        expect(failure).toMatchObject({ code: 'BRIDGE_INCOMPATIBLE' });
        expect((failure as Error).message).toBe(
            'The page bridge is missing: screenshot(), exportVideo(), countFrames(), concatSegments(), listTracks(), fps.',
        );
    });

    it('says BRIDGE_INCOMPATIBLE when the page published no bridge at all', async () => {
        publish(null);

        const failure = await failureOf(engineFor());

        expect(failure).toMatchObject({ code: 'BRIDGE_INCOMPATIBLE' });
        expect((failure as Error).message).toBe('The page bridge is missing: bridge not installed.');
    });

    it('leaves the engine startable: a retry boots from the start', async () => {
        scenario.state = 'failed';
        scenario.detail = 'first attempt';
        const subject = engineFor();
        expect(await failureOf(subject)).toMatchObject({ code: 'START_FAILED' });

        scenario.state = 'ready';
        await subject.start();

        expect(subject.started).toBe(true);
        expect(hoisted.launch).toHaveBeenCalledTimes(2);
    });
});

describe('page diagnostics', () => {
    let written: string[];

    beforeEach(() => {
        written = [];
        vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: string | Uint8Array) => {
            written.push(String(chunk));
            return true;
        }) as typeof process.stderr.write);
    });

    const emit = (event: string, arg: unknown) => {
        for (const listener of pageListeners.get(event) ?? []) listener(arg);
    };
    const message = (type: string, text: string) => ({ type: () => type, text: () => text });
    const ours = () => written.filter((line) => line.startsWith('[motionscript page]'));

    it('hands an error and a warning to onPageMessage, as the type and the text, and nothing else', async () => {
        const seen: Array<{ type: string; text: string }> = [];
        await engineFor({ onPageMessage: (m) => seen.push(m) }).start();

        emit('console', message('warning', 'a warning'));
        emit('console', message('error', 'an error'));
        for (const type of ['log', 'info', 'debug', 'trace', 'dir']) emit('console', message(type, `quiet ${type}`));

        expect(seen).toEqual([
            { type: 'warning', text: 'a warning' },
            { type: 'error', text: 'an error' },
        ]);
        expect(ours()).toEqual([]);
    });

    it('writes them to stderr when there is no onPageMessage, and only those two types', async () => {
        await engineFor().start();

        emit('console', message('warning', 'a warning'));
        emit('console', message('error', 'an error'));
        emit('console', message('log', 'chatter'));

        expect(ours()).toEqual([
            '[motionscript page] warning: a warning\n',
            '[motionscript page] error: an error\n',
        ]);
    });

    it('always writes an uncaught page error to stderr, whether or not onPageMessage is set', async () => {
        const seen: unknown[] = [];
        await engineFor({ onPageMessage: (m) => seen.push(m) }).start();
        emit('pageerror', new Error('uncaught in the page'));
        expect(ours()).toEqual(['[motionscript page] uncaught in the page\n']);
        expect(seen).toEqual([]);

        await engine!.close();
        written.length = 0;
        pageListeners.clear();
        await engineFor().start();
        emit('pageerror', new Error('uncaught again'));
        expect(ours()).toEqual(['[motionscript page] uncaught again\n']);
    });
});

describe('the render methods', () => {
    it('asks for the last frame unless told otherwise, and returns the bytes with the frame and the count', async () => {
        const bridge = stubBridge();
        publish(bridge);
        const document = { kind: 'still', nodes: [] };

        const image = await engineFor().renderImage({ document });

        expect(bridge.screenshot).toHaveBeenCalledWith({ document, frame: 'last', scale: undefined, format: undefined });
        expect(Buffer.isBuffer(image.bytes)).toBe(true);
        expect([...image.bytes]).toEqual([1, 2, 3]);
        expect([image.frame, image.totalFrames]).toEqual([4, 9]);
    });

    it('starts the engine on the first render, once', async () => {
        const subject = engineFor();
        await Promise.all([subject.renderImage({}), subject.renderImage({})]);
        expect(hoisted.launch).toHaveBeenCalledTimes(1);
    });

    it('sends frame, scale and format as given, and validates none of them', async () => {
        const bridge = stubBridge();
        publish(bridge);
        const subject = engineFor();

        await subject.renderImage({ frame: 2, scale: 2, format: 'jpeg' });
        await subject.renderImage({ frame: -5, scale: -1, format: 'gif' as never });
        await subject.renderImage({ frame: 'mid' as never, scale: Number.NaN });

        expect(bridge.screenshot.mock.calls.map(([request]) => request)).toEqual([
            { document: undefined, frame: 2, scale: 2, format: 'jpeg' },
            { document: undefined, frame: -5, scale: -1, format: 'gif' },
            { document: undefined, frame: 'mid', scale: Number.NaN, format: undefined },
        ]);
    });

    it('sends the options of a video as they came, the document as its JSON text, and returns its bytes', async () => {
        const bridge = stubBridge();
        publish(bridge);
        const document = { kind: 'project' };

        const video = await engineFor().renderVideo({ document, scale: 2, codec: 'vp9' });

        expect(bridge.exportVideo).toHaveBeenCalledWith({ document: JSON.stringify(document), scale: 2, codec: 'vp9' });
        expect(Buffer.isBuffer(video)).toBe(true);
        expect([...video]).toEqual([4, 5, 6]);
    });

    it('lets what the page throws reach the caller as it is, uncoded', async () => {
        const bridge = stubBridge();
        const pageFailure = new Error('page.evaluate: Error: Unknown scene(s): nope');
        bridge.screenshot.mockRejectedValue(pageFailure);
        bridge.exportVideo.mockRejectedValue(pageFailure);
        publish(bridge);
        const subject = engineFor();

        const still = await subject.renderImage({}).then(() => null, (error: unknown) => error);
        const video = await subject.renderVideo({}).then(() => null, (error: unknown) => error);

        // Neither is wrapped.
        expect(still).toBe(pageFailure);
        expect(video).toBe(pageFailure);
        expect(isEngineError(still)).toBe(false);
    });

    it.todo('wraps a failure inside the page in a coded EngineError, with the browser stack as its cause');
});

describe('a split export', () => {
    const base64 = (...bytes: number[]) => Buffer.from(bytes).toString('base64');
    const pagesOpened = () => calls.filter((call) => call === 'newPage').length;
    /** The bridge, with each segment's bytes naming the frame it starts at. */
    function segmentingBridge() {
        const bridge = stubBridge();
        bridge.exportVideo.mockImplementation(async (request?: unknown) => {
            const frames = (request as { frames?: { start: number } }).frames;
            return frames ? base64(frames.start) : base64(4, 5, 6);
        });
        publish(bridge);
        return bridge;
    }

    it('is not one at a concurrency of 1: one page, one export, no count of the frames', async () => {
        const bridge = segmentingBridge();

        await engineFor().renderVideo({ document: { kind: 'project' }, concurrency: 1 });

        expect(pagesOpened()).toBe(1);
        expect(bridge.countFrames).not.toHaveBeenCalled();
        expect(bridge.exportVideo).toHaveBeenCalledTimes(1);
        expect(bridge.concatSegments).not.toHaveBeenCalled();
    });

    it('gives each page one contiguous range under one encoder configuration, and joins them in the first', async () => {
        const bridge = segmentingBridge();
        // Carried as its JSON text, which Playwright serialises far faster than the object.
        const document = JSON.stringify({ kind: 'project' });

        const video = await engineFor().renderVideo({ document: { kind: 'project' }, scale: 2, bitrate: 5_000_000, concurrency: 3 });

        expect(bridge.countFrames).toHaveBeenCalledWith({ document });
        expect(pagesOpened()).toBe(3);
        const pinned = { document, scale: 2, bitrate: 5_000_000, codec: 'avc', hardwareAcceleration: 'no-preference', includeAudio: false };
        expect(bridge.exportVideo.mock.calls.map(([request]) => request)).toEqual([
            { ...pinned, frames: { start: 0, end: 4 } },
            { ...pinned, frames: { start: 4, end: 7 } },
            { ...pinned, frames: { start: 7, end: 10 } },
        ]);
        expect(bridge.concatSegments).toHaveBeenCalledTimes(1);
        expect(bridge.concatSegments).toHaveBeenCalledWith({ document, segments: [base64(0), base64(4), base64(7)], includeAudio: undefined });
        expect([...video]).toEqual([7, 8, 9]);
    });

    it('keeps the encoder a caller chose for every segment, and leaves the audio to the join', async () => {
        const bridge = segmentingBridge();

        await engineFor().renderVideo({ codec: 'hevc', hardwareAcceleration: 'prefer-software', includeAudio: true, concurrency: 2 });

        for (const [request] of bridge.exportVideo.mock.calls) {
            expect(request).toMatchObject({ codec: 'hevc', hardwareAcceleration: 'prefer-software', includeAudio: false });
        }
        expect(bridge.concatSegments).toHaveBeenCalledWith(expect.objectContaining({ includeAudio: true }));
    });

    it('keeps the pages it opened for the next split export, and opens only the ones it lacks', async () => {
        segmentingBridge();
        const subject = engineFor();

        await subject.renderVideo({ concurrency: 3 });
        await subject.renderVideo({ concurrency: 3 });
        expect(pagesOpened()).toBe(3);
        await subject.renderVideo({ concurrency: 2 });
        expect(pagesOpened()).toBe(3);
        await subject.renderVideo({ concurrency: 4 });
        expect(pagesOpened()).toBe(4);
    });

    it('boots every page it adds like the first, manifest included', async () => {
        const bridge = segmentingBridge();
        const manifest = { image: {}, video: {}, audio: {}, font: {} };

        await engineFor({ manifest }).renderVideo({ concurrency: 3 });

        expect(calls.filter((call) => call === 'addScriptTag https://motion-script.local/bundle.js')).toHaveLength(3);
        expect(bridge.setManifest).toHaveBeenCalledTimes(3);
    });

    it('opens no page for a timeline of one frame, and exports it in the first', async () => {
        const bridge = segmentingBridge();
        bridge.countFrames.mockReturnValue(1);

        const video = await engineFor().renderVideo({ concurrency: 8 });

        expect(pagesOpened()).toBe(1);
        expect(bridge.exportVideo.mock.calls.map(([request]) => request)).toEqual([{}]);
        expect([...video]).toEqual([4, 5, 6]);
    });

    it('exports in one page instead, and says why, when the segments cannot be joined', async () => {
        const written: string[] = [];
        vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: string | Uint8Array) => {
            written.push(String(chunk));
            return true;
        }) as typeof process.stderr.write);
        const bridge = segmentingBridge();
        bridge.concatSegments.mockResolvedValue({ mismatch: 'Segment 1 was encoded differently from segment 0.' });

        const video = await engineFor().renderVideo({ document: 'json', scale: 2, concurrency: 2 });

        expect(bridge.exportVideo.mock.calls.at(-1)).toEqual([{ document: 'json', scale: 2 }]);
        expect([...video]).toEqual([4, 5, 6]);
        expect(written).toEqual(['[motionscript] Segment 1 was encoded differently from segment 0. Exporting in one page instead.\n']);
    });

    it('rejects with a segment\'s failure once every page has finished, and joins nothing', async () => {
        const bridge = segmentingBridge();
        const failure = new Error('page.evaluate: Error: segment two broke');
        let finished = 0;
        bridge.exportVideo.mockImplementation(async (request?: unknown) => {
            const { start } = (request as { frames: { start: number } }).frames;
            if (start === 4) throw failure;
            await new Promise((resolve) => setTimeout(resolve, 5));
            finished++;
            return base64(start);
        });

        const outcome = await engineFor().renderVideo({ concurrency: 3 }).then(() => null, (error: unknown) => error);

        expect(outcome).toBe(failure);
        expect(finished).toBe(2);
        expect(bridge.concatSegments).not.toHaveBeenCalled();
    });
});
