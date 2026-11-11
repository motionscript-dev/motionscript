import { LerpFunction } from "@/tween/lerp";
import type { AttributeOps, HasUniformCheck } from "@/attributes/shared/operators";
import { Corners, CornersInput, resolveCorners, lerpCorners, isUniformCorners } from "./corners";

/** How a corner with a non-zero radius is shaped: `'rounded'` (a circular arc) or `'angled'` (a straight chamfer). */
export type CornerStyle = "rounded" | "angled";

export type CornerStyleResolved = Corners<CornerStyle>;

/** Corner style input for a Rect: one {@link CornerStyle} for all corners, or an object per corner (`{ topLeft, … }`) or axis (`{ top, bottom }` / `{ left, right }`); an already-resolved value passes through. Unspecified corners fall back to a previous value or `'rounded'`. */
export type RectCornerStyle = CornersInput<CornerStyle> | CornerStyleResolved;

/** The corner-style op set. No zero check (style has no zero value); style is a discrete enum, so "interpolating" snaps at `t = 0.5`, as for other discrete properties (see the pixelate effect). */
export const cornerStyleOps: AttributeOps<RectCornerStyle, CornerStyleResolved>
    & HasUniformCheck<RectCornerStyle, CornerStyleResolved> = {
    resolve: (value, previous) => resolveCorners(value as CornersInput<CornerStyle>, "rounded", previous, (v): v is CornerStyle => v === "rounded" || v === "angled"),
    lerp: (from, to, t) => lerpCorners(from, to, t, (f, g) => (t < 0.5 ? f : g)),
    isUniformInput: (value): value is CornerStyle => value === "rounded" || value === "angled",
    isUniform: (value) => isUniformCorners(value),
};

/** Scalar corner style tween for shapes whose vertices don't map to named corners (polygons and polygrams apply one style to every vertex), instead of {@link cornerStyleOps}'s per-corner form. */
export const lerpCornerScalarStyle: LerpFunction<CornerStyle> = (from, to, t) => (t < 0.5 ? from : to);
