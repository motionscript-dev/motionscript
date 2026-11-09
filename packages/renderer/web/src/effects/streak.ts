import { Effects, type StreakEffect } from "@motionscript/core";
import { definePort } from "./_pack.ts";

export default definePort<StreakEffect, { t: number; scale: number; sigma: number; rad: number }>({
    type: "streak",
    surface: "filter",
    params: {
        // The engine's threshold matrix: out = (in − t) / (1 − t).
        scale: { type: "f32", uses: ["threshold"], value: (_e, c) => c.scale },
        bias: { type: "f32", value: (_e, c) => -c.t * c.scale },
        intensity: "param",
        sigma: { type: "f32", uses: ["length"], value: (_e, c) => c.sigma },
        axis: { type: "vec2f", uses: ["angle"], value: (_e, c) => [Math.cos(c.rad), Math.sin(c.rad)] },
    },
    prepare(e) {
        if (e.intensity <= 0 || e.length <= 0) return null;
        const t = Math.max(0, Math.min(1, e.threshold));
        return { t, scale: t < 1 ? 1 / (1 - t) : 1, sigma: e.length / 2, rad: (e.angle * Math.PI) / 180 };
    },
    extras: (_e, c) => ({ blur: [c.sigma, 0.01, c.rad], reach: 3 * c.sigma }),
    cases: () => [
        Effects.streak().list[0],
        Effects.streak({ angle: 30, length: 80, threshold: 0.5, intensity: 1.5 }).list[0],
        Effects.streak({ angle: 90, length: 60, threshold: 0.3, intensity: 0.7 }).list[0],
    ],
});
