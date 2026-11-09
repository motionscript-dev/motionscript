import { Effects, type BloomEffect } from "@motionscript/core";
import { definePort } from "./_pack.ts";

export default definePort<BloomEffect, { t: number; scale: number; sigma: number }>({
    type: "bloom",
    surface: "filter",
    params: {
        // The engine's threshold matrix: out = (in − t) / (1 − t).
        scale: { type: "f32", uses: ["threshold"], value: (_e, c) => c.scale },
        bias: { type: "f32", value: (_e, c) => -c.t * c.scale },
        intensity: "param",
    },
    uses: ["radius"],
    prepare(e) {
        if (e.radius <= 0 || e.intensity <= 0) return null;
        const t = Math.max(0, Math.min(1, e.threshold));
        return { t, scale: t < 1 ? 1 / (1 - t) : 1, sigma: e.radius / 2 };
    },
    extras: (_e, c) => ({ blur: [c.sigma, c.sigma, 0], reach: 3 * c.sigma }),
    cases: () => [
        Effects.bloom().list[0],
        Effects.bloom({ threshold: 0.4, radius: 24, intensity: 1.5 }).list[0],
        Effects.bloom({ threshold: 0, radius: 6, intensity: 0.6 }).list[0],
    ],
});
