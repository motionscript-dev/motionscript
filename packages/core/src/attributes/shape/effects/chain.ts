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

/**
 * Every effect builder takes **exactly one argument**: an options object
 * carrying all of that effect's data. Builders with one dominant animated
 * scalar also accept that scalar directly, so the common case stays terse:
 *
 *     Effects.blur(8)
 *     Effects.blur({ radius: 8, mode: 'backdrop' })
 *
 * Field names are shared vocabulary across every effect — `radius` is always a
 * pixel distance, `amount` always a 0–1 intensity, `angle` always degrees,
 * `center` always a 0–1 normalised point, `axis` always an {@link EffectAxis}.
 */

/** Gaussian blur. Scalar shorthand sets `radius`. */
export type BlurOptions = EffectOptionsOf<typeof blurSpec.params>;

/** Directional (linear) blur. Scalar shorthand sets `radius`. */
export type DirectionalBlurOptions = EffectOptionsOf<typeof directionalBlurSpec.params>;

/** Desaturation. Scalar shorthand sets `amount`. */
export type GrayscaleOptions = EffectOptionsOf<typeof grayscaleSpec.params>;

/**
 * After Effects-style Mosaic. Scalar shorthand sets `blocks` on both axes.
 *
 * `blocks` is the *number of blocks* across the node, so a count equal to the
 * node's pixel size on that axis is pristine and lower counts are coarser.
 */
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

/**
 * A custom shader. `mode` selects the path:
 *
 * - `'foreground'` (the default) — `sample_src` reads the node's layer; the output
 *   replaces it, or composites onto it with `blendMode`.
 * - `'backdrop'` — `sample_src` reads a snapshot of what is painted beneath the
 *   node. `blendMode` is unused.
 */
export interface ShaderEffectOptions extends EffectOptions {
    /**
     * The WGSL program, or a registered
     * **shader pack** — a program plus the editable values it publishes.
     *
     * A pack resolves to plain uniforms here, so nothing below this builder
     * knows one exists; what survives into the document is the resolved record
     * plus a `shaderId` naming the pack, which is what lets a host reopen its
     * property panel from a saved scene.
     */
    source: string | EffectShader;
    /**
     * Property overrides, by property id, when {@link source} is a pack.
     *
     * Anything not named here takes the pack's own default. Ignored — with a
     * warning — for a bare source string, which has no properties to override.
     */
    values?: ShaderPropertyValues;
    /**
     * Uniform values by name — lerped between animation frames (default `{}`).
     *
     * The positional `[{ name, value }]` array still works; both are bound by
     * name now, so the array's order no longer means anything.
     */
    uniforms?: ShaderUniformRecord | ShaderUniform[];
    /** How a foreground shader composites onto the layer; its output replaces the layer when absent. */
    blendMode?: BlendMode;
    /** How far past the node's box (logical px) a WGSL effect may draw. Default 0. */
    reach?: number;
}

/** Coloured band around the node's silhouette. Scalar shorthand sets `width`. */
export type OutlineOptions = EffectOptionsOf<typeof outlineSpec.params>;

/**
 * A shadow cast from the node's silhouette. Scalar shorthand sets `blur`, since
 * softness is the knob a shadow is usually reached for by.
 */
export type DropShadowOptions = EffectOptionsOf<typeof dropShadowSpec.params>;

/** Darkened edges / lens falloff. Scalar shorthand sets `amount`. */
export type VignetteOptions = EffectOptionsOf<typeof vignetteSpec.params>;

/** Film grain. Scalar shorthand sets `amount`. */
/**
 * A 3D colour lookup table — see {@link LutEffect} for the table's layout and
 * why it is compared by reference.
 *
 * No scalar shorthand: the dominant argument is a whole cube, and a builder that
 * took `Effects.lut(table)` would still need the size beside it to read it.
 */
export type LutOptions = EffectOptionsOf<typeof lutSpec.params>;

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

/**
 * Per-channel RGB offset. Scalar shorthand sets `amount`, which spreads red and
 * blue apart horizontally by that many pixels and leaves green put — the
 * everyday case. Name `red`/`green`/`blue` for full control.
 */
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

/**
 * A glow — bright (or opaque) areas spread outward and composited back, with
 * optional recolouring. Scalar shorthand sets `intensity`.
 *
 * Unlike `bloom`, this spreads past the node's own box, chooses how the source
 * composites against it, and can be coloured through a ramp.
 */
export type GlowOptions = EffectOptionsOf<typeof glowSpec.params>;

