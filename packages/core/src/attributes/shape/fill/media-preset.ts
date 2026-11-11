import { lerpNumber } from "@/tween/lerp";
import type { AssetScope } from "@/assets/scope";
import { declareFilter, lerpFilterArray } from "../filters/registry";
import { resolveChainAdjustments } from "../filters/chain";
import type { ImageAdjustment, VideoAdjustment } from "../filters/chain";
import type { MediaAdjustment, VideoOnlyAdjustment } from "../filters/union";

/** A **preset**: the grade a media fill carries, an ordered chain of adjustments plus one dry/wet mix. Wrapped rather than a sibling prop because a look is constantly asked for as "the same, but less": one number about the whole chain, not smeared across each adjustment (scaling toward neutral is the approximation forced when the renderer can't mix). */
export interface MediaPresetProp {
    /** The chain: one adjustment, a plain array, or an {@link AdjustmentChain}. */
    adjustments?: ImageAdjustment;
    /** How much of the grade to apply, 0–1 (default 1): a real mix against the ungraded pixels, not a scaling of the chain's values. */
    intensity?: number;
}

/** {@link MediaPresetProp} for a video fill, which also admits the temporal adjustments. */
export interface VideoPresetProp {
    adjustments?: VideoAdjustment;
    intensity?: number;
}

export interface MediaPresetResolved<A = MediaAdjustment> {
    adjustments: A[];
    intensity: number;
}

/** Normalises a fill's grade. `undefined` (not an empty preset) when there is none: an ungraded media fill takes a cheaper renderer path that an always-present key would forfeit. */
export function resolveMediaPreset(
    preset: MediaPresetProp | VideoPresetProp | undefined,
): MediaPresetResolved<MediaAdjustment | VideoOnlyAdjustment> | undefined {
    const adjustments = resolveChainAdjustments(preset?.adjustments);
    if (adjustments.length === 0) return undefined;
    return {
        adjustments,
        // Clamped: an intensity outside 0–1 would make the renderer's mix extrapolate past the graded image.
        intensity: Math.min(1, Math.max(0, preset?.intensity ?? 1)),
    };
}

/**
 * Interpolates two presets: the chain pairwise (see {@link lerpFilterArray}), the mix as a number.
 *
 * **An absent preset is read as the other side's chain at `intensity: 0`**, not an empty chain: `lerpFilterArray` keeps
 * an index present on one side as-is, so tweening grayscaled to ungraded would hold the grayscale at full strength then
 * cut. Holding the chain and fading the mix is what "remove this grade over half a second" means.
 */
export function lerpMediaPreset<A extends MediaAdjustment | VideoOnlyAdjustment>(
    a: MediaPresetResolved<A> | undefined,
    b: MediaPresetResolved<A> | undefined,
    t: number,
): MediaPresetResolved<A> | undefined {
    if (!a && !b) return undefined;
    const from = a ?? { adjustments: b!.adjustments, intensity: 0 };
    const to = b ?? { adjustments: a!.adjustments, intensity: 0 };
    return {
        adjustments: lerpFilterArray(from.adjustments, to.adjustments, t) as A[],
        intensity: lerpNumber(from.intensity, to.intensity, t),
    };
}

export function declareMediaPreset(
    preset: MediaPresetResolved<MediaAdjustment | VideoOnlyAdjustment> | undefined,
    assets: AssetScope,
): void {
    for (const adjustment of preset?.adjustments ?? []) declareFilter(adjustment, assets);
}
