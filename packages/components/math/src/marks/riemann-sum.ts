import {
    component2d,
    Types,
    type NodeOf,
    type NodeView,
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
import { listed, omit, PAINT, PAINT_COMMANDS } from "../kit/component";
import type { Interval } from "../kit/coords";
import { curveValue } from "../kit/curve";
import { lerpInterval, PLOT_COLOR, readInterval } from "../kit/furniture";
import { clamp } from "../kit/geometry";
import { curveFor, PLANE_ENTRY, PLOT_REF } from "../kit/graph";
import { drawMark, inkSize, reading, traced, type MarkReading } from "../kit/mark";

export type RiemannSample = "left" | "right" | "center";

export interface RiemannSumProps extends PaintProps {
    on?: string;
    domain?: Interval;
    dx?: number;
    sample?: RiemannSample;
}

/** More rectangles than this is a filled area with extra steps. */
const MAX_RECTANGLES = 2000;

const state = {
    // Its rectangles are revealed by `dx`, not by trimming their outlines.
    ...omit(PAINT, "start", "end"),
    on: PLOT_REF,
    domain: Types.custom<Interval>([0, 1], { resolve: readInterval, lerp: lerpInterval }),
    /** Each rectangle's width, in graph units. */
    dx: Types.number(0.25, { min: 0.001 }),
    /** Where in its width a rectangle reads the curve's height. */
    sample: listed(["left", "right", "center"], "left", { animatable: false }),
    graph: PLANE_ENTRY,
};

interface SumValues {
    readonly on: NodeView | null;
    readonly domain: Interval;
    readonly dx: number;
    readonly sample: RiemannSample;
}

/** Rectangles under a plot, each `dx` wide and as tall as the curve where it is sampled. */
export const RiemannSum = traced(component2d({
    key: "riemannSum",
    state,
    defaults: {
        fill: { type: "solid", color: PLOT_COLOR, opacity: 0.35 },
        stroke: { weight: 1.5, fill: PLOT_COLOR, align: "center", join: "round" },
        width: "hug",
        height: "hug",
    },
    commands: {
        ...omit(PAINT_COMMANDS, "progressTo", "flash"),
        /** Animate the rectangles' width: narrower is the sum closing in on the area. */
        refineTo: { args: ["dx"] },
        /** Animate the span of x the rectangles cover. */
        domainTo: { args: ["domain"] },
    },
    measure: (_measurer, s) => inkSize(traceSum(s, reading(s))),
    render: (ctx, s) => drawMark(ctx, s, traceSum(s, reading(s)), { closed: true }),
}), traceSum);

export type RiemannSum = NodeOf<typeof RiemannSum>;

function traceSum(s: SumValues, { map, plane }: MarkReading): Vector2[][] {
    const plot = curveFor(plane, s.on);
    const [a, b] = s.domain;
    const dx = s.dx;
    if (!plot || !(b > a) || !(dx > 0)) return [];
    const [yMin, yMax] = map.yRange;
    const base = clamp(0, yMin, yMax);
    const at = s.sample === "left" ? 0 : s.sample === "right" ? 1 : 0.5;
    const count = Math.min(MAX_RECTANGLES, Math.ceil((b - a) / dx - 1e-9));
    const runs: Vector2[][] = [];
    for (let i = 0; i < count; i++) {
        const left = a + i * dx;
        const right = Math.min(b, left + dx);
        const value = curveValue(plot, left + (right - left) * at);
        if (!Number.isFinite(value)) continue;
        const height = clamp(value, yMin, yMax);
        runs.push([map.toPoint(left, base), map.toPoint(left, height), map.toPoint(right, height), map.toPoint(right, base)]);
    }
    return runs;
}
