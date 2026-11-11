import type { NodeView } from "@motionscript/sdk";
import { equationParams, parseEquation } from "./equation";
import type { ExpressionScope } from "./expression";
import { scopeFor, type PlotSource } from "./source";

/** A curve as a mark reads it. Data rather than a class, so a copied plot is ridden like the kit's own. */
export interface CurveValues {
    readonly expression: PlotSource;
    readonly params: ExpressionScope;
    readonly x: number;
    readonly y: number;
    /** The plane the plot was laid out on; `null` outside any system. */
    readonly graph?: object | null;
}

/** The node types a point, a tangent or an area can ride: they have a height at each `x`. */
export const CURVE_KEYS: readonly string[] = ["functionPlot", "tracedPath"];

/**
 * The curve's height at graph `x`, or `NaN` where it has none or is not a
 * function of `x`. What a point, a tangent or an area riding a plot reads.
 */
export function curveValue(curve: CurveValues, x: number): number {
    const { source, blend } = curve.expression;
    const shift = curve.graph ? curve : NO_SHIFT;
    const value = heightOf(source, curve.params, x - shift.x) + shift.y;
    if (!blend) return value;
    const from = heightOf(blend.from, curve.params, x - shift.x) + shift.y;
    return from + (value - from) * blend.t;
}

/** Whether `view` is a node a mark can ride. */
export function isCurve(view: unknown): view is NodeView & { readonly state: CurveValues } {
    return typeof view === "object" && view !== null && CURVE_KEYS.includes((view as { key?: string }).key ?? "");
}

const NO_SHIFT = { x: 0, y: 0 };

function heightOf(source: string, params: ExpressionScope, x: number): number {
    const equation = parseEquation(source, equationParams(source));
    if (equation instanceof Error || equation.kind !== "function" || equation.of !== "x") return NaN;
    return equation.f(x, 0, scopeFor(equationParams(source), params));
}
