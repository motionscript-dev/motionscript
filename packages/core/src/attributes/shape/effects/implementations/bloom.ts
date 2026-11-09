import type { ModedEffect, EffectData } from "../effect-data";
import { defineEffect, effectDataOf, param, type EffectFields } from "../spec";

export interface BloomEffect extends ModedEffect, EffectFields<typeof bloomSpec.params> {
    type: "bloom";
}

/** The {@link BloomEffect} spec: its parameters, defaults and ranges. */
export const bloomSpec = defineEffect({
    type: "bloom",
    group: "light",
    scalar: "intensity",
    neutral: { intensity: 0 },
    params: {
        /** 0–1 luminance cutoff — only pixels brighter than this bloom. */
        threshold: param.number({ default: 0.7, min: 0, max: 1, control: "slider" }),
        /** Spread in pixels. */
        radius: param.number({ default: 12, min: 0, unit: "px" }),
        /** Additive multiplier for the bloom pass. */
        intensity: param.number({ default: 1, min: 0, max: 3, control: "slider", inline: true }),
    },
});

export const bloomEffect: EffectData<BloomEffect> = effectDataOf(bloomSpec);
