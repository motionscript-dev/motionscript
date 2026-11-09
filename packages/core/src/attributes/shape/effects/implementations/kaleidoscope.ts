import type { ModedEffect, EffectData } from "../effect-data";
import { CENTER, defineEffect, effectDataOf, param, type EffectFields } from "../spec";

/**
 * Kaleidoscope — the content is folded into `segments` mirrored wedges around
 * `center`, so one slice of the source is repeated around a circle.
 *
 * Only the wedge starting at `angle` is ever read; every other segment is that
 * same wedge reflected or rotated into place. That is why rotating `angle`
 * animates so well — the pattern stays locked while *different source material*
 * sweeps through the wedge, which is the effect people actually want and is not
 * the same as rotating the node.
 *
 * `segments` counts the mirrored pairs, so 6 gives the familiar snowflake. It is
 * discrete: a tween snaps rather than passing through a fractional fold, which
 * would tear.
 */
export interface KaleidoscopeEffect extends ModedEffect, EffectFields<typeof kaleidoscopeSpec.params> {
    type: "kaleidoscope";
}

/** The {@link KaleidoscopeEffect} spec: its parameters, defaults and ranges. */
export const kaleidoscopeSpec = defineEffect({
    type: "kaleidoscope",
    group: "distort",
    // Resamples the source at a reflected position.
    surface: "shader",
    scalar: "segments",
    // `segments` is discrete, so the neutral is the continuous blend.
    neutral: { amount: 0 },
    params: {
        /**
         * Number of mirrored wedges; below 2 is a no-op. Discrete: a fractional
         * wedge cannot tile the circle, so it rounds and a tween snaps.
         */
        segments: param.number({ default: 6, normalize: Math.round, min: 2, max: 64, step: 1, lerp: "step", inline: true }),
        /** Rotation of the pattern in degrees — animate to sweep the source. */
        angle: param.number({ default: 0, step: 1, unit: "deg" }),
        /** Fold origin in 0–1 layer coords. */
        center: param.vec2({ default: CENTER, min: 0, max: 1, step: 0.01, unit: "normalized", label: "foldCenter" }),
        /** Radial offset of the sampled wedge. */
        offset: param.number({ default: 0, min: -1, max: 1, control: "slider", label: "wedgeOffset" }),
        /** 0–1 blend from the original to the folded pattern. */
        amount: param.number({ default: 1, min: 0, max: 1, control: "slider" }),
    },
});

export const kaleidoscopeEffect: EffectData<KaleidoscopeEffect> = effectDataOf(kaleidoscopeSpec);
