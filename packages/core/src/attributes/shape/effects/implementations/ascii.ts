import type { ModedEffect, EffectData } from "../effect-data";
import { defineEffect, effectDataOf, param, type EffectFields } from "../spec";

/**
 * Built-in glyph ramps, each ordered **least ink first** (`charset[0]` for the darkest cells). On the default white ink
 * over black an empty cell is the darkest thing drawn, so least-ink-first is dark-to-light; with ink and background
 * inverted the same ramp is used back to front automatically, so a custom ramp is written once. `'standard'` is the
 * classic ten-step ramp, `'blocks'` Unicode shading blocks (most legible small, each step a fixed coverage fraction),
 * `'braille'` the finest, `'binary'` a two-tone cut, `'hex'` a nominal ramp (ink doesn't track the digit: texture, not tone).
 */
export type AsciiCharset = "standard" | "blocks" | "braille" | "binary" | "hex";

export const ASCII_CHARSETS: Record<AsciiCharset, string> = {
    standard: " .:-=+*#%@",
    blocks: " ░▒▓█",
    braille: " ⠄⣀⣄⣤⣶⣷⣿",
    binary: "01",
    hex: "0123456789ABCDEF",
};

export function resolveAsciiCharset(charset: AsciiCharset | string): string {
    return ASCII_CHARSETS[charset as AsciiCharset] ?? charset;
}

/** ASCII art: the content is divided into cells, each cell's tone matched to a glyph. Glyphs come from a texture baked once per charset/font/size, the first effect to use the renderer's resource hook. */
export interface AsciiEffect extends ModedEffect, EffectFields<typeof asciiSpec.params> {
    type: "ascii";
}

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
