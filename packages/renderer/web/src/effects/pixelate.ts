import { Effects, type PixelateEffect } from "@motionscript/core";
import { definePort } from "./_pack.ts";

export default definePort<PixelateEffect>({
    type: "pixelate",
    surface: "filter",
    params: { blocks: "param", sharpColors: "param" },
    // Blended blocks fade out over half a block past the grid's edge (the
    // engine's linear upsample of a decal grid). A block's size depends on
    // the box, which the packer doesn't see: reach a generous fixed amount.
    // The grid is anchored at the box's top-left, as the engine's is for a
    // node laid out around its own centre.
    extras: (e) => ({ reach: e.sharpColors ? 0 : 100 }),
    cases: () => [
        Effects.pixelate(40).list[0],
        Effects.pixelate({ blocks: { x: 40, y: 24 }, sharpColors: false }).list[0],
        Effects.pixelate({ blocks: { x: 12.5, y: 40 / 3 } }).list[0],
    ],
});
