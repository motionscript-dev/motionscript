import type { ModedEffect, EffectData } from "../effect-data";
import { CENTER, defineEffect, effectDataOf, param, type EffectFields } from "../spec";

/** Which way samples smear around {@link RadialBlurEffect.center}: `"zoom"` along the radius (a rush toward or away from the centre) or `"spin"` along the tangent. (After Effects' "Type"; that name is the effect discriminator here, so the field is `style`.) */
export type RadialBlurStyle = "zoom" | "spin";

/** After Effects' Radial Blur: the source is sampled along a path radiating from (`zoom`) or circling (`spin`) a centre and the taps averaged. The centre stays sharp and the smear grows with distance, which reads as speed rather than softness. */
export interface RadialBlurEffect extends ModedEffect, EffectFields<typeof radialBlurSpec.params> {
    type: "radialBlur";
}

export const radialBlurSpec = defineEffect({
    type: "radialBlur",
    group: "blur",
    // Resamples along a path per pixel.
    surface: "shader",
    scalar: "amount",
    neutral: { amount: 0 },
    params: {
        /** Smear length, 0–1. */
        amount: param.number({ default: 0.5, min: 0, max: 1, control: "slider", inline: true, order: 1 }),
        /** Radial rush (`'zoom'`) or rotational streak (`'spin'`). */
        style: param.choice(["zoom", "spin"] satisfies RadialBlurStyle[], { default: "zoom", control: "segmented", optionsLabel: "radialBlurStyle", order: 0 }),
        /** Blur centre in 0–1 layer coords. */
        center: param.vec2({ default: CENTER, min: 0, max: 1, step: 0.01, unit: "normalized", order: 2 }),
        /** Taps averaged per pixel (max 32). A quality knob, so it snaps. */
        samples: param.number({ default: 16, min: 2, max: 32, step: 1, lerp: "step", hidden: true, order: 3 }),
    },
});

export const radialBlurEffect: EffectData<RadialBlurEffect> = effectDataOf(radialBlurSpec);
