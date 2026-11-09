import type { ModedEffect, EffectData } from "../effect-data";
import { defineEffect, effectDataOf, param, type EffectFields } from "../spec";

export interface VintageEffect extends ModedEffect, EffectFields<typeof vintageSpec.params> {
    type: "vintage";
}

/** The {@link VintageEffect} spec: its parameters, defaults and ranges. */
export const vintageSpec = defineEffect({
    type: "vintage",
    group: "color",
    scalar: "amount",
    neutral: { amount: 0, warmth: 0 },
    params: {
        /** 0–1: 0 = original, 1 = full sepia + desaturate. */
        amount: param.number({ default: 1, min: 0, max: 1, control: "slider", inline: true }),
        /** −1…1: negative = cool/cyan tint, positive = warm/amber. */
        warmth: param.number({ default: 0.2, min: -1, max: 1, control: "slider" }),
    },
});

export const vintageEffect: EffectData<VintageEffect> = effectDataOf(vintageSpec);
