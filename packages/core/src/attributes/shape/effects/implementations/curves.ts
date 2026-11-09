import { lerpNumber } from "@/tween/lerp";
import type { ModedEffect, EffectData } from "../effect-data";
import type { CurvesChannel } from "../../filters/implementations/curves";
import { defineEffect, effectDataOf, param, type EffectFields } from "../spec";

/**
 * Tone curve as a **node effect** — the same adjustment `Adjustments.curves`
 * applies to a photo, now available on any node, so a group of shapes or a text
 * block can be graded the same way.
 *
 * Shares its type name, fields and renderer handler with {@link CurvesFilter}
 * (the media-fill filter); the only difference is the `mode` flag every scene
 * effect carries. Keeping them one implementation is deliberate — a curve should
 * not mean two different things depending on what it is attached to.
 */
export interface CurvesEffect extends ModedEffect, EffectFields<typeof curvesSpec.params> {
    type: "curves";
}

/** The {@link CurvesEffect} spec: its parameters, defaults and ranges. */
export const curvesSpec = defineEffect({
    type: "curves",
    group: "color",
    // A curve is a *lookup*, and a colour matrix cannot express one: it is affine
    // by construction and a curve is authored for its bends. Evaluating it per
    // pixel needs the source as a shader it can read — the same reason `lut` is a
    // shader scope, and the same trade: exact, at the cost of a pass. See the
    // renderer's `curvesEffectHandler` for what that means for ordering.
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
