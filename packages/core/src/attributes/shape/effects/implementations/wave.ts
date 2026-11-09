import type { ModedEffect, EffectData } from "../effect-data";
import { CENTER, defineEffect, effectDataOf, param, type EffectFields } from "../spec";

/**
 * How the wave's crests are laid out.
 *
 * - `"linear"` — parallel crests running across the node, travelling along
 *   `angle`. Flags, banners, wobbling type, heat shimmer.
 * - `"radial"` — concentric rings expanding from `center`. The pond-ripple /
 *   drop-impact look, and the one that reads as *something happened here*.
 */
export type WaveShape = "linear" | "radial";

/**
 * Sine displacement — the procedural warp that needs no asset.
 *
 * Pixels are resampled at a position offset by a sine of their own coordinate,
 * so the content ripples without anything being generated or loaded. For an
 * arbitrary warp driven by an image, see `displace`.
 *
 * `phase` is in degrees and the sine wraps, so a **linear tween of `phase` over
 * 360 loops seamlessly** — that is how you make the wave travel. Animating it is
 * the whole point; a static wave reads as a distortion rather than as motion.
 */
export interface WaveEffect extends ModedEffect, EffectFields<typeof waveSpec.params> {
    type: "wave";
}

/** The {@link WaveEffect} spec: its parameters, defaults and ranges. */
export const waveSpec = defineEffect({
    type: "wave",
    group: "distort",
    // Resamples the source at an offset position.
    surface: "shader",
    scalar: "amplitude",
    neutral: { amplitude: 0 },
    params: {
        /**
         * Peak displacement in px per axis. A bare number means the Y axis only:
         * a wave that displaces along its own direction of travel just smears.
         */
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
