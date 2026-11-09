import { EventEmitter } from 'node:events';
import type http from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The sample server's routes and its status mapping, driven in-process: `node:http`
 * is replaced by a stand-in that keeps the request listener (and listens on
 * nothing), `render.js` by a fake engine that records what it was asked, and the
 * requests and responses are plain objects. No socket, no browser.
 *
 * The module listens as it loads, so each case loads a fresh copy.
 */
const hoisted = vi.hoisted(() => ({
    listener: null as null | ((req: unknown, res: unknown) => void),
    listen: vi.fn(),
    fonts: [] as Array<{ family: string; file: string }>,
    engine: { started: false, start: vi.fn<() => Promise<void>>(async () => { }) },
    renderImage: vi.fn(),
    renderVideo: vi.fn(),
}));

vi.mock('node:http', () => ({
    default: {
        createServer(listener: (req: unknown, res: unknown) => void) {
            hoisted.listener = listener;
            return { listen: hoisted.listen };
        },
    },
}));

vi.mock('./render.js', () => ({
    FONTS: hoisted.fonts,
    FPS: 60,
    VIEWPORT: { width: 1280, height: 720 },
    getEngine: () => hoisted.engine,
    isAvailable: (scene: { requiresFont?: boolean }) => !scene.requiresFont || hoisted.fonts.length > 0,
    renderImage: hoisted.renderImage,
    renderVideo: hoisted.renderVideo,
}));

/** A response that keeps what it was given and says when it is done. */
class FakeResponse {
    status = 0;
    headers: Record<string, string | number> = {};
    body: Buffer = Buffer.alloc(0);
    headersSent = false;
    destroyed = false;
    endThrows: Error | null = null;
    readonly finished: Promise<void>;
    private finish!: () => void;

    constructor() {
        this.finished = new Promise<void>((resolve) => { this.finish = resolve; });
    }

    setHeader(name: string, value: string | number) {
        this.headers[name.toLowerCase()] = value;
    }

    writeHead(status: number, headers: Record<string, string | number> = {}) {
        this.status = status;
        this.headersSent = true;
        for (const [name, value] of Object.entries(headers)) this.setHeader(name, value);
    }

    end(chunk?: string | Buffer) {
        if (this.endThrows) {
            const error = this.endThrows;
            this.endThrows = null;
            throw error;
        }
        if (chunk !== undefined) this.body = Buffer.from(chunk);
        this.finish();
    }

    destroy() {
        this.destroyed = true;
        this.finish();
    }

    get text() {
        return this.body.toString('utf8');
    }

    get json() {
        return JSON.parse(this.text) as Record<string, unknown>;
    }
}

interface Loaded {
    HttpError: typeof import('./errors.js').HttpError;
    EngineError: typeof import('@motionscript/headless').EngineError;
    /** Send one request through the server's listener and wait for the answer. */
    request(url: string, options?: { method?: string; setup?: (res: FakeResponse) => void }): Promise<FakeResponse>;
    /** The request object of the last `request`, to emit events on. */
    lastRequest(): EventEmitter;
}

async function loadServer(env: { PORT?: string; HOST?: string } = {}): Promise<Loaded> {
    vi.resetModules();
    hoisted.listener = null;
    for (const name of ['PORT', 'HOST'] as const) {
        if (env[name] === undefined) vi.stubEnv(name, undefined as unknown as string);
        else vi.stubEnv(name, env[name]);
    }
    await import('./server.js');
    const { HttpError } = await import('./errors.js');
    const { EngineError } = await import('@motionscript/headless');
    let last: EventEmitter = new EventEmitter();
    return {
        HttpError,
        EngineError,
        async request(url, { method = 'GET', setup } = {}) {
            const req = Object.assign(new EventEmitter(), { method, url, headers: { host: 'localhost:5175' } });
            last = req;
            const res = new FakeResponse();
            setup?.(res);
            hoisted.listener!(req as unknown as http.IncomingMessage, res);
            await res.finished;
            return res;
        },
        lastRequest: () => last,
    };
}

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

let logs: string[];
let warnings: string[];
let errors: unknown[][];

beforeEach(() => {
    hoisted.fonts.length = 0;
    hoisted.engine.started = false;
    hoisted.engine.start.mockReset().mockResolvedValue();
    hoisted.listen.mockReset().mockImplementation((_port: unknown, _host: unknown, ready?: () => void) => ready?.());
    hoisted.renderImage.mockReset().mockResolvedValue({ bytes: PNG, frame: 3, time: 0.05, totalFrames: 9 });
    hoisted.renderVideo.mockReset().mockResolvedValue(Uint8Array.from([0, 0, 0, 0x1c, 0x66, 0x74, 0x79, 0x70]));
    logs = [];
    warnings = [];
    errors = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => { logs.push(args.join(' ')); });
    vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => { warnings.push(args.join(' ')); });
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { errors.push(args); });
});

afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

describe('starting up', () => {
    it('listens on 127.0.0.1:5175 unless PORT and HOST say otherwise', async () => {
        await loadServer();
        expect(hoisted.listen).toHaveBeenCalledWith(5175, '127.0.0.1', expect.any(Function));

        await loadServer({ PORT: '6001', HOST: '0.0.0.0' });
        expect(hoisted.listen).toHaveBeenLastCalledWith(6001, '0.0.0.0', expect.any(Function));
    });

    it('logs its address and the scene ids, and warns that no font is declared', async () => {
        await loadServer();
        expect(logs[0]).toBe('[engine] http://127.0.0.1:5175');
        expect(logs[1]).toBe('[engine] scenes: shapes, variables, text, aurora, pulse-ring, prism, dynamic-node, view-3d, audio');
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain('No fonts declared');
    });

    it('logs the fonts it found instead of warning', async () => {
        hoisted.fonts.push({ family: 'Inter', file: '/fonts/Inter.ttf' }, { family: 'Mono', file: '/fonts/Mono.ttf' });
        await loadServer();
        expect(logs).toContain('[engine] fonts: Inter, Mono');
        expect(warnings).toEqual([]);
    });

    it('starts the engine without waiting for it, and logs a start that fails', async () => {
        let fail!: (error: Error) => void;
        hoisted.engine.start.mockImplementation(() => new Promise<void>((_resolve, reject) => { fail = reject; }));

        await loadServer();
        expect(hoisted.engine.start).toHaveBeenCalledTimes(1);
        expect(errors).toEqual([]);

        const failure = new Error('no chromium');
        fail(failure);
        await vi.waitFor(() => expect(errors).toEqual([['[engine] failed to start the renderer:', failure]]));
    });
});

describe('every response', () => {
    it('allows any origin, the content-type header and GET, POST and OPTIONS', async () => {
        const server = await loadServer();
        for (const url of ['/health', '/scenes', '/nowhere', '/scene?scene=missing']) {
            const response = await server.request(url);
            expect(response.headers['access-control-allow-origin'], url).toBe('*');
            expect(response.headers['access-control-allow-headers'], url).toBe('content-type');
            expect(response.headers['access-control-allow-methods'], url).toBe('GET,POST,OPTIONS');
        }
    });

    it('answers OPTIONS with 204 and no body, without touching the engine', async () => {
        const server = await loadServer();
        const response = await server.request('/image?scene=shapes', { method: 'OPTIONS' });
        expect(response.status).toBe(204);
        expect(response.text).toBe('');
        expect(response.headers['access-control-allow-origin']).toBe('*');
        expect(hoisted.renderImage).not.toHaveBeenCalled();
    });
});

describe('the read-only routes', () => {
    it('GET / is the demo page, listing each scene and marking the ones this process cannot render', async () => {
        const server = await loadServer();
        const response = await server.request('/');
        expect(response.status).toBe(200);
        expect(response.headers['content-type']).toBe('text/html; charset=utf-8');
        expect(response.text).toMatch(/^<!doctype html>/);
        expect(response.text).toContain('<option value="shapes"');
        expect(response.text).toMatch(/<option value="text" disabled>/);
        expect(response.text).not.toMatch(/<option value="shapes" disabled>/);
    });

    it('GET /health reports the engine, the fonts, the viewport and the frame rate', async () => {
        hoisted.fonts.push({ family: 'Inter', file: '/fonts/Inter.ttf' });
        hoisted.engine.started = true;
        const server = await loadServer();
        const response = await server.request('/health');
        expect(response.status).toBe(200);
        expect(response.headers['content-type']).toBe('application/json; charset=utf-8');
        expect(response.json).toEqual({
            ok: true,
            started: true,
            fonts: ['Inter'],
            viewport: { width: 1280, height: 720 },
            fps: 60,
        });
    });

    it('GET /scenes lists the nine scenes, and a scene that names a font is unavailable until one is declared', async () => {
        const server = await loadServer();
        const without = (await server.request('/scenes')).json as { scenes: Array<{ id: string; name: string; description: string; available: boolean }> };
        expect(without.scenes.map((s) => s.id)).toEqual(
            ['shapes', 'variables', 'text', 'aurora', 'pulse-ring', 'prism', 'dynamic-node', 'view-3d', 'audio'],
        );
        expect(Object.keys(without.scenes[0]).sort()).toEqual(['available', 'description', 'id', 'name']);
        expect(without.scenes.filter((s) => !s.available).map((s) => s.id)).toEqual(['text']);
        expect((await server.request('/scenes')).json).toMatchObject({ viewport: { width: 1280, height: 720 }, fps: 60 });

        hoisted.fonts.push({ family: 'Inter', file: '/fonts/Inter.ttf' });
        const withFont = (await (await loadServer()).request('/scenes')).json as typeof without;
        expect(withFont.scenes.every((s) => s.available)).toBe(true);
    });

    it('GET /scene returns the scene\'s document, and 404 for one that is not in the catalog', async () => {
        const server = await loadServer();
        const found = await server.request('/scene?scene=shapes');
        expect(found.status).toBe(200);
        expect(found.json).toMatchObject({ kind: 'composition' });
        expect(Array.isArray(found.json.nodes)).toBe(true);

        const missing = await server.request('/scene?scene=nope');
        expect(missing.status).toBe(404);
        expect(missing.json).toEqual({ error: 'No scene "nope".' });
        expect((await server.request('/scene')).json).toEqual({ error: 'No scene "".' });
    });

    it('answers a path it does not serve with 404 and the routes it does', async () => {
        const server = await loadServer();
        const response = await server.request('/nowhere');
        expect(response.status).toBe(404);
        expect(response.json.error).toBe('No route /nowhere');
        expect(response.json.routes).toEqual([
            '/', '/health', '/scenes', '/scene?scene=<id>', '/image?scene=<id>&at=last', '/video?scene=<id>',
        ]);
    });
});

