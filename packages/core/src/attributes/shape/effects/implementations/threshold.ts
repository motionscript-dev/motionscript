import type { ModedEffect, EffectData } from "../effect-data";
import { defineEffect, effectDataOf, param, type EffectFields } from "../spec";

/**
 * Two-tone cut: every pixel brighter than `level` becomes white, everything
 * else black — the stencil / high-contrast look.
 *
 * `smoothness` widens the cut into a ramp centred on `level`, which both
 * anti-aliases the boundary and, at higher values, keeps some midtone
 * modelling instead of a pure stencil.
 */
export interface ThresholdEffect extends ModedEffect, EffectFields<typeof thresholdSpec.params> {
    type: "threshold";
}

/** The {@link ThresholdEffect} spec: its parameters, defaults and ranges. */
export const thresholdSpec = defineEffect({
    type: "threshold",
    group: "color",
    // A non-linear per-pixel remap, drawn as its own pass.
    surface: "shader",
    scalar: "level",
    // Flattens colour to two tones at every level and smoothness.
    neutral: null,
    params: {
        /** 0–1 cut point. */
        level: param.number({ default: 0.5, min: 0, max: 1, control: "slider", inline: true }),
        /** 0–1 ramp width around the cut (just enough to anti-alias by default). */
        smoothness: param.number({ default: 0.05, min: 0, max: 1, control: "slider" }),
    },
});

export const thresholdEffect: EffectData<ThresholdEffect> = effectDataOf(thresholdSpec);
