import type { ModedEffect, EffectData } from "../effect-data";
import { defineEffect, effectDataOf, param, type EffectFields } from "../spec";

/**
 * A fixed hardware palette to snap colours to.
 *
 * - `'none'` — no palette; quantize each channel to `bits` instead.
 * - `'gameboy'` — the DMG's four greens.
 * - `'cga'` — IBM CGA palette 1 high-intensity (black, cyan, magenta, white).
 * - `'nes'` — a representative 16-colour cut of the NES master palette.
 */
export type BitCrushPalette = "none" | "gameboy" | "cga" | "nes";

/**
 * Colour-depth reduction: either quantize each channel to `bits`, or snap every
 * pixel to its nearest entry in a fixed hardware palette.
 *
 * The distinction from `posterize` and `dither` is *which* colours survive.
 * Posterize keeps an evenly-spaced grid per channel; this can instead force an
 * arbitrary, uneven, historically-specific set — which is what actually makes
 * something look like a Game Boy rather than merely low-colour.
 *
 * Pairs naturally with `dither`: quantize here, and let an ordered dither carry
 * the error so gradients survive the palette cut.
 */
export interface BitCrushEffect extends ModedEffect, EffectFields<typeof bitCrushSpec.params> {
    type: "bitCrush";
}

/** The {@link BitCrushEffect} spec: its parameters, defaults and ranges. */
export const bitCrushSpec = defineEffect({
    type: "bitCrush",
    group: "stylize",
    // A palette search is per-pixel non-linear; no LUT colour filter in this build.
    surface: "shader",
    scalar: "bits",
    neutral: { amount: 0 },
    params: {
        /** Bits per channel when `palette` is `'none'`, 1–8. */
        bits: param.number({ default: 3, min: 1, max: 8, step: 1, inline: true }),
        /** Fixed hardware palette to snap to. A halfway palette is meaningless, so it cuts. */
        palette: param.choice(["none", "gameboy", "cga", "nes"] satisfies BitCrushPalette[], { default: "none", optionsLabel: "bitCrushPalette" }),
        /** 0–1 blend between original and crushed. */
        amount: param.number({ default: 1, min: 0, max: 1, control: "slider" }),
    },
});

export const bitCrushEffect: EffectData<BitCrushEffect> = effectDataOf(bitCrushSpec);
