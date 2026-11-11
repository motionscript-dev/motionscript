import { lerpNumber } from "@/tween/lerp";
import { lerpColor } from "@/attributes/shape/fill/lerp";
import { BlendModes } from "@/attributes/shape/fill/blend";
import type { Color } from "@/attributes/shape/fill/color/parser";
import type { ModedEffect, EffectData } from "../effect-data";
import { resolveEffectColor, sameEffectColor } from "../effect-data";
import { defineEffect, effectDataOf, param, type EffectFields } from "../spec";

/** What the glow reads for strength: `"luminance"` (bright pixels bleed; {@link GlowEffect.threshold} sets the cut) or `"alpha"` (every opaque pixel glows equally: a halo around a shape rather than light escaping an image). */
export type GlowChannel = "luminance" | "alpha";

/** What the glow is coloured with: `"none"` keeps the source colours scaled by intensity, `"solid"` one {@link GlowEffect.color}, `"ramp"` maps strength through {@link GlowEffect.colors} / {@link GlowEffect.stops} (heat, neon, aurora). */
export type GlowTint = "none" | "solid" | "ramp";

/** How the ramp repeats past one pass ({@link GlowEffect.cycles}): `"repeat"` restarts at the first stop (hard seam), `"mirror"` walks back down (seamless, halves the apparent frequency). */
export type GlowLoopStyle = "mirror" | "repeat";

/** Where the source layer sits relative to the glow it produced. */
export type GlowOriginal = "behind" | "front" | "hidden";

/** A glow: bright (or opaque) parts of a layer spread outward and composited back, optionally recoloured through a ramp. Unlike `bloom`, a `"filter"` effect bounded by the node's rect that can only screen its bright-pass back, this spreads past the box, chooses its compositing and can be coloured. See {@link EffectData.surface}. */
export interface GlowEffect extends ModedEffect, EffectFields<typeof glowSpec.params> {
    type: "glow";
}

// White at the core falling to a warm amber.
const GLOW_RAMP_COLORS: Color[] = ["white", "#ffa640"];
const GLOW_RAMP_STOPS: number[] = [0, 1];

export const glowSpec = defineEffect({
    type: "glow",
    group: "light",
    surface: "shader",
    scalar: "intensity",
    // `intensity: 0` alone is not enough: `original: 'hidden'` would carry over
    // from the effect being faded and erase the node.
    neutral: { intensity: 0, original: "behind" },
    // Kept from the hand-written lerp: ramps of different lengths snap the whole
    // glow, not only the ramp, at the midpoint.
    lerp: <G extends { colors: Color[] }>(from: G, to: G, t: number, derived: (a: G, b: G, t: number) => G) =>
        from.colors.length !== to.colors.length ? { ...(t < 0.5 ? from : to) } : derived(from, to, t),
    params: {
        /** What decides a pixel's glow strength. */
        channel: param.choice(["luminance", "alpha"] satisfies GlowChannel[], { default: "luminance", control: "segmented", optionsLabel: "glowChannel", order: 9 }),
        /** 0-1 luminance cutoff; read only when `channel` is `'luminance'`. */
        threshold: param.number({ default: 0.5, min: 0, max: 1, control: "slider", order: 0 }),
        /** Spread distance in pixels. */
        radius: param.number({ default: 25, min: 0, unit: "px", order: 1 }),
        /** Dilation applied before the blur, in pixels — gives the glow a solid core. */
        spread: param.number({ default: 0, min: 0, unit: "px", order: 2 }),
        /** Additive multiplier for the glow pass. */
        intensity: param.number({ default: 1, min: 0, max: 3, control: "slider", inline: true, order: 3 }),
        /** Which way the glow spreads; `'x'`/`'y'` give anamorphic streaks. */
        axis: param.axis({ default: "both", control: "segmented", optionsLabel: "effectAxis", order: 10 }),
        /** Where the source layer sits relative to the glow. */
        original: param.choice(["behind", "front", "hidden"] satisfies GlowOriginal[], { default: "behind", control: "segmented", optionsLabel: "glowOriginal", order: 11 }),
        /** How the glow merges with the layer. */
        blend: param.choice(BlendModes, { default: "screen", optionsLabel: "blendMode", order: 12 }),
        /** What the glow is coloured with. */
        tint: param.choice(["none", "solid", "ramp"] satisfies GlowTint[], { default: "none", control: "segmented", optionsLabel: "glowTint", order: 4 }),
        /** The glow's colour when `tint` is `'solid'`. */
        color: param.color({ default: "white", order: 5 }),
        /** Ramp colours when `tint` is `'ramp'`, parallel to `stops`. Componentwise for equal stop counts; otherwise there is no correspondence to interpolate along, so it snaps at the midpoint. */
        colors: param.of<Color[]>()({
            kind: "colors",
            default: GLOW_RAMP_COLORS,
            hidden: true,
            order: 13,
            lerp: (a, b, t) => (a.length !== b.length ? (t < 0.5 ? a : b) : a.map((c, i) => lerpColor(resolveEffectColor(c), resolveEffectColor(b[i]), t))),
            equals: (a, b) => a.length === b.length && a.every((c, i) => sameEffectColor(c, b[i])),
        }),
        /** Each ramp colour's position, 0-1 ascending (evenly spaced when absent). */
        stops: param.of<number[]>()({
            kind: "numbers",
            default: GLOW_RAMP_STOPS,
            hidden: true,
            order: 14,
            lerp: (a, b, t, from, to) => ((from.colors as Color[]).length !== (to.colors as Color[]).length
                ? (t < 0.5 ? a : b)
                : a.map((s, i) => lerpNumber(s, b[i] ?? s, t))),
            equals: (a, b) => a.length === b.length && a.every((s, i) => s === b[i]),
        }),
        /** How the ramp repeats past one pass. */
        loopStyle: param.choice(["mirror", "repeat"] satisfies GlowLoopStyle[], { default: "mirror", control: "segmented", optionsLabel: "glowLoopStyle", order: 6 }),
        /** Ramp traversals across the glow's strength range. */
        cycles: param.number({ default: 1, min: 1, max: 10, step: 0.1, order: 7 }),
        /** Offset along the ramp in degrees of one cycle; animate to move colour. */
        phase: param.number({ default: 0, unit: "deg", control: "angle", order: 8 }),
    },
});

export const glowEffect: EffectData<GlowEffect> = effectDataOf(glowSpec);
