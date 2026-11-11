import type { ModedEffect, EffectData } from "../effect-data";
import { defineEffect, effectDataOf, param, type EffectFields } from "../spec";

/** Duotone / gradient map: the content's luminance remapped onto a two-colour ramp (black becomes `shadows`, white `highlights`); source chroma is discarded. */
export interface DuotoneEffect extends ModedEffect, EffectFields<typeof duotoneSpec.params> {
    type: "duotone";
}

export const duotoneSpec = defineEffect({
    type: "duotone",
    group: "color",
    // A luminance ramp is a plain affine colour transform, so it composes as an
    // ImageFilter (the default surface) rather than needing a shader scope.
    scalar: "amount",
    neutral: { amount: 0 },
    params: {
        /** 0–1 blend from the original colours to the full ramp. */
        amount: param.number({ default: 1, min: 0, max: 1, control: "slider", inline: true }),
        /** Colour the darkest tones map to. */
        shadows: param.color({ default: "black" }),
        /** Colour the brightest tones map to. */
        highlights: param.color({ default: "white" }),
    },
});

export const duotoneEffect: EffectData<DuotoneEffect> = effectDataOf(duotoneSpec);
