import { MediaAdjustment, VideoOnlyAdjustment } from "./union";
import { EffectChain } from "../effects/chain";
import type { BlendMode } from "../fill/blend";
import type { ColorAdjustmentFilter } from "./implementations/color-adjustment";
import type { CurvesChannel } from "./implementations/curves";
import type { EffectOptions } from "../effects/effect-data";
import type {
    AsciiOptions,
    BitCrushOptions,
    BlockDisplaceOptions,
    BloomOptions,
    BulgeOptions,
    ChromaticAberrationOptions,
    DirectionalBlurOptions,
    DitherOptions,
    DuotoneOptions,
    EdgesOptions,
    GrainOptions,
    HalftoneOptions,
    InvertOptions,
    LutOptions,
    KaleidoscopeOptions,
    OilPaintOptions,
    PixelateOptions,
    PosterizeOptions,
    ProgressiveBlurOptions,
    RadialBlurOptions,
    RgbShiftOptions,
    ScanlinesOptions,
    ScatterOptions,
    SharpenOptions,
    ShaderEffectOptions,
    StreakOptions,
    ThresholdOptions,
    TwirlOptions,
    VignetteOptions,
    VintageOptions,
    WaveOptions,
} from "../effects/chain";

/** Any concrete filter a chain may hold — pixel or video-only. */
type AnyFilter = MediaAdjustment | VideoOnlyAdjustment;

/**
 * An *adjustment* is what an author writes (`Adjustments.blur(8)`); a *filter* is the primitive the renderer
 * realises it as (`BlurFilter`, the `FilterData` handlers in `registry.ts`). Usually one-to-one, but a grade can
 * compose several primitives and the LUT lookup has no builder. Most builders delegate to the node-effect
 * roster ({@link EffectAdjustment} lists the exceptions). `colorAdjustment`'s options are named after the
 * primitive (`ColorAdjustmentFilterOptions`) to avoid `ColorAdjustmentAdjustmentOptions`.
 */

/** Gaussian blur. Scalar shorthand sets `radius`. */
export interface BlurFilterOptions {
    /** Blur radius in pixels. */
    radius: number;
}

/** Desaturation. Scalar shorthand sets `amount`. */
export interface GrayscaleFilterOptions {
    /** 0 = original, 1 = fully grayscale. */
    amount: number;
}

/** Alpha (opacity) multiply. Scalar shorthand sets `amount`. */
export interface AlphaFilterOptions {
    /** 0 = fully transparent, 1 = unchanged. */
    amount: number;
}

/** Luminance scale. Scalar shorthand sets `amount`. */
export interface ExposureFilterOptions {
    /** Exposure multiplier. 1 = unchanged, >1 brighter, <1 darker. */
    amount: number;
}

/** Raw 4×5 row-major colour matrix. Array shorthand sets `matrix`. */
export interface ColorMatrixFilterOptions {
    /** 4×5 row-major colour matrix: rows R, G, B, A of `[r, g, b, a, bias]`. */
    matrix: number[];
}

/** Tone curve through control points. */
export interface CurvesFilterOptions {
    /** Curve control points as [input, output] pairs in [0, 1]. */
    points: [number, number][];
    /** Channel(s) to apply the curve to (default `'rgb'`). */
    channel?: CurvesChannel;
}

/** Photographic tonal/colour adjustments. All fields optional. */
export type ColorAdjustmentFilterOptions = Omit<ColorAdjustmentFilter, 'type'>;

/** Stop-motion frame-rate resample (video only). Scalar shorthand sets `fps`. */
export interface PosterizeTimeFilterOptions {
    /** Target frame rate the source playhead snaps to. */
    fps: number;
}

/** Motion-trail echo of past frames (video only). */
export interface EchoFilterOptions {
    /** Number of past-frame taps drawn behind the current frame. */
    echoes: number;
    /** Delay between successive taps, in source seconds. */
    delay: number;
    /** Per-tap alpha multiplier; tap `n` is drawn at `decay ** n` (default 0.5). */
    decay?: number;
    /** Blend mode used to composite the echo taps (default `'screen'`). */
    blend?: BlendMode;
}

/** A node effect's builder options as a filter takes them: minus {@link EffectOptions} (`mode`), since a filter acts on the fill's own pixels and has no backdrop. */
type AsFilterOptions<T> = T extends number ? number : Omit<T, keyof EffectOptions>;

