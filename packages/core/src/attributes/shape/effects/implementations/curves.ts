import { lerpNumber } from "@/tween/lerp";
import type { ModedEffect, EffectData } from "../effect-data";
import type { CurvesChannel } from "../../filters/implementations/curves";
import { defineEffect, effectDataOf, param, type EffectFields } from "../spec";

/** Tone curve as a **node effect**, the same adjustment `Adjustments.curves` applies to a photo. Shares type name, fields and renderer handler with {@link CurvesFilter} (they differ only by the `mode` flag), so a curve doesn't mean two things depending on what it is attached to. */
export interface CurvesEffect extends ModedEffect, EffectFields<typeof curvesSpec.params> {
    type: "curves";
}

export const curvesSpec = defineEffect({
    type: "curves",
    group: "color",
    // A curve is a *lookup*, which an affine colour matrix cannot express, so evaluating it per pixel needs the source as a readable shader (as `lut`): exact, at the cost of a pass. See the renderer's `curvesEffectHandler` for ordering.
    surface: "shader",
    neutral: { points: [[0, 0], [1, 1]] },
    params: {
        /** Curve control points as `[input, output]` pairs in 0–1. Move pairwise, as `curvesFilter.lerp`. */
        points: param.of<[number, number][]>()({
            kind: "points",
            required: true,
            lerp: (from, to, t) => from.map(([x, y], i) => {
                const [tx, ty] = to[i] ?? [x, y];
                return [lerpNumber(x, tx, t), lerpNumber(y, ty, t)] as [number, number];
            }),
            equals: (a, b) => a.length === b.length && a.every(([x, y], i) => x === b[i]?.[0] && y === b[i]?.[1]),
        }),
        /** Channel(s) the curve applies to. An intermediate channel name is meaningless, so it cuts. */
        channel: param.choice(["rgb", "r", "g", "b", "a"] satisfies CurvesChannel[], { default: "rgb", optional: true }),
    },
});

export const curvesEffect: EffectData<CurvesEffect> = effectDataOf(curvesSpec);
