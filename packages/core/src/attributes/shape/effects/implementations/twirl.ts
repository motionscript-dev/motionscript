import type { ModedEffect, EffectData } from "../effect-data";
import { CENTER, defineEffect, effectDataOf, param, type EffectFields } from "../spec";

/** Twirl / swirl: the content rotates about `center` by an amount that falls off with distance (full `angle` at the centre, zero at the rim of `radius`), so it shears like a vortex rather than rotating rigidly. There is no wrap point: animating `angle` past a full turn keeps winding into an ever-tighter spiral. */
export interface TwirlEffect extends ModedEffect, EffectFields<typeof twirlSpec.params> {
    type: "twirl";
}

export const twirlSpec = defineEffect({
    type: "twirl",
    group: "distort",
    // Resamples the source at a rotated position.
    surface: "shader",
    scalar: "angle",
    neutral: { angle: 0 },
    params: {
        /** Rotation at the centre in degrees. */
        angle: param.number({ default: 180, unit: "deg", label: "twist", inline: true }),
        /** 0–1 radius of influence (1 = the whole node). */
        radius: param.number({ default: 1, min: 0, max: 1, control: "slider", label: "reach" }),
        /** Vortex centre in 0–1 layer coords. */
        center: param.vec2({ default: CENTER, min: 0, max: 1, step: 0.01, unit: "normalized", label: "vortexCenter" }),
    },
});

export const twirlEffect: EffectData<TwirlEffect> = effectDataOf(twirlSpec);
