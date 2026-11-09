import { Effects, type GlowEffect, resolveEffectAxis, resolveEffectColor, type Color } from "@motionscript/core";
import { definePort } from "./_pack.ts";

// core's blend names, in blend_mode's index order (_header.wgsl).
const BLEND = ["normal", "multiply", "screen", "overlay", "darken", "lighten", "color-dodge", "color-burn",
    "hard-light", "soft-light", "difference", "exclusion", "hue", "saturation", "color", "luminosity"];

export default definePort<GlowEffect, { colors: Color[] }>({
    type: "glow",
    surface: "shader",
    params: {
        channel: "param",
        threshold: "param",
        spread: { type: "f32", value: (e) => Math.max(0, e.spread) },
        intensity: "param",
        tint: "param",
        original: "param",
        blend: { type: "f32", value: (e) => Math.max(0, BLEND.indexOf(e.blend)) },
        count: { type: "f32", value: (_e, c) => c.colors.length },
        cycles: "param",
        phase: { type: "f32", value: (e) => e.phase / 360 },
        mirror: { type: "f32", uses: ["loopStyle"], value: (e) => (e.loopStyle === "mirror" ? 1 : 0) },
        stops: {
            type: { array: 8, of: "f32" },
            value(e, c) {
                const out: number[] = [];
                let previous = 0;
                for (let i = 0; i < c.colors.length; i++) {
                    previous = Math.max(previous, Math.min(1, e.stops[i] ?? i / Math.max(1, c.colors.length - 1)));
                    out.push(previous);
                }
                return out;
            },
        },
        colors: { type: { array: 8, of: "vec4f" }, uses: ["color"], value: (_e, c) => c.colors.flatMap((x) => resolveEffectColor(x)) },
    },
    uses: ["radius", "axis"],
    prepare(e) {
        // The engine's renderInputs declines these (the node paints untouched).
        if ((e.radius <= 0 && e.spread <= 0) || e.intensity <= 0) return null;
        return { colors: (e.tint === "solid" ? [e.color] : e.colors).slice(0, 8) };
    },
    extras(e) {
        const axis = resolveEffectAxis(e.axis);
        const sigma = Math.max(0, e.radius) / 2;
        // Glow spreads past the content by its blur and spread.
        return { blur: [sigma * axis.x, sigma * axis.y, 0], reach: 3 * sigma + Math.max(0, e.spread) };
    },
    cases: () => [
        Effects.glow().list[0],
        Effects.glow({ radius: 12, threshold: 0.3, intensity: 1.5, original: "front" }).list[0],
        Effects.glow({ channel: "alpha", radius: 20, spread: 4, tint: "solid", color: "#4cf" }).list[0],
        Effects.glow({ radius: 30, tint: "ramp", colors: ["#ff3", "#f0f", "#0ff"], stops: [0, 0.5, 1], blend: "lighten" }).list[0],
    ],
});