function scalarFilter<O extends object>(arg: number | O, key: keyof O): O {
    return typeof arg === "number" ? ({ [key]: arg } as O) : arg;
}

/** Routes through the effect chain so defaults, scalar shorthands and normalisation have one definition. */
function fromEffect(chain: EffectChain): AnyFilter {
    return chain.list[0] as AnyFilter;
}

/** Immutable, chainable list of media filters valid on an **image** fill; {@link VideoAdjustmentChain} adds the video-only temporal ones. */
export class AdjustmentChain {
    constructor(public list: AnyFilter[] = []) { }

    /** Returns the same class so the video subclass keeps its extra builders after an inherited one. */
    protected append(filter: AnyFilter): this {
        const Ctor = this.constructor as new (list: AnyFilter[]) => this;
        return new Ctor([...this.list, filter]);
    }

    blur(options: number | BlurFilterOptions) {
        const { radius } = scalarFilter(options, "radius");
        return this.append({ type: 'blur', radius });
    }

    grayscale(options: number | GrayscaleFilterOptions) {
        const { amount } = scalarFilter(options, "amount");
        return this.append({ type: 'grayscale', amount });
    }

    alpha(options: number | AlphaFilterOptions) {
        const { amount } = scalarFilter(options, "amount");
        return this.append({ type: 'alpha', amount });
    }

    exposure(options: number | ExposureFilterOptions) {
        const { amount } = scalarFilter(options, "amount");
        return this.append({ type: 'exposure', amount });
    }

    colorAdjustment(options: ColorAdjustmentFilterOptions) {
        return this.append({ type: 'colorAdjustment', ...options });
    }

    colorMatrix(options: number[] | ColorMatrixFilterOptions) {
        const matrix = Array.isArray(options) ? options : options.matrix;
        return this.append({ type: 'colorMatrix', matrix });
    }

    curves(options: CurvesFilterOptions) {
        return this.append({ type: 'curves', points: options.points, channel: options.channel });
    }

    directionalBlur(options: AsFilterOptions<number | DirectionalBlurOptions>) {
        return this.append(fromEffect(new EffectChain().directionalBlur(options)));
    }

    radialBlur(options?: AsFilterOptions<number | RadialBlurOptions>) {
        return this.append(fromEffect(new EffectChain().radialBlur(options)));
    }

    progressiveBlur(options?: AsFilterOptions<number | ProgressiveBlurOptions>) {
        return this.append(fromEffect(new EffectChain().progressiveBlur(options)));
    }

    bloom(options?: AsFilterOptions<number | BloomOptions>) {
        return this.append(fromEffect(new EffectChain().bloom(options)));
    }

    streak(options?: AsFilterOptions<number | StreakOptions>) {
        return this.append(fromEffect(new EffectChain().streak(options)));
    }

    sharpen(options?: AsFilterOptions<number | SharpenOptions>) {
        return this.append(fromEffect(new EffectChain().sharpen(options)));
    }

    invert(options?: AsFilterOptions<number | InvertOptions>) {
        return this.append(fromEffect(new EffectChain().invert(options)));
    }

    vintage(options?: AsFilterOptions<number | VintageOptions>) {
        return this.append(fromEffect(new EffectChain().vintage(options)));
    }

    duotone(options?: AsFilterOptions<number | DuotoneOptions>) {
        return this.append(fromEffect(new EffectChain().duotone(options)));
    }

    posterize(options?: AsFilterOptions<number | PosterizeOptions>) {
        return this.append(fromEffect(new EffectChain().posterize(options)));
    }

    threshold(options?: AsFilterOptions<number | ThresholdOptions>) {
        return this.append(fromEffect(new EffectChain().threshold(options)));
    }

    bitCrush(options?: AsFilterOptions<number | BitCrushOptions>) {
        return this.append(fromEffect(new EffectChain().bitCrush(options)));
    }

    dither(options?: AsFilterOptions<number | DitherOptions>) {
        return this.append(fromEffect(new EffectChain().dither(options)));
    }

    halftone(options?: AsFilterOptions<number | HalftoneOptions>) {
        return this.append(fromEffect(new EffectChain().halftone(options)));
    }

    /** Append film grain. Animate it by tweening `seed`. */
    grain(options?: AsFilterOptions<number | GrainOptions>) {
        return this.append(fromEffect(new EffectChain().grain(options)));
    }

