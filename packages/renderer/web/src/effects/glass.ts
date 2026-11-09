import { Effects, type GlassEffect } from "@motionscript/core";
import { definePort } from "./_pack.ts";

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

// The engine's constants.
const DISPERSION_SPAN = 0.35;
const LIGHT_GAIN = 1;
const SHADE_NEAR = 0.1;
const SHADE_FAR = 0.06;
const SHADE_REACH = 0.7;
const SPLAY_REACH = 0.3;
const SPLAY_THINNING = 0.25;

export default definePort<GlassEffect, { light: number; splay: number; frost: number }>({
    type: "glass",
    surface: "shader",
    // The engine's handler only answers for the backdrop.
    backdropOnly: true,
    params: {
        depth: "param",
        refraction: { type: "f32", value: (e) => Math.max(0, e.refraction / 100) },
        spread: { type: "f32", uses: ["dispersion"], value: (e) => clamp01(e.dispersion / 100) * DISPERSION_SPAN },
        light: {
            type: "vec2f",
            uses: ["lightAngle"],
            value(e) {
                const radians = (e.lightAngle * Math.PI) / 180;
                return [Math.sin(radians), -Math.cos(radians)];
            },
        },
        rim: { type: "f32", uses: ["lightIntensity"], value: (_e, c) => c.light * LIGHT_GAIN },
        shade_near: { type: "f32", uses: ["splay"], value: (_e, c) => c.light * SHADE_NEAR * (1 - SPLAY_THINNING * c.splay) },
        shade_far: { type: "f32", value: (_e, c) => c.light * SHADE_FAR * (1 - SPLAY_THINNING * c.splay) },
        shade_reach: { type: "f32", value: (_e, c) => SHADE_REACH + SPLAY_REACH * c.splay },
        frost: { type: "f32", value: (_e, c) => c.frost },
    },
    prepare(e) {
        if (!(e.depth > 0)) return null;
        return {
            light: Math.max(0, e.lightIntensity / 100),
            splay: clamp01(e.splay / 100),
            // Figma's frost is a blur radius, twice the sigma.
            frost: Math.max(0, e.frost) * 0.5,
        };
    },
    extras: (_e, c) => ({
        // The frost blur reads past the outline; refraction pulls inward.
        reach: 3 * c.frost + 2,
        blur: c.frost > 0 ? [c.frost, c.frost, 0] : undefined,
        field: true,
    }),
    cases: () => [
        Effects.glass().list[0],
        Effects.glass({ dispersion: 0, frost: 0, depth: 30 }).list[0],
    ],
});
