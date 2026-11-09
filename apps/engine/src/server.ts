/**
 * A small HTTP front door for `@motionscript/headless`.
 *
 * The point of this app is to prove the library renders a video **from a
 * server** — you POST/GET a scene id and get mp4 bytes back — so it is
 * deliberately dependency-free above `node:http`: nothing here is a framework
 * choice worth arguing about, and the interesting code is all in `render.ts`.
 *
 *   GET /                                    → a page to drive the two below
 *   GET /health
 *   GET /scenes                              → the demo catalog as JSON
 *   GET /image?scene=shapes&at=last&scale=1  → PNG or JPEG; `at` is a frame
 *                                              index, a time ("1s"), first
 *                                              or last
 *   GET /video?scene=shapes&scale=0.5        → MP4
 */
import http from 'node:http';
import { isEngineError } from '@motionscript/headless';
import { indexPage } from './index-page.js';
import { SCENE_DOCS } from './scenes/documents.js';
import { HttpError } from './errors.js';
import { parseFormatParam, parseFrameParam, parseNumber } from './request.js';
import {
    FONTS,
    FPS,
    VIEWPORT,
    getEngine,
    isAvailable,
    renderImage,
    renderVideo,
} from './render.js';

const PORT = Number(process.env.PORT ?? 5175);
const HOST = process.env.HOST ?? '127.0.0.1';

/**
 * Wide open, because this serves `apps/react` on another port and is a local
 * dev tool. A real deployment names its origins.
 */
function cors(res: http.ServerResponse): void {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
    const payload = JSON.stringify(body, null, 2);
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    res.end(payload);
}

const server = http.createServer((req, res) => {
    void handle(req, res).catch(err => {
        // A caller's mistake answers 4xx — answering 500 would send them
        // looking at the wrong machine.
        const status = err instanceof HttpError
            ? err.status
            : isEngineError(err) && err.code === 'INVALID_OPTION' ? 400 : 500;
        const message = err instanceof Error ? err.message : String(err);
        if (status >= 500) console.error(`[engine] ${req.method} ${req.url} failed:`, err);
        if (!res.headersSent) json(res, status, { error: message });
        else res.destroy();
    });
});

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    cors(res);
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const params = url.searchParams;

    // The request going away mid-render is the normal case for a scrubby UI:
    // the engine checks the signal between frames.
    const abort = new AbortController();
    req.on('aborted', () => abort.abort());

    switch (url.pathname) {
        case '/':
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
            res.end(indexPage(SCENE_DOCS.map(scene => ({ ...scene, available: isAvailable(scene) }))));
            return;

        case '/health':
            return json(res, 200, {
                ok: true,
                started: getEngine().started,
                fonts: FONTS.map(f => f.family),
                viewport: VIEWPORT,
                fps: FPS,
            });

        case '/scenes':
            return json(res, 200, {
                viewport: VIEWPORT,
                fps: FPS,
                scenes: SCENE_DOCS.map(scene => ({
                    id: scene.id,
                    name: scene.name,
                    description: scene.description,
                    // False for a font-naming scene with no font registered:
                    // asking for it answers 409 rather than an empty frame.
                    available: isAvailable(scene),
                })),
            });

        case '/scene': {
            const id = params.get('scene');
            const found = SCENE_DOCS.find(s => s.id === id);
            if (!found) throw new HttpError(404, `No scene "${id ?? ''}".`);
            return json(res, 200, found.doc);
        }

        case '/image': {
            const { format, mimeType } = parseFormatParam(params.get('format'));
            const image = await renderImage({
                scene: params.get('scene') ?? undefined,
                at: parseFrameParam(params.get('at'), FPS),
                scale: parseNumber(params.get('scale')),
                format,
                signal: abort.signal,
            });
            res.writeHead(200, {
                'content-type': mimeType,
                'content-length': image.bytes.byteLength,
                'cache-control': 'no-store',
                'x-frame-index': String(image.frame),
                'x-frame-time': image.time.toFixed(3),
            });
            res.end(Buffer.from(image.bytes));
            return;
        }

        case '/video': {
            const started = Date.now();
            const scene = params.get('scene') ?? undefined;
            console.log(`[engine] rendering video (scene=${scene ?? 'all'})…`);
            const bytes = await renderVideo({
                scene,
                scale: parseNumber(params.get('scale')),
                signal: abort.signal,
            });
            console.log(`[engine] done in ${((Date.now() - started) / 1000).toFixed(1)}s — ${(bytes.byteLength / 1e6).toFixed(2)} MB`);
            res.writeHead(200, {
                'content-type': 'video/mp4',
                'content-length': bytes.byteLength,
                'cache-control': 'no-store',
                'content-disposition': `inline; filename="${scene ?? 'project'}.mp4"`,
            });
            res.end(Buffer.from(bytes));
            return;
        }

        default:
            return json(res, 404, {
                error: `No route ${url.pathname}`,
                routes: ['/', '/health', '/scenes', '/scene?scene=<id>', '/image?scene=<id>&at=last', '/video?scene=<id>'],
            });
    }
}

server.listen(PORT, HOST, () => {
    console.log(`[engine] http://${HOST}:${PORT}`);
    console.log(`[engine] scenes: ${SCENE_DOCS.map(s => s.id).join(', ')}`);
    if (FONTS.length === 0) {
        console.warn(
            '[engine] No fonts declared. The page would shape against a fallback face —\n' +
            '         a wrong typeface rather than a blank frame, which is harder to spot —\n' +
            '         so font-naming scenes are refused. Drop a .ttf into\n' +
            '         apps/engine/assets/fonts/ (e.g. Inter.ttf) and restart.',
        );
    } else {
        console.log(`[engine] fonts: ${FONTS.map(f => f.family).join(', ')}`);
    }
    // Warm the engine now so the first request pays for a render and nothing else.
    void getEngine().start().catch(err => console.error('[engine] failed to start the renderer:', err));
});
