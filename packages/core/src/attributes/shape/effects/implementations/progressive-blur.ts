import type { ModedEffect, EffectData } from "../effect-data";
import { CENTER, defineEffect, effectDataOf, param, type EffectFields } from "../spec";

/**
 * How the blur ramp is laid out across the node.
 *
 * - `"linear"` — the ramp runs along `angle`, so the blur builds from one edge
 *   toward the other. The gradient/fade-to-blur strip under a toolbar or over
 *   the bottom of a hero image.
 * - `"radial"` — the ramp runs outward from `center`, so the middle stays sharp
 *   and the surround softens. A cheap depth-of-field / tilt-shift.
 */
export type ProgressiveBlurShape = "linear" | "radial";

/**
 * Blur whose radius *ramps* across the node instead of being uniform.
 *
 * A plain blur is a constant; this interpolates from `startRadius` to `radius`
 * between `start` and `end` along the ramp, which is what makes content appear
 * to dissolve into softness rather than simply being out of focus.
 *
 * **In `mode: 'backdrop'` this is the frosted panel with a falloff** — the
 * translucent bar whose blur fades out at its edge instead of stopping at a hard
 * line. That is the case a plain backdrop blur cannot express, and the reason
 * this effect exists.
 *
 * Cost scales with `samples`, which are spent on the *widest* part of the ramp;
 * pixels below `start` return the source untouched without sampling at all.
 */
export interface ProgressiveBlurEffect extends ModedEffect, EffectFields<typeof progressiveBlurSpec.params> {
    type: "progressiveBlur";
}

/** The {@link ProgressiveBlurEffect} spec: its parameters, defaults and ranges. */
export const progressiveBlurSpec = defineEffect({
    type: "progressiveBlur",
    group: "blur",
    // Averages a neighbourhood whose extent varies per pixel.
    surface: "shader",
    scalar: "radius",
    neutral: { radius: 0 },
    params: {
        /** Blur spread in px at the far end of the ramp. */
        radius: param.number({ default: 24, min: 0, unit: "px", label: "endBlur", order: 2 }),
        /** Blur spread in px at the near end of the ramp (0: sharp, what it did before the field existed). */
        startRadius: param.number({ default: 0, min: 0, unit: "px", label: "startBlur", order: 1 }),
        /** Ramp layout. */
        shape: param.choice(["linear", "radial"] satisfies ProgressiveBlurShape[], { default: "linear", control: "segmented", label: "rampShape", optionsLabel: "rampShape", order: 0 }),
        /** 0–1 where the blur starts building. */
        start: param.number({ default: 0, min: -0.5, max: 1.5, control: "slider", label: "rampStart", order: 3 }),
        /** 0–1 where it reaches `radius`. */
        end: param.number({ default: 1, min: -0.5, max: 1.5, control: "slider", label: "rampEnd", order: 4 }),
        /** Ramp direction in degrees; 0 = left-to-right, 90 = downward. */
        angle: param.number({ default: 90, unit: "deg", control: "angle", order: 5 }),
        /** Ramp origin in 0–1 layer coords. `'radial'` only. */
        center: param.vec2({ default: CENTER, min: 0, max: 1, step: 0.01, unit: "normalized", order: 6 }),
        /** Taps averaged at full radius, 2–32. A fractional count would just round, so it snaps. */
        samples: param.number({ default: 20, min: 2, max: 32, step: 1, lerp: "step", hidden: true, order: 7, initial: 16 }),
    },
});

export const progressiveBlurEffect: EffectData<ProgressiveBlurEffect> = effectDataOf(progressiveBlurSpec);
