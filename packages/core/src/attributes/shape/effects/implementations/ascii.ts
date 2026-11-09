import type { ModedEffect, EffectData } from "../effect-data";
import { defineEffect, effectDataOf, param, type EffectFields } from "../spec";

/**
 * Built-in glyph ramps, each ordered **least ink first**: `charset[0]` stands in
 * for the darkest cells and the last entry for the lightest.
 *
 * That ordering is about the *result*, not the glyph. On the default white ink
 * over black, an empty cell is the darkest thing the effect can draw and a solid
 * one the brightest, so least-ink-first is exactly dark-to-light. Invert the ink
 * and background — black on white, the paper look — and the same ramp is used
 * back to front automatically, so a custom ramp only ever has to be written once.
 *
 * - `'standard'` — the classic ten-step ASCII ramp.
 * - `'blocks'` — Unicode shading blocks; the most legible at small cell sizes,
 *   because each step really is a fixed fraction of coverage.
 * - `'braille'` — braille dot patterns, the finest ramp of the set.
 * - `'binary'` — just `0` and `1`: a two-tone cut rather than a ramp.
 * - `'hex'` — `0`–`F`, the hex-dump look. Its "ramp" is nominal, since a glyph's
 *   ink doesn't track its digit, so expect texture rather than tone.
 */
export type AsciiCharset = "standard" | "blocks" | "braille" | "binary" | "hex";

/** The ramp each named charset expands to. Exported so a backend needn't guess. */
export const ASCII_CHARSETS: Record<AsciiCharset, string> = {
    standard: " .:-=+*#%@",
    blocks: " ░▒▓█",
    braille: " ⠄⣀⣄⣤⣶⣷⣿",
    binary: "01",
    hex: "0123456789ABCDEF",
};

/** Resolve a charset option to its literal ramp; unknown names fall back to `'standard'`. */
export function resolveAsciiCharset(charset: AsciiCharset | string): string {
    return ASCII_CHARSETS[charset as AsciiCharset] ?? charset;
}

/**
 * ASCII art: the content is divided into a grid of cells, each cell's tone is
 * matched to a glyph, and that glyph is drawn in its place.
 *
 * The glyphs come from a texture baked once per charset/font/size — the first
 * effect to use the renderer's resource hook.
 */
export interface AsciiEffect extends ModedEffect, EffectFields<typeof asciiSpec.params> {
    type: "ascii";
}

/** The {@link AsciiEffect} spec: its parameters, defaults and ranges. */
export const asciiSpec = defineEffect({
    type: "ascii",
    group: "stylize",
    // Reads one texel per cell and a glyph texture alongside it.
    surface: "shader",
    scalar: "size",
    // Replaces the image with glyphs at every size.
    neutral: null,
    params: {
        /** Cell size in pixels — the width of one character. */
        size: param.number({ default: 12, min: 2, unit: "px", label: "cellSize", inline: true }),
        /** A named ramp, or a custom string ordered least-ink-first. */
        charset: param.of<AsciiCharset | string>()({
            kind: "enum",
            default: "standard",
            options: Object.keys(ASCII_CHARSETS),
            optionsLabel: "asciiCharset",
        }),
        /** Family the glyphs are baked in; a monospace face reads best. */
        fontFamily: param.text({ default: "monospace" }),
        /** Glyph colour when `colored` is false. */
        ink: param.color({ default: "white" }),
        /** Colour behind the glyphs (`'transparent'` to overlay). */
        background: param.color({ default: "black" }),
        /** Tint each glyph with its own cell's colour instead of using `ink`. */
        colored: param.boolean({ default: false }),
    },
});

export const asciiEffect: EffectData<AsciiEffect> = effectDataOf(asciiSpec);
