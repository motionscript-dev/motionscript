import type { ModedEffect, EffectData } from "../effect-data";
import { defineEffect, effectDataOf, param, type EffectFields } from "../spec";

/**
 * Film grain — per-pixel noise blended into the node's own content.
 *
 * The noise is *signed* (it lightens and darkens around the source value) and
 * scaled by the local alpha, so it never bleeds past the silhouette and never
 * shifts the average exposure.
 *
 * Grain that doesn't move reads as a texture rather than as film, so
 * {@link animated} re-seeds the field every frame from the node's elapsed time.
 * For a deterministic render (e.g. a pixel-diff test) leave it off and animate
 * {@link seed} instead — a tween over `seed` gives the same shimmer frame-locked
 * to the timeline.
 */
export interface GrainEffect extends ModedEffect, EffectFields<typeof grainSpec.params> {
    type: "grain";
}

/** The {@link GrainEffect} spec: its parameters, defaults and ranges. */
export const grainSpec = defineEffect({
    type: "grain",
    group: "stylize",
    // Hashes each pixel's position into a noise value.
    surface: "shader",
    scalar: "amount",
    neutral: { amount: 0 },
    params: {
        /** 0–1 noise amplitude. */
        amount: param.number({ default: 0.25, min: 0, max: 1, control: "slider", inline: true }),
        /** Grain cell size in pixels. */
        size: param.number({ default: 1, min: 1, unit: "px", label: "grainSize" }),
        /** Random field offset — animate it for frame-locked shimmer. */
        seed: param.number({ default: 0, step: 1 }),
        /** Re-seed every frame from elapsed time. */
        animated: param.boolean({ default: false }),
        /** Per-channel colour speckle instead of luminance noise. */
        colored: param.boolean({ default: false }),
    },
});

export const grainEffect: EffectData<GrainEffect> = effectDataOf(grainSpec);
