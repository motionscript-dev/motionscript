/**
 * Screenshot harness — capture the first / mid / last frame of every e2e scene.
 *
 *   tsx scripts/shoot.ts                                # every scene
 *   tsx scripts/shoot.ts --scenes rect-basic,text-basic
 *
 * Renders through `@motionscript/headless`, which drives the browser engine in
 * a page on SwiftShader's WebGPU adapter (headed on Linux, where a headless
 * page reads a WebGPU canvas back empty). Each scene is its document
 * (src/scenes/catalog.ts, plus the WGSL scenes in scripts/wgpu/scenes.ts) as a
 * one-track project (`projectOf`, src/project.ts). For each scene it:
 *   1. captures its last frame to learn the scene's total frame count,
 *   2. resolves first / mid / last to concrete frame indices (see lib/frames.ts),
 *   3. writes each as out/wgpu/<id>.<label>.png.
 *
 * Needs `pnpm build:lib` (which builds the renderer, so Rust).
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createServerEngine } from '@motionscript/headless';
import type { FontSource } from '@motionscript/headless';
import type { AssetManifest, CompositionDocument, FontMeta, ImageMeta, ProjectDocument, VideoMeta } from '@motionscript/core';
import { FRAME_LABELS, resolveFrames } from './lib/frames.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(__dirname, '..');

/** What one scene is rendered from. */
type Target = { document: ProjectDocument };

/** What the render loop needs from the engine. */
interface ShootEngine {
    render(request: { target: Target; at: 'last' | number; scale: number }):
        Promise<{ bytes: Uint8Array; totalFrames: number }>;
    close(): Promise<void>;
}

interface Args {
    scenes?: string[];
    scale: number;
}

function parseArgs(argv: string[]): Args {
    let scenes: string[] | undefined;
    let scale = 1;
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--scenes') scenes = splitScenes(argv[++i]);
        else if (a.startsWith('--scenes=')) scenes = splitScenes(a.slice('--scenes='.length));
        else if (a === '--scale') scale = Number(argv[++i]);
        else if (a.startsWith('--scale=')) scale = Number(a.slice('--scale='.length));
    }
    if (!Number.isFinite(scale) || scale <= 0) throw new Error(`Invalid --scale: ${scale}`);
    return { scenes, scale };
}

function splitScenes(raw: string | undefined): string[] | undefined {
    if (!raw) return undefined;
    const names = raw.split(',').map(s => s.trim()).filter(Boolean);
    return names.length ? names : undefined;
}

interface CatalogEntry {
    id: string;
    name: string;
    section: string;
    description: string;
}

/** Read the auto-generated scene catalog (id ↔ scene-name ↔ section). */
function readCatalog(): CatalogEntry[] {
    const file = path.join(pkgRoot, 'src', 'scenes', 'catalog.json');
    if (!fs.existsSync(file)) {
        throw new Error(`Scene catalog missing at ${file} — run \`pnpm gen\` first.`);
    }
    return JSON.parse(fs.readFileSync(file, 'utf8')) as CatalogEntry[];
}

/**
 * How each scene id resolves to the document the page renders.
 *
 * Built here in Node and sent with the request, so a scene that fails to build fails
 * alone, inside the render loop.
 */
type SceneLoaders = Array<{ id: string; load: () => Promise<{ default: CompositionDocument }> }>;

async function targetsFor(projectRoot: string, extra: SceneLoaders): Promise<(entry: CatalogEntry) => Promise<Target>> {
    const { catalog } = await import(pathToFileURL(path.join(projectRoot, 'src', 'scenes', 'catalog.ts')).href) as {
        catalog: SceneLoaders;
    };
    const { projectOf } = await import(pathToFileURL(path.join(projectRoot, 'src', 'project.ts')).href) as {
        projectOf: (id: string, clip: CompositionDocument) => ProjectDocument;
    };
    const loaders = new Map([...catalog, ...extra].map(entry => [entry.id, entry.load]));
    return async entry => {
        const load = loaders.get(entry.id);
        if (!load) throw new Error(`${entry.id} is not in src/scenes/catalog.ts — run \`pnpm gen\`.`);
        return { document: projectOf(entry.id, (await load()).default) };
    };
}

/** Every asset a scene may reference lives under the project's `public/`. */
function assetsDirFor(projectRoot: string): string | undefined {
    const dir = path.join(projectRoot, 'public');
    return fs.existsSync(dir) ? dir : undefined;
}