/** Kuwahara brushwork. Scalar shorthand sets `radius`. */
export type OilPaintOptions = EffectOptionsOf<typeof oilPaintSpec.params>;

/** Sine warp. Scalar shorthand sets `amplitude` on the Y axis — the everyday ripple. */
export type WaveOptions = EffectOptionsOf<typeof waveSpec.params>;

/** Twirl / swirl vortex. Scalar shorthand sets `angle`. */
export type TwirlOptions = EffectOptionsOf<typeof twirlSpec.params>;

/**
 * Blur that ramps across the node. Scalar shorthand sets `radius`.
 *
 * `mode: 'backdrop'` gives the frosted panel whose blur fades out rather than
 * ending at a hard edge.
 */
export type ProgressiveBlurOptions = EffectOptionsOf<typeof progressiveBlurSpec.params>;

/** Mirrored wedges around a point. Scalar shorthand sets `segments`. */
export type KaleidoscopeOptions = EffectOptionsOf<typeof kaleidoscopeSpec.params>;

/**
 * Figma's Glass over the backdrop. Scalar shorthand sets `refraction`.
 *
 * Figma's fields, units and defaults (light `-45°` at 80, refraction 80, depth
 * 20 px, dispersion 50, frost 4, splay 0), so a bare `Effects.glass()` is the
 * glass Figma adds and values copied from a Figma file render the same.
 *
 * Defaults to `{ mode: 'backdrop' }`; there is nothing to refract in a node's
 * own paint, so the foreground is a no-op.
 */
export type GlassOptions = EffectOptionsOf<typeof glassSpec.params>;

/** Colour-depth reduction. Scalar shorthand sets `bits`. */
export type BitCrushOptions = EffectOptionsOf<typeof bitCrushSpec.params>;

/**
 * Immutable, chainable list of node effects.
 *
 * Each builder method returns a new `EffectChain` with the effect appended,
 * so chains are safe to share and branch.
 *
 * @example
 * const fx = Effects.blur(4).grayscale(0.5);
 * node.effects = fx; // assign directly
 * node.effects = [...fx, { type: 'pixelate', ... }]; // spread into array
 */
export class EffectChain {
    constructor(public list: NodeEffect[] = []) { }

    private append(effect: NodeEffect): EffectChain {
        return new EffectChain([...this.list, effect]);
    }

    /**
     * Append a Gaussian blur. Pass `{ mode: "backdrop" }` to blur the content
     * beneath the node (clipped to its silhouette, Figma-style) instead of the
     * node's own content.
     */
    blur(options: number | BlurOptions) {
        return this.append(buildEffect(blurSpec, options));
    }

    /**
     * Append a motion-blur-style directional (linear) blur, smearing the node's
     * own content along a single axis (or the backdrop, with `{ mode: "backdrop" }`).
     */
    directionalBlur(options: number | DirectionalBlurOptions) {
        return this.append(buildEffect(directionalBlurSpec, options));
    }

    /**
     * Append an After Effects-style Mosaic / pixelate. `blocks` is the *number of
     * blocks* across the node (a count equal to the node's pixel size on that
     * axis is pristine; lower is coarser), not a pixel block size.
     */
    pixelate(options: number | PixelateOptions) {
        return this.append(buildEffect(pixelateSpec, options));
    }

    /** Append a grayscale effect. `{ mode: "backdrop" }` desaturates the backdrop. */
    grayscale(options: number | GrayscaleOptions) {
        return this.append(buildEffect(grayscaleSpec, options));
    }

    /**
     * Append a bulge/pinch lens. A barrel distortion magnifies the centre and
     * pins the edges; a negative strength pinches the centre inward instead.
     * `mode: "backdrop"` points the same lens at what is painted beneath the
     * node, giving a glass dome over the layers below rather than a warp of the
     * node's own paint.
     */
    bulge(options: number | BulgeOptions) {
        return this.append(buildEffect(bulgeSpec, options));
    }

    /**
     * Append a magnify lens that magnifies the backdrop beneath the node. The lens
     * fills the node's bounding box and is clipped to its silhouette, so whatever
     * is painted underneath shows through scaled about `center` — like a
     * magnifying glass shaped to the node.
     *
     * Defaults to `{ mode: 'backdrop' }`; pass `mode` explicitly to override.
     */
    magnify(options?: number | MagnifyOptions) {
        return this.append(buildEffect(magnifySpec, options));
    }

    /**
     * Append a bloom (glow) effect. Bright areas bleed soft light outward via a
     * screen-blend of the blurred bright-pass onto the layer.
     */
    bloom(options?: number | BloomOptions) {
        return this.append(buildEffect(bloomSpec, options));
    }