    /** Append a 3D colour lookup table — see {@link EffectChain.lut}. */
    lut(options: AsFilterOptions<LutOptions>) {
        return this.append(fromEffect(new EffectChain().lut(options as LutOptions)));
    }

    scanlines(options?: AsFilterOptions<number | ScanlinesOptions>) {
        return this.append(fromEffect(new EffectChain().scanlines(options)));
    }

    pixelate(options: AsFilterOptions<number | PixelateOptions>) {
        return this.append(fromEffect(new EffectChain().pixelate(options)));
    }

    /** Cost grows with `radius^2`: the most expensive filter in the set. */
    oilPaint(options?: AsFilterOptions<number | OilPaintOptions>) {
        return this.append(fromEffect(new EffectChain().oilPaint(options)));
    }

    ascii(options?: AsFilterOptions<number | AsciiOptions>) {
        return this.append(fromEffect(new EffectChain().ascii(options)));
    }

    edges(options?: AsFilterOptions<number | EdgesOptions>) {
        return this.append(fromEffect(new EffectChain().edges(options)));
    }

    vignette(options?: AsFilterOptions<number | VignetteOptions>) {
        return this.append(fromEffect(new EffectChain().vignette(options)));
    }

    chromaticAberration(options?: AsFilterOptions<number | ChromaticAberrationOptions>) {
        return this.append(fromEffect(new EffectChain().chromaticAberration(options)));
    }

    rgbShift(options?: AsFilterOptions<number | RgbShiftOptions>) {
        return this.append(fromEffect(new EffectChain().rgbShift(options)));
    }

    scatter(options?: AsFilterOptions<number | ScatterOptions>) {
        return this.append(fromEffect(new EffectChain().scatter(options)));
    }

    blockDisplace(options?: AsFilterOptions<number | BlockDisplaceOptions>) {
        return this.append(fromEffect(new EffectChain().blockDisplace(options)));
    }

    bulge(options: AsFilterOptions<number | BulgeOptions>) {
        return this.append(fromEffect(new EffectChain().bulge(options)));
    }

    twirl(options?: AsFilterOptions<number | TwirlOptions>) {
        return this.append(fromEffect(new EffectChain().twirl(options)));
    }

    wave(options?: AsFilterOptions<number | WaveOptions>) {
        return this.append(fromEffect(new EffectChain().wave(options)));
    }

    kaleidoscope(options?: AsFilterOptions<number | KaleidoscopeOptions>) {
        return this.append(fromEffect(new EffectChain().kaleidoscope(options)));
    }

    shader(options: AsFilterOptions<ShaderEffectOptions>) {
        return this.append(fromEffect(new EffectChain().shader(options)));
    }

    *[Symbol.iterator]() {
        yield* this.list;
    }

    toJSON() {
        return this.list;
    }
}

/** The image chain plus the video-only temporal filters. */
export class VideoAdjustmentChain extends AdjustmentChain {
    posterizeTime(options: number | PosterizeTimeFilterOptions) {
        const { fps } = scalarFilter(options, "fps");
        return this.append({ type: 'posterizeTime', fps });
    }

    echo(options: EchoFilterOptions) {
        return this.append({ type: 'echo', ...options });
    }
}

/** Accepted shapes for an **image** fill's `filters` prop; video-only filters are excluded. */
export type ImageAdjustment = MediaAdjustment | MediaAdjustment[] | AdjustmentChain;

/** Accepted shapes for a **video** fill's `filters` prop: pixel filters plus the video-only `posterizeTime` and `echo`. */
export type VideoAdjustment =
    | (MediaAdjustment | VideoOnlyAdjustment)
    | (MediaAdjustment | VideoOnlyAdjustment)[]
    | AdjustmentChain;

/** Empty chain: `Adjustments.blur(8)` is `new AdjustmentChain().blur(8)`, so builders are documented once, on {@link AdjustmentChain}. Pixel filters only. */
export const Adjustments = new AdjustmentChain();

/** {@link Adjustments} plus the video-only temporal builders. */
export const VideoAdjustments = new VideoAdjustmentChain();

/** Normalises any `ImageAdjustment`/`VideoAdjustment` value to a plain filter array. */
export function resolveChainAdjustments(filters: ImageAdjustment | VideoAdjustment | undefined): AnyFilter[] {
    if (filters === undefined) return [];
    if (filters instanceof AdjustmentChain) return filters.list;
    if (Array.isArray(filters)) return filters;
    return [filters];
}
