import { Effects, type TwirlEffect } from "@motionscript/core";
import { definePort } from "./_pack.ts";

export default definePort<TwirlEffect>({
    type: "twirl",
    surface: "shader",
    params: {
        angle: { type: "f32", value: (e) => (e.angle * Math.PI) / 180 },
        radius: "param",
        center: "param",
    },
    prepare: (e) => (e.angle === 0 || e.radius <= 0 ? null : {}),
    extras(e) {
        // Rotation keeps r, so the swirl draws out to where a rotated point still
        // lands in the box (≤ √2 normalised). Reach assumes a ~360 px half extent.
        const r = Math.min(e.radius, Math.SQRT2);
        return { reach: Math.min((Math.max(r - 1, 0) + 2 * Math.hypot(e.center.x - 0.5, e.center.y - 0.5)) * 360, 800) };
    },
    cases: () => [
        Effects.twirl().list[0],
        Effects.twirl({ angle: -120, radius: 0.6 }).list[0],
        Effects.twirl({ angle: 300, radius: 1.4, center: { x: 0.35, y: 0.55 } }).list[0],
    ],
});
