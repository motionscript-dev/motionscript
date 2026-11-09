import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * What `render.ts` asks of the engine, against a fake one: how the process's one
 * engine is configured, how a scene id becomes a document, and how a request's
 * options reach `renderImage` and `renderVideo`. `createServerEngine` is the
 * only thing replaced; the scene catalog is the real one.
 */
const hoisted = vi.hoisted(() => ({
    engine: { renderImage: vi.fn(), renderVideo: vi.fn() },
    createServerEngine: vi.fn(),
}));

vi.mock('@motionscript/headless', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@motionscript/headless')>()),
    createServerEngine: hoisted.createServerEngine,
}));

// `project.js` imports the shaders app's build, which `pnpm build:lib` does not make,
// and render.ts takes only the frame rate and the viewport from it.
vi.mock('./project.js', async () => ({
    FPS: 60,
    VIEWPORT: { width: 1280, height: 720 },
    THEME: (await import('./scenes/documents.js')).THEME,
}));

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function load() {
    vi.resetModules();
    hoisted.createServerEngine.mockReset().mockReturnValue(hoisted.engine);
    hoisted.engine.renderImage.mockReset().mockResolvedValue({ bytes: new Uint8Array([1]), frame: 30, totalFrames: 90 });
    hoisted.engine.renderVideo.mockReset().mockResolvedValue(new Uint8Array([2]));
    const render = await import('./render.js');
    const { HttpError } = await import('./errors.js');
    const { SCENE_DOCS } = await import('./scenes/documents.js');
    return { ...render, HttpError, SCENE_DOCS };
}

beforeEach(() => {
    vi.restoreAllMocks();
});

describe('the engine', () => {
    it('is built once for the process, and not before it is asked for', async () => {
        const render = await load();
        expect(hoisted.createServerEngine).not.toHaveBeenCalled();

        const first = render.getEngine();
        const second = render.getEngine();

        expect(first).toBe(hoisted.engine);
        expect(second).toBe(first);
        expect(hoisted.createServerEngine).toHaveBeenCalledTimes(1);
    });

    it('is rooted at the app, serves its assets directory, and declares the clip the audio scene plays', async () => {
        const render = await load();
        render.getEngine();

        const [options] = hoisted.createServerEngine.mock.calls[0];
        expect(options.projectRoot).toBe(appRoot);
        expect(options.assetsDir).toBe(path.join(appRoot, 'assets'));
        expect(options.manifest.image).toEqual({});
        expect(options.manifest.video).toEqual({});
        expect(options.manifest.audio).toEqual({
            'audio/chime.wav': {
                src: 'audio/chime.wav',
                duration: 3,
                sizeBytes: fs.statSync(path.join(appRoot, 'assets', 'audio', 'chime.wav')).size,
            },
        });
        // The rasterizer is left to MS_SOFTWARE_RENDER.
        expect(options).not.toHaveProperty('softwareRender');
    });

    it('serves and declares exactly the fonts it found, at weight 400 under `family@400`', async () => {
        const render = await load();
        render.getEngine();

        const [options] = hoisted.createServerEngine.mock.calls[0];
        const urls = render.FONTS.map((font) => `/fonts/${path.basename(font.file)}`);
        expect(Object.keys(options.serve)).toEqual(urls);
        expect(Object.keys(options.manifest.font)).toEqual(render.FONTS.map((font) => `${font.family}@400`));
        for (const [i, font] of render.FONTS.entries()) {
            expect(options.serve[urls[i]]).toBe(font.file);
            expect(options.manifest.font[`${font.family}@400`]).toMatchObject({ fontFamily: font.family, fontWeight: 400, src: urls[i] });
        }
    });
});

