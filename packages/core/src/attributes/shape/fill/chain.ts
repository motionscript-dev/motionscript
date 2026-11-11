import type { Color } from "./color/parser";
import type { BlendMode } from "./blend";
import type { Vector2 } from "@/attributes/layout/vector2";
import type { MediaPresetProp, VideoPresetProp } from "./media-preset";
import type { FillProp, FillResolved, FillSpace } from "./union";
import { normalizeUniforms } from "../shaders/uniforms";
import { resolveShaderProperties, type ShaderPropertyValues } from "../shaders/resolve";
import type { FillShader } from "../shaders/pack";
import type { ImageCrop, ImageFit, ImageMatrix } from "./implementations/image";
import type { Alignment } from "@/attributes/layout/alignment";
import type { FractalNoiseFillProp } from "./implementations/fractal-noise";
import type { DotGridFillProp } from "./implementations/dot-grid";
import type { GridFillProp } from "./implementations/grid";
import type { ShaderFillProp } from "./implementations/shader";
import type { Scene3D } from "@/render3d/scene3d";

/** Placement options shared by the image and video fill builders. */
export interface MediaPlacementOptions {
    /** How the (cropped) source is scaled into the node's bounds. Default `'fill'`. */
    fit?: ImageFit;
    /** Window onto the source, in fractions of its own size, applied before `fit`. */
    crop?: ImageCrop;
    /** Magnification on top of the fitted scale. `1` is the fitted size. */
    zoom?: number;
    /** The point held fixed as `zoom` scales; also the alignment when it doesn't cover. */
    anchor?: Alignment;
    /** Raw source→shape matrix; bypasses `crop`/`fit`/`zoom`/`anchor` and the bounds. */
    matrix?: ImageMatrix;
}

/** Author-facing options for a {@link FillChain.video} layer. */
export interface VideoFillOptions extends FillOptions, MediaPlacementOptions {
    /** The grade laid over the footage — an adjustment chain plus a 0–1 mix. */
    preset?: VideoPresetProp;
    /** Explicit source time in seconds. Omit and the clip plays by itself from when the node appeared; set only to drive the playhead yourself (`null` hands it back). */
    timestamp?: number | null;
    /** Whether playback advances with the node's clock. Defaults to `true`. */
    playing?: boolean;
    trimStart?: number;
    trimEnd?: number;
    /** Seconds after the painting node appears before playback begins. Default `0`. */
    playStart?: number;
    speed?: number;
    loop?: 'forward' | 'reverse' | 'none';
    duration?: number;
}

/** Cross-cutting options for every fill layer: the `opacity` / `blend` fields each fill prop accepts, plus the registry's generic `space` directive. */
export interface FillOptions {
    opacity?: number;
    blend?: BlendMode;
    space?: FillSpace;
}

/** Strip `undefined` option keys so the produced props stay minimal/comparable. */
function withOptions<T extends object>(base: T, options: FillOptions = {}): T & FillOptions {
    const out = { ...base } as T & FillOptions;
    if (options.opacity !== undefined) out.opacity = options.opacity;
    if (options.blend !== undefined) out.blend = options.blend;
    if (options.space !== undefined) out.space = options.space;
    return out;
}

/** Immutable, chainable list of fill layers; each builder returns a new chain, so chains can be shared and branched. */
export class FillChain {
    constructor(public list: FillProp[] = []) { }

    color(color: Color, options?: FillOptions) {
        return new FillChain([...this.list, withOptions({ type: 'solid' as const, color }, options)]);
    }

    image(
        src: string,
        options?: FillOptions & MediaPlacementOptions & {
            /** The grade laid over the picture — an adjustment chain plus a 0–1 mix. */
            preset?: MediaPresetProp;
        },
    ) {
        const { fit, crop, zoom, anchor, matrix, preset, ...common } = options ?? {};
        // Forwarded unresolved: `imageFill.resolve` is the one place that
        // flattens a chain, so a fill built here and a fill written as a
        // literal cannot disagree about what a grade means.
        return new FillChain([...this.list, withOptions({
            type: 'image' as const,
            src,
            fit, crop, zoom, anchor, matrix,
            preset,
        }, common)]);
    }

