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

/** Ceiling on bound textures: more than a handful is really a 3D scene, and the cap stops a typo in a generated list exhausting texture units. */
const MAX_TEXTURES = 4;

export interface ShaderTexture {
    /** The name the shader pack gives this texture. */
    name: string;
    /** Asset path, resolved like any other image fill's `src`. */
    src: string;
}

/**
 * A custom WGSL shader painted as a fill. The source defines `fn fill(in: FillIn) -> vec4f` returning **premultiplied**
 * rgba; `in` carries `uv` (0-1 across the box), `local` (px from the top-left), `size`, `time` and `scale` (device px
 * per px), and uniforms are `u`, a `struct Params` it declares. The first of `textures` is what `sample_texture(uv)`
 * reads. It must *not* fold `opacity` in: the layer's opacity is already applied, so doing it again squares it.
 *
 * `source` is the compile-cache key, so it **snaps** at a tween's midpoint (tweening it would compile a program per
 * frame): hoist it to module scope and put everything that changes in a uniform, an in-place write.
 *
 *   Rect({ fill: Fills.shader(src, { uniforms: { amount: 0.4 } }) })
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
     * The shader pack this was built from. **Reserved, carried rather than read**: a pack resolves to plain uniforms
     * first, so the frame is identical with or without it. It exists for the trip back: a host reopening a saved scene
     * needs it to redraw the property panel. An id naming an unregistered pack is **not** an error: the shader still
     * renders, the host just cannot offer the panel.
     */
    shaderId?: string;
    /** Uniform values keyed by declared name; the positional `[{name, value}]` array is accepted too so a shader moves between an effect and a fill unchanged. */
    uniforms?: ShaderUniformRecord | readonly ShaderUniform[];
    textures?: readonly ShaderTexture[];
    opacity?: number;
    blend?: BlendMode;
}

export interface ShaderFillResolved {
    type: 'shader';
    source: string;
    language: ShaderLanguage;
    contract?: number;
    shaderId?: string;
    uniforms: ShaderUniformRecord;
    textures?: ShaderTexture[];
    opacity?: number;
    blend?: BlendMode;
}

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
        // Normalised and key-sorted here (not at paint time) so `equals` and structural diffs see the canonical record the renderer binds.
        uniforms: normalizeUniforms(prop.uniforms),
        textures: resolveTextures(prop.textures),
        opacity: prop.opacity,
        blend: prop.blend,
    }),

    // `source` and `textures` snap; only uniform values and `opacity` interpolate (the source is the compile-cache key, so
    // there is nothing halfway between programs). Returns neither `type` nor `blend`: `FillResult` omits both and `lerpFill`
    // reassembles via `{ ...a, ...lerp(...) }`, which also makes the ragged-array self-pair work.
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