/**
 * The families the scenes name, and the files they are shaped from.
 *
 * Node has no system fonts and no fallback face, so an unregistered family
 * shapes to **nothing** and its text simply does not appear — a text scene then
 * captures a flat background, and a flat background diffs clean against any
 * other flat background. That is the one failure a visual suite must not have,
 * and it is why registering these is what makes the Text section prove anything
 * at all rather than a nicety.
 *
 * Registered under the bare family name, which is how `loadFont` does it and
 * what makes `fontWeight` tween-able: the matcher picks the closest face for
 * whatever weight a scene asks for, so a heading at 800 gets a real face rather
 * than nothing.
 *
 * **The upright face only.** `registerFont` aliases a file to a family name and
 * the provider then picks among the faces under that alias without consulting
 * the requested style, so adding `inter-italic.ttf` beside the regular sets
 * *every* Inter scene in oblique. One scene (`richtext-basic`) asks for an
 * italic run and gets an upright one; forty render correctly, which is the right
 * side of that trade until the adapter can register a face's style.
 */
const SCENE_FONTS: Array<{ family: string; file: string; weight?: number }> = [
    { family: 'Inter', file: 'inter/inter-regular.ttf', weight: 400 },
    { family: 'Fira Mono', file: 'fira-mono/fira-mono.ttf', weight: 400 },
];

/**
 * Tracked in this package (each family beside its OFL licence) and read from
 * here: the faces are harness input, like the scenes.
 */
const FONTS_DIR = path.join(pkgRoot, 'fonts');

function sceneFonts(): FontSource[] {
    const missing = SCENE_FONTS.filter(font => !fs.existsSync(path.join(FONTS_DIR, font.file)));
    if (missing.length > 0) {
        throw new Error(
            `Missing scene font(s) ${missing.map(f => f.file).join(', ')} under ${FONTS_DIR} — ` +
            'they are tracked in git, so the checkout is incomplete.',
        );
    }
    return SCENE_FONTS.map(font => ({ family: font.family, path: path.join(FONTS_DIR, font.file), weight: font.weight }));
}

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.svg']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mov', '.m4v']);

/**
 * Manifest entries for every image and video under `public/`.
 *
 * The catalog throws for a `src` it has never heard of, so without these no
 * media scene can render at all. Sizes are left at 0: the adapter learns a
 * source's intrinsic size when it decodes it, and a probe here would be a second
 * answer that could disagree. A video's duration is read from its container,
 * since trims and audio spans default to it.
 */
function mediaManifest(assetsDir: string | undefined): Pick<AssetManifest, 'image' | 'video'> {
    const image: Record<string, ImageMeta> = {};
    const video: Record<string, VideoMeta> = {};
    if (!assetsDir) return { image, video };
    const walk = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const file = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name !== 'fonts') walk(file);
                continue;
            }
            const key = path.relative(assetsDir, file).split(path.sep).join('/');
            const ext = path.extname(entry.name).toLowerCase();
            const sizeBytes = fs.statSync(file).size;
            if (IMAGE_EXTENSIONS.has(ext)) {
                image[key] = { src: `/${key}`, width: 0, height: 0, sizeBytes };
            } else if (VIDEO_EXTENSIONS.has(ext)) {
                video[key] = { src: `/${key}`, width: 0, height: 0, duration: mp4Duration(file), sizeBytes };
            }
        }
    };
    walk(assetsDir);
    return { image, video };
}

/** Seconds, from the ISO-BMFF `mvhd` box; 0 for a container without one. */
function mp4Duration(file: string): number {
    const bytes = fs.readFileSync(file);
    const at = bytes.indexOf('mvhd', 0, 'latin1');
    if (at < 0) return 0;
    const version = bytes.readUInt8(at + 4);
    const timescale = version === 1 ? bytes.readUInt32BE(at + 24) : bytes.readUInt32BE(at + 16);
    const duration = version === 1 ? Number(bytes.readBigUInt64BE(at + 28)) : bytes.readUInt32BE(at + 20);
    return timescale > 0 ? duration / timescale : 0;
}

/**
 * The browser engine, driven in a headless page.
 *
 * Images and video come from the project's own `public/`, and fonts from this
 * package's `fonts/`, over the page's origin, so none of the ffmpeg probing the
 * CPU path needs applies — a browser reads its own media.
 */
