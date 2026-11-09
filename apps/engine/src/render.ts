/**
 * The engine, and the two things this app asks it for: a still and a video.
 *
 * One engine for the whole process. It holds a headless browser and a built page
 * bundle, both of which are expensive to start and cheap to reuse, so a second
 * one would buy nothing but a second Chromium.
 *
 * ### Why a browser
 *
 * An in-process rasterizer could not draw `Canvas3D` at
 * all — `upload3DFrame` returned null and warned once — and `loadAudio` threw
 * outright. A server export and a user's preview were different pictures, and
 * nothing said so. Here they are the same code: `createServerEngine` drives the
 * *browser* engine in a page.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServerEngine, type MotionScriptServerEngine } from '@motionscript/headless';
import type { CompositionDocument, FontMeta } from '@motionscript/sdk';
import { HttpError } from './errors.js';
import { FPS } from './project.js';
import { SCENE_DOCS, findSceneDoc, type SceneDoc } from './scenes/documents.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');

export { VIEWPORT, FPS, THEME } from './project.js';

/**
 * The families a scene may name, and the files they are shaped from.
 *
 * Declared, not merely present: `ManifestAssetCatalog` throws for a `src` it has
 * never heard of, so an undeclared face is never fetched — and a browser then
 * shapes against a fallback rather than failing, which is a wrong frame that
 * reports nothing. Anything dropped in `assets/fonts/*.ttf` is registered under
 * its filename's family, e.g. `Inter-Regular.ttf` → `Inter`.
 */
function discoverFonts(): { family: string; file: string }[] {
    const dir = path.join(appRoot, 'assets', 'fonts');
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
        .filter(f => /\.(ttf|otf)$/i.test(f))
        .map(file => ({
            family: file.replace(/\.(ttf|otf)$/i, '').replace(/[-_](regular|book)$/i, ''),
            file: path.join(dir, file),
        }));
}

export const FONTS = discoverFonts();

let engine: MotionScriptServerEngine | null = null;

export function getEngine(): MotionScriptServerEngine {
    if (engine) return engine;

    const serve: Record<string, string> = {};
    const font: Record<string, FontMeta> = {};
    for (const entry of FONTS) {
        const url = `/fonts/${path.basename(entry.file)}`;
        serve[url] = entry.file;
        font[`${entry.family}@400`] = {
            fontFamily: entry.family,
            fontWeight: 400,
            src: url,
            sizeBytes: fs.statSync(entry.file).size,
        };
    }

    // The audio scene's clip, declared as well as served: the catalog throws for
    // a `src` it has never heard of, so an undeclared clip is never fetched and
    // the scene is silent with nothing to say why.
    const audioFile = path.join(appRoot, 'assets', 'audio', 'chime.wav');
    const audio = fs.existsSync(audioFile)
        ? { 'audio/chime.wav': { src: 'audio/chime.wav', duration: 3, sizeBytes: fs.statSync(audioFile).size } }
        : {};

    engine = createServerEngine({
        projectRoot: appRoot,
        assetsDir: path.join(appRoot, 'assets'),
        serve,
        manifest: { image: {}, video: {}, audio, font },
    });
    return engine;
}

/** Whether a scene can render here: a font-naming scene needs a registered face. */
export function isAvailable(scene: SceneDoc): boolean {
    return !scene.requiresFont || FONTS.length > 0;
}

/**
 * The document a request names.
 *
 * Sent as JSON, which is the whole reason the entry carries no project: a
 * document is data and crosses to the page freely, so there is nothing to
 * pre-assemble and nothing to filter back down by name.
 */
function documentFor(id?: string): CompositionDocument {
    const wanted = id ?? SCENE_DOCS.find(isAvailable)?.id;
    if (!wanted) throw new HttpError(409, noFontMessage());
    const found = findSceneDoc(wanted);
    if (!found) throw new HttpError(404, `No scene "${wanted}". Try one of: ${SCENE_DOCS.map(s => s.id).join(', ')}.`);
    if (!isAvailable(found)) throw new HttpError(409, noFontMessage());
    return found.doc;
}

function noFontMessage(): string {
    return (
        'That scene names a font, and none is declared. Drop a .ttf into ' +
        'apps/engine/assets/fonts/ (e.g. Inter.ttf) and restart — a browser would ' +
        'otherwise shape it against a fallback face and quietly render the wrong type.'
    );
}

export interface RenderVideoRequest {
    scene?: string;
    scale?: number;
    signal?: AbortSignal;
    onProgress?: (progress: number) => void;
}

/** Render one scene (or the whole project) to mp4 bytes. */
export async function renderVideo(request: RenderVideoRequest = {}): Promise<Uint8Array> {
    return getEngine().renderVideo({
        document: documentFor(request.scene),
        scale: request.scale,
    });
}

export interface RenderImageRequest {
    scene?: string;
    /** `'first'`, `'last'`, or a frame index. */
    at?: number | 'first' | 'last';
    scale?: number;
    format?: 'png' | 'jpeg';
    signal?: AbortSignal;
}

export async function renderImage(request: RenderImageRequest = {}) {
    const shot = await getEngine().renderImage({
        document: documentFor(request.scene),
        frame: request.at ?? 'last',
        scale: request.scale,
        format: request.format,
    });
    return { ...shot, time: shot.frame / FPS };
}
