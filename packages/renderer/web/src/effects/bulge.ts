import { Effects, type BulgeEffect } from "@motionscript/core";
import { definePort } from "./_pack.ts";

export default definePort<BulgeEffect>({
    type: "bulge",
    surface: "shader",
    params: { strength: "param", center: "param" },
    prepare: (e) => (e.strength === 0 ? null : {}),
    extras(e) {
        // A pinch (k < 0) folds the far field back into the box: it draws out to
        // where f(r) = r(1 + k r²)/(1 + k) falls back to -1. The packer doesn't
        // know the box, so reach assumes a ~360 px half extent.
        // An off-centre lens also draws past the box on its far side.
        let reach = 2 * Math.hypot(e.center.x - 0.5, e.center.y - 0.5) * 360;
        if (e.strength < 0) {
            const k = e.strength * 0.8;
            let r = 1;
            while (r < 4 && (r * (1 + k * r * r)) / (1 + k) > -1) r += 0.01;
            reach = Math.min((r - 1 + 2 * Math.hypot(e.center.x - 0.5, e.center.y - 0.5)) * 360, 800);
        }
        return { reach };
    },
    cases: () => [
        Effects.bulge(0.6).list[0],
        Effects.bulge(-0.7).list[0],
        Effects.bulge({ strength: 0.9, center: { x: 0.3, y: 0.6 } }).list[0],
    ],
});
