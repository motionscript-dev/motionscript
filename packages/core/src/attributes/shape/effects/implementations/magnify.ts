import type { ModedEffect, EffectData } from "../effect-data";
import { CENTER, defineEffect, effectDataOf, param, type EffectFields } from "../spec";

export interface MagnifyEffect extends ModedEffect, EffectFields<typeof magnifySpec.params> {
    type: "magnify";
}

export const magnifySpec = defineEffect({
    type: "magnify",
    group: "distort",
    // Resamples the backdrop about `center`.
    surface: "shader",
    scalar: "scale",
    defaultMode: "backdrop",
    onlyOn: "backdrop",
    neutral: { scale: 1 },
    params: {
        /** Magnification factor — 1 = none, 2 = 2×, 0.5 = zoomed out. */
        scale: param.number({ default: 2, min: 0, step: 0.1, unit: "factor", label: "magnification", inline: true }),
        /** Magnify centre in 0–1 layer coords. */
        center: param.vec2({ default: CENTER, min: 0, max: 1, step: 0.01, unit: "normalized", label: "lensCenter" }),
    },
});

export const magnifyEffect: EffectData<MagnifyEffect> = effectDataOf(magnifySpec);
