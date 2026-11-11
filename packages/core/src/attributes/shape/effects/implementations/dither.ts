import type { ModedEffect, EffectData } from "../effect-data";
import { defineEffect, effectDataOf, param, type EffectFields } from "../spec";

/** Size of the Bayer threshold matrix (2×2, 4×4, 8×8): bigger carries more threshold levels, a finer pattern and wider apparent tonal range. */
export type DitherMatrix = 2 | 4 | 8;

/** Where a pixel's threshold comes from: `'bayer'` (the ordered matrix; its lattice *is* the look, a visible crosshatch that can beat against the pixel grid at some `scale`s) or `'blue'` (void-and-cluster blue noise: homogeneous at every density, no lattice or moiré; texture rather than pattern). `matrix` only applies to `'bayer'`. */
export type DitherNoise = 'bayer' | 'blue';

/** Ordered dithering: quantize to `levels` tones per channel after offsetting each pixel's rounding by a threshold pattern, trading banding for texture (how 8-bit hardware faked gradients). Unlike `posterize`, which has no pattern and so makes flat bands. */
export interface DitherEffect extends ModedEffect, EffectFields<typeof ditherSpec.params> {
    type: "dither";
}

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
        /** Threshold pattern; see {@link DitherNoise}. */
        noise: param.choice(["bayer", "blue"] satisfies DitherNoise[], { default: "bayer", label: "ditherNoise", optionsLabel: "ditherNoise", order: 1 }),
    },
});

export const ditherEffect: EffectData<DitherEffect> = effectDataOf(ditherSpec);
