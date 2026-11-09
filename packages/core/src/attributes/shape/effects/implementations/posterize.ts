import type { ModedEffect, EffectData } from "../effect-data";
import { defineEffect, effectDataOf, param, type EffectFields } from "../spec";

/**
 * After Effects-style Posterize.
 *
 * Quantizes each colour channel into `levels` evenly-spaced brightness steps, so
 * smooth gradients collapse into flat bands. `levels` is the number of tones per
 * channel (matching AE's single "Level" parameter): 2 → pure two-tone per
 * channel, higher values keep more detail. Below 2 there is nothing to band, so
 * the effect is a no-op.
 */
export interface PosterizeEffect extends ModedEffect, EffectFields<typeof posterizeSpec.params> {
    type: "posterize";
}

/** The {@link PosterizeEffect} spec: its parameters, defaults and ranges. */
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
