import { Effects, type KaleidoscopeEffect } from "@motionscript/core";
import { definePort } from "./_pack.ts";

export default definePort<KaleidoscopeEffect, { segments: number }>({
    type: "kaleidoscope",
    surface: "shader",
    params: {
        wedge: { type: "f32", uses: ["segments"], value: (_e, c) => (2 * Math.PI) / c.segments },
        angle: { type: "f32", value: (e) => (e.angle * Math.PI) / 180 },
        offset: "param",
        amount: { type: "f32", value: (e) => Math.max(0, Math.min(1, e.amount)) },
        center: "param",
    },
    prepare(e) {
        const segments = Math.round(e.segments);
        return segments < 2 || e.amount <= 0 ? null : { segments };
    },
    // The fold keeps r (shifted by offset), so it draws out to ≤ √2
    // normalised. Reach assumes a ~360 px half extent.
    extras: (e) => ({
        reach: Math.min((Math.SQRT2 - 1 + Math.abs(e.offset) + 2 * Math.hypot(e.center.x - 0.5, e.center.y - 0.5)) * 360, 800),
    }),
    cases: () => [
        Effects.kaleidoscope().list[0],
        Effects.kaleidoscope({ segments: 8, angle: 20, offset: 0.15 }).list[0],
        Effects.kaleidoscope({ segments: 3, amount: 0.6, center: { x: 0.4, y: 0.55 } }).list[0],
    ],
});
