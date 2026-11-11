import type { ModedEffect, EffectData } from "../effect-data";
import { defineEffect, effectDataOf, param, type EffectFields } from "../spec";

/** Which channel / colour component is inverted: a single `'red' | 'green' | 'blue'`; `'rgba'` (red, green, blue; alpha untouched); `'alpha'`; `'hue'` (rotated 180°); `'luminance'` (perceptual BT.709, preserving chroma). */
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
