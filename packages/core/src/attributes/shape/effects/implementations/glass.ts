import type { ModedEffect, EffectData } from "../effect-data";
import { defineEffect, effectDataOf, param, type EffectFields } from "../spec";

/**
 * Figma's Glass: the backdrop seen through a slab of glass whose edge curves
 * down to the node's outline — refracted, split into a spectrum at the curve,
 * optionally frosted, with a rim of light.
 *
 * The fields are Figma's own, in Figma's units, so values copied from a Figma
 * file render the same: `depth` and `frost` are px, `lightAngle` is degrees
 * clockwise from the top, and the rest are 0–100 amounts.
 *
 * Glass only has meaning on the **backdrop** — there is nothing to refract in a
 * node's own paint — so `Effects.glass()` defaults `mode` to `'backdrop'` and the
 * renderer's handler serves that target only.
 */
export interface GlassEffect extends ModedEffect, EffectFields<typeof glassSpec.params> {
    type: "glass";
}

/** The {@link GlassEffect} spec: its parameters, defaults and ranges. */
export const glassSpec = defineEffect({
    type: "glass",
    group: "light",
    // Resamples the backdrop through a bevel, three times per fragment.
    surface: "shader",
    scalar: "refraction",
    defaultMode: "backdrop",
    onlyOn: "backdrop",
    // No curved edge means nothing to refract or light along.
    neutral: { depth: 0 },
    params: {
        /** Where the light comes from, in degrees clockwise from the top. */
        lightAngle: param.number({ default: -45, unit: "deg", control: "angle", zero: "top" }),
        /** 0–100 brightness of the light. */
        lightIntensity: param.number({ default: 80, min: 0, max: 100, unit: "percent" }),
        /** 0–100 how strongly the curved edge bends the backdrop. */
        refraction: param.number({ default: 80, min: 0, max: 100, step: 1, control: "slider", inline: true }),
        /** How far the curved edge reaches in from the outline, px. */
        depth: param.number({ default: 20, min: 0, max: 100, step: 1, unit: "px", control: "slider" }),
        /** 0–100 spectral split along the curved edge. */
        dispersion: param.number({ default: 50, min: 0, max: 100, step: 1, control: "slider" }),
        /** Backdrop blur radius, px. */
        frost: param.number({ default: 4, min: 0, max: 100, step: 1, unit: "px", control: "slider" }),
        /** 0–100 how far the projected light spreads in from the rim. */
        splay: param.number({ default: 0, min: 0, max: 100, step: 1, control: "slider" }),
    },
});

export const glassEffect: EffectData<GlassEffect> = effectDataOf(glassSpec);
