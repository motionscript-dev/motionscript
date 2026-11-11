import type { ModedEffect, EffectData } from "../effect-data";
import { defineEffect, effectDataOf, param, type EffectFields } from "../spec";

export interface ScatterEffect extends ModedEffect, EffectFields<typeof scatterSpec.params> {
    type: "scatter";
}

export const scatterSpec = defineEffect({
    type: "scatter",
    group: "glitch",
    // Displaces each pixel by a hash of its position, so it needs random access
    // to its source. It was realised as a displacement-map ImageFilter until the
    // filter path's layer snapping was found to re-roll the field whenever the
    // node stood on a fractional pixel — see the renderer's `scatter` handler,
    // which carries the full account.
    surface: "shader",
    scalar: "strength",
    neutral: { strength: 0 },
    params: {
        /** Maximum random pixel displacement. */
        strength: param.number({ default: 10, min: 0, unit: "px", inline: true }),
        /** Axis pixels are scattered along. */
        axis: param.axis({ default: "both", label: "direction", optionsLabel: "effectAxis" }),
    },
});

export const scatterEffect: EffectData<ScatterEffect> = effectDataOf(scatterSpec);
