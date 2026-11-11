import type { ModedEffect, EffectData } from "../effect-data";
import { defineEffect, effectDataOf, param, type EffectFields } from "../spec";

/** Unsharp mask: subtract a blurred copy from the content and add the difference back, `out = c + amount · (c − blur(c, radius))`. `radius` sets the scale of detail (small crisps texture, large adds "clarity"); past ~2 `amount` shows the classic halo. */
export interface SharpenEffect extends ModedEffect, EffectFields<typeof sharpenSpec.params> {
    type: "sharpen";
}

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