    /** Plays by default: the source timestamp is derived as it paints, from how long the carrying node has existed, so the clip runs wherever the fill is used with nothing to advance. */
    video(src: string, options?: VideoFillOptions) {
        const { fit, crop, zoom, anchor, matrix, preset, timestamp, playing, trimStart, trimEnd, playStart, speed, loop, duration, ...common } = options ?? {};
        return new FillChain([...this.list, withOptions({
            type: 'video' as const,
            src,
            fit, crop, zoom, anchor, matrix, preset,
            timestamp,
            playing: playing ?? true,
            trimStart, trimEnd, playStart, speed, loop, duration,
        }, common)]);
    }


    linearGradient(colors: Color[], options?: FillOptions & { stops?: number[]; start?: Vector2; end?: Vector2 }) {
        const { stops, start, end, ...common } = options ?? {};
        return new FillChain([...this.list, withOptions({ type: 'linear-gradient' as const, colors, stops, start, end }, common)]);
    }

    radialGradient(colors: Color[], options?: FillOptions & { stops?: number[]; center?: Vector2; radius?: number }) {
        const { stops, center, radius, ...common } = options ?? {};
        return new FillChain([...this.list, withOptions({ type: 'radial-gradient' as const, colors, stops, center, radius }, common)]);
    }

    conicGradient(colors: Color[], options?: FillOptions & { stops?: number[]; center?: Vector2; startAngle?: number }) {
        const { stops, center, startAngle, ...common } = options ?? {};
        return new FillChain([...this.list, withOptions({ type: 'conic-gradient' as const, colors, stops, center, startAngle }, common)]);
    }

    /** Append a noise (speckle) fill. Tween `seed` to make the static crawl. */
    noise(options?: FillOptions & { size?: Vector2; density?: number; color?: Color; seed?: number }) {
        const { size, density, color, seed, ...common } = options ?? {};
        return new FillChain([...this.list, withOptions({ type: 'noise' as const, size, density, color, seed }, common)]);
    }

    /** A continuous field (cloud, marble, smoke), unlike the speckle of {@link noise}. Tween `offset` to flow through it, `seed` to churn to a different field. */
    fractalNoise(options?: FillOptions & Omit<FractalNoiseFillProp, 'type' | 'opacity' | 'blend'>) {
        const {
            basis, octaves, frequency, lacunarity, gain, seed, offset, angle,
            colors, stops, contrast, ...common
        } = options ?? {};
        return new FillChain([...this.list, withOptions(
            {
                type: 'fractalNoise' as const,
                basis, octaves, frequency, lacunarity, gain, seed, offset, angle,
                colors, stops, contrast,
            },
            common,
        )]);
    }

    /**
     * Custom shader fill. The WGSL `source` defines `fn fill(in: FillIn) -> vec4f` and declares uniforms as
     * `struct Params`, read as `u.<name>`. It returns **premultiplied** rgba without folding `opacity` in (already
     * applied; doing it twice squares it). Keep `source` constant: it is the compile-cache key, so it snaps at a
     * tween's midpoint and rebuilding it per frame compiles a program per frame. Changing values belong in uniforms.
     *
     * @example
     * Fills.shader(GLOW, { uniforms: { amount: 0.6 } })
     */
    shader(
        source: string | FillShader,
        options?: FillOptions
            & Omit<ShaderFillProp, 'type' | 'source' | 'language' | 'opacity' | 'blend' | 'shaderId'>
            & { values?: ShaderPropertyValues },
    ) {
        const pack = typeof source === 'string' ? undefined : source;
        if (pack && pack.scope !== 'fill') {
            throw new Error(
                `Fills.shader was given a "${(pack as { scope: string }).scope}" shader ` +
                `("${pack.name}"). An effect shader samples a backdrop a fill does not have; ` +
                `use Effects.shader.`,
            );
        }
        const { uniforms, textures, values, ...common } = options ?? {};
        // A pack resolves to plain uniforms here; anything passed as `uniforms`
        // still wins, matching how an author value overrides a built-in.
        const resolved = pack
            ? { ...resolveShaderProperties(pack, values), ...normalizeUniforms(uniforms ?? {}) }
            : uniforms;
        return new FillChain([...this.list, withOptions(
            {
                type: 'shader' as const,
                source: typeof source === 'string' ? source : source.source,
                language: 'wgsl' as const,
                uniforms: resolved,
                textures,
                ...(pack?.id !== undefined ? { shaderId: pack.id } : {}),
            },
            common,
        )]);
    }

