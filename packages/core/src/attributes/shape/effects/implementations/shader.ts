import { BlendModes, type BlendMode } from "../../fill/blend";
import type { ModedEffect, EffectData } from "../effect-data";
import {
    lerpUniformRecord,
    normalizeUniforms,
    uniformRecordsEqual,
    type ShaderUniform,
    type ShaderUniformRecord,
} from "../../shaders/uniforms";
import { shaderContractOf, type ShaderLanguage } from "../../shaders/language";
import { defineEffect, effectDataOf, param, type EffectFields } from "../spec";

/**
 * A custom shader, classified by the shared {@link EffectMode}:
 *
 * - `'backdrop'`: `sample_src` reads a snapshot of the canvas content beneath
 *   the node. For magnification, distortion, ripple. The result replaces the
 *   backdrop within the node's silhouette clip.
 *
 * - `'foreground'` (the default): `sample_src` reads the node's own layer, and
 *   the output replaces it, or composites onto it with {@link blendMode}.
 *
 * Named for the paint it is the sibling of: this is the same act as a `shader`
 * **fill**, on a layer instead of inside a path.
 */
export interface ShaderEffect extends ModedEffect {
    type: "shader";
    /**
     * The program. In WGSL it defines `fn effect(in: EffectIn) -> vec4f`
     * (premultiplied), reads its input with `sample_src(uv)` /
     * `sample_src_px(px)` — the node's layer, or in `'backdrop'` mode what lies
     * beneath it — and its uniforms as `u`, the `struct Params` it declares.
     */
    source: string;
    /** The language `source` is written in; WGSL when absent. */
    language?: ShaderLanguage;
    /** WGSL only: the contract version it is written against; `resolve` stamps `WGSL_CONTRACT` when absent. */
    contract?: number;
    /**
     * How far past the node's box (logical px) a WGSL effect may draw — a glow,
     * a ripple that spills. The layer it runs over grows by it. Default 0.
     */
    reach?: number;
    /**
     * Uniform values, by name. Values lerp component-wise.
     *
     * The positional `[{ name, value }]` array older documents carry is still
     * accepted and normalised on the way in; both are bound by name.
     */
    uniforms: ShaderUniformRecord | ShaderUniform[];
    /**
     * The shader pack this was built from, when it was built from one.
     *
     * **Reserved, and carried rather than read.** A pack resolves to a plain
     * uniform record before it reaches here, so nothing in the render path needs
     * this — the frame is identical with or without it. What it exists for is the
     * trip back: a document stores resolved uniforms, and without a reference to
     * the pack a host reopening a saved scene has a set of numbers and no way to
     * know which of them were `twist` and `ink`, so the property panel it drew
     * when the shader was applied cannot be drawn again.
     *
     * An id naming a pack that is not registered is **not** an error: the shader
     * still renders, because the uniforms it needs are already in the document.
     * The host simply cannot offer the panel, which is the honest degradation —
     * refusing to render a scene because an editor cannot edit it would be the
     * wrong way round.
     */
    shaderId?: string;
    /**
     * Blend mode used when `mode` is `'foreground'`; the output replaces the
     * layer when absent. Ignored for `'backdrop'`.
     */
    blendMode?: BlendMode;
}

// The hand-written interface and the spec describe the same fields.
type ShaderFields = Omit<ShaderEffect, "type" | keyof ModedEffect>;
type SpecFields = EffectFields<typeof shaderSpec.params>;
const _specAgrees: [ShaderFields extends SpecFields ? true : false, SpecFields extends ShaderFields ? true : false] = [true, true];

/**
 * The {@link ShaderEffect} spec. Its fields are described for a host; its
 * interpolation, equality and surface stay hand-written, since they are about a
 * program and its uniform record rather than a set of parameters.
 */
export const shaderSpec = defineEffect({
    type: "shader",
    group: "stylize",
    // An arbitrary user shader: neutrality is the author's to define.
    neutral: null,
    params: {
        source: param.text({ required: true, hidden: true }),
        language: {
            ...param.choice(["wgsl"] satisfies ShaderLanguage[], { optional: true, hidden: true }),
            // "sksl" is the retired value documents from before WGSL carry: it draws nothing and is reported.
            options: ["wgsl", "sksl"],
        },
        reach: param.number({ optional: true, min: 0, unit: "px", hidden: true }),
        uniforms: param.of<ShaderUniformRecord | ShaderUniform[]>()({ kind: "uniforms", default: {}, hidden: true }),
        shaderId: param.text({ optional: true, hidden: true }),
        blendMode: param.choice(BlendModes, { optional: true, optionsLabel: "blendMode" }),
    },
    // Returns the effect untouched when it already states its contract, which
    // is what keeps `resolveChainEffects` from copying an array per write.
    resolve: (effect: ShaderEffect) => {
        const contract = effect.contract ?? shaderContractOf(effect);
        return contract === effect.contract ? effect : { ...effect, contract };
    },
    // The program and what it is blended with snap at the midpoint, as the
    // `shader` fill's source does: the source is the compile-cache key, so there
    // is no program halfway between two. Only the uniform values interpolate
    // (over the union of names), which keeps a same-program tween smooth.
    lerp: (from: ShaderEffect, to: ShaderEffect, t: number): ShaderEffect => {
        const near = t < 0.5 ? from : to;
        return {
            type: "shader",
            source: near.source,
            ...(near.language !== undefined ? { language: near.language } : {}),
            ...(near.contract !== undefined ? { contract: near.contract } : {}),
            ...(from.reach !== undefined || to.reach !== undefined
                ? { reach: (from.reach ?? 0) + ((to.reach ?? 0) - (from.reach ?? 0)) * t }
                : {}),
            ...(near.shaderId !== undefined ? { shaderId: near.shaderId } : {}),
            mode: near.mode,
            blendMode: near.blendMode,
            uniforms: lerpUniformRecord(
                normalizeUniforms(from.uniforms),
                normalizeUniforms(to.uniforms),
                t,
            ),
        };
    },
    equals: (a: ShaderEffect, b: ShaderEffect) =>
        a.source === b.source &&
        a.language === b.language &&
        a.contract === b.contract &&
        (a.reach ?? 0) === (b.reach ?? 0) &&
        a.mode === b.mode &&
        a.blendMode === b.blendMode &&
        uniformRecordsEqual(normalizeUniforms(a.uniforms), normalizeUniforms(b.uniforms)),
    // A backdrop shader resamples what is beneath the node, so it needs a redraw scope.
    surface: (effect: ShaderEffect) => (effect.mode === "backdrop" ? "shader" : "filter"),
});

export const shaderEffect = effectDataOf(shaderSpec) as unknown as EffectData<ShaderEffect>;
