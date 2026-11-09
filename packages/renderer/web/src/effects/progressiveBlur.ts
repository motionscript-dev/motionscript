import { Effects, type ProgressiveBlurEffect } from "@motionscript/core";
import { definePort } from "./_pack.ts";

export default definePort<ProgressiveBlurEffect, { start0: number }>({
    type: "progressiveBlur",
    surface: "shader",
    params: {
        center: "param",
        direction: {
            type: "vec2f",
            uses: ["angle"],
            value(e) {
                const a = (e.angle * Math.PI) / 180;
                return [Math.cos(a), Math.sin(a)];
            },
        },
        radius: "param",
        start_radius: { type: "f32", uses: ["startRadius"], value: (_e, c) => c.start0 },
        start: "param",
        end: "param",
        shape: "param",
        samples: { type: "f32", value: (e) => Math.max(2, Math.min(32, Math.round(e.samples))) },
    },
    prepare(e) {
        const start0 = e.startRadius ?? 0;
        return e.radius <= 0 && start0 <= 0 ? null : { start0 };
    },
    extras: (e, c) => ({ reach: Math.max(e.radius, c.start0, 0) }),
    cases: () => [
        Effects.progressiveBlur().list[0],
        Effects.progressiveBlur({ radius: 30, angle: 0, start: 0.3, end: 0.9, samples: 28 }).list[0],
        Effects.progressiveBlur({ radius: 28, startRadius: 4, shape: "radial", center: { x: 0.4, y: 0.5 } }).list[0],
    ],
});
