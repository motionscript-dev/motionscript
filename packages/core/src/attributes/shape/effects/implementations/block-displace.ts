import type { ModedEffect, EffectData } from "../effect-data";
import { defineEffect, effectDataOf, param, type EffectFields } from "../spec";

/**
 * Datamosh-style tearing: the content is cut into bands and each band is
 * displaced by a random amount.
 *
 * `density` is what separates this from noise — only that fraction of bands
 * move at all, so the image stays readable and the tear reads as a fault rather
 * than as static. Turn it to 1 and every band shifts.
 *
 * The displacement is a pure function of the band index and `seed`, so a frame
 * always re-renders identically. Animate `seed` (in whole steps) to make the
 * glitch jump between distinct states rather than sliding smoothly, which is
 * what makes it read as digital.
 */
export interface BlockDisplaceEffect extends ModedEffect, EffectFields<typeof blockDisplaceSpec.params> {
    type: "blockDisplace";
}

/** The {@link BlockDisplaceEffect} spec: its parameters, defaults and ranges. */
export const blockDisplaceSpec = defineEffect({
    type: "blockDisplace",
    group: "glitch",
    // Resamples the source at a displaced position.
    surface: "shader",
    scalar: "amount",
    neutral: { amount: 0 },
    params: {
        /** Maximum displacement in px. */
        amount: param.number({ default: 20, min: 0, unit: "px", inline: true }),
        /** Band thickness in px. */
        size: param.number({ default: 16, min: 1, unit: "px", label: "bandSize" }),
        /** 0–1 fraction of bands that move at all. */
        density: param.number({ default: 0.3, min: 0, max: 1, control: "slider" }),
        /** Random field offset — step it to jump between glitch states. */
        seed: param.number({ default: 0, step: 1 }),
        /** Which way bands slide. */
        axis: param.axis({ default: "x", label: "direction", optionsLabel: "effectAxis" }),
    },
});

export const blockDisplaceEffect: EffectData<BlockDisplaceEffect> = effectDataOf(blockDisplaceSpec);
