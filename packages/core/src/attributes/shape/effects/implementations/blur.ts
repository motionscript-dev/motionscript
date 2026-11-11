import type { ModedEffect, EffectData } from "../effect-data";
import { defineEffect, effectDataOf, param, type EffectFields } from "../spec";

export interface BlurEffect extends ModedEffect, EffectFields<typeof blurSpec.params> {
    type: "blur";
}

export const blurSpec = defineEffect({
    type: "blur",
    group: "blur",
    scalar: "radius",
    neutral: { radius: 0 },
    params: {
        /** Blur spread in pixels. */
        radius: param.number({ default: 0, required: true, min: 0, unit: "px", inline: true, initial: 4 }),
    },
});

export const blurEffect: EffectData<BlurEffect> = effectDataOf(blurSpec);
