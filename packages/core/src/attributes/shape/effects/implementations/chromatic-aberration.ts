import type { ModedEffect, EffectData } from "../effect-data";
import { defineEffect, effectDataOf, param, type EffectFields } from "../spec";

export interface ChromaticAberrationEffect extends ModedEffect, EffectFields<typeof chromaticAberrationSpec.params> {
    type: "chromaticAberration";
}

export const chromaticAberrationSpec = defineEffect({
    type: "chromaticAberration",
    group: "glitch",
    scalar: "amount",
    neutral: { amount: 0 },
    params: {
        /** Pixel offset distance for the R/B fringe. */
        amount: param.number({ default: 4, min: 0, unit: "px", inline: true }),
        /** Fringe axis in degrees — 0 = horizontal, R right / B left. */
        angle: param.number({ default: 0, unit: "deg" }),
    },
});

export const chromaticAberrationEffect: EffectData<ChromaticAberrationEffect> = effectDataOf(chromaticAberrationSpec);
