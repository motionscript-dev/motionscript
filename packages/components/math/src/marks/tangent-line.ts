import {
    component2d,
    Types,
    type NodeOf,
    type NodeView,
    type Vector2,
    // Named so the emitted declaration reaches these through the sdk, not core.
    type Node2D as _Node2D,
    type Node2DProps as _Node2DProps,
    type Shadow as _Shadow,
    type ShadowResolved as _ShadowResolved,
    type Stroke as _Stroke,
    type StrokeResolved as _StrokeResolved,
} from "@motionscript/sdk";
import { omit, PAINT, PAINT_COMMANDS } from "../kit/component";
import { curveValue, type CurveValues } from "../kit/curve";
import { curveFor, PLANE_ENTRY, PLOT_REF } from "../kit/graph";
import { drawMark, inkSize, reading, traced, type MarkReading } from "../kit/mark";

/** The step a slope is measured over, as a share of the system's width. */
const SLOPE_STEP = 1e-4;

const state = {
    ...omit(PAINT, "fill"),
    on: PLOT_REF,
    length: Types.number(260, { min: 0, unit: "px" }),
    /** The second point's distance along x; zero is the tangent itself. */
    dx: Types.number(0, { min: 0 }),
    legs: Types.boolean(false, { animatable: false }),
    graph: PLANE_ENTRY,
    /** The slope drawn, in graph units: the curve's at `x`, or the secant's when there is a `dx`. A formula reads it back as `[key.slope]`. */
    slope: Types.number(NaN, { private: true }),
};

interface TangentValues {
    readonly x: number;
    readonly on: NodeView | null;
    readonly length: number;
    readonly dx: number;
    readonly legs: boolean;
}

/** The tangent to a plot at this node's `x`, a fixed length on screen; with a `dx`, the secant through `x` and `x + dx`. */
export const TangentLine = traced(component2d({
    key: "tangentLine",
    state,
    defaults: {
        stroke: { weight: 3, fill: "#f59e0b", align: "center", cap: "round", join: "round" },
        width: "hug",
        height: "hug",
        slope: (s) => {
            const plot = curveFor(s.graph, s.on);
            return plot ? tangentSlope(plot, s.x, s.dx) : NaN;
        },
    },
    commands: omit(PAINT_COMMANDS, "fillTo"),
    measure: (_measurer, s) => inkSize(traceTangent(s, reading(s))),
    render: (ctx, s) => drawMark(ctx, s, traceTangent(s, reading(s))),
}), traceTangent);

export type TangentLine = NodeOf<typeof TangentLine>;

/** The slope a tangent at `x` draws on `curve`, in graph units: the curve's at `x`, or the secant's to `x + dx`. */
export function tangentSlope(curve: CurveValues, x: number, dx = 0): number {
    if (dx > 0) return (curveValue(curve, x + dx) - curveValue(curve, x)) / dx;
    const h = 1e-6 * Math.max(1, Math.abs(x));
    return (curveValue(curve, x + h) - curveValue(curve, x - h)) / (2 * h);
}

function traceTangent(s: TangentValues, { map, plane }: MarkReading): Vector2[][] {
    const plot = curveFor(plane, s.on);
    if (!plot) return [];
    const x = s.x;
    const y = curveValue(plot, x);
    if (!Number.isFinite(y)) return [];
    const half = s.length / 2;

    if (s.dx > 0) {
        const y2 = curveValue(plot, x + s.dx);
        if (!Number.isFinite(y2)) return [];
        const a = map.toPoint(x, y);
        const b = map.toPoint(x + s.dx, y2);
        const span = Math.hypot(b.x - a.x, b.y - a.y);
        if (span === 0) return [];
        const reach = Math.max(half, span / 2 + 16);
        const ux = (b.x - a.x) / span;
        const uy = (b.y - a.y) / span;
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        const secant = [{ x: mx - ux * reach, y: my - uy * reach }, { x: mx + ux * reach, y: my + uy * reach }];
        return s.legs ? [secant, [a, map.toPoint(x + s.dx, y), b]] : [secant];
    }

    const [xMin, xMax] = map.xRange;
    const h = Number.isFinite(xMax - xMin) ? (xMax - xMin) * SLOPE_STEP : 1e-4;
    const before = curveValue(plot, x - h);
    const after = curveValue(plot, x + h);
    if (!Number.isFinite(before) || !Number.isFinite(after)) return [];
    const p = map.toPoint(x, y);
    const a = map.toPoint(x - h, before);
    const b = map.toPoint(x + h, after);
    const span = Math.hypot(b.x - a.x, b.y - a.y);
    if (span === 0) return [];
    const ux = (b.x - a.x) / span;
    const uy = (b.y - a.y) / span;
    return [[{ x: p.x - ux * half, y: p.y - uy * half }, { x: p.x + ux * half, y: p.y + uy * half }]];
}
