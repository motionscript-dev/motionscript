import {
    component2d,
    Types,
    type NodeOf,
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
import { radians } from "../kit/geometry";
import { PLANE_ENTRY } from "../kit/graph";
import { drawMark, graphPoint, inkSize, ownPoint, reading, traced, type MarkReading, type MarkState } from "../kit/mark";

/** Degrees of arc per drawn segment of a bent arrow. */
const BEND_STEP = 4;

const state = {
    ...omit(PAINT, "fill"),
    tail: Types.vector2(),
    head: Types.vector2({ x: 1, y: 1 }),
    /** The arc the arrow sweeps, in degrees: zero is straight, positive bows to its left. */
    bend: Types.number(0, { min: -180, max: 180, unit: "°" }),
    graph: PLANE_ENTRY,
};

interface ArrowValues {
    readonly tail: Vector2;
    readonly head: Vector2;
    readonly bend: number;
}

/** A handle on one end of the arrow: where the end is in its own frame, and the graph point a drop there gives. */
const end = (which: "tail" | "head") => ({
    at: (s: ArrowValues & MarkState) => {
        const read = reading(s);
        return ownPoint(read, traceArrow(s, read), s[which]);
    },
    value: (at: Vector2, s: ArrowValues & MarkState) => {
        const read = reading(s);
        return graphPoint(read, traceArrow(s, read), at);
    },
});

/** An arrow from `tail` to `head`, two graph points; its arrowhead is the stroke's `endCap`. (Not `from`/`to`: every node has a `to`.) */
export const VectorArrow = traced(component2d({
    key: "vectorArrow",
    state,
    defaults: { stroke: { weight: 4, fill: "#e5e7eb", align: "center", endCap: "triangle" }, width: "hug", height: "hug" },
    commands: {
        ...omit(PAINT_COMMANDS, "fillTo"),
        /** Move either end, in graph coordinates. */
        endpointsTo: { args: ["tail", "head"] },
    },
    handles: { tail: end("tail"), head: end("head") },
    measure: (_measurer, s) => inkSize(traceArrow(s, reading(s))),
    render: (ctx, s) => drawMark(ctx, s, traceArrow(s, reading(s))),
}), traceArrow);

export type VectorArrow = NodeOf<typeof VectorArrow>;

function traceArrow(s: ArrowValues, { map, shift }: MarkReading): Vector2[][] {
    const a = map.toPoint(s.tail.x + shift.x, s.tail.y + shift.y);
    const b = map.toPoint(s.head.x + shift.x, s.head.y + shift.y);
    const sweep = radians(s.bend);
    const chord = Math.hypot(b.x - a.x, b.y - a.y);
    if (Math.abs(sweep) < 1e-3 || chord === 0) return [[a, b]];

    // The circle through both ends that subtends `sweep` at its centre.
    const radius = chord / (2 * Math.sin(Math.abs(sweep) / 2));
    const side = Math.sign(sweep);
    const reach = radius * Math.cos(sweep / 2);
    // The centre sits to the arrow's right for a positive sweep, so the arc bows to its left.
    const cx = (a.x + b.x) / 2 + (side * (b.y - a.y) * reach) / chord;
    const cy = (a.y + b.y) / 2 - (side * (b.x - a.x) * reach) / chord;
    const from = Math.atan2(a.y - cy, a.x - cx);
    const steps = Math.max(8, Math.ceil(Math.abs(s.bend) / BEND_STEP));
    const run: Vector2[] = [];
    for (let i = 0; i <= steps; i++) {
        const angle = from - (sweep * i) / steps;
        run.push({ x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) });
    }
    return [run];
}
