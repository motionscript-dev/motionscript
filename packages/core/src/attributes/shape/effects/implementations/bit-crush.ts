import type { ModedEffect, EffectData } from "../effect-data";
import { defineEffect, effectDataOf, param, type EffectFields } from "../spec";

/** A fixed hardware palette to snap colours to: `'none'` (quantize each channel to `bits` instead), `'gameboy'` (the DMG's four greens), `'cga'` (palette 1 high-intensity: black, cyan, magenta, white), `'nes'` (a representative 16-colour cut of the NES master palette). */
export type BitCrushPalette = "none" | "gameboy" | "cga" | "nes";

/** Colour-depth reduction: quantize each channel to `bits`, or snap each pixel to the nearest entry of a fixed hardware palette. Unlike `posterize` (an even grid per channel), it can force an arbitrary, uneven, historically specific set, which is what makes something look like a Game Boy rather than merely low-colour. Pair with `dither` so gradients survive the palette cut. */
export interface BitCrushEffect extends ModedEffect, EffectFields<typeof bitCrushSpec.params> {
    type: "bitCrush";
}

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
