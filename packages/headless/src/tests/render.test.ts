import fs from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isEngineError } from '../errors.js';
import { MotionScriptServerEngine } from '../server-engine.js';
import {
    BARE_ENTRY,
    BOOT_TIMEOUT_MS,
    DEFAULT_PROJECT,
    SOURCE_NODE_KEY,
    decodePng,
    isJpeg,
    isPng,
    mp4Seconds,
    pageMessages,
    richEntry,
    scratchProject,
    slidingSquareClip,
    slidingSquareProject,
    solidPng,
    stillOf,
    videoOrSkip,
    type ScratchProject,
} from './headless.fixtures.js';

/**
 * The render paths through a real headless Chromium. One engine is booted for the
 * stills and the video, and a second one without a manifest for the cases a
 * manifest changes, so the suite pays for two launches.
 *
 * Software rasterization throughout: a GPU frame and a SwiftShader frame do not
 * match, and a container has no GPU to ask for.
 */

const RED: [number, number, number, number] = [255, 0, 0, 255];
const GREEN: [number, number, number, number] = [0, 255, 0, 255];
const BLUE: [number, number, number, number] = [0, 0, 255, 255];
const BLACK: [number, number, number, number] = [0, 0, 0, 255];
const MAGENTA: [number, number, number, number] = [255, 0, 255, 255];

/** A rejection, kept as a value so a test can look at what it is. */
async function failureOf(work: Promise<unknown>): Promise<unknown> {
    return work.then(() => undefined, (error: unknown) => error);
}

/** What a failure inside the page looks like to the caller: Playwright's own error, not a coded one. */
function expectPageFailure(failure: unknown, message: RegExp): void {
    expect(failure).toBeInstanceOf(Error);
    expect(isEngineError(failure)).toBe(false);
    expect((failure as Error).message).toMatch(/^page\.evaluate: /);
    expect((failure as Error).message).toMatch(message);
}

const imageDocument = stillOf('#000000', [
    {
        id: 'frame',
        type: 'rect',
        parentId: null,
        layerOrder: 0,
        props: { width: 'fill', height: 'fill', fill: [{ type: 'image', src: 'dot.png', fit: 'fill' }] },
    },
]);

const textDocument = (text: string) => stillOf('#000000', [
    {
        id: 'label',
        type: 'text',
        parentId: null,
        layerOrder: 0,
        props: { text, fontFamily: 'Inter', fontSize: 20, fill: '#ffffff' },
    },
]);

