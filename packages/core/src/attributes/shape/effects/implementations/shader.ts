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

/** A custom shader, classified by {@link EffectMode}: `'backdrop'` (`sample_src` reads a snapshot beneath the node; the result replaces the backdrop within the silhouette clip) or `'foreground'` (default; `sample_src` reads the node's own layer, and the output replaces it or composites with {@link blendMode}). The effect twin of a `shader` **fill**. */
export interface ShaderEffect extends ModedEffect {
    type: "shader";
    /** The program. WGSL defines `fn effect(in: EffectIn) -> vec4f` (premultiplied), reads input with `sample_src(uv)` / `sample_src_px(px)` (the node's layer, or the backdrop in `'backdrop'` mode), and its uniforms as `u`, the `struct Params` it declares. */
    source: string;
    /** The language `source` is written in; WGSL when absent. */
    language?: ShaderLanguage;
    /** WGSL only: the contract version it is written against; `resolve` stamps `WGSL_CONTRACT` when absent. */
    contract?: number;
    /** How far past the node's box (logical px) a WGSL effect may draw (a glow, a spilling ripple); the layer it runs over grows by it. Default 0. */
    reach?: number;
    /** Uniform values by name, lerped component-wise. The older positional `[{ name, value }]` array is normalised on the way in. */
    uniforms: ShaderUniformRecord | ShaderUniform[];
    /**
     * The shader pack this was built from. **Reserved, carried rather than read**: a pack resolves to plain uniforms
     * first, so the frame is identical with or without it. It exists for the trip back: a host reopening a saved scene
     * needs it to redraw the property panel. An id naming an unregistered pack is **not** an error: the shader still
     * renders, the host just cannot offer the panel.
     */
    shaderId?: string;
    /** Blend mode when `mode` is `'foreground'`; the output replaces the layer when absent. Ignored for `'backdrop'`. */
    blendMode?: BlendMode;
}

// The hand-written interface and the spec describe the same fields.
type ShaderFields = Omit<ShaderEffect, "type" | keyof ModedEffect>;
type SpecFields = EffectFields<typeof shaderSpec.params>;
const _specAgrees: [ShaderFields extends SpecFields ? true : false, SpecFields extends ShaderFields ? true : false] = [true, true];

/** The {@link ShaderEffect} spec; interpolation, equality and surface stay hand-written since they concern a program and its uniform record. */
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
    // The program and blend snap at the midpoint (the source is the compile-cache key); only uniform values interpolate, over the union of names.
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
