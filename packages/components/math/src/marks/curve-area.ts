import {
    component2d,
    type NodeOf,
    type NodeView,
    type Vector2,
    // Named so the emitted declaration reaches these through the sdk, not core.
    type Fill as _Fill,
    type FillResolved as _FillResolved,
    type Node2D as _Node2D,
    type Node2DProps as _Node2DProps,
    type Shadow as _Shadow,
    type ShadowResolved as _ShadowResolved,
} from "@motionscript/sdk";
import { omit, PAINT, PAINT_COMMANDS } from "../kit/component";
import type { Interval } from "../kit/coords";
import { curveValue } from "../kit/curve";
import { intervalEntry, PLOT_COLOR } from "../kit/furniture";
import { clamp } from "../kit/geometry";
import { curveFor, PLANE_ENTRY, PLOT_REF } from "../kit/graph";
import { drawMark, inkSize, reading, traced, type MarkReading } from "../kit/mark";

const state = {
    // An area is only its fill, and has no outline to trim.
    ...omit(PAINT, "stroke", "start", "end"),
    /** The plot that bounds the area, by id. */
    on: PLOT_REF,
    /** A second plot to fill down to, in place of the x axis. */
    under: PLOT_REF,
    domain: intervalEntry([0, 1]),
    graph: PLANE_ENTRY,
};

interface AreaValues {
    readonly on: NodeView | null;
    readonly under: NodeView | null;
    readonly domain: Interval;
}

/** The region between a plot and the x axis, or between two plots, over a span of x. It sits beside the plots it reads, since it may read two. */
export const CurveArea = traced(component2d({
    key: "curveArea",
    state,
    defaults: { fill: { type: "solid", color: PLOT_COLOR, opacity: 0.35 }, width: "hug", height: "hug" },
    commands: {
        ...omit(PAINT_COMMANDS, "strokeTo", "progressTo", "flash"),
        /** Animate the span of x that is filled: sweep an area open, or slide it along. */
        domainTo: { args: ["domain"] },
    },
    measure: (_measurer, s) => inkSize(traceArea(s, reading(s))),
    render: (ctx, s) => drawMark(ctx, s, traceArea(s, reading(s)), { closed: true }),
}), traceArea);

export type CurveArea = NodeOf<typeof CurveArea>;

function traceArea(s: AreaValues, { map, plane }: MarkReading): Vector2[][] {
    const top = curveFor(plane, s.on);
    if (!top) return [];
    const floor = curveFor(plane, s.under, false);
    const [yMin, yMax] = map.yRange;
    const a = Math.max(s.domain[0], map.xRange[0]);
    const b = Math.min(s.domain[1], map.xRange[1]);
    if (!(b > a)) return [];

    const width = Math.abs(map.toPoint(b, 0).x - map.toPoint(a, 0).x);
    const steps = Math.max(8, Math.min(600, Math.round(width / 2)));
    // Held inside the system's range, and at the axis where a curve has no value.
    const height = (value: number) => (Number.isFinite(value) ? clamp(value, yMin, yMax) : clamp(0, yMin, yMax));
    const upper: Vector2[] = [];
    const lower: Vector2[] = [];
    for (let i = 0; i <= steps; i++) {
        const x = a + ((b - a) * i) / steps;
        upper.push(map.toPoint(x, height(curveValue(top, x))));
        lower.push(map.toPoint(x, height(floor ? curveValue(floor, x) : 0)));
    }
    return [[...upper, ...lower.reverse()]];
}
