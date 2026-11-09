import { Effects, type HalftoneEffect } from "@motionscript/core";
import { definePort } from "./_pack.ts";

export default definePort<HalftoneEffect>({
    type: "halftone",
    surface: "shader",
    params: {
        size: "param",
        angle: { type: "f32", value: (e) => (e.angle * Math.PI) / 180 },
        shape: "param",
        separation: "param",
    },
    // A sub-pixel pitch is a no-op in the engine; the pass checks it (needs the scale).
    // A cell whose centre is inside the node draws its dot across the edge: up to a pitch.
    extras: (e) => ({ reach: e.size }),
    cases: () => [
        Effects.halftone().list[0],
        Effects.halftone({ size: 10, angle: 20, shape: "line", separation: "rgb" }).list[0],
        Effects.halftone({ size: 12, shape: "cross", separation: "cmyk" }).list[0],
    ],
});
