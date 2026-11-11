import { NodeEffect } from "./union";
import type { BlendMode } from "../fill/blend";
import type { EffectOptions } from "./effect-data";
import { scalarOptions, withEffectOptions } from "./effect-data";
import { resolveEffect, lerpEffect } from "./registry";
import { buildEffect, type EffectOptionsOf } from "./spec";
import { blurSpec } from "./implementations/blur";
import { directionalBlurSpec } from "./implementations/directional-blur";
import { grayscaleSpec } from "./implementations/grayscale";
import { pixelateSpec } from "./implementations/pixelate";
import { bulgeSpec } from "./implementations/bulge";
import { magnifySpec } from "./implementations/magnify";
import { bloomSpec } from "./implementations/bloom";
import { vintageSpec } from "./implementations/vintage";
import { chromaticAberrationSpec } from "./implementations/chromatic-aberration";
import { invertSpec } from "./implementations/invert";
import { scatterSpec } from "./implementations/scatter";
import { posterizeSpec } from "./implementations/posterize";
import { motionBlurSpec } from "./implementations/motion-blur";
import { outlineSpec } from "./implementations/outline";
import { dropShadowSpec } from "./implementations/drop-shadow";
import { vignetteSpec } from "./implementations/vignette";
import { lutSpec } from "./implementations/lut";
import { grainSpec } from "./implementations/grain";
import { sharpenSpec } from "./implementations/sharpen";
import { edgesSpec } from "./implementations/edges";
import { thresholdSpec } from "./implementations/threshold";
import { radialBlurSpec } from "./implementations/radial-blur";
import { halftoneSpec } from "./implementations/halftone";
import { ditherSpec } from "./implementations/dither";
import { duotoneSpec } from "./implementations/duotone";
import { curvesSpec } from "./implementations/curves";
import { rgbShiftSpec } from "./implementations/rgb-shift";
import { scanlinesSpec } from "./implementations/scanlines";
import { blockDisplaceSpec } from "./implementations/block-displace";
import { bitCrushSpec } from "./implementations/bit-crush";
import { asciiSpec } from "./implementations/ascii";
import { oilPaintSpec } from "./implementations/oil-paint";
import { streakSpec } from "./implementations/streak";
import { glowSpec } from "./implementations/glow";
import { waveSpec } from "./implementations/wave";
import { twirlSpec } from "./implementations/twirl";
import { progressiveBlurSpec } from "./implementations/progressive-blur";
import { kaleidoscopeSpec } from "./implementations/kaleidoscope";
import { glassSpec } from "./implementations/glass";
import type { AttributeOps } from "@/attributes/shared/operators";
import { normalizeUniforms, type ShaderUniform, type ShaderUniformRecord } from "../shaders/uniforms";
import { resolveShaderProperties, type ShaderPropertyValues } from "../shaders/resolve";
import type { EffectShader } from "../shaders/pack";
import type { ColorAdjustmentEffect } from "./implementations/color-adjustment";

// Shared field vocabulary: `radius` px, `amount` 0-1, `angle` degrees, `center` 0-1 point, `axis` an {@link EffectAxis}.

/** Gaussian blur. Scalar shorthand sets `radius`. */
export type BlurOptions = EffectOptionsOf<typeof blurSpec.params>;

/** Directional (linear) blur. Scalar shorthand sets `radius`. */
export type DirectionalBlurOptions = EffectOptionsOf<typeof directionalBlurSpec.params>;

/** Desaturation. Scalar shorthand sets `amount`. */
export type GrayscaleOptions = EffectOptionsOf<typeof grayscaleSpec.params>;

/** After Effects-style Mosaic. Scalar shorthand sets `blocks`, a block count across the node: a count equal to the node's pixel size is pristine. */
export type PixelateOptions = EffectOptionsOf<typeof pixelateSpec.params>;

/** Bulge / pinch lens over the node's content, or the backdrop. Scalar shorthand sets `strength`. */
export type BulgeOptions = EffectOptionsOf<typeof bulgeSpec.params>;

/** Magnifier lens over the backdrop. Scalar shorthand sets `scale`. */
export type MagnifyOptions = EffectOptionsOf<typeof magnifySpec.params>;

/** Bloom (glow). Scalar shorthand sets `intensity`. */
export type BloomOptions = EffectOptionsOf<typeof bloomSpec.params>;

/** Vintage / film-look colour grading. Scalar shorthand sets `amount`. */
export type VintageOptions = EffectOptionsOf<typeof vintageSpec.params>;

