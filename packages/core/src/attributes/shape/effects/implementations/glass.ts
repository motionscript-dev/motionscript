import type { ModedEffect, EffectData } from "../effect-data";
import { defineEffect, effectDataOf, param, type EffectFields } from "../spec";

/** Figma's Glass: the backdrop seen through a slab whose edge curves down to the node's outline, refracted, split into a spectrum, optionally frosted, with a rim of light. Fields and units are Figma's (`depth`/`frost` px, `lightAngle` degrees clockwise from the top, the rest 0–100), so copied values render the same. Only meaningful on the **backdrop** (nothing to refract in a node's own paint), so `Effects.glass()` defaults `mode` to `'backdrop'`. */
export interface GlassEffect extends ModedEffect, EffectFields<typeof glassSpec.params> {
    type: "glass";
}

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