    /** Append a vintage / film-look colour grading effect. */
    vintage(options?: number | VintageOptions) {
        return this.append(buildEffect(vintageSpec, options));
    }

    /**
     * Append a chromatic aberration effect — red/blue colour fringing that mimics
     * lens dispersion.
     */
    chromaticAberration(options?: number | ChromaticAberrationOptions) {
        return this.append(buildEffect(chromaticAberrationSpec, options));
    }

    /** Append a colour-invert effect. */
    invert(options?: number | InvertOptions) {
        return this.append(buildEffect(invertSpec, options));
    }

    /**
     * Append a scatter effect — randomly jitters the node's own pixels, smearing
     * its content like After Effects' Scatter.
     */
    scatter(options?: number | ScatterOptions) {
        return this.append(buildEffect(scatterSpec, options));
    }

    /**
     * Append an After Effects-style posterize effect — quantizes each colour
     * channel into `levels` evenly-spaced bands, flattening gradients into steps.
     */
    posterize(options?: number | PosterizeOptions) {
        return this.append(buildEffect(posterizeSpec, options));
    }

    /**
     * Append velocity-driven motion blur — smears the node's own content along its
     * actual per-frame motion (a static node stays sharp). Modelled on After
     * Effects' shutter angle (`length`) and shutter phase (`alignment`).
     */
    motionBlur(options?: number | MotionBlurOptions) {
        return this.append(buildEffect(motionBlurSpec, options));
    }

    /**
     * Append an outline — a coloured band traced around the node's silhouette,
     * including alpha silhouettes (text, an image's cutout, a whole subtree) that
     * a geometry `stroke` can't follow.
     */
    outline(options?: number | OutlineOptions) {
        return this.append(buildEffect(outlineSpec, options));
    }

    /**
     * Append a drop shadow cast from the node's **silhouette** — including alpha
     * silhouettes (text, an image's cutout, a whole subtree) that a geometry
     * `shadow` can't follow, since that one fills the node's path.
     */
    dropShadow(options?: number | DropShadowOptions) {
        return this.append(buildEffect(dropShadowSpec, options));
    }

    /**
     * Append a vignette — a soft tint ramping in toward the node's corners. The
     * falloff follows the node's aspect ratio, so a wide node darkens along its
     * short edges the way a lens would.
     */
    vignette(options?: number | VignetteOptions) {
        return this.append(buildEffect(vignetteSpec, options));
    }

    /**
     * Append film grain. Static grain reads as texture rather than film, so pass
     * `{ animated: true }` to re-seed it each frame — or tween `seed` when the
     * render has to stay deterministic.
     */
    /**
     * Apply a 3D colour lookup table.
     *
     * The whole point of a LUT is that it is *someone else's* colour science, so
     * there is nothing to default beyond how much of it to use: `amount` is the
     * mix and everything else is the file.
     *
     * @example
     * Effects.lut({ table, size: 33 })            // the full look
     * Effects.lut({ table, size: 33, amount: 0.6 })
     */
    lut(options: LutOptions) {
        return this.append(buildEffect(lutSpec, options));
    }

    grain(options?: number | GrainOptions) {
        return this.append(buildEffect(grainSpec, options));
    }

    /** Append an unsharp-mask sharpen — local contrast boosted at `radius` scale. */
    sharpen(options?: number | SharpenOptions) {
        return this.append(buildEffect(sharpenSpec, options));
    }

    /**
     * Append edge detection — flat areas go black and boundaries light up with
     * the magnitude of the local gradient.
     */
    edges(options?: number | EdgesOptions) {
        return this.append(buildEffect(edgesSpec, options));
    }

    /**
     * Append a luminance threshold — a two-tone stencil cut at `level`, with
     * `smoothness` widening the cut into a ramp.
     */
    threshold(options?: number | ThresholdOptions) {
        return this.append(buildEffect(thresholdSpec, options));
    }

    /**
     * Append a radial blur — samples smeared along the radius (`'zoom'`, the
     * default) or the tangent (`'spin'`) about `center`, leaving the centre sharp.
     */
    radialBlur(options?: number | RadialBlurOptions) {
        return this.append(buildEffect(radialBlurSpec, options));
    }

    /**
     * Append a halftone screen — the newsprint look, where tone becomes the size
     * of a mark on a rotated grid.
     */
    halftone(options?: number | HalftoneOptions) {
        return this.append(buildEffect(halftoneSpec, options));
    }