/** Lens-dispersion colour fringing. Scalar shorthand sets `amount`. */
export type ChromaticAberrationOptions = EffectOptionsOf<typeof chromaticAberrationSpec.params>;

/** Colour invert. Scalar shorthand sets `strength`. */
export type InvertOptions = EffectOptionsOf<typeof invertSpec.params>;

/** Per-pixel random jitter. Scalar shorthand sets `strength`. */
export type ScatterOptions = EffectOptionsOf<typeof scatterSpec.params>;

/** Colour banding. Scalar shorthand sets `levels`. */
export type PosterizeOptions = EffectOptionsOf<typeof posterizeSpec.params>;

/** Velocity-driven motion blur. Scalar shorthand sets `length`. */
export type MotionBlurOptions = EffectOptionsOf<typeof motionBlurSpec.params>;

/** A custom shader. `mode` picks the layer `sample_src` reads: `'foreground'` (default) the node's own, or `'backdrop'` what is painted beneath it. */
export interface ShaderEffectOptions extends EffectOptions {
    /** WGSL program, or a registered shader pack. A pack resolves to plain uniforms here; the document keeps the resolved record plus a `shaderId` so a host can reopen its property panel. */
    source: string | EffectShader;
    /** Property overrides by id when {@link source} is a pack; unnamed ones take the pack default. Ignored with a warning for a bare string. */
    values?: ShaderPropertyValues;
    /** Uniform values by name, lerped between frames (default `{}`). The `[{ name, value }]` array form is bound by name too. */
    uniforms?: ShaderUniformRecord | ShaderUniform[];
    /** How a foreground shader composites onto the layer; its output replaces the layer when absent. */
    blendMode?: BlendMode;
    /** How far past the node's box (logical px) a WGSL effect may draw. Default 0. */
    reach?: number;
}

/** Coloured band around the node's silhouette. Scalar shorthand sets `width`. */
export type OutlineOptions = EffectOptionsOf<typeof outlineSpec.params>;

/** Cast from the node's silhouette. Scalar shorthand sets `blur`. */
export type DropShadowOptions = EffectOptionsOf<typeof dropShadowSpec.params>;

/** Darkened edges / lens falloff. Scalar shorthand sets `amount`. */
export type VignetteOptions = EffectOptionsOf<typeof vignetteSpec.params>;

/** 3D colour lookup table; see {@link LutEffect}. No scalar shorthand: the dominant argument is a whole cube. */
export type LutOptions = EffectOptionsOf<typeof lutSpec.params>;

/** Film grain. Scalar shorthand sets `amount`. */
export type GrainOptions = EffectOptionsOf<typeof grainSpec.params>;

/** Unsharp-mask sharpen. Scalar shorthand sets `amount`. */
export type SharpenOptions = EffectOptionsOf<typeof sharpenSpec.params>;

/** Edge detection. Scalar shorthand sets `strength`. */
export type EdgesOptions = EffectOptionsOf<typeof edgesSpec.params>;

/** Two-tone luminance cut. Scalar shorthand sets `level`. */
export type ThresholdOptions = EffectOptionsOf<typeof thresholdSpec.params>;

/** Zoom / spin blur about a point. Scalar shorthand sets `amount`. */
export type RadialBlurOptions = EffectOptionsOf<typeof radialBlurSpec.params>;

/** Halftone print screen. Scalar shorthand sets `size`. */
export type HalftoneOptions = EffectOptionsOf<typeof halftoneSpec.params>;

/** Ordered (Bayer) dithering. Scalar shorthand sets `levels`. */
export type DitherOptions = EffectOptionsOf<typeof ditherSpec.params>;

/** Two-colour luminance ramp. Scalar shorthand sets `amount`. */
export type DuotoneOptions = EffectOptionsOf<typeof duotoneSpec.params>;

/** Tone curve through control points. */
export type CurvesOptions = EffectOptionsOf<typeof curvesSpec.params>;

/** Photographic grading. Every field is optional and defaults to neutral. */
export type ColorAdjustmentOptions = Omit<ColorAdjustmentEffect, 'type'> & EffectOptions;

/** Per-channel RGB offset. Name `red`/`green`/`blue` for full control. */
export type RgbShiftOptions = EffectOptionsOf<typeof rgbShiftSpec.params> & {
    /** Shorthand: ±px horizontal spread of red vs. blue (default 4); `red`/`blue` override it. */
    amount?: number;
};

