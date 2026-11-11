import type { ModedEffect, EffectData } from "../effect-data";
import { defineEffect, effectDataOf, param, type EffectFields } from "../spec";

/** The screen pattern each cell is drawn with: `"dot"` (grows with tone), `"line"` (rules thicken with tone), `"cross"` (crossed rules, coarse engraving). */
export type HalftoneShape = "dot" | "line" | "cross";

/** How many plates the screen separates into: `"mono"` (one black screen over luminance, newsprint), `"cmyk"` (four plates at the process angles C 15°, M 75°, Y 0°, K 45°; the shared darkness on a K plate keeps neutrals neutral, so it reads as *printed*), `"rgb"` (one per channel: cheaper, but with no K plate every grey prints three mid-dots and neutrals turn to colour noise). */
export type HalftoneSeparation = "mono" | "rgb" | "cmyk";

/** Halftone screen (newsprint, comic-book): a rotated grid of cells whose tone becomes mark size, reproducing shading by dot area rather than intensity. `separation` picks the plates, see {@link HalftoneSeparation}. */
export interface HalftoneEffect extends ModedEffect, EffectFields<typeof halftoneSpec.params> {
    type: "halftone";
}

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
