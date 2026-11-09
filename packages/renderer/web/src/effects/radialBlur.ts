import { Effects, type RadialBlurEffect } from "@motionscript/core";
import { definePort } from "./_pack.ts";

export default definePort<RadialBlurEffect>({
    type: "radialBlur",
    surface: "shader",
    params: {
        amount: "param",
        style: "param",
        center: "param",
        samples: { type: "f32", value: (e) => Math.round(Math.max(2, Math.min(32, e.samples))) },
    },
    prepare: (e) => (e.amount > 0 ? {} : null),
    extras(e) {
        // Taps pull in material from farther in (zoom: out to 1/(1 - amount/2) of
        // the box; spin: round to the corners), so the smear spills past the box.
        // Reach assumes a ~360 px half extent (the packer doesn't see the box).
        const spill = e.style === "spin" ? Math.SQRT2 - 1 : 1 / Math.max(1 - e.amount / 2, 0.25) - 1;
        return { reach: Math.min((spill + 2 * Math.hypot(e.center.x - 0.5, e.center.y - 0.5)) * 360, 800) };
    },
    cases: () => [
        Effects.radialBlur().list[0],
        Effects.radialBlur({ amount: 0.8, style: "spin", samples: 24 }).list[0],
        Effects.radialBlur({ amount: 0.3, center: { x: 0.3, y: 0.4 }, samples: 8 }).list[0],
    ],
});
