import type { ModedEffect, EffectData } from "../effect-data";
import { defineEffect, effectDataOf, param, type EffectFields } from "../spec";

export interface GrayscaleEffect extends ModedEffect, EffectFields<typeof grayscaleSpec.params> {
    type: "grayscale";
}

export const grayscaleSpec = defineEffect({
    type: "grayscale",
    group: "color",
    scalar: "amount",
    neutral: { amount: 0 },
    params: {
        /** 0–1: 0 = original, 1 = fully desaturated. */
        amount: param.number({ default: 0, required: true, min: 0, max: 1, control: "slider", inline: true, initial: 1 }),
    },
});

export const grayscaleEffect: EffectData<GrayscaleEffect> = effectDataOf(grayscaleSpec);
