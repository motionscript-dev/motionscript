import type { ModedEffect, EffectData } from "../effect-data";
import { defineEffect, effectDataOf, param, type EffectFields } from "../spec";

/**
 * Which channel(s) / colour space component the invert is applied to.
 *
 * - `'red' | 'green' | 'blue'`  — invert a single RGB channel.
 * - `'rgba'`                    — invert red, green and blue (alpha untouched).
 * - `'alpha'`                   — invert the alpha channel.
 * - `'hue'`                     — rotate hue by 180°.
 * - `'luminance'`               — invert perceptual luminance (BT.709) while preserving chroma.
 */
export type InvertChannel =
    | "red"
    | "green"
    | "blue"
    | "rgba"
    | "alpha"
    | "hue"
    | "luminance";

export interface InvertEffect extends ModedEffect, EffectFields<typeof invertSpec.params> {
    type: "invert";
}

/** The {@link InvertEffect} spec: its parameters, defaults and ranges. */
export const invertSpec = defineEffect({
    type: "invert",
    group: "color",
    scalar: "strength",
    neutral: { strength: 0 },
    params: {
        /** Which channel / colour component to invert. */
        channel: param.choice(["rgba", "red", "green", "blue", "alpha", "hue", "luminance"] satisfies InvertChannel[], { default: "rgba", optionsLabel: "invertChannel" }),
        /** 0–1: blend from original (0) to fully inverted (1). */
        strength: param.number({ default: 1, min: 0, max: 1, control: "slider", inline: true }),
    },
});

export const invertEffect: EffectData<InvertEffect> = effectDataOf(invertSpec);
