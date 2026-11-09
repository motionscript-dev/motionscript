import type { ModedEffect, EffectData } from "../effect-data";
import { defineEffect, effectDataOf, param, type EffectFields } from "../spec";

/**
 * Unsharp mask — the standard sharpen: subtract a blurred copy of the content
 * from itself and add the difference back, which exaggerates local contrast at
 * edges.
 *
 *   out = c + amount · (c − blur(c, radius))
 *
 * `radius` sets the scale of detail affected (a small radius crisps fine texture,
 * a large one adds "clarity" to broad shapes); `amount` sets how hard. Past
 * ~2 the classic halo artefact shows up, which is sometimes the point.
 */
export interface SharpenEffect extends ModedEffect, EffectFields<typeof sharpenSpec.params> {
    type: "sharpen";
}

/** The {@link SharpenEffect} spec: its parameters, defaults and ranges. */
export const sharpenSpec = defineEffect({
    type: "sharpen",
    group: "blur",
    // Convolves a neighbourhood, so it resamples.
    surface: "shader",
    scalar: "amount",
    neutral: { amount: 0 },
    params: {
        /** Edge-contrast boost. */
        amount: param.number({ default: 1, min: 0, max: 4, control: "slider", inline: true }),
        /** Radius of the blurred reference, in pixels. */
        radius: param.number({ default: 1, min: 0, unit: "px" }),
    },
});

export const sharpenEffect: EffectData<SharpenEffect> = effectDataOf(sharpenSpec);
