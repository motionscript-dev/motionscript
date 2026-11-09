/**
 * The demo documents, handed to the player as they are.
 *
 * Their vocabulary is the engine's own `Registry` — the builtins plus this
 * project's node types (`src/project.ts`, handed to `createBrowserEngine` in
 * `App.tsx`) — so a document naming `auroraCard` only plays on an engine that
 * has heard of it.
 */
import type { AssetManifest } from '@motionscript/sdk';
import { FONT_FAMILY, SCENE_DOCS, type SceneDoc } from './scenes/documents';

export const DEMOS: SceneDoc[] = SCENE_DOCS;

export const VIEWPORT = { width: 1280, height: 720 };
export const FPS = 60;

// The palette lives with the documents that declare it.
export { THEME } from './scenes/documents';

/**
 * Where the text scene's face is looked for, and the manifest entry describing
 * it. Nothing in the stack falls back to a system font — the browser backend
 * shapes with the typefaces the manifest gave it — so the app checks for the
 * file and disables that scene when it is absent rather than drawing nothing.
 */
export const FONT_URL = `/fonts/${FONT_FAMILY}.ttf`;

/**
 * The clip the audio scene names.
 *
 * Declared, not merely present: `ManifestAssetCatalog` throws for a `src` it has
 * never heard of, so an undeclared clip is never fetched and never plays. The
 * duration is the file's own — 3s of synthesized chime.
 */
export const AUDIO_SRC = 'audio/chime.wav';
const AUDIO_META = { src: AUDIO_SRC, duration: 3, sizeBytes: 264644 };

/**
 * Everything this app's documents may name.
 *
 * One builder rather than a manifest-or-empty pair: the audio clip is always
 * there, and a font-less run that swapped in an empty manifest would take the
 * clip's declaration away with it — leaving the audio scene silent for a reason
 * that has nothing to do with audio.
 */
export function assetManifest(fontBytes: number | null): AssetManifest {
    return {
        image: {},
        video: {},
        audio: { [AUDIO_SRC]: AUDIO_META },
        font: fontBytes === null ? {} : {
            [`${FONT_FAMILY}@400`]: {
                fontFamily: FONT_FAMILY,
                fontWeight: 400,
                src: FONT_URL,
                sizeBytes: fontBytes,
            },
        },
    };
}

/**
 * The font file's size when `public/fonts/<family>.ttf` is really there.
 *
 * It reads the bytes and checks the sfnt magic rather than trusting the status:
 * a dev server answers a missing path with the SPA's `index.html` and a 200, so
 * a `HEAD` check reports every font as present and the scene then renders blank
 * — the exact failure this is meant to prevent.
 */
export async function probeFont(signal?: AbortSignal): Promise<number | null> {
    try {
        const response = await fetch(FONT_URL, { signal });
        if (!response.ok) return null;
        const bytes = await response.arrayBuffer();
        return isSfnt(bytes) ? bytes.byteLength : null;
    } catch {
        return null;
    }
}

/** TrueType/OpenType all start with one of four 4-byte tags. */
function isSfnt(buffer: ArrayBuffer): boolean {
    if (buffer.byteLength < 4) return false;
    const tag = new DataView(buffer).getUint32(0);
    return tag === 0x00010000    // TrueType
        || tag === 0x74727565    // 'true'
        || tag === 0x4f54544f    // 'OTTO' (CFF outlines)
        || tag === 0x74746366;   // 'ttcf' (collection)
}