describe('rendering through the page', () => {
    let project: ScratchProject;
    let engine: MotionScriptServerEngine;
    const messages = pageMessages();
    const dot = solidPng(4, 4, MAGENTA);

    beforeAll(async () => {
        project = scratchProject('render');
        project.writeEntry(richEntry());
        project.writeAsset('dot.png', dot);
        engine = new MotionScriptServerEngine({
            projectRoot: project.dir,
            cacheDir: project.cacheDir,
            softwareRender: true,
            onPageMessage: messages.onPageMessage,
            manifest: {
                image: { 'dot.png': { src: '/dot.png', width: 4, height: 4, sizeBytes: dot.length } },
                video: {},
                audio: {},
                font: {},
            },
        });
        await engine.start();
    }, BOOT_TIMEOUT_MS);

    afterAll(async () => {
        await engine?.close();
        project?.remove();
    });

    describe('renderImage', () => {
        it('draws the first and the last frame of a project, and says which and out of how many', async () => {
            const first = await engine.renderImage({ document: slidingSquareProject(), frame: 'first' });
            const last = await engine.renderImage({ document: slidingSquareProject(), frame: 'last' });

            expect([first.frame, first.totalFrames]).toEqual([0, DEFAULT_PROJECT.totalFrames]);
            expect([last.frame, last.totalFrames]).toEqual([DEFAULT_PROJECT.totalFrames - 1, DEFAULT_PROJECT.totalFrames]);

            // A red square centred on a black scene, sliding right: it covers the centre at
            // the start and has left it by the end.
            const start = decodePng(first.bytes);
            const end = decodePng(last.bytes);
            expect([start.width, start.height]).toEqual([32, 24]);
            expect(start.pixel(16, 12)).toEqual(RED);
            expect(start.pixel(28, 12)).toEqual(BLACK);
            expect(end.pixel(16, 12)).toEqual(BLACK);
            expect(end.pixel(26, 12)).toEqual(RED);
        });

        it('asks for the last frame when no frame is named', async () => {
            const named = await engine.renderImage({ document: slidingSquareProject(), frame: 'last' });
            const unnamed = await engine.renderImage({ document: slidingSquareProject() });
            expect(unnamed.frame).toBe(named.frame);
            expect(Buffer.from(unnamed.bytes).equals(Buffer.from(named.bytes))).toBe(true);
        });

        it('draws a frame by its index', async () => {
            const third = await engine.renderImage({ document: slidingSquareProject(), frame: 3 });
            expect(third.frame).toBe(3);
            // Three frames in, the square has moved 3 pixels: it still covers x=21 and no longer x=31.
            const png = decodePng(third.bytes);
            expect(png.pixel(21, 12)).toEqual(RED);
            expect(png.pixel(24, 12)).toEqual(BLACK);
        });

        it('clamps an index past the end to the last frame', async () => {
            const past = await engine.renderImage({ document: slidingSquareProject(), frame: 999 });
            const last = await engine.renderImage({ document: slidingSquareProject(), frame: 'last' });
            expect(past.frame).toBe(DEFAULT_PROJECT.totalFrames - 1);
            expect(Buffer.from(past.bytes).equals(Buffer.from(last.bytes))).toBe(true);
        });

        it('encodes PNG by default and JPEG on request', async () => {
            const png = await engine.renderImage({ document: slidingSquareProject(), frame: 0 });
            const jpeg = await engine.renderImage({ document: slidingSquareProject(), frame: 0, format: 'jpeg' });
            expect(isPng(png.bytes)).toBe(true);
            expect(isJpeg(png.bytes)).toBe(false);
            expect(isJpeg(jpeg.bytes)).toBe(true);
            expect(isPng(jpeg.bytes)).toBe(false);
        });

        it('multiplies the output size by `scale`', async () => {
            const double = decodePng((await engine.renderImage({ document: slidingSquareProject(), frame: 0, scale: 2 })).bytes);
            const half = decodePng((await engine.renderImage({ document: slidingSquareProject(), frame: 0, scale: 0.5 })).bytes);
            expect([double.width, double.height]).toEqual([64, 48]);
            expect([half.width, half.height]).toEqual([16, 12]);
        });

        it('renders the entry\'s default project when the request brings no document', async () => {
            // The default has two tracks: a sliding square, and over it a blue sheet for the first half second.
            const first = await engine.renderImage({ frame: 'first' });
            const last = await engine.renderImage({ frame: 'last' });
            expect(first.totalFrames).toBe(DEFAULT_PROJECT.totalFrames);
            expect(decodePng(first.bytes).pixel(0, 0)).toEqual(BLUE);
            expect(decodePng(last.bytes).pixel(0, 0)).toEqual(BLACK);
            expect(decodePng(last.bytes).pixel(26, 12)).toEqual(RED);
        });

        it('renders a lone clip at the size and frame rate of the entry\'s default project', async () => {
            const still = await engine.renderImage({ document: slidingSquareClip(), frame: 'first' });
            const png = decodePng(still.bytes);
            expect([png.width, png.height]).toEqual([DEFAULT_PROJECT.viewport.width, DEFAULT_PROJECT.viewport.height]);
            expect(still.totalFrames).toBe(DEFAULT_PROJECT.totalFrames);
        });

        it('draws a node type the entry registered from a source string', async () => {
            const document = stillOf('#000000', [
                { id: 'g', type: SOURCE_NODE_KEY, parentId: null, layerOrder: 0, props: {} },
            ]);
            const still = await engine.renderImage({ document });
            expect(decodePng(still.bytes).pixel(16, 12)).toEqual(GREEN);
        });

        it('draws nothing for a node type nothing registered, and the rest of the document as usual', async () => {
            const document = stillOf('#000000', [
                { id: 'z', type: 'neverRegistered', parentId: null, layerOrder: 0, props: { width: 32, height: 24 } },
            ]);
            expect(decodePng((await engine.renderImage({ document })).bytes).pixel(16, 12)).toEqual(BLACK);
        });

        it.todo('rejects a frame, scale or format the page cannot honour as INVALID_OPTION before it reaches the page (nothing validates today)');

        it('renders two stills at once, each from its own session', async () => {
            const [red, blue, green] = await Promise.all([
                engine.renderImage({ document: stillOf('#ff0000') }),
                engine.renderImage({ document: stillOf('#0000ff') }),
                engine.renderImage({
                    document: stillOf('#000000', [
                        { id: 'g', type: SOURCE_NODE_KEY, parentId: null, layerOrder: 0, props: {} },
                    ]),
                }),
            ]);
            expect(decodePng(red.bytes).pixel(2, 2)).toEqual(RED);
            expect(decodePng(blue.bytes).pixel(2, 2)).toEqual(BLUE);
            expect(decodePng(green.bytes).pixel(2, 2)).toEqual(GREEN);
        });

        it('gives the frame a concurrent request asked for, not a neighbour\'s', async () => {
            const [early, late] = await Promise.all([
                engine.renderImage({ document: slidingSquareProject(), frame: 0 }),
                engine.renderImage({ document: slidingSquareProject(), frame: 9 }),
            ]);
            expect([early.frame, late.frame]).toEqual([0, 9]);
            expect(decodePng(early.bytes).pixel(16, 12)).toEqual(RED);
            expect(decodePng(late.bytes).pixel(16, 12)).toEqual(BLACK);
        });
    });

    describe('the manifest', () => {
        it('lets an image the manifest declares and the assets directory serves draw', async () => {
            const still = await engine.renderImage({ document: imageDocument });
            expect(decodePng(still.bytes).pixel(16, 12)).toEqual(MAGENTA);
        });

        it('draws without a font the manifest does not declare, and the page says so', async () => {
            const still = await engine.renderImage({ document: textDocument('Hello') });

            expect(still.bytes.length).toBeGreaterThan(0);
            expect(messages.matching(/Inter/)).not.toHaveLength(0);
        });
    });

    describe('renderVideo', () => {
        // At 160 by 120 (scale 5): a hardware H.264 encoder can have a minimum frame
        // size (NVENC's is about 145 pixels wide), and Chromium hangs on a smaller
        // frame instead of failing. A boot plus SwiftShader can outlast vitest's 5 s default.
        it('returns an MP4 as long as the timeline', { timeout: 30_000 }, async (context) => {
            const bytes = await videoOrSkip(context, engine.renderVideo({ document: slidingSquareProject(), scale: 5 }));
            expect(Buffer.isBuffer(bytes)).toBe(true);
            expect(Buffer.from(bytes).subarray(4, 8).toString('latin1')).toBe('ftyp');
            expect(mp4Seconds(bytes)).toBeCloseTo(DEFAULT_PROJECT.totalFrames / DEFAULT_PROJECT.fps, 1);
        });
    });

    describe('a scale of 0', () => {
        it('is passed to the page unchecked: the engine validates nothing', async () => {
            await failureOf(engine.renderImage({ document: slidingSquareProject(), scale: 0 }));
            expectPageFailure(await failureOf(engine.renderVideo({ document: slidingSquareProject(), scale: 0 })), /./);
        });

        it.todo('is refused as INVALID_OPTION by renderImage and renderVideo (nothing validates today)');
    });
});

