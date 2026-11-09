import { Effects, resolveEffectColor, type DropShadowEffect } from "@motionscript/core";
import { definePort } from "./_pack.ts";

export default definePort<DropShadowEffect, { ox: number; oy: number; sigma: number; spread: number }>({
    type: "dropShadow",
    surface: "shader",
    params: {
        offset: { type: "vec2f", uses: ["offsetX", "offsetY"], value: (_e, c) => [c.ox, c.oy] },
        sigma: { type: "f32", uses: ["blur"], value: (_e, c) => c.sigma },
        color: "param",
        spread: { type: "f32", value: (_e, c) => c.spread },
    },
    prepare(e) {
        if (resolveEffectColor(e.color)[3] <= 0) return null;
        const ox = e.offsetX;
        const oy = -e.offsetY; // scene is y-up, the pass y-down
        const sigma = Math.max(0, e.blur) / 2;
        const spread = Math.max(0, e.spread);
        if (ox === 0 && oy === 0 && sigma === 0 && spread === 0) return null;
        return { ox, oy, sigma, spread };
    },
    extras: (_e, c) => ({ reach: Math.hypot(c.ox, c.oy) + 3 * c.sigma + c.spread }),
    cases: () => [
        Effects.dropShadow().list[0],
        Effects.dropShadow({ offsetX: 10, offsetY: 10, blur: 24, color: "#0008" }).list[0],
        Effects.dropShadow({ offsetX: 0, offsetY: 0, blur: 0, spread: 6, color: "#f40" }).list[0],
        Effects.dropShadow({ offsetX: -12, offsetY: -6, blur: 40, spread: 4, color: "#04f" }).list[0],
    ],
});
