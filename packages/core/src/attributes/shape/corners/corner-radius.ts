import { lerpNumber } from "@/tween/lerp";
import type { CornerRadiusOps } from "@/attributes/shared/operators";
import { Corners, CornersInput, resolveCorners, lerpCorners, isUniformCorners } from "./corners";

/** Per-corner border radius values, all fully resolved to numbers. */
export type CornerRadiusResolved = Corners<number>;

/** Corner radius input for a Rect: one number for all corners, or an object per corner (`{ topLeft, … }`) or axis (`{ top, bottom }` / `{ left, right }`); an already-resolved value passes through. Unspecified corners fall back to a previous value or 0. */
export type RectCornerRadius = CornersInput<number> | CornerRadiusResolved;

/**
 * The corner-radius attribute's op set: `resolve`/`lerp` for `Shapes.corners`,
 * plus the uniform/zero checks a renderer needs to pick a cheap draw path.
 */
export const cornerRadiusOps: CornerRadiusOps = {
    // A resolved value is structurally a full per-corner `CornersInput<number>`,
    // so pin T=number and let resolveCorners re-resolve it idempotently.
    resolve: (value, previous) => resolveCorners(value as CornersInput<number>, 0, previous, (v): v is number => typeof v === "number"),
    lerp: (from, to, t) => lerpCorners(from, to, t, lerpNumber),
    isUniformInput: (value): value is number => typeof value === "number",
    isUniform: (value) => isUniformCorners(value),
    isZero: (value) => value.topLeft === 0 && value.topRight === 0 && value.bottomLeft === 0 && value.bottomRight === 0,
};