/** CRT scanlines. Scalar shorthand sets `darkness`. */
export type ScanlinesOptions = EffectOptionsOf<typeof scanlinesSpec.params>;

/** Datamosh-style band tearing. Scalar shorthand sets `amount`. */
export type BlockDisplaceOptions = EffectOptionsOf<typeof blockDisplaceSpec.params>;

/** ASCII art from a glyph grid. Scalar shorthand sets `size`. */
export type AsciiOptions = EffectOptionsOf<typeof asciiSpec.params>;

/** Anamorphic glare — a bright pass smeared along one axis. Scalar shorthand sets `intensity`. */
export type StreakOptions = EffectOptionsOf<typeof streakSpec.params>;

/** Bright (or opaque) areas spread outward and composited back. Scalar shorthand sets `intensity`. Unlike `bloom`, spreads past the node's box and can be coloured through a ramp. */
export type GlowOptions = EffectOptionsOf<typeof glowSpec.params>;

/** Kuwahara brushwork. Scalar shorthand sets `radius`. */
export type OilPaintOptions = EffectOptionsOf<typeof oilPaintSpec.params>;

/** Sine warp. Scalar shorthand sets `amplitude` on the Y axis — the everyday ripple. */
export type WaveOptions = EffectOptionsOf<typeof waveSpec.params>;

/** Twirl / swirl vortex. Scalar shorthand sets `angle`. */
export type TwirlOptions = EffectOptionsOf<typeof twirlSpec.params>;

/** Blur that ramps across the node; `mode: 'backdrop'` gives a frosted panel whose blur fades out. Scalar shorthand sets `radius`. */
export type ProgressiveBlurOptions = EffectOptionsOf<typeof progressiveBlurSpec.params>;

/** Mirrored wedges around a point. Scalar shorthand sets `segments`. */
export type KaleidoscopeOptions = EffectOptionsOf<typeof kaleidoscopeSpec.params>;

/**
 * Figma's Glass over the backdrop. Scalar shorthand sets `refraction`. Defaults are Figma's
 * (light -45 deg at 80, refraction 80, depth 20 px, dispersion 50, frost 4, splay 0) and `mode: 'backdrop'`;
 * the foreground is a no-op.
 */
export type GlassOptions = EffectOptionsOf<typeof glassSpec.params>;

/** Colour-depth reduction. Scalar shorthand sets `bits`. */
export type BitCrushOptions = EffectOptionsOf<typeof bitCrushSpec.params>;

/** Immutable, chainable list of node effects; each builder returns a new chain, so chains can be shared and branched. */
export class EffectChain {
    constructor(public list: NodeEffect[] = []) { }

    private append(effect: NodeEffect): EffectChain {
        return new EffectChain([...this.list, effect]);
    }

    /** `{ mode: "backdrop" }` blurs what is beneath the node (clipped to its silhouette, Figma-style). */
    blur(options: number | BlurOptions) {
        return this.append(buildEffect(blurSpec, options));
    }

    directionalBlur(options: number | DirectionalBlurOptions) {
        return this.append(buildEffect(directionalBlurSpec, options));
    }

    pixelate(options: number | PixelateOptions) {
        return this.append(buildEffect(pixelateSpec, options));
    }

    grayscale(options: number | GrayscaleOptions) {
        return this.append(buildEffect(grayscaleSpec, options));
    }

    /** A negative strength pinches instead of bulging; `mode: "backdrop"` makes a glass dome over the layers below. */
    bulge(options: number | BulgeOptions) {
        return this.append(buildEffect(bulgeSpec, options));
    }

    /** Lens fills the node's box, clipped to its silhouette, scaled about `center`. Defaults to `mode: 'backdrop'`. */
    magnify(options?: number | MagnifyOptions) {
        return this.append(buildEffect(magnifySpec, options));
    }

    bloom(options?: number | BloomOptions) {
        return this.append(buildEffect(bloomSpec, options));
    }

    vintage(options?: number | VintageOptions) {
        return this.append(buildEffect(vintageSpec, options));
    }

    chromaticAberration(options?: number | ChromaticAberrationOptions) {
        return this.append(buildEffect(chromaticAberrationSpec, options));
    }

    invert(options?: number | InvertOptions) {
        return this.append(buildEffect(invertSpec, options));
    }

    scatter(options?: number | ScatterOptions) {
        return this.append(buildEffect(scatterSpec, options));
    }

    posterize(options?: number | PosterizeOptions) {
        return this.append(buildEffect(posterizeSpec, options));
    }

