import {
    component2d,
    type NodeOf,
    type NodeView,
    type PaintProps,
    type Vector2,
    // Named so the emitted declaration reaches these through the sdk, not core.
    type Node2D as _Node2D,
    type Node2DProps as _Node2DProps,
    type Shadow as _Shadow,
    type ShadowResolved as _ShadowResolved,
    type Stroke as _Stroke,
    type StrokeResolved as _StrokeResolved,
} from "@motionscript/sdk";
import { listed, omit, PAINT, PAINT_COMMANDS } from "../kit/component";
import { curveValue } from "../kit/curve";
import { AXIS_COLOR } from "../kit/furniture";
import { clamp } from "../kit/geometry";
import { curveFor, PLANE_ENTRY, PLOT_REF } from "../kit/graph";
import { drawMark, inkSize, reading, traced, type MarkReading } from "../kit/mark";

export type DropAxis = "x" | "y" | "both";

export interface DropLinesProps extends PaintProps {
    on?: string;
    axis?: DropAxis;
}

const state = {
    ...omit(PAINT, "fill"),
    /** A plot to take the point's height from, by id. */
    on: PLOT_REF,
    /** Which axis to drop to: `x` draws the vertical line, `y` the horizontal one. */
    axis: listed(["x", "y", "both"], "both", { animatable: false }),
    graph: PLANE_ENTRY,
};

interface DropValues {
    readonly x: number;
    readonly y: number;
    readonly on: NodeView | null;
    readonly axis: DropAxis;
}

/**
 * Guide lines from a graph point to the axes, reading its coordinates off them.
 * The point is this node's `x`/`y`, or the point of a plot above its `x`.
 */
export const DropLines = traced(component2d({
    key: "dropLines",
    state,
    defaults: { stroke: { weight: 2, fill: AXIS_COLOR, align: "center", dash: [8, 6] }, width: "hug", height: "hug" },
    commands: omit(PAINT_COMMANDS, "fillTo"),
    measure: (_measurer, s) => inkSize(traceDrops(s, reading(s))),
    render: (ctx, s) => drawMark(ctx, s, traceDrops(s, reading(s))),
}), traceDrops);

export type DropLines = NodeOf<typeof DropLines>;

function traceDrops(s: DropValues, { map, plane }: MarkReading): Vector2[][] {
    const x = s.x;
    const plot = curveFor(plane, s.on);
    const y = plot ? curveValue(plot, x) : s.y;
    if (!Number.isFinite(y)) return [];
    const at = map.toPoint(x, y);
    const runs: Vector2[][] = [];
    // Each line starts on its axis, so drawing it on grows it towards the point.
    if (s.axis !== "y") runs.push([map.toPoint(x, clamp(0, map.yRange[0], map.yRange[1])), at]);
    if (s.axis !== "x") runs.push([map.toPoint(clamp(0, map.xRange[0], map.xRange[1]), y), at]);
    return runs;
}
