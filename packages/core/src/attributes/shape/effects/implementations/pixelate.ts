import type { ModedEffect, EffectData } from "../effect-data";
import { defineEffect, effectDataOf, param, type EffectFields } from "../spec";

/** After Effects-style Mosaic. `blocks` is the *number of blocks* across the node per axis (AE's "Horizontal/Vertical Blocks"): a count equal to the node's pixel dimension leaves the image untouched, lower is coarser. `sharpColors` (AE's "Sharp Colors") makes each block one solid colour (nearest-neighbour) instead of smoothly interpolated between centres. */
export interface PixelateEffect extends ModedEffect, EffectFields<typeof pixelateSpec.params> {
    type: "pixelate";
}

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
