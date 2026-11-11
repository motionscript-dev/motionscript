import type { ModedEffect, EffectData } from "../effect-data";
import { CENTER, defineEffect, effectDataOf, param, type EffectFields } from "../spec";

/** How the blur ramp is laid out: `"linear"` runs along `angle` (the fade-to-blur strip under a toolbar), `"radial"` runs outward from `center` (sharp middle, soft surround: a cheap tilt-shift). */
export type ProgressiveBlurShape = "linear" | "radial";

/** Blur whose radius *ramps* from `startRadius` to `radius` between `start` and `end` along the ramp, so content dissolves into softness. **In `mode: 'backdrop'` this is the frosted panel with a falloff** (blur fading out at the edge, which a plain backdrop blur cannot express). Cost scales with `samples`, spent on the *widest* part of the ramp; pixels below `start` return the source untouched. */
export interface ProgressiveBlurEffect extends ModedEffect, EffectFields<typeof progressiveBlurSpec.params> {
    type: "progressiveBlur";
}

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
        /** Blur spread in px at the near end of the ramp (0 is sharp). */
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
