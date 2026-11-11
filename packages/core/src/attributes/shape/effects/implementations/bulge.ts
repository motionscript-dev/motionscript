import type { ModedEffect, EffectData } from "../effect-data";
import { CENTER, defineEffect, effectDataOf, param, type EffectFields } from "../spec";

export interface BulgeEffect extends ModedEffect, EffectFields<typeof bulgeSpec.params> {
    type: "bulge";
}

export const bulgeSpec = defineEffect({
    type: "bulge",
    group: "distort",
    // Warps its source: samples a displaced texel per fragment.
    surface: "shader",
    scalar: "strength",
    neutral: { strength: 0 },
    params: {
        /** Positive bulges (barrel), negative pinches (pincushion). Range ≈ −1…1. */
        strength: param.number({ default: 0, required: true, min: -1, max: 1, control: "slider", inline: true, initial: 0.5 }),
        /** Lens centre in 0–1 layer coords. */
        center: param.vec2({ default: CENTER, min: 0, max: 1, step: 0.01, unit: "normalized", label: "lensCenter" }),
    },
});

export const bulgeEffect: EffectData<BulgeEffect> = effectDataOf(bulgeSpec);
