import type { ModedEffect, EffectData } from "../effect-data";
import { CENTER, defineEffect, effectDataOf, param, type EffectFields } from "../spec";

/** How the wave's crests are laid out: `"linear"` (parallel crests travelling along `angle`: flags, heat shimmer) or `"radial"` (concentric rings from `center`: pond ripples, drop impacts). */
export type WaveShape = "linear" | "radial";

/** Sine displacement, the procedural warp that needs no asset: pixels are resampled at an offset by a sine of their own coordinate (see `displace` for an image-driven warp). `phase` is in degrees and wraps, so a **linear tween of `phase` over 360 loops seamlessly**: how the wave travels. */
export interface WaveEffect extends ModedEffect, EffectFields<typeof waveSpec.params> {
    type: "wave";
}

export const waveSpec = defineEffect({
    type: "wave",
    group: "distort",
    // Resamples the source at an offset position.
    surface: "shader",
    scalar: "amplitude",
    neutral: { amplitude: 0 },
    params: {
        /** Peak displacement in px per axis. A bare number means Y only: displacing along the direction of travel just smears. */
        amplitude: param.vec2({ default: 20, fromNumber: "y", unit: "px" }),
        /** Distance between crests in px. */
        wavelength: param.number({ default: 120, min: 1, unit: "px", inline: true }),
        /** Phase in degrees; tween over 360 for one seamless loop. */
        phase: param.number({ default: 0, step: 1, unit: "deg" }),
        /** Parallel bands or concentric rings. */
        shape: param.choice(["linear", "radial"] satisfies WaveShape[], { default: "linear", label: "crestShape", optionsLabel: "waveShape" }),
        /** Direction the crests advance along, in degrees. `'linear'` only. */
        angle: param.number({ default: 0, unit: "deg", control: "angle" }),
        /** Ring origin in 0–1 layer coords. `'radial'` only. */
        center: param.vec2({ default: CENTER, min: 0, max: 1, step: 0.01, unit: "normalized", label: "ringCenter" }),
    },
});

export const waveEffect: EffectData<WaveEffect> = effectDataOf(waveSpec);
