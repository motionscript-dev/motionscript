import { Effects, type MagnifyEffect } from "@motionscript/core";
import { definePort } from "./_pack.ts";

export default definePort<MagnifyEffect>({
    type: "magnify",
    surface: "shader",
    // magnify draws nothing.
    backdropOnly: true,
    params: { scale: "param", center: "param" },
    prepare: (e) => (e.scale === 1 || e.scale <= 0 ? null : {}),
    // Magnifying samples inside the box; shrinking samples outside it, by
    // up to (1/scale − 1) of the half extent (assumed ~360 px, as bulge).
    extras: (e) => ({ reach: e.scale < 1 ? Math.min((1 / e.scale - 1) * 360, 800) : 0 }),
    cases: () => [
        Effects.magnify({ scale: 2 }).list[0],
        Effects.magnify({ scale: 1.6, center: { x: 0.3, y: 0.7 } }).list[0],
    ],
});
