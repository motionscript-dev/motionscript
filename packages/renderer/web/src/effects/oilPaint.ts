import { Effects, type OilPaintEffect } from "@motionscript/core";
import { definePort } from "./_pack.ts";

export default definePort<OilPaintEffect>({
    type: "oilPaint",
    surface: "shader",
    params: { radius: "param" },
    // The engine returns null when the radius rounds below 1 device px; the
    // scale isn't known here, so sub-pixel radii fall through to a no-op in WGSL.
    prepare: (e) => (e.radius > 0 ? {} : null),
    extras: (e) => ({ reach: e.radius }),
    cases: () => [
        Effects.oilPaint().list[0],
        Effects.oilPaint({ radius: 5 }).list[0],
        Effects.oilPaint({ radius: 1.5 }).list[0],
    ],
});
