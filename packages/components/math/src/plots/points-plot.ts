import {
    component2d,
    Types,
    type NodeOf,
    type PaintProps,
    type Vector2,
    // Named so the emitted declaration reaches these through the sdk, not core.
    type Fill as _Fill,
    type FillResolved as _FillResolved,
    type Node2D as _Node2D,
    type Node2DProps as _Node2DProps,
    type Shadow as _Shadow,
    type ShadowResolved as _ShadowResolved,
    type Stroke as _Stroke,
    type StrokeResolved as _StrokeResolved,
} from "@motionscript/sdk";
import { PAINT, PAINT_COMMANDS } from "../kit/component";
import { PLOT_COLOR } from "../kit/furniture";
import { PLANE_ENTRY } from "../kit/graph";
import { drawMark, inkSize, reading, traced, type MarkReading } from "../kit/mark";

export interface PointsPlotProps extends PaintProps {
    points?: Vector2[];
    closed?: boolean;
    smooth?: boolean;
}

// A shorter list is padded with its own last point, so a line grows new points out of its end.
function lerpPoints(from: Vector2[], to: Vector2[], t: number): Vector2[] {
    const count = Math.max(from.length, to.length);
    if (from.length === 0 || to.length === 0) return t < 1 ? from : to;
    const out = new Array<Vector2>(count);
    for (let i = 0; i < count; i++) {
        const a = from[Math.min(i, from.length - 1)];
        const b = to[Math.min(i, to.length - 1)];
        out[i] = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    return out;
}

/** Points on the curve between each pair of a smooth line's points. */
const SMOOTH_STEPS = 16;

const state = {
    ...PAINT,
    points: Types.custom<Vector2[]>([], { lerp: lerpPoints }),
    /** Join the last point to the first. */
    closed: Types.boolean(false, { animatable: false }),
    /** Curve through the points instead of turning a corner at each. */
    smooth: Types.boolean(false, { animatable: false }),
    graph: PLANE_ENTRY,
};

interface PointsValues {
    readonly points: Vector2[];
    readonly closed: boolean;
    readonly smooth: boolean;
}

/** A line through listed graph points: data, or a shape drawn in graph coordinates when closed, which is when it is filled. */
export const PointsPlot = traced(component2d({
    key: "pointsPlot",
    state,
    defaults: { stroke: { weight: 3, fill: PLOT_COLOR, align: "center", cap: "round", join: "round" }, width: "hug", height: "hug" },
    commands: {
        ...PAINT_COMMANDS,
        /** Move the points to new places; extra ones grow from the line's end. */
        pointsTo: { args: ["points"] },
    },
    measure: (_measurer, s) => inkSize(tracePoints(s, reading(s))),
    // An open line has no inside, so its fill waits until it is closed.
    render: (ctx, s) => drawMark(ctx, s, tracePoints(s, reading(s)), { closed: s.closed, fills: s.closed }),
}), tracePoints);

export type PointsPlot = NodeOf<typeof PointsPlot>;

function tracePoints(s: PointsValues, { map, shift }: MarkReading): Vector2[][] {
    const pixels = s.points.map((p) => map.toPoint(p.x + shift.x, p.y + shift.y));
    if (pixels.length < 2) return [];
    return [s.smooth && pixels.length > 2 ? spline(pixels, s.closed) : pixels];
}

// Catmull–Rom, so the curve passes through every point it was given.
function spline(points: readonly Vector2[], closed: boolean): Vector2[] {
    const n = points.length;
    const at = (i: number): Vector2 => (closed ? points[((i % n) + n) % n] : points[Math.max(0, Math.min(n - 1, i))]);
    const out: Vector2[] = [];
    const spans = closed ? n : n - 1;
    for (let i = 0; i < spans; i++) {
        const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
        for (let s = 0; s < SMOOTH_STEPS; s++) {
            const t = s / SMOOTH_STEPS;
            const t2 = t * t;
            const t3 = t2 * t;
            out.push({
                x: 0.5 * (2 * p1.x + (p2.x - p0.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (3 * p1.x - p0.x - 3 * p2.x + p3.x) * t3),
                y: 0.5 * (2 * p1.y + (p2.y - p0.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (3 * p1.y - p0.y - 3 * p2.y + p3.y) * t3),
            });
        }
    }
    if (!closed) out.push(points[n - 1]);
    return out;
}
