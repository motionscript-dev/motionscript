import type { ModedEffect, EffectData } from "../effect-data";
import { defineEffect, effectDataOf, param, type EffectFields } from "../spec";

/**
 * Which convolution kernel detects the edges.
 *
 * - `"sobel"` — gradient magnitude with a centre-weighted 3×3 pair. The default:
 *   thick, smooth, noise-tolerant edges.
 * - `"prewitt"` — the same gradient pair without the centre weighting. Slightly
 *   thinner and more literal, noisier on gradients.
 * - `"laplacian"` — second derivative in one pass. Finest lines, picks up texture
 *   the gradient operators smooth over.
 */
export type EdgeKernel = "sobel" | "prewitt" | "laplacian";

/**
 * Edge detection — replaces the content with the magnitude of its own gradient,
 * so flat areas go black and boundaries light up.
 */
export interface EdgesEffect extends ModedEffect, EffectFields<typeof edgesSpec.params> {
    type: "edges";
}

/** The {@link EdgesEffect} spec: its parameters, defaults and ranges. */
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
