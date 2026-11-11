import { MediaAdjustment, VideoOnlyAdjustment } from "./union";
import { declareEffect, effectSurface, hasEffect, lerpEffect } from "../effects/registry";
import type { NodeEffect } from "../effects/union";
import type { AssetScope } from "@/assets/scope";

import { exposureFilter } from "./implementations/exposure";
import { blurFilter } from "./implementations/blur";
import { grayscaleFilter } from "./implementations/grayscale";
import { alphaFilter } from "./implementations/alpha";
import { colorMatrixFilter } from "./implementations/color-matrix";
import { curvesFilter } from "./implementations/curves";
import { colorAdjustmentFilter } from "./implementations/color-adjustment";
import { posterizeTimeFilter } from "./implementations/posterize-time";
import { echoFilter } from "./implementations/echo";

/** Any concrete filter object accepted on a media fill — pixel or video-only. */
export type AnyFilter = MediaAdjustment | VideoOnlyAdjustment;

/** Interpolation and equality contract every filter implementation must implement. */
export interface FilterData<T extends AnyFilter> {
    lerp(from: T, to: T, t: number): T;
    equals(a: T, b: T): boolean;
}

/** Maps each filter `type` to its `FilterData` handler, as constants (no runtime registration step to forget). Holds only filters that exist *solely* as filters; most of the roster is {@link EffectAdjustment}, looked up in the effects registry so `dither` interpolates the same on a node or an image. */
const FILTERS = new Map<string, FilterData<AnyFilter>>([
    ["exposure", exposureFilter as FilterData<AnyFilter>],
    ["blur", blurFilter as FilterData<AnyFilter>],
    ["grayscale", grayscaleFilter as FilterData<AnyFilter>],
    ["alpha", alphaFilter as FilterData<AnyFilter>],
    ["colorMatrix", colorMatrixFilter as FilterData<AnyFilter>],
    ["curves", curvesFilter as FilterData<AnyFilter>],
    ["colorAdjustment", colorAdjustmentFilter as FilterData<AnyFilter>],
    ["posterizeTime", posterizeTimeFilter as FilterData<AnyFilter>],
    ["echo", echoFilter as FilterData<AnyFilter>],
]);

/** Video-only filter types, consumed by the video fill's per-frame `update()` (`posterizeTime`) or a dedicated multi-pass renderer (`echo`); `isPixelFilter` lets a renderer skip them when composing the pixel chain. */
const VIDEO_ONLY = new Set<string>(["posterizeTime", "echo"]);

export function isPixelFilter(type: string): boolean {
    return !VIDEO_ONLY.has(type);
}

export function hasFilter(type: string): boolean {
    return FILTERS.has(type) || hasEffect(type);
}

/** Interpolates two filters, hard-cutting at t = 0.5 when types differ or are unregistered. A type with no dedicated `FilterData` is an {@link EffectAdjustment}, handed to `lerpEffect` so one interpolation serves a node or a fill. */
export function lerpFilter(from: AnyFilter, to: AnyFilter, t: number): AnyFilter {
    if (from.type !== to.type) return t < 0.5 ? from : to;
    const data = FILTERS.get(from.type);
    if (data) return data.lerp(from, to, t);
    return lerpEffect(from as NodeEffect, to as NodeEffect, t) as AnyFilter;
}

/** An {@link EffectAdjustment} can reference assets (`lut` samples an image), and an undeclared one reads as "no lookup table". */
export function declareFilter(filter: AnyFilter, assets: AssetScope): void {
    if (FILTERS.has(filter.type)) return;
    declareEffect(filter as NodeEffect, assets);
}

/** How a backend must realise `filter`: `"shader"` when it resamples pixel positions, so it wraps the fill's shader rather than composing into its `ImageFilter` chain. The filters defined here are all `"filter"`; an {@link EffectAdjustment} answers with its effect's declaration. */
export function filterSurface(filter: AnyFilter): "filter" | "shader" {
    if (FILTERS.has(filter.type)) return "filter";
    // A filter is applied to the fill's own pixels, so it is never a backdrop
    // effect however the underlying effect's `mode` predicate reads.
    return effectSurface({ ...filter, mode: "foreground" } as NodeEffect);
}

/** {@link lerpFilterArray} over two *optional* arrays, answering `undefined` when neither has a filter: a media fill's `lerp` is spread over the whole fill, so returning `[]` would allocate per fill per frame and turn an absent field into a present one. */
export function lerpOptionalFilters<T extends AnyFilter>(
    from: T[] | undefined,
    to: T[] | undefined,
    t: number,
): T[] | undefined {
    if (!from?.length && !to?.length) return undefined;
    return lerpFilterArray(from ?? [], to ?? [], t) as T[];
}

/** Interpolates two filter arrays of possibly different lengths: indices in only one array are kept, matched ones lerped pairwise. */
export function lerpFilterArray(from: AnyFilter[], to: AnyFilter[], t: number): AnyFilter[] {
    const maxLen = Math.max(from.length, to.length);
    const result: AnyFilter[] = [];
    for (let i = 0; i < maxLen; i++) {
        const a = from[i];
        const b = to[i];
        if (a && b) {
            result.push(lerpFilter(a, b, t));
        } else if (a) {
            result.push(a);
        } else if (b) {
            result.push(b);
        }
    }
    return result;
}