describe('GET /image', () => {
    it('renders the last frame as a PNG by default, and labels the bytes with the frame it drew', async () => {
        const server = await loadServer();

        const response = await server.request('/image?scene=shapes');

        expect(hoisted.renderImage).toHaveBeenCalledTimes(1);
        expect(hoisted.renderImage).toHaveBeenCalledWith({
            scene: 'shapes',
            at: 'last',
            scale: undefined,
            format: 'png',
            signal: expect.any(AbortSignal),
        });
        expect(response.status).toBe(200);
        expect(response.headers).toMatchObject({
            'content-type': 'image/png',
            'content-length': PNG.byteLength,
            'cache-control': 'no-store',
            'x-frame-index': '3',
            'x-frame-time': '0.050',
        });
        expect([...response.body]).toEqual([...PNG]);
    });

    it.each([
        ['', 'last'],
        ['at=first', 'first'],
        ['at=last', 'last'],
        ['at=12', 12],
        ['at=1s', 60],
        ['at=2.5s', 150],
        ['at=', 'last'],
    ])('reads %s as the frame %s, with the project\'s 60 frames a second', async (query, frame) => {
        const server = await loadServer();
        await server.request(`/image?scene=shapes&${query}`);
        expect(hoisted.renderImage.mock.calls[0][0].at).toBe(frame);
    });

    it('reads scale as a number, and an empty one as none', async () => {
        const server = await loadServer();
        await server.request('/image?scale=0.5');
        await server.request('/image?scale=');
        await server.request('/image');
        expect(hoisted.renderImage.mock.calls.map(([request]) => request.scale)).toEqual([0.5, undefined, undefined]);
        expect(hoisted.renderImage.mock.calls[0][0].scene).toBeUndefined();
    });

    it.each([
        ['jpg', 'image/jpeg', 'jpeg'],
        ['jpeg', 'image/jpeg', 'jpeg'],
        ['png', 'image/png', 'png'],
    ])('answers format=%s with %s and renders %s', async (query, mimeType, format) => {
        const server = await loadServer();
        const response = await server.request(`/image?format=${query}`);
        expect(response.headers['content-type']).toBe(mimeType);
        expect(hoisted.renderImage.mock.calls[0][0].format).toBe(format);
    });

    it.each([
        ['at=soon', /^Invalid frame selector: "soon"/],
        ['at=-1', /^Invalid frame selector: "-1"/],
        ['scale=big', /^Not a number: big$/],
        ['format=gif', /^Unsupported image format: gif/],
    ])('refuses %s with 400 before it spends a render', async (query, message) => {
        const server = await loadServer();

        const response = await server.request(`/image?${query}`);

        expect(response.status).toBe(400);
        expect(response.json.error).toMatch(message);
        expect(hoisted.renderImage).not.toHaveBeenCalled();
    });

    it('stops the render\'s signal when the request is aborted', async () => {
        let signal!: AbortSignal;
        let release!: () => void;
        hoisted.renderImage.mockImplementation((request: { signal: AbortSignal }) => {
            signal = request.signal;
            return new Promise((resolve) => {
                release = () => resolve({ bytes: PNG, frame: 0, time: 0, totalFrames: 1 });
            });
        });
        const server = await loadServer();

        const pending = server.request('/image');
        await vi.waitFor(() => expect(signal).toBeDefined());
        expect(signal.aborted).toBe(false);
        server.lastRequest().emit('aborted');
        expect(signal.aborted).toBe(true);
        release();
        await pending;
    });
});

