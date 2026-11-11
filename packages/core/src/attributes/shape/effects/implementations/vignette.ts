import type { ModedEffect, EffectData } from "../effect-data";
import { defineEffect, effectDataOf, param, type EffectFields } from "../spec";

/** Darkened corners (lens falloff). The node box is normalised to a unit ellipse, so the falloff follows its aspect ratio. Untouched inside `radius`; from there to `radius + softness` the tint ramps in with a smoothstep, reaching `amount` at the corners. */
export interface VignetteEffect extends ModedEffect, EffectFields<typeof vignetteSpec.params> {
    type: "vignette";
}

export const vignetteSpec = defineEffect({
    type: "vignette",
    group: "light",
    // Needs each pixel's position within the node box to compute its falloff.
    surface: "shader",
    scalar: "amount",
    neutral: { amount: 0 },
    params: {
        /** 0–1 tint strength at the very edge. 0 = off. */
        amount: param.number({ default: 0.5, min: 0, max: 1, control: "slider", inline: true }),
        /** 0–1 normalised radius where the falloff starts (1 ≈ the box corners). */
        radius: param.number({ default: 0.75, min: 0, max: 1, control: "slider" }),
        /** 0–1 width of the ramp; 0 is a hard ring, 1 a long gradient. */
        softness: param.number({ default: 0.5, min: 0, max: 1, control: "slider" }),
        /** Tint colour — black darkens (the classic look), white blows the edges out. */
        color: param.color({ default: "black", label: "tint" }),
    },
});

export const vignetteEffect: EffectData<VignetteEffect> = effectDataOf(vignetteSpec);