    /** Smears along the node's actual per-frame motion (a static node stays sharp); `length` is the shutter angle, `alignment` the phase. */
    motionBlur(options?: number | MotionBlurOptions) {
        return this.append(buildEffect(motionBlurSpec, options));
    }

    /** Follows alpha silhouettes (text, cutouts, subtrees) that a geometry `stroke` can't. */
    outline(options?: number | OutlineOptions) {
        return this.append(buildEffect(outlineSpec, options));
    }

    /** Follows alpha silhouettes that a geometry `shadow` (which fills the node's path) can't. */
    dropShadow(options?: number | DropShadowOptions) {
        return this.append(buildEffect(dropShadowSpec, options));
    }

    /** Falloff follows the node's aspect ratio, so a wide node darkens along its short edges. */
    vignette(options?: number | VignetteOptions) {
        return this.append(buildEffect(vignetteSpec, options));
    }

    /** `amount` is the mix; everything else is the table. */
    lut(options: LutOptions) {
        return this.append(buildEffect(lutSpec, options));
    }

    /** Static grain reads as texture; pass `{ animated: true }` to re-seed per frame, or tween `seed` to stay deterministic. */
    grain(options?: number | GrainOptions) {
        return this.append(buildEffect(grainSpec, options));
    }

    sharpen(options?: number | SharpenOptions) {
        return this.append(buildEffect(sharpenSpec, options));
    }

    edges(options?: number | EdgesOptions) {
        return this.append(buildEffect(edgesSpec, options));
    }

    threshold(options?: number | ThresholdOptions) {
        return this.append(buildEffect(thresholdSpec, options));
    }

    radialBlur(options?: number | RadialBlurOptions) {
        return this.append(buildEffect(radialBlurSpec, options));
    }

    halftone(options?: number | HalftoneOptions) {
        return this.append(buildEffect(halftoneSpec, options));
    }

    dither(options?: number | DitherOptions) {
        return this.append(buildEffect(ditherSpec, options));
    }

    duotone(options?: number | DuotoneOptions) {
        return this.append(buildEffect(duotoneSpec, options));
    }

    curves(options: CurvesOptions) {
        return this.append(buildEffect(curvesSpec, options));
    }

    /** For darkened edges use {@link EffectChain.vignette}. */
    colorAdjustment(options: ColorAdjustmentOptions) {
        // Destructure `mode` out: `{ mode: undefined }` would plant the key on the effect, and `equals()` compares `mode` directly.
        const { mode, ...fields } = options;
        return this.append(withEffectOptions({ type: "colorAdjustment" as const, ...fields }, { mode }));
    }

    rgbShift(options?: number | RgbShiftOptions) {
        const o = scalarOptions(options, "amount");
        const spread = o.amount;
        return this.append(buildEffect(rgbShiftSpec, spread === undefined ? o : {
            ...o,
            red: o.red ?? { x: spread, y: 0 },
            blue: o.blue ?? { x: -spread, y: 0 },
        }));
    }

    /** Animate `offset` past `spacing` to roll the bands; the pattern wraps, so a linear tween loops. */
    scanlines(options?: number | ScanlinesOptions) {
        return this.append(buildEffect(scanlinesSpec, options));
    }

    /** Step `seed` in whole numbers to jump between glitch states rather than sliding. */
    blockDisplace(options?: number | BlockDisplaceOptions) {
        return this.append(buildEffect(blockDisplaceSpec, options));
    }

    /** Pair with {@link EffectChain.dither} so gradients survive the cut. */
    bitCrush(options?: number | BitCrushOptions) {
        return this.append(buildEffect(bitCrushSpec, options));
    }

    /** `background: 'transparent'` lays the glyphs over whatever is behind the node. */
    ascii(options?: number | AsciiOptions) {
        return this.append(buildEffect(asciiSpec, options));
    }

    /** By some margin the most expensive effect; keep `radius` small. */
    oilPaint(options?: number | OilPaintOptions) {
        return this.append(buildEffect(oilPaintSpec, options));
    }

    streak(options?: number | StreakOptions) {
        return this.append(buildEffect(streakSpec, options));
    }

    glow(options?: number | GlowOptions) {
        return this.append(buildEffect(glowSpec, options));
    }