describe('GET /video', () => {
    it('renders the scene as an MP4, named after it, and logs how long it took', async () => {
        const server = await loadServer();

        const response = await server.request('/video?scene=shapes&scale=0.5');

        expect(hoisted.renderVideo).toHaveBeenCalledWith({ scene: 'shapes', scale: 0.5, signal: expect.any(AbortSignal) });
        expect(response.status).toBe(200);
        expect(response.headers).toMatchObject({
            'content-type': 'video/mp4',
            'content-length': 8,
            'cache-control': 'no-store',
            'content-disposition': 'inline; filename="shapes.mp4"',
        });
        expect(response.body.subarray(4, 8).toString('latin1')).toBe('ftyp');
        expect(logs.some((line) => line === '[engine] rendering video (scene=shapes)…')).toBe(true);
        expect(logs.some((line) => /^\[engine\] done in \d+\.\ds — 0\.00 MB$/.test(line))).toBe(true);
    });

    it('names the file "project" and says "all" in its log when no scene is asked for', async () => {
        const server = await loadServer();

        const response = await server.request('/video');

        expect(response.headers['content-disposition']).toBe('inline; filename="project.mp4"');
        expect(logs).toContain('[engine] rendering video (scene=all)…');
        expect(hoisted.renderVideo.mock.calls[0][0].scene).toBeUndefined();
    });

    it('refuses a scale that is not a number with 400 before it renders', async () => {
        const server = await loadServer();
        const response = await server.request('/video?scale=big');
        expect(response.status).toBe(400);
        expect(response.json).toEqual({ error: 'Not a number: big' });
        expect(hoisted.renderVideo).not.toHaveBeenCalled();
    });
});

describe('a request that fails', () => {
    it('answers with the status an HttpError carries', async () => {
        const server = await loadServer();
        hoisted.renderImage.mockRejectedValue(new server.HttpError(409, 'That scene names a font.'));

        const response = await server.request('/image?scene=text');

        expect(response.status).toBe(409);
        expect(response.headers['content-type']).toBe('application/json; charset=utf-8');
        expect(response.json).toEqual({ error: 'That scene names a font.' });
        expect(response.headers['access-control-allow-origin']).toBe('*');
        expect(errors).toEqual([]);
    });

    it('answers an INVALID_OPTION from the engine with 400', async () => {
        const server = await loadServer();
        hoisted.renderVideo.mockRejectedValue(new server.EngineError('INVALID_OPTION', 'Invalid scale: 0.'));

        const response = await server.request('/video');

        expect(response.status).toBe(400);
        expect(response.json).toEqual({ error: 'Invalid scale: 0.' });
        expect(errors).toEqual([]);
    });

    it.each([
        ['START_FAILED'],
        ['BRIDGE_TIMEOUT'],
        ['PROJECT_NOT_FOUND'],
        ['CLOSED'],
    ] as const)('answers every other engine code, such as %s, with 500, and logs it', async (code) => {
        const server = await loadServer();
        const failure = new server.EngineError(code, `engine says ${code}`);
        hoisted.renderImage.mockRejectedValue(failure);

        const response = await server.request('/image?scene=shapes');

        expect(response.status).toBe(500);
        expect(response.json).toEqual({ error: `engine says ${code}` });
        expect(errors).toEqual([['[engine] GET /image?scene=shapes failed:', failure]]);
    });

    it('answers anything else with 500, with its message as the body, and logs it', async () => {
        const server = await loadServer();
        const failure = new Error('page.evaluate: Invalid project document');
        hoisted.renderImage.mockRejectedValue(failure);

        const response = await server.request('/image');

        expect(response.status).toBe(500);
        expect(response.json).toEqual({ error: 'page.evaluate: Invalid project document' });
        expect(errors).toEqual([['[engine] GET /image failed:', failure]]);
    });

    it('answers a thrown string with 500 too', async () => {
        const server = await loadServer();
        hoisted.renderVideo.mockRejectedValue('plain string');
        const response = await server.request('/video');
        expect(response.status).toBe(500);
        expect(response.json).toEqual({ error: 'plain string' });
    });

    it('destroys the connection instead of writing an error once the headers are out', async () => {
        const server = await loadServer();

        const response = await server.request('/image', {
            setup: (res) => { res.endThrows = new Error('socket closed'); },
        });

        expect(response.status).toBe(200);
        expect(response.destroyed).toBe(true);
        expect(response.text).toBe('');
        expect(errors).toHaveLength(1);
        expect(errors[0][0]).toBe('[engine] GET /image failed:');
    });

    it.todo('answers a document naming an unregistered node type with 4xx rather than 500');
});
