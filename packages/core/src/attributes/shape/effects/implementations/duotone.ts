import type { ModedEffect, EffectData } from "../effect-data";
import { defineEffect, effectDataOf, param, type EffectFields } from "../spec";

/**
 * Duotone / gradient map — remap the content's luminance onto a two-colour ramp,
 * so black becomes `shadows`, white becomes `highlights`, and everything between
 * interpolates. Chroma in the source is discarded; only its brightness survives.
 *
 * The editorial two-colour treatment (Spotify covers, risograph posters) and the
 * general "tint a photo to brand colours" tool, both from one pair of colours.
 */
export interface DuotoneEffect extends ModedEffect, EffectFields<typeof duotoneSpec.params> {
    type: "duotone";
}

/** The {@link DuotoneEffect} spec: its parameters, defaults and ranges. */
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