describe('an engine whose entry has no default project and no manifest', () => {
    let project: ScratchProject;
    let engine: MotionScriptServerEngine;
    const messages = pageMessages();

    beforeAll(async () => {
        project = scratchProject('bare');
        project.writeEntry(BARE_ENTRY);
        project.writeAsset('dot.png', solidPng(4, 4, MAGENTA));
        engine = new MotionScriptServerEngine({
            projectRoot: project.dir,
            cacheDir: project.cacheDir,
            softwareRender: true,
            onPageMessage: messages.onPageMessage,
        });
        await engine.start();
    }, BOOT_TIMEOUT_MS);

    afterAll(async () => {
        await engine?.close();
        project?.remove();
    });

    it('cannot draw an image although the assets directory serves it, and the page says so', async () => {
        expect(fs.existsSync(`${project.assetsDir}/dot.png`)).toBe(true);
        const still = await engine.renderImage({ document: imageDocument });

        expect(decodePng(still.bytes).pixel(16, 12)).not.toEqual(MAGENTA);
        expect(messages.matching(/dot\.png|image/)).not.toHaveLength(0);
    });

    it('rejects a request that names no document when the entry has no default to fall back on', async () => {
        const noDocument = /This request named no document, and the project entry has no default export to fall back on\./;
        expectPageFailure(await failureOf(engine.renderImage({})), noDocument);
        expectPageFailure(await failureOf(engine.renderVideo({})), noDocument);
    });

    it('carries a frame of more than one base64 chunk across intact', async () => {
        // The entry names no viewport and a lone clip has none, so this renders at the default 1920 by 1080.
        const still = await engine.renderImage({ document: slidingSquareClip(), frame: 0 });

        expect(still.bytes.length).toBeGreaterThan(0x8000);
        const png = decodePng(still.bytes);
        expect([png.width, png.height]).toEqual([1920, 1080]);
        expect(png.pixel(960, 540)).toEqual(RED);
        expect(png.pixel(10, 10)).toEqual(BLACK);
    });

    it('does not know a node type that only the other entry registered, so draws nothing for it', async () => {
        const document = stillOf('#000000', [
            { id: 'g', type: SOURCE_NODE_KEY, parentId: null, layerOrder: 0, props: {} },
        ]);
        expect(decodePng((await engine.renderImage({ document })).bytes).pixel(16, 12)).toEqual(BLACK);
    });
});
