import { Effects, type DirectionalBlurEffect } from "@motionscript/core";
import { definePort } from "./_pack.ts";

export default definePort<DirectionalBlurEffect, { sigma: number; rad: number }>({
    type: "directionalBlur",
    surface: "filter",
    params: {
        sigma: { type: "f32", uses: ["radius"], value: (_e, c) => c.sigma },
        axis: { type: "vec2f", uses: ["angle"], value: (_e, c) => [Math.cos(c.rad), Math.sin(c.rad)] },
    },
    prepare: (e) => (e.radius <= 0 ? null : { sigma: e.radius / 2, rad: (e.angle * Math.PI) / 180 }),
    extras: (_e, c) => ({ blur: [c.sigma, 0, c.rad], reach: 3 * c.sigma }),
    cases: () => [
        Effects.directionalBlur(20).list[0],
        Effects.directionalBlur({ radius: 30, angle: 45 }).list[0],
        Effects.directionalBlur({ radius: 12, angle: 100 }).list[0],
        Effects.directionalBlur({ radius: 120, angle: -20 }).list[0],
    ],
});
