import type { ModedEffect, EffectData } from "../effect-data";
import { defineEffect, effectDataOf, param, type EffectFields } from "../spec";

/**
 * Size of the Bayer threshold matrix: 2×2, 4×4 or 8×8. Bigger matrices carry
 * more distinct threshold levels, so the pattern is finer and the apparent tonal
 * range wider — 2 is a blunt checkerboard, 8 the smooth classic ordered dither.
 */
export type DitherMatrix = 2 | 4 | 8;

/**
 * Where a pixel's threshold comes from.
 *
 * - `'bayer'` — the recursive ordered matrix. Its lattice *is* the look: the
 *   crosshatch is visible at every density, which is what reads as 8-bit and
 *   what makes it beat against the pixel grid at some `scale`s.
 * - `'blue'` — a void-and-cluster blue-noise field. Every density stays
 *   homogeneous, so the tone is reproduced with no lattice and no moiré. Pick
 *   this when the dither should be texture rather than pattern.
 *
 * `matrix` only applies to `'bayer'`.
 */
export type DitherNoise = 'bayer' | 'blue';

/**
 * Ordered dithering — quantize the image to `levels` tones per channel, but
 * offset each pixel's rounding by a threshold pattern first. The error is traded
 * for texture instead of banding, which is how 8-bit hardware faked gradients.
 *
 * `noise` picks which pattern: the classic Bayer matrix (visible crosshatch, the
 * retro look) or blue noise (no visible structure at any density).
 *
 * Contrast with `posterize`, which quantizes with no threshold pattern and so
 * produces flat bands.
 */
export interface DitherEffect extends ModedEffect, EffectFields<typeof ditherSpec.params> {
    type: "dither";
}

/** The {@link DitherEffect} spec: its parameters, defaults and ranges. */
export const ditherSpec = defineEffect({
    type: "dither",
    group: "stylize",
    // The threshold depends on the pixel's position in the pattern.
    surface: "shader",
    scalar: "levels",
    neutral: { levels: 255 },
    params: {
        /** Output tones per channel, ≥ 2. */
        levels: param.number({ default: 2, min: 2, max: 32, step: 1, inline: true, order: 0 }),
        /** Bayer matrix size. Ignored when `noise` is `'blue'`. */
        matrix: param.choice([2, 4, 8] satisfies DitherMatrix[], { default: 4, optionsLabel: "ditherMatrix", order: 2 }),
        /** Pattern cell size in pixels. */
        scale: param.number({ default: 1, min: 1, step: 1, unit: "px", label: "cellSize", order: 3 }),
        /** Dither luminance to black and white. */
        monochrome: param.boolean({ default: false, order: 4 }),
        /**
         * Threshold pattern. `'bayer'` is the classic ordered matrix — a visible
         * crosshatch, the retro look, which can beat against the pixel grid at
         * some `scale`s. `'blue'` is a void-and-cluster blue-noise field: same
         * tone reproduction, no lattice, no moiré.
         */
        noise: param.choice(["bayer", "blue"] satisfies DitherNoise[], { default: "bayer", label: "ditherNoise", optionsLabel: "ditherNoise", order: 1 }),
    },
});

export const ditherEffect: EffectData<DitherEffect> = effectDataOf(ditherSpec);
