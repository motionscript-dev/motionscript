import type { ModedEffect, EffectData } from "../effect-data";
import { defineEffect, effectDataOf, param, type EffectFields } from "../spec";

/** After Effects-style Posterize: quantizes each channel into `levels` evenly spaced steps (AE's single "Level"), collapsing gradients into flat bands. Below 2 there is nothing to band: a no-op. */
export interface PosterizeEffect extends ModedEffect, EffectFields<typeof posterizeSpec.params> {
    type: "posterize";
}

export const posterizeSpec = defineEffect({
    type: "posterize",
    group: "color",
    // Reads its source texel-by-texel through a banding shader.
    surface: "shader",
    scalar: "levels",
    neutral: { levels: 255 },
    params: {
        /** Number of brightness levels per channel (≥ 2). */
        levels: param.number({ default: 4, min: 2, step: 1, inline: true }),
    },
});

export const posterizeEffect: EffectData<PosterizeEffect> = effectDataOf(posterizeSpec);
