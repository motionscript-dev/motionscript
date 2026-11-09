import type { ModedEffect, EffectData } from "../effect-data";
import { defineEffect, effectDataOf, param, type EffectFields } from "../spec";

/**
 * The screen pattern each halftone cell is drawn with.
 *
 * - `"dot"` — the classic circular dot that grows with tone.
 * - `"line"` — a line screen: parallel rules that thicken with tone.
 * - `"cross"` — crossed rules, a coarse engraving / crosshatch.
 */
export type HalftoneShape = "dot" | "line" | "cross";

/**
 * How many plates the screen is separated into.
 *
 * - `"mono"` — one black screen over luminance. The newsprint look.
 * - `"cmyk"` — four plates at the classic process angles (C 15°, M 75°, Y 0°,
 *   K 45°). Pulling the shared darkness onto a K plate is what keeps neutrals
 *   neutral, so this is the one that reads as *printed*.
 * - `"rgb"` — one screen per RGB channel. Cheaper and occasionally the look you
 *   want, but with no K plate every grey prints three overlapping mid-dots, so
 *   anything neutral turns to colour noise. Prefer `"cmyk"` for print looks.
 */
export type HalftoneSeparation = "mono" | "rgb" | "cmyk";

/**
 * Halftone screen — the newsprint / comic-book look. The image is divided into a
 * rotated grid of cells and each cell's tone becomes the size of a mark, so
 * continuous shading is reproduced by varying dot area rather than intensity.
 *
 * `separation` picks how many plates the image is split across — see
 * {@link HalftoneSeparation}.
 */
export interface HalftoneEffect extends ModedEffect, EffectFields<typeof halftoneSpec.params> {
    type: "halftone";
}

/** The {@link HalftoneEffect} spec: its parameters, defaults and ranges. */
export const halftoneSpec = defineEffect({
    type: "halftone",
    group: "stylize",
    // Cell position drives the mark, so it needs each pixel's coordinates.
    surface: "shader",
    scalar: "size",
    // Resolution-relative: inert only while the cell is finer than the pixel grid.
    neutral: { size: 0.5 },
    params: {
        /** Cell pitch in pixels. */
        size: param.number({ default: 8, min: 1, unit: "px", label: "cellSize", inline: true }),
        /** Screen rotation in degrees. */
        angle: param.number({ default: 45, unit: "deg", control: "angle", label: "screenAngle" }),
        /** Mark drawn per cell. */
        shape: param.choice(["dot", "line", "cross"] satisfies HalftoneShape[], { default: "dot", optionsLabel: "halftoneShape" }),
        /** Plates to screen into. */
        separation: param.choice(["mono", "rgb", "cmyk"] satisfies HalftoneSeparation[], { default: "mono", optionsLabel: "halftoneSeparation" }),
    },
});

export const halftoneEffect: EffectData<HalftoneEffect> = effectDataOf(halftoneSpec);
