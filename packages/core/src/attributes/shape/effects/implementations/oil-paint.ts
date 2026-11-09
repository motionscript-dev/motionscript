import type { ModedEffect, EffectData } from "../effect-data";
import { defineEffect, effectDataOf, param, type EffectFields } from "../spec";

/**
 * Kuwahara filter — the painterly one.
 *
 * Each pixel looks at four overlapping quadrant windows and takes the mean of
 * whichever is *flattest*. Averaging within a region but never across a boundary
 * is what makes it read as brushwork: flat areas smooth into strokes while edges
 * stay crisp, where a plain blur would soften both.
 *
 * Cost grows with the square of `radius` — four windows of `(radius+1)²` samples
 * each — so this is the most expensive effect in the set by a wide margin.
 */
export interface OilPaintEffect extends ModedEffect, EffectFields<typeof oilPaintSpec.params> {
    type: "oilPaint";
}

/** The {@link OilPaintEffect} spec: its parameters, defaults and ranges. */
export const oilPaintSpec = defineEffect({
    type: "oilPaint",
    group: "blur",
    // Reads a large neighbourhood per pixel.
    surface: "shader",
    scalar: "radius",
    neutral: { radius: 0 },
    params: {
        /** Window radius in pixels — brush size, capped at 6. */
        radius: param.number({ default: 3, min: 0, max: 6, step: 1, unit: "px", label: "brush", inline: true }),
    },
});

export const oilPaintEffect: EffectData<OilPaintEffect> = effectDataOf(oilPaintSpec);
