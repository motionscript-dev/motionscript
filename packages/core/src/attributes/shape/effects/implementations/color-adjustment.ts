import type { ModedEffect, EffectData } from "../effect-data";
import { defineEffect, effectDataOf, param, type EffectFields } from "../spec";

/** Photographic tonal and colour adjustments as a **node effect** (the grading panel `Adjustments.colorAdjustment` gives an image fill); all fields optional and neutral by default. Shares its type name and renderer handler with `ColorAdjustmentFilter` except for `vignette`, which a colour matrix cannot do (it needs each pixel's position): use `Effects.vignette()`. */
export interface ColorAdjustmentEffect extends ModedEffect, EffectFields<typeof colorAdjustmentSpec.params> {
    type: "colorAdjustment";
}

export const colorAdjustmentSpec = defineEffect({
    type: "colorAdjustment",
    group: "color",
    neutral: { contrast: 1, saturation: 1, temperature: 0 },
    // Every field is optional; `default` is what an absent one means.
    params: {
        /** −1…1, additive. */
        brightness: param.number({ default: 0, optional: true, min: -1, max: 1, control: "slider", inline: true }),
        /** 0…2, multiplicative around mid-grey. */
        contrast: param.number({ default: 1, optional: true, min: 0, max: 2, control: "slider" }),
        /** 0…3, multiplicative. */
        saturation: param.number({ default: 1, optional: true, min: 0, max: 3, control: "slider" }),
        /** Hue rotation in degrees. */
        hue: param.number({ default: 0, optional: true, unit: "deg", control: "hue" }),
        /** −1…1, saturation weighted toward muted colours. */
        vibrance: param.number({ default: 0, optional: true, min: -1, max: 1, control: "slider" }),
        /** −1…1, lifts or crushes the dark end. */
        shadows: param.number({ default: 0, optional: true, min: -1, max: 1, control: "slider" }),
        /** −1…1, lifts or crushes the bright end. */
        highlights: param.number({ default: 0, optional: true, min: -1, max: 1, control: "slider" }),
        /** −1…1, cool to warm. */
        temperature: param.number({ default: 0, optional: true, min: -1, max: 1, control: "slider" }),
        /** −1…1, green to magenta. */
        tint: param.number({ default: 0, optional: true, min: -1, max: 1, control: "slider", label: "tintAmount" }),
    },
});

export const colorAdjustmentEffect: EffectData<ColorAdjustmentEffect> = effectDataOf(colorAdjustmentSpec);
