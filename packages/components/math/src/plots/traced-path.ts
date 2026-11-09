import {
    component2d,
    Types,
    type NodeOf,
    // Named so the emitted declaration reaches these through the sdk, not core.
    type Node2D as _Node2D,
    type Node2DProps as _Node2DProps,
    type Shadow as _Shadow,
    type ShadowResolved as _ShadowResolved,
    type Stroke as _Stroke,
    type StrokeResolved as _StrokeResolved,
} from "@motionscript/sdk";
import { omit } from "../kit/component";
import type { Interval } from "../kit/coords";
import { drawMark, inkSize, reading, traced, type MarkReading } from "../kit/mark";
import { PLOT_COMMANDS, PLOT_STATE, PLOT_STROKE, tracePlot, type FunctionPlotProps, type PlotValues } from "./function-plot";

export interface TracedPathProps extends FunctionPlotProps {
    from?: number;
    value?: number;
    tail?: number;
}

const state = {
    // It reveals itself by its value, so it trims no outline of its own.
    ...omit(PLOT_STATE, "start", "end"),
    /** The value the trail starts at. */
    from: Types.number(0, { step: 0.1 }),
    /** The value the point is at now: where the trail ends. */
    value: Types.number(0, { step: 0.1 }),
    /** How much of the trail is kept, in the value's own units; zero keeps all of it. */
    tail: Types.number(0, { min: 0, step: 0.1 }),
};

interface TrailValues extends PlotValues {
    readonly from: number;
    readonly value: number;
    readonly tail: number;
}

/**
 * The trail a point leaves as a value changes: the curve of its equation from
 * where the value began to where it is now. Bind `value` to a variable
 * (`"=[t]"`) and the trail grows as the variable is driven, or drive it with
 * `traceTo`; a `tail` keeps only its most recent stretch.
 */
export const TracedPath = traced(component2d({
    key: "tracedPath",
    state,
    defaults: { stroke: PLOT_STROKE, width: "hug", height: "hug" },
    commands: {
        ...omit(PLOT_COMMANDS, "progressTo", "flash"),
        /** Carry the point on to another value, the trail following it. */
        traceTo: { args: ["value"] },
    },
    measure: (_measurer, s) => inkSize(traceTrail(s, reading(s))),
    render: (ctx, s) => drawMark(ctx, s, traceTrail(s, reading(s))),
}), traceTrail);

export type TracedPath = NodeOf<typeof TracedPath>;

function traceTrail(s: TrailValues, read: MarkReading) {
    return tracePlot(s, read, span(s));
}

/** The span of the free variable the trail covers: from where the value began, or its tail, to where it is. */
function span({ from, value, tail }: TrailValues): Interval {
    const kept = tail > 0 ? Math.min(Math.abs(value - from), tail) : Math.abs(value - from);
    return value >= from ? [value - kept, value] : [value, value + kept];
}
