import type { ModedEffect, EffectData } from "../effect-data";
import { defineEffect, effectDataOf, param, type EffectFields } from "../spec";

/** Which convolution kernel detects edges: `"sobel"` (default; thick, smooth, noise-tolerant), `"prewitt"` (no centre weighting: slightly thinner, noisier on gradients), `"laplacian"` (second derivative in one pass: finest lines, picks up texture the gradients smooth over). */
export type EdgeKernel = "sobel" | "prewitt" | "laplacian";

/** Edge detection: replaces the content with the magnitude of its own gradient, so flat areas go black and boundaries light up. */
export interface EdgesEffect extends ModedEffect, EffectFields<typeof edgesSpec.params> {
    type: "edges";
}

export const edgesSpec = defineEffect({
    type: "edges",
    group: "stylize",
    // Convolves a 3×3 neighbourhood.
    surface: "shader",
    scalar: "strength",
    neutral: { strength: 0 },
    params: {
        /** Multiplier on the detected gradient. */
        strength: param.number({ default: 1, min: 0, max: 4, control: "slider", inline: true }),
        /** Which operator measures the gradient. */
        kernel: param.choice(["sobel", "prewitt", "laplacian"] satisfies EdgeKernel[], { default: "sobel", optionsLabel: "edgeKernel" }),
        /** Detect per RGB channel instead of on luminance. */
        colored: param.boolean({ default: false }),
    },
});

export const edgesEffect: EffectData<EdgesEffect> = effectDataOf(edgesSpec);