    /**
     * Append ordered (Bayer) dithering — quantization to `levels` tones per
     * channel with the error traded for a retro crosshatch pattern.
     */
    dither(options?: number | DitherOptions) {
        return this.append(buildEffect(ditherSpec, options));
    }

    /**
     * Append a duotone / gradient map — the content's luminance remapped onto a
     * `shadows` → `highlights` ramp, discarding its original chroma.
     */
    duotone(options?: number | DuotoneOptions) {
        return this.append(buildEffect(duotoneSpec, options));
    }

    /**
     * Append a tone curve — the same adjustment `Adjustments.curves` applies to a
     * photo, on any node.
     */
    curves(options: CurvesOptions) {
        return this.append(buildEffect(curvesSpec, options));
    }

    /**
     * Append photographic grading (brightness / contrast / saturation / vibrance /
     * shadows / highlights / temperature / tint) — `Adjustments.colorAdjustment`
     * on any node. For darkened edges use {@link EffectChain.vignette}.
     */
    colorAdjustment(options: ColorAdjustmentOptions) {
        // Destructure `mode` out rather than spreading it through: a caller who
        // writes `{ mode: undefined }` would otherwise plant the key on the
        // effect, and `equals()` compares `mode` directly. `withEffectOptions`
        // skips undefined, so handing it back there is safe.
        const { mode, ...fields } = options;
        return this.append(withEffectOptions({ type: "colorAdjustment" as const, ...fields }, { mode }));
    }

    /**
     * Append a per-channel RGB offset — the digital cousin of
     * {@link EffectChain.chromaticAberration}, where each plane goes where you
     * point it instead of following a lens model.
     */
    rgbShift(options?: number | RgbShiftOptions) {
        const o = scalarOptions(options, "amount");
        const spread = o.amount;
        return this.append(buildEffect(rgbShiftSpec, spread === undefined ? o : {
            ...o,
            red: o.red ?? { x: spread, y: 0 },
            blue: o.blue ?? { x: -spread, y: 0 },
        }));
    }

    /**
     * Append CRT scanlines. Animate `offset` past `spacing` to roll the bands;
     * the pattern wraps, so a linear tween loops seamlessly.
     */
    scanlines(options?: number | ScanlinesOptions) {
        return this.append(buildEffect(scanlinesSpec, options));
    }

    /**
     * Append datamosh-style band tearing. Step `seed` in whole numbers to jump
     * between distinct glitch states rather than sliding between them.
     */
    blockDisplace(options?: number | BlockDisplaceOptions) {
        return this.append(buildEffect(blockDisplaceSpec, options));
    }

    /**
     * Append colour-depth reduction — `bits` per channel, or a fixed hardware
     * palette. Pair with {@link EffectChain.dither} so gradients survive the cut.
     */
    bitCrush(options?: number | BitCrushOptions) {
        return this.append(buildEffect(bitCrushSpec, options));
    }

    /**
     * Append ASCII art — the content divided into a grid of cells, each cell's
     * tone replaced by the glyph that carries a matching amount of ink.
     *
     * Set `background: 'transparent'` to lay the glyphs over whatever is behind
     * the node instead of over a solid field.
     */
    ascii(options?: number | AsciiOptions) {
        return this.append(buildEffect(asciiSpec, options));
    }

    /**
     * Append Kuwahara brushwork — averages within a region but never across an
     * edge, so flat areas smooth into strokes while boundaries stay crisp.
     * By some margin the most expensive effect in the set; keep `radius` small.
     */
    oilPaint(options?: number | OilPaintOptions) {
        return this.append(buildEffect(oilPaintSpec, options));
    }

    /**
     * Append an anamorphic streak — a bright pass smeared along one axis and
     * screened back on. {@link EffectChain.bloom} spreads light in every
     * direction; this spreads it in one.
     */
    streak(options?: number | StreakOptions) {
        return this.append(buildEffect(streakSpec, options));
    }

    /**
     * Append a glow — the bright (or opaque) parts of the layer spread outward
     * and composited back, optionally recoloured through a ramp.
     *
     * `bloom` is the cheaper relative: it screens a blurred bright-pass back
     * within the node's own box. This one spreads past that box, lets the source
     * sit behind, in front of, or nowhere at all, and can map glow strength onto
     * `colors`/`stops` — which is what a heat, neon or aurora look needs.
     */
    glow(options?: number | GlowOptions) {
        return this.append(buildEffect(glowSpec, options));
    }

