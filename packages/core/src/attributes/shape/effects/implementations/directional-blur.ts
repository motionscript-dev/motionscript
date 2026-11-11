import type { ModedEffect, EffectData } from "../effect-data";
import { defineEffect, effectDataOf, param, type EffectFields } from "../spec";

/**
 * Motion-blur-style directional (linear) blur. Unlike {@link BlurEffect}, which
 * blurs uniformly in all directions, this smears the node's own content along a
 * single axis.
 */
export interface DirectionalBlurEffect extends ModedEffect, EffectFields<typeof directionalBlurSpec.params> {
    type: "directionalBlur";
}

export const directionalBlurSpec = defineEffect({
    type: "directionalBlur",
    group: "blur",
    scalar: "radius",
    neutral: { radius: 0 },
    params: {
        /** Smear length in pixels along `angle`. */
        radius: param.number({ default: 0, required: true, min: 0, unit: "px", label: "length", inline: true, order: 1, initial: 10 }),
        /** Smear axis in degrees — 0 = horizontal, 90 = vertical. */
        angle: param.number({ default: 0, unit: "deg", order: 0 }),
    },
});

export const directionalBlurEffect: EffectData<DirectionalBlurEffect> = effectDataOf(directionalBlurSpec);
