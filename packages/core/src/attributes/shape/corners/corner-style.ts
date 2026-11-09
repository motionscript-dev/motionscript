import { LerpFunction } from "@/tween/lerp";
import type { AttributeOps, HasUniformCheck } from "@/attributes/shared/operators";
import { Corners, CornersInput, resolveCorners, lerpCorners, isUniformCorners } from "./corners";

/**
 * How a single corner is shaped once it has a non-zero radius:
 * - `'rounded'` — a circular arc;
 * - `'angled'`  — a straight diagonal chamfer cut across the corner.
 */
export type CornerStyle = "rounded" | "angled";

/** Per-corner resolved styles. */
export type CornerStyleResolved = Corners<CornerStyle>;

/**
 * Accepted corner style input for a Rect: a single {@link CornerStyle} applies to
 * all corners; an object overrides corners individually (`{ topLeft, … }`) or by
 * axis (`{ top, bottom }` / `{ left, right }`). An already-resolved value passes
 * through. Unspecified corners fall back to a previous value or `'rounded'` when
 * resolved.
 */
export type RectCornerStyle = CornersInput<CornerStyle> | CornerStyleResolved;

/**
 * The corner-style attribute's op set — no zero check, since style has no zero
 * value. "Interpolating" corner styles means snapping at the midpoint — corner
 * style is a discrete enum, so it switches at `t = 0.5` rather than blending,
 * matching the codebase's convention for discrete properties (see e.g. the
 * pixelate effect).
 */
export const cornerStyleOps: AttributeOps<RectCornerStyle, CornerStyleResolved>
    & HasUniformCheck<RectCornerStyle, CornerStyleResolved> = {
    resolve: (value, previous) => resolveCorners(value as CornersInput<CornerStyle>, "rounded", previous, (v): v is CornerStyle => v === "rounded" || v === "angled"),
    lerp: (from, to, t) => lerpCorners(from, to, t, (f, g) => (t < 0.5 ? f : g)),
    isUniformInput: (value): value is CornerStyle => value === "rounded" || value === "angled",
    isUniform: (value) => isUniformCorners(value),
};

/**
 * Scalar (single-value) corner style tween for shapes whose vertices don't map to
 * named corners — polygons and polygrams apply one style to every vertex, so they
 * use this instead of {@link cornerStyleOps}'s per-corner form.
 */
export const lerpCornerScalarStyle: LerpFunction<CornerStyle> = (from, to, t) => (t < 0.5 ? from : to);
