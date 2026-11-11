import type { ModedEffect, EffectData } from "../effect-data";
import { defineEffect, effectDataOf, param, type EffectFields } from "../spec";

/** Anamorphic glare: a bright pass smeared along `angle` only and screened back on. Where `bloom` spreads light equally, this asymmetry is the whole look (the horizontal flare a wide lens throws off a highlight, not a halo). */
export interface StreakEffect extends ModedEffect, EffectFields<typeof streakSpec.params> {
    type: "streak";
}

export const streakSpec = defineEffect({
    type: "streak",
    group: "light",
    // An anisotropic blur of a colour-matrix bright pass — all ImageFilter work.
    scalar: "intensity",
    neutral: { intensity: 0 },
    params: {
        /** Additive multiplier for the streak pass. */
        intensity: param.number({ default: 1, min: 0, max: 3, control: "slider", inline: true }),
        /** 0–1 luminance cutoff. */
        threshold: param.number({ default: 0.7, min: 0, max: 1, control: "slider" }),
        /** Smear length in pixels. */
        length: param.number({ default: 120, min: 0, unit: "px" }),
        /** Smear axis in degrees; 0 = horizontal. */
        angle: param.number({ default: 0, unit: "deg", control: "angle" }),
    },
});

export const streakEffect: EffectData<StreakEffect> = effectDataOf(streakSpec);
