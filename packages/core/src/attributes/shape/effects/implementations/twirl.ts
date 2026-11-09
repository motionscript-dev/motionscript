import type { ModedEffect, EffectData } from "../effect-data";
import { CENTER, defineEffect, effectDataOf, param, type EffectFields } from "../spec";

/**
 * Twirl / swirl — the content is rotated about `center` by an amount that falls
 * off with distance, so the middle spins and the rim stays put.
 *
 * The falloff is what separates this from simply rotating the node: rotation is
 * rigid, this shears. Everything inside `radius` twists by a fraction of `angle`
 * that reaches full strength at the centre and zero at the rim, which is what
 * makes it read as a vortex rather than a transform.
 *
 * Animating `angle` past a full turn keeps winding — there is no wrap point, so
 * a long tween produces an ever-tightening spiral.
 */
export interface TwirlEffect extends ModedEffect, EffectFields<typeof twirlSpec.params> {
    type: "twirl";
}

/** The {@link TwirlEffect} spec: its parameters, defaults and ranges. */
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
