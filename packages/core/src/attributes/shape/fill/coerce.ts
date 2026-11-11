/**
 * Cross-type fill coercion for tweening. The renderer dispatches by `fill.type`, so an in-between frame must be a
 * fully-formed fill of one concrete type: when a tween's endpoints differ, both are promoted to a common type, then
 * that type's `lerp` runs.
 *
 *  - `color` is a degenerate gradient: against a gradient, the color expands into a uniform gradient (every stop that
 *    color), which renders identically to the flat color, so frame 0 of color→gradient looks like the color.
 *  - Two *different* gradient types share no geometry, so coerce toward the destination (`to`) type: colors/stops/opacity
 *    interpolate while geometry adopts the destination's, snapped at frame 0.
 *
 * Coercion never mutates its input.
 */

import type { NormalizedColor } from "./color/parser";
import type { FillResolved, FillCommon, FillSpace } from "./union";
import type { BlendMode } from "./blend";
import type { SolidFillResolved } from "./implementations/color";
import type { LinearGradientFillResolved } from "./implementations/linear-gradient";
import type { RadialGradientFillResolved } from "./implementations/radial-gradient";
import type { ConicGradientFillResolved } from "./implementations/conic-gradient";

/** Resolved fills that carry a `colors` array (every gradient variant), with {@link FillCommon} (`space`) mixed in as the registry's `FillResolved` does. */
type GradientResolved = FillCommon & (
    | LinearGradientFillResolved
    | RadialGradientFillResolved
    | ConicGradientFillResolved
);

/** Fill types that can participate in cross-type color/gradient tweening. */
const GRADIENT_TYPES = new Set<FillResolved["type"]>([
    "linear-gradient",
    "radial-gradient",
    "conic-gradient",
]);

export function isGradientType(type: FillResolved["type"]): boolean {
    return GRADIENT_TYPES.has(type);
}

/** True if `a` and `b` can be tweened across differing types: each a color or gradient, at least one a gradient (same-type pairs never reach coercion). */
export function canCoerce(a: FillResolved, b: FillResolved): boolean {
    const aColorish = a.type === "solid" || isGradientType(a.type);
    const bColorish = b.type === "solid" || isGradientType(b.type);
    if (!aColorish || !bColorish) return false;
    // At least one gradient — color↔color is same-type and never reaches here.
    return isGradientType(a.type) || isGradientType(b.type);
}

function evenStops(count: number): number[] {
    return Array.from({ length: count }, (_, i) => i / Math.max(1, count - 1));
}

/** Expands a solid color into a `targetType` gradient with every stop that color, matching `stopCount` so it lerps cleanly against the real gradient. Geometry defaults match each gradient's `resolve()` so it renders as the flat color. */
function colorToGradient(
    color: NormalizedColor,
    opacity: number | undefined,
    blend: BlendMode | undefined,
    space: FillSpace | undefined,
    targetType: GradientResolved["type"],
    stopCount: number,
): GradientResolved {
    const n = Math.max(2, stopCount);
    const colors: NormalizedColor[] = Array.from({ length: n }, () => [...color] as NormalizedColor);
    const stops = evenStops(n);
    const common = { colors, stops, opacity, blend, space };

    switch (targetType) {
        case "linear-gradient":
            return { type: "linear-gradient", ...common, start: { x: -1, y: 1 }, end: { x: 1, y: -1 } };
        case "radial-gradient":
            return { type: "radial-gradient", ...common, center: { x: 0, y: 0 }, radius: 100 };
        case "conic-gradient":
            return { type: "conic-gradient", ...common, center: { x: 0, y: 0 }, startAngle: 0 };
    }
}

/** Re-types a gradient as `targetType`, carrying colors/stops/opacity and adopting the target's default geometry (the geometries are not interpolatable). */
function retypeGradient(
    g: GradientResolved,
    targetType: GradientResolved["type"],
): GradientResolved {
    if (g.type === targetType) return g;
    const common = { colors: g.colors, stops: g.stops, opacity: g.opacity, blend: g.blend, space: g.space };
    switch (targetType) {
        case "linear-gradient":
            return { type: "linear-gradient", ...common, start: { x: -1, y: 1 }, end: { x: 1, y: -1 } };
        case "radial-gradient":
            return { type: "radial-gradient", ...common, center: { x: 0, y: 0 }, radius: 100 };
        case "conic-gradient":
            return { type: "conic-gradient", ...common, center: { x: 0, y: 0 }, startAngle: 0 };
    }
}

/** Promotes two differing-type fills to a common type so the registry can lerp them; both results share `result[0].type`. Caller must have checked {@link canCoerce}. */
export function coercePair(a: FillResolved, b: FillResolved): [FillResolved, FillResolved] {
    const aIsColor = a.type === "solid";
    const bIsColor = b.type === "solid";

    // color → gradient: expand the color to match the gradient's type.
    if (aIsColor && !bIsColor) {
        const grad = b as GradientResolved;
        const expanded = colorToGradient(
            (a as SolidFillResolved).color, a.opacity, a.blend, a.space, grad.type, grad.colors.length,
        );
        return [expanded, grad];
    }
    // gradient → color: expand the color (b) to match the gradient's (a) type.
    if (bIsColor && !aIsColor) {
        const grad = a as GradientResolved;
        const expanded = colorToGradient(
            (b as SolidFillResolved).color, b.opacity, b.blend, b.space, grad.type, grad.colors.length,
        );
        return [grad, expanded];
    }

    // Two different gradient types: coerce toward the destination (b) type.
    const ga = a as GradientResolved;
    const gb = b as GradientResolved;
    return [retypeGradient(ga, gb.type), gb];
}