describe('a scene id', () => {
    it('renders the first scene that can be rendered when none is named', async () => {
        const render = await load();
        await render.renderImage({});
        expect(hoisted.engine.renderImage.mock.calls[0][0].document).toBe(render.SCENE_DOCS[0].doc);
        expect(render.SCENE_DOCS[0].id).toBe('shapes');
    });

    it('is turned into that scene\'s document', async () => {
        const render = await load();
        await render.renderVideo({ scene: 'variables' });
        const variables = render.SCENE_DOCS.find((scene) => scene.id === 'variables')!;
        expect(hoisted.engine.renderVideo.mock.calls[0][0].document).toBe(variables.doc);
    });

    it('is a 404 listing every scene when it is unknown, and nothing is rendered', async () => {
        const render = await load();

        const failure = await render.renderImage({ scene: 'nope' }).then(() => null, (error: unknown) => error);

        expect(failure).toBeInstanceOf(render.HttpError);
        expect(failure).toMatchObject({ status: 404 });
        expect((failure as Error).message).toBe(
            'No scene "nope". Try one of: shapes, variables, text, aurora, pulse-ring, prism, dynamic-node, view-3d, audio.',
        );
        expect(hoisted.engine.renderImage).not.toHaveBeenCalled();
    });

    it('is a 409 when the scene names a font and none is declared', async (context) => {
        const render = await load();
        if (render.FONTS.length > 0) context.skip('this checkout has a font in assets/fonts, so the text scene is available');

        const failure = await render.renderImage({ scene: 'text' }).then(() => null, (error: unknown) => error);

        expect(failure).toBeInstanceOf(render.HttpError);
        expect(failure).toMatchObject({ status: 409 });
        expect((failure as Error).message).toContain('That scene names a font, and none is declared.');
        expect(hoisted.engine.renderImage).not.toHaveBeenCalled();
    });

    it('is available unless it names a font nobody declared', async () => {
        const render = await load();
        const text = render.SCENE_DOCS.find((scene) => scene.id === 'text')!;
        const shapes = render.SCENE_DOCS.find((scene) => scene.id === 'shapes')!;
        expect(render.isAvailable(shapes)).toBe(true);
        expect(render.isAvailable(text)).toBe(render.FONTS.length > 0);
    });
});

describe('renderImage', () => {
    it('asks for the last frame by default, and sends scale and format on', async () => {
        const render = await load();

        await render.renderImage({ scene: 'shapes' });
        await render.renderImage({ scene: 'shapes', at: 'first', scale: 2, format: 'jpeg' });
        await render.renderImage({ scene: 'shapes', at: 12 });

        expect(hoisted.engine.renderImage.mock.calls.map(([request]) => [request.frame, request.scale, request.format])).toEqual([
            ['last', undefined, undefined],
            ['first', 2, 'jpeg'],
            [12, undefined, undefined],
        ]);
    });

    it('returns what the engine drew, and the time of that frame at the project\'s frame rate', async () => {
        const render = await load();

        const shot = await render.renderImage({ scene: 'shapes' });

        expect(shot).toEqual({ bytes: new Uint8Array([1]), frame: 30, totalFrames: 90, time: 30 / render.FPS });
    });
});

describe('renderVideo', () => {
    it('sends the scene\'s document and the scale, and returns the bytes', async () => {
        const render = await load();

        const bytes = await render.renderVideo({ scene: 'shapes', scale: 0.5 });

        expect(hoisted.engine.renderVideo).toHaveBeenCalledWith({
            document: render.SCENE_DOCS[0].doc,
            scale: 0.5,
        });
        expect(bytes).toEqual(new Uint8Array([2]));
    });

    it('accepts a signal and a progress callback and does nothing with them', async () => {
        const render = await load();
        const onProgress = vi.fn();
        const controller = new AbortController();
        controller.abort();

        await render.renderVideo({ scene: 'shapes', signal: controller.signal, onProgress });

        expect(hoisted.engine.renderVideo).toHaveBeenCalledTimes(1);
        expect(Object.keys(hoisted.engine.renderVideo.mock.calls[0][0]).sort()).toEqual(['document', 'scale']);
        expect(onProgress).not.toHaveBeenCalled();
    });
});