function browserEngine(projectRoot: string): ShootEngine {
    // Fonts have to be *declared*, not just present. The catalog throws for a
    // `src` it has never heard of, so an undeclared face is never fetched — and
    // a browser then shapes against a fallback instead of failing, which for
    // these scenes means a blank frame that diffs clean against any other blank
    // frame. That is the one failure a visual suite must not have.
    const fonts = sceneFonts();
    const fontManifest: Record<string, FontMeta> = {};
    const serve: Record<string, string> = {};
    for (const font of fonts) {
        if (!font.path) continue;
        const served = `/fonts/${path.basename(font.path)}`;
        serve[served] = font.path;
        fontManifest[`${font.family}@${font.weight ?? 400}`] = {
            fontFamily: font.family,
            fontWeight: font.weight ?? 400,
            src: served,
            sizeBytes: fs.statSync(font.path).size,
        };
    }

    // A browser fails softly where Node failed loudly: an undeclared font shapes
    // against a fallback rather than rendering nothing, and a blank or
    // wrong-typeface frame diffs clean against any other. So the warnings that
    // mean "this frame is wrong" are collected and raised per scene.
    let softFailures: string[] = [];
    const assetsDir = assetsDirFor(projectRoot);
    rendererWasm();

    const engine = createServerEngine({
        projectRoot,
        // Headless Chromium on Linux reads a SwiftShader WebGPU canvas back empty.
        headed: process.platform === 'linux',
        assetsDir,
        serve,
        onPageMessage({ type, text }) {
            if (/No font manifest entry|not drawn yet|not loaded|Unsupported color format|decode failed|failed to decode|no video track|asset not found/i.test(text)) {
                softFailures.push(text);
                return;
            }
            if (type === 'error') softFailures.push(text);
        },
        manifest: { ...mediaManifest(assetsDir), audio: {}, font: fontManifest },
        // A GPU frame and a SwiftShader frame do not match, and the baseline is SwiftShader's.
        softwareRender: true,
    });
    return {
        async render({ target, at, scale }) {
            softFailures = [];
            const shot = await engine.renderImage({
                document: target.document,
                frame: at,
                scale,
                format: 'png',
            });
            if (softFailures.length > 0) {
                throw new Error(`page reported: ${[...new Set(softFailures)].join(' | ')}`);
            }
            return { bytes: shot.bytes, totalFrames: shot.totalFrames };
        },
        close: () => engine.close(),
    };
}

/** Fails early, with the fix, when the renderer was never built (`pnpm build:lib`, Rust). */
function rendererWasm(): string {
    const file = fileURLToPath(import.meta.resolve('@motionscript/renderer/ms_renderer_bg.wasm'));
    if (!fs.existsSync(file)) {
        throw new Error(`No renderer WASM at ${file}: run "pnpm build:renderer" from the repo root (needs Rust).`);
    }
    return file;
}

async function main(): Promise<void> {
    const { scenes: filter, scale } = parseArgs(process.argv.slice(2));
    const extra = (await import(pathToFileURL(path.join(pkgRoot, 'scripts', 'wgpu', 'scenes.ts')).href) as { wgpuScenes: Array<CatalogEntry & SceneLoaders[number]> }).wgpuScenes;
    const catalog = [...readCatalog(), ...extra];
    const selected = filter
        ? catalog.filter(c => filter.includes(c.id) || filter.includes(c.name))
        : catalog;

    if (selected.length === 0) {
        throw new Error('No scenes selected — check --scenes against src/scenes/catalog.json.');
    }

    const projectRoot = pkgRoot;
    const outDir = path.join(pkgRoot, 'out', 'wgpu');
    fs.mkdirSync(outDir, { recursive: true });

    console.log(
        `Shooting ${selected.length} scene(s) [scale=${scale}]\n` +
        `  project: ${projectRoot}\n  output:  ${path.relative(pkgRoot, outDir)}/`,
    );

    const targetOf = await targetsFor(projectRoot, extra);
    const engine = browserEngine(projectRoot);

    const failures: { id: string; error: string }[] = [];
    const started = Date.now();

    try {
        let done = 0;
        for (const entry of selected) {
            done++;
            try {
                const target = await targetOf(entry);
                // Rendering one scene at a time keeps every capture's frame
                // indices scene-local, so a scene's own length is all that
                // resolves first/mid/last. The first capture (last frame) also
                // tells us the scene's length.
                const lastShot = await engine.render({ target, at: 'last', scale });
                const frames = resolveFrames(lastShot.totalFrames);

                for (const label of FRAME_LABELS) {
                    const shot = label === 'last'
                        ? lastShot
                        : await engine.render({ target, at: frames[label], scale });
                    fs.writeFileSync(path.join(outDir, `${entry.id}.${label}.png`), shot.bytes);
                }
                console.log(
                    `  [${done}/${selected.length}] ${entry.id} ✓ ` +
                    `(${lastShot.totalFrames} frames → 0/${frames.mid}/${frames.last})`,
                );
            } catch (err) {
                const message = err instanceof Error ? err.message.split('\n').filter(Boolean).slice(0, 3).join(' ') : String(err);
                failures.push({ id: entry.id, error: message });
                console.log(`  [${done}/${selected.length}] ${entry.id} ✗ ${message}`);
            }
        }
    } finally {
        await engine.close();
    }

    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    const ok = selected.length - failures.length;
    console.log(`\nDone: ${ok}/${selected.length} scenes captured in ${elapsed}s.`);
    if (failures.length > 0) {
        console.log('\nFailures:');
        for (const f of failures) console.log(`  ${f.id}: ${f.error}`);
        process.exitCode = 1;
    }
}

main().catch(err => {
    console.error(`\nFatal: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
});