    stripe(options?: FillOptions & { gap?: number; strokeWidth?: number; angle?: number; color?: Color }) {
        const { gap, strokeWidth, angle, color, ...common } = options ?? {};
        return new FillChain([...this.list, withOptions({ type: 'stripe' as const, gap, strokeWidth, angle, color }, common)]);
    }

    /** Lattice of dots at a pixel pitch. Tween `offset` to drift the field under a still shape. */
    dotGrid(options?: FillOptions & Omit<DotGridFillProp, 'type' | 'opacity' | 'blend'>) {
        const { radius, spacing, offset, color, ...common } = options ?? {};
        return new FillChain([...this.list, withOptions(
            { type: 'dotGrid' as const, radius, spacing, offset, color },
            common,
        )]);
    }

    /** Ruled lines dividing the shape into cells, optionally with a finer ruling inside. Sized in divisions rather than px (unlike {@link dotGrid}), so it holds its structure as the shape resizes. */
    grid(options?: FillOptions & Omit<GridFillProp, 'type' | 'opacity' | 'blend'>) {
        const {
            divisions, subdivisions, offset, strokeWidth, subdivisionWidth, color, ...common
        } = options ?? {};
        return new FillChain([...this.list, withOptions(
            {
                type: 'grid' as const,
                divisions, subdivisions, offset, strokeWidth, subdivisionWidth, color,
            },
            common,
        )]);
    }

    /**
     * A 3D scene painted through the shape's own path. Takes a **built** {@link Scene3D}, never a builder; freshness
     * comes from where the value is produced (a `renderSelf`, or a `() => …` binding). Two same-type 3D layers
     * hard-cut rather than cross-fading (a command list has no in-between): stack them and tween opacities instead.
     */
    canvas3D(scene: Scene3D, options?: FillOptions & { maxPixelRatio?: number; antialias?: boolean }) {
        const { maxPixelRatio, antialias, ...common } = options ?? {};
        return new FillChain([...this.list, withOptions({ type: 'canvas3D' as const, scene, maxPixelRatio, antialias }, common)]);
    }

    *[Symbol.iterator]() {
        yield* this.list;
    }

    toJSON() {
        return this.list;
    }
}

/** Accepted shapes for a node's `fill`: a single fill, a `FillChain`, an already-resolved {@link FillResolved}, or an array mixing these (chains contribute their layers in place). */
export type Fill =
    | FillProp
    | FillResolved
    | FillChain
    | (FillProp | FillResolved | FillChain)[];

/** An empty {@link FillChain}: `Fills.image(src)` *is* `new FillChain().image(src)`, so builders are documented once, on the class. Chains are immutable, so sharing one instance is safe. */
export const Fills = new FillChain();

/** Normalises any {@link Fill} to `FillProp[]`. Already-resolved fills structurally satisfy `FillProp` and pass through (`resolveFill` re-normalises idempotently). */
export function resolveChainFill(fill: Fill | undefined): FillProp[] {
    if (fill == null) return [];
    if (fill instanceof FillChain) return fill.list;
    if (Array.isArray(fill)) {
        // Flatten chains used as array elements, and the plain array a chain serializes to (how it reads back from a stored document).
        const out: FillProp[] = [];
        for (const item of fill) {
            if (item instanceof FillChain) out.push(...item.list);
            else if (Array.isArray(item)) out.push(...resolveChainFill(item as Fill));
            else out.push(item as FillProp);
        }
        return out;
    }
    return [fill as FillProp];
}
