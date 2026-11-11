import type { ModedEffect, EffectData } from "../effect-data";
import { defineEffect, effectDataOf, param, type EffectFields } from "../spec";

/** Kuwahara filter, the painterly one: each pixel takes the mean of whichever of four overlapping quadrant windows is *flattest*, so flat areas smooth into strokes while edges stay crisp (a blur softens both). Cost grows with `radius²` (four windows of `(radius+1)²` samples): by far the most expensive effect. */
export interface OilPaintEffect extends ModedEffect, EffectFields<typeof oilPaintSpec.params> {
    type: "oilPaint";
}

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
