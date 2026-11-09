import type { BlendMode } from '../blend';
import type { FillData } from '../registry';
import {
    lerpUniformRecord,
    normalizeUniforms,
    uniformRecordsEqual,
    type ShaderUniform,
    type ShaderUniformRecord,
} from '../../shaders/uniforms';
import { shaderContractOf, type ShaderLanguage } from '../../shaders/language';

/**
 * Ceiling on bound textures: a fill wanting more than a handful is really a 3D
 * scene, and the cap keeps a typo in a generated list from exhausting texture units.
 */
const MAX_TEXTURES = 4;

/** An image the shader samples. */
export interface ShaderTexture {
    /** The name the shader pack gives this texture. */
    name: string;
    /** Asset path, resolved like any other image fill's `src`. */
    src: string;
}

/**
 * A custom WGSL shader, painted as a fill.
 *
 * The source defines `fn fill(in: FillIn) -> vec4f`, returning **premultiplied**
 * rgba; `in` carries `uv` (0–1 across the box), `local` (px from the box's
 * top-left), `size`, `time` and `scale` (device px per px), and the uniforms are
 * `u`, a `struct Params` the source declares. The first of `textures` is what
 * `sample_texture(uv)` reads.
 *
 * The escape hatch at the end of the procedural spectrum: where
 * {@link NoiseFillProp} and {@link FractalNoiseFillProp} expose a fixed set of
 * knobs over a fixed field, this hands the whole fragment function to the author.
 * It is still a fill, so it paints inside the shape's own path — an `Ellipse`, a
 * `Path`, a run of `Text` — stacks as one layer in the fill array, and inherits
 * the layer's `opacity`/`blend`/`space` like every other kind.
 *
 *   Rect({ fill: Fills.shader(src, { uniforms: { amount: 0.4 } }) })
 *   Text({ text: "DEPTH", fontSize: 320, fill: Fills.shader(src) })
 *
 * It must *not* fold `opacity` in: the fill layer's opacity is already applied
 * to the output, so a shader applying it again renders at the square of what
 * was asked for.
 *
 * `source` is the compile-cache key, so it **snaps** at a tween's midpoint rather
 * than interpolating — tweening it would compile a program per frame. Keep the
 * source constant (hoist it to module scope) and put everything that changes in a
 * uniform, which costs nothing: uniform values are an in-place write.
 */
export interface ShaderFillProp {
    type: 'shader';
    /** The program. Hoist it; don't rebuild it per frame. */
    source: string;
    /** The language `source` is written in; WGSL when absent. */
    language?: ShaderLanguage;
    /** WGSL only: the contract version it is written against (`WGSL_CONTRACT` when absent). */
    contract?: number;
    /**
     * The shader pack this was built from, when it was built from one.
     *
     * **Reserved, and carried rather than read.** A pack resolves to a plain
     * uniform record before it reaches here, so nothing in the render path needs
     * it — the frame is identical with or without it. What it exists for is the
     * trip back: a document stores resolved uniforms, and without a reference to
     * the pack a host reopening a saved scene has a set of numbers and no way to
     * know which of them were `twist` and `ink`, so the property panel it drew
     * when the shader was applied cannot be drawn again.
     *
     * An id naming a pack that is not registered is **not** an error: the shader
     * still renders, because the uniforms it needs are already in the document.
     * The host simply cannot offer the panel.
     */
    shaderId?: string;
    /**
     * Uniform values keyed by their declared name. The positional
     * `[{name, value}]` array is accepted too, so a shader can move between an
     * effect and a fill unchanged.
     */
    uniforms?: ShaderUniformRecord | readonly ShaderUniform[];
    /** Images the shader samples. */
    textures?: readonly ShaderTexture[];
    opacity?: number;
    blend?: BlendMode;
}

export interface ShaderFillResolved {
    type: 'shader';
    source: string;
    language: ShaderLanguage;
    /** WGSL only. See {@link ShaderFillProp.contract}. */
    contract?: number;
    /** See {@link ShaderFillProp.shaderId}. */
    shaderId?: string;
    uniforms: ShaderUniformRecord;
    textures?: ShaderTexture[];
    opacity?: number;
    blend?: BlendMode;
}

/** Copy the texture list, dropping malformed entries and capping the length. */
function resolveTextures(textures: readonly ShaderTexture[] | undefined): ShaderTexture[] | undefined {
    if (!textures?.length) return undefined;
    const out: ShaderTexture[] = [];
    for (const texture of textures) {
        if (!texture?.name || !texture?.src) continue;
        if (out.length >= MAX_TEXTURES) {
            console.warn(`[shader] A shader fill declares more than ${MAX_TEXTURES} textures; the rest are ignored.`);
            break;
        }
        out.push({ name: texture.name, src: texture.src });
    }
    return out.length ? out : undefined;
}

function withContract(shader: { language?: string; contract?: number }): { contract?: number } {
    const contract = shaderContractOf(shader);
    return contract === undefined ? {} : { contract };
}

function texturesEqual(a: ShaderTexture[] | undefined, b: ShaderTexture[] | undefined): boolean {
    if (a === b) return true;
    if (!a || !b || a.length !== b.length) return false;
    return a.every((t, i) => t.name === b[i].name && t.src === b[i].src);
}

export const shaderFill: FillData<ShaderFillResolved> = {
    resolve: (prop: ShaderFillProp) => ({
        type: 'shader',
        source: prop.source ?? '',
        // A stored document may still say "sksl"; carried so the renderer can report it.
        language: prop.language ?? 'wgsl',
        ...withContract(prop),
        // Carried, never read: see `ShaderFillProp.shaderId`. Omitted when absent
        // so `equals` compares like with like for a fill that never had one.
        ...(prop.shaderId !== undefined ? { shaderId: prop.shaderId } : {}),
        // Normalised (and key-sorted) here rather than at paint time so `equals`
        // and any structural diff see the same canonical record the renderer
        // binds, whichever authoring shape it came in as.
        uniforms: normalizeUniforms(prop.uniforms),
        textures: resolveTextures(prop.textures),
        opacity: prop.opacity,
        blend: prop.blend,
    }),

    // `source` and `textures` snap; only the uniform values and `opacity`
    // interpolate. The source is the compile-cache key, so there is nothing
    // halfway between two programs to cross to — the same reason an image
    // fill's `src` and a 3D fill's scene snap.
    //
    // Deliberately returns neither `type` nor `blend`: `FillResult` omits both and
    // `lerpFill` reassembles via `{ ...a, ...lerp(...) }`, which is also what makes
    // the ragged-array self-pair (a fill fading against a copy of itself, when two
    // fill arrays differ in length) work.
    lerp: (a, b, t) => ({
        source: t < 0.5 ? a.source : b.source,
        language: t < 0.5 ? a.language : b.language,
        ...withContract(t < 0.5 ? a : b),
        uniforms: lerpUniformRecord(a.uniforms, b.uniforms, t),
        textures: t < 0.5 ? a.textures : b.textures,
        opacity: (a.opacity ?? 1) + ((b.opacity ?? 1) - (a.opacity ?? 1)) * t,
    }),

    equals: (a, b) =>
        a.source === b.source &&
        a.contract === b.contract &&
        uniformRecordsEqual(a.uniforms, b.uniforms) &&
        texturesEqual(a.textures, b.textures),

    // Runs off the same descriptors the renderer binds, so what gets loaded can't
    // drift from what gets sampled.
    declare: (fill, assets) => {
        for (const texture of fill.textures ?? []) assets.image(texture.src);
    },
};