    /**
     * Append a custom WGSL shader. `mode` picks the layer it runs on, which
     * `sample_src` reads: the node's own layer, or what is painted beneath it
     * (`'backdrop'`).
     */
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

    /**
     * Append a sine warp. Tween `phase` over 360 to make the wave travel — it
     * wraps, so a linear tween loops seamlessly.
     */
    wave(options?: number | WaveOptions) {
        return this.append(buildEffect(waveSpec, options));
    }

    /**
     * Append a twirl / swirl vortex — a rotation about `center` that falls off
     * with distance, so the middle spins while the rim stays pinned.
     */
    twirl(options?: number | TwirlOptions) {
        return this.append(buildEffect(twirlSpec, options));
    }

    /**
     * Append a blur whose radius ramps across the node rather than being
     * uniform. With `{ mode: 'backdrop' }` this is the frosted panel whose blur
     * fades out instead of ending at a hard edge.
     */
    progressiveBlur(options?: number | ProgressiveBlurOptions) {
        return this.append(buildEffect(progressiveBlurSpec, options));
    }

    /**
     * Append a kaleidoscope fold. Animating `angle` sweeps fresh source material
     * through the sampled wedge while the pattern itself stays locked — which is
     * not what rotating the node does.
     */
    kaleidoscope(options?: number | KaleidoscopeOptions) {
        return this.append(buildEffect(kaleidoscopeSpec, options));
    }

    /**
     * Append Figma's Glass — the backdrop refracted, dispersed and frosted
     * through a curved edge on the node's outline, with a rim of light.
     *
     * Like `magnify`, this reads what is painted *beneath* the node and is
     * clipped to its outline, so the shape's own edges stay sharp. It needs no
     * map: the curve is derived from the outline itself, so it follows a
     * rounded rect, an ellipse, a hand-drawn path or text equally.
     *
     * Defaults to `{ mode: 'backdrop' }`; pass `mode` explicitly to override.
     */
    glass(options?: number | GlassOptions) {
        return this.append(buildEffect(glassSpec, options));
    }

    /** Allows spreading the chain into an array: `[...Effects.blur(5)]`. */
    *[Symbol.iterator]() {
        yield* this.list;
    }

    /** Serializes to the raw effect array so frameworks that call `toJSON` get a plain value. */
    toJSON() {
        return this.list;
    }
}

/**
 * Accepted shapes for a node's `effects` prop.
 *
 * Mirrors {@link Fill}: a single {@link NodeEffect}, an `EffectChain` builder
 * result, or an array mixing effects and chains (each chain contributes all its
 * effects in place). Already-resolved effects are themselves `NodeEffect`s, so
 * a node's read-back `effects` can be assigned straight back.
 *
 *   Effects.blur(8)                        // chain
 *   { type: 'blur', radius: 8 }       // single effect
 *   [Effects.blur(8), { type: 'invert' }]  // mixed array
 *   [...Effects.blur(8), grayscaleEffect]
 */
export type Effect =
    | NodeEffect
    | EffectChain
    | (NodeEffect | EffectChain)[];

/**
 * Entry point for building effect chains fluently.
 *
 * An empty {@link EffectChain}, so `Effects.blur(8)` *is* `new EffectChain().blur(8)`
 * — every builder's signature and documentation has exactly one definition, on
 * the class, which is also what an editor shows when you hover `Effects.blur`.
 * (A parallel object of arrow functions would need its own copy of all 41 docs,
 * and hovering it showed none of them.)
 *
 * The chain is immutable — every builder returns a *new* chain — so sharing one
 * empty instance as the entry point is safe.
 *
 * @example
 * node.effects = Effects.blur(8).grayscale(1);
 */
export const Effects = new EffectChain();

/**
 * Normalises any {@link Effect} value to a plain `NodeEffect[]`.
 * Used internally when reading props before rendering or interpolation.
 *
 * Chains used as array elements are flattened so each contributes its effects
 * in place: `[Effects.blur(8), grayscaleEffect]` — as is the plain array a chain
 * serializes to, which is how that value reads back out of a stored document.
 */
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
 * Resolve every effect in `list`, returning **the same array** when none of them
 * needed it — which is the overwhelming majority, since one effect type
 * registers a `resolve` at all.
 *
 * The identity is load-bearing, not a micro-optimisation: this runs on every
 * write of an `effects` prop, and `lerpEffectArray` short-circuits on
 * `from === to`. Copying unconditionally would defeat that for every node in
 * every scene to migrate one effect type.
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

/** The effect-chain attribute's op set — the `effects` prop's resolve/lerp pair. */
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