    shader(options: ShaderEffectOptions) {
        const pack = typeof options.source === "string" ? undefined : options.source;
        if (pack && pack.scope !== "effect") {
            throw new Error(
                `Effects.shader was given a "${(pack as { scope: string }).scope}" shader ` +
                `("${pack.name}"). A fill shader has no backdrop to sample and is bound to a ` +
                `shape's box; use Fills.shader.`,
            );
        }
        // A backdrop pack supplies the default; a caller may still say otherwise.
        const mode = options.mode ?? (pack?.backdrop ? "backdrop" : "foreground");
        const source = pack ? pack.source : (options.source as string);
        const uniforms = pack
            ? { ...resolveShaderProperties(pack, options.values), ...normalizeUniforms(options.uniforms ?? {}) }
            : (options.uniforms ?? {});
        const base = {
            type: "shader" as const,
            source,
            language: "wgsl" as const,
            ...(options.reach ? { reach: options.reach } : {}),
            uniforms,
            ...(pack?.id !== undefined ? { shaderId: pack.id } : {}),
        };
        // blendMode only applies to the foreground overlay; leaving it undefined
        // for a backdrop shader keeps `equals()` comparing like with like.
        const effect: NodeEffect = mode === "foreground" && options.blendMode
            ? { ...base, blendMode: options.blendMode }
            : base;
        return this.append(withEffectOptions(effect, { mode }));
    }

    /** Tween `phase` over 360 to travel the wave; it wraps, so a linear tween loops. */
    wave(options?: number | WaveOptions) {
        return this.append(buildEffect(waveSpec, options));
    }

    twirl(options?: number | TwirlOptions) {
        return this.append(buildEffect(twirlSpec, options));
    }

    progressiveBlur(options?: number | ProgressiveBlurOptions) {
        return this.append(buildEffect(progressiveBlurSpec, options));
    }

    /** Animating `angle` sweeps fresh source through the wedge while the pattern stays locked, unlike rotating the node. */
    kaleidoscope(options?: number | KaleidoscopeOptions) {
        return this.append(buildEffect(kaleidoscopeSpec, options));
    }

    glass(options?: number | GlassOptions) {
        return this.append(buildEffect(glassSpec, options));
    }

    *[Symbol.iterator]() {
        yield* this.list;
    }

    toJSON() {
        return this.list;
    }
}

/** A single effect, a chain, or an array mixing both (chains flatten in place). Resolved effects are `NodeEffect`s, so a read-back `effects` can be assigned straight back. */
export type Effect =
    | NodeEffect
    | EffectChain
    | (NodeEffect | EffectChain)[];

/**
 * An empty {@link EffectChain}: `Effects.blur(8)` *is* `new EffectChain().blur(8)`, so each builder is
 * documented once, on the class. Chains are immutable, so sharing one instance is safe.
 */
export const Effects = new EffectChain();

/** Normalises any {@link Effect} to `NodeEffect[]`, flattening chains and the plain arrays a chain serializes to. */
export function resolveChainEffects(effects: Effect | undefined): NodeEffect[] {
    if (effects === undefined) return [];
    if (effects instanceof EffectChain) return resolveAll(effects.list);
    if (Array.isArray(effects)) {
        const out: NodeEffect[] = [];
        for (const item of effects) {
            if (item instanceof EffectChain) out.push(...resolveAll(item.list));
            else if (Array.isArray(item)) out.push(...resolveChainEffects(item as Effect));
            else out.push(resolveEffect(item));
        }
        return out;
    }
    return [resolveEffect(effects)];
}

/**
 * Returns **the same array** when nothing needed resolving (almost always): this runs on every `effects`
 * write and `lerpEffectArray` short-circuits on `from === to`.
 */
function resolveAll(list: NodeEffect[]): NodeEffect[] {
    let out: NodeEffect[] | undefined;
    for (let i = 0; i < list.length; i++) {
        const resolved = resolveEffect(list[i]);
        if (!out && resolved !== list[i]) out = list.slice(0, i);
        out?.push(resolved);
    }
    return out ?? list;
}

export const effectsOps: AttributeOps<Effect, NodeEffect[]> = {
    resolve: (effects) => resolveChainEffects(effects),
    lerp: (from, to, t) => {
        if (from === to) return from;
        const maxLen = Math.max(from.length, to.length);
        const result: NodeEffect[] = [];
        for (let i = 0; i < maxLen; i++) {
            const a = from[i];
            const b = to[i];
            if (a && b) {
                result.push(lerpEffect(a, b, t));
            } else if (a) {
                result.push(a);
            } else if (b) {
                result.push(b);
            }
        }
        return result;
    },
};
