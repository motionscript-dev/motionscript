import type { ModedEffect, EffectData } from "../effect-data";
import { defineEffect, effectDataOf, param, type EffectFields } from "../spec";

/**
 * After Effects-style Mosaic / pixelate.
 *
 * `blocks` is the *number of blocks* across the node on each axis, exactly like
 * AE's Mosaic "Horizontal Blocks" / "Vertical Blocks". A count equal to the
 * node's pixel dimension on that axis leaves the image untouched (one block per
 * pixel); lower counts give larger, coarser blocks. For a 1920×1080 image,
 * `{ x: 1920, y: 1080 }` is pristine and `{ x: 200, y: 180 }` is heavily
 * pixelated.
 *
 * `sharpColors` mirrors AE's "Sharp Colors" checkbox: when `true` each block is
 * a single solid colour with hard edges (nearest-neighbour); when `false` the
 * block colours are smoothly interpolated between centres (linear).
 */
export interface PixelateEffect extends ModedEffect, EffectFields<typeof pixelateSpec.params> {
    type: "pixelate";
}

/** The {@link PixelateEffect} spec: its parameters, defaults and ranges. */
export const pixelateSpec = defineEffect({
    type: "pixelate",
    group: "stylize",
    scalar: "blocks",
    // Resolution-relative: inert only while a block is finer than the pixel grid.
    neutral: { blocks: 1920 },
    params: {
        /** Block count per axis; a bare number sets both. */
        blocks: param.vec2({ default: 1, fromNumber: "both", required: true, min: 1, step: 1, initial: { x: 64, y: 64 } }),
        /** AE "Sharp Colors": solid blocks (true) vs. smoothly blended. */
        sharpColors: param.boolean({ default: true }),
    },
});

export const pixelateEffect: EffectData<PixelateEffect> = effectDataOf(pixelateSpec);
