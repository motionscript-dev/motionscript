import {
    component2d,
    Types,
    type NodeOf,
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
import type { CoordinateMap } from "../kit/coords";
import { drawField, FIELD_COMMANDS, FIELD_STATE, traceField, type FieldDrawing, type FieldSampler, type FieldStroke, type FieldValues } from "../kit/field-mark";
import { PLOT_COLOR } from "../kit/furniture";
import { clamp } from "../kit/geometry";
import { inkSize, reading, traced, type MarkReading } from "../kit/mark";

const MAX_LINES = 1600;
/** Steps a line takes across one spacing: what keeps a tight swirl round. */
const STEPS_PER_SPACING = 8;
const MAX_STEPS = 600;

const state = {
    ...FIELD_STATE,
    /** How far apart the lines start, in graph units. */
    spacing: Types.number(1, { min: 0.01, step: 0.1 }),
    /** How far each line runs from where it starts, in graph units along itself. */
    length: Types.number(3, { min: 0, step: 0.1 }),
    /** The share of each line that is shown at once; one shows all of it. */
    window: Types.number(1, { min: 0.01, max: 1, step: 0.01 }),
    /** Where along its line each shown stretch is: one turn of it runs every line from end to end. */
    phase: Types.number(0, { step: 0.01 }),
};

interface LinesValues extends FieldValues {
    readonly spacing: number;
    readonly length: number;
    readonly window: number;
    readonly phase: number;
}

const LINES: FieldDrawing<LinesValues> = {
    own: (s) => `${s.spacing}|${s.length}|${s.window}|${s.phase}`,
    strokes: (s, map, field) => lines(s, map, field),
};

const traceLines = (s: LinesValues, read: MarkReading) => traceField("streamLines", LINES, s, read);

/**
 * The lines a vector field carries a point along, one from each point of a
 * grid: `(-y, x)` draws circles. With a `window` below one, each line shows
 * only a stretch of itself, and `flowTo` sends those stretches along.
 */
export const StreamLines = traced(component2d({
    key: "streamLines",
    state,
    defaults: { stroke: { weight: 2, fill: PLOT_COLOR, align: "center", cap: "round", join: "round" }, width: "hug", height: "hug" },
    commands: {
        ...FIELD_COMMANDS,
        /** Send the shown stretches along their lines: a whole number runs each line that many times over. */
        flowTo: { args: ["phase"] },
    },
    measure: (_measurer, s) => inkSize(traceLines(s, reading(s)).runs),
    render: (ctx, s) => drawField(ctx, s, traceLines(s, reading(s))),
}), (s: LinesValues, read: MarkReading) => traceLines(s, read).runs);

export type StreamLines = NodeOf<typeof StreamLines>;

function lines(s: LinesValues, map: CoordinateMap, field: FieldSampler): FieldStroke[] {
    const [x0, x1] = map.xRange;
    const [y0, y1] = map.yRange;
    let spacing = Math.max(s.spacing, 1e-6);
    const count = () => (Math.floor((x1 - x0) / spacing) + 1) * (Math.floor((y1 - y0) / spacing) + 1);
    while (count() > MAX_LINES) spacing *= 2;
    const step = spacing / STEPS_PER_SPACING;
    const steps = Math.min(MAX_STEPS, Math.round(s.length / step));
    if (steps < 1) return [];
    // A line is followed a little past what is shown, so it leaves the box rather than stopping at its edge.
    const inside = (x: number, y: number) => x >= x0 - spacing && x <= x1 + spacing && y >= y0 - spacing && y <= y1 + spacing;
    const window = clamp(s.window, 0, 1);

    const drawn: FieldStroke[] = [];
    let index = 0;
    for (let i = Math.ceil(x0 / spacing - 1e-9); i * spacing <= x1 + 1e-9; i++) {
        for (let j = Math.ceil(y0 / spacing - 1e-9); j * spacing <= y1 + 1e-9; j++) {
            const line = follow(field, i * spacing, j * spacing, step, steps, inside);
            index++;
            if (line.points.length < 2) continue;
            const shown = window >= 1 ? line.points : stretch(line.points, window, s.phase + stagger(index));
            if (shown.length < 2) continue;
            drawn.push({ runs: [shown.map((p) => map.toPoint(p.x, p.y))], magnitude: line.magnitude });
        }
    }
    return drawn;
}

/** The graph points a field carries a point through from `(x, y)`, at an even pace, and how strong it was on the way. */
function follow(
    field: FieldSampler,
    x: number,
    y: number,
    step: number,
    steps: number,
    inside: (x: number, y: number) => boolean,
): { points: Vector2[]; magnitude: number } {
    const points: Vector2[] = [{ x, y }];
    const v: Vector2 = { x: 0, y: 0 };
    let strength = 0;
    let read = 0;
    // The field's direction at a point, as a unit step; `false` where it has none or is at rest.
    const heading = (px: number, py: number, out: Vector2): boolean => {
        if (!field(px, py, v)) return false;
        const magnitude = Math.hypot(v.x, v.y);
        if (!(magnitude > 1e-9)) return false;
        out.x = v.x / magnitude;
        out.y = v.y / magnitude;
        strength += magnitude;
        read++;
        return true;
    };
    const a: Vector2 = { x: 0, y: 0 };
    const b: Vector2 = { x: 0, y: 0 };
    for (let i = 0; i < steps; i++) {
        // Midpoint rule: the direction half a step on is the one the whole step takes.
        if (!heading(x, y, a) || !heading(x + (a.x * step) / 2, y + (a.y * step) / 2, b)) break;
        x += b.x * step;
        y += b.y * step;
        if (!inside(x, y)) break;
        points.push({ x, y });
    }
    return { points, magnitude: read > 0 ? strength / read : 0 };
}

/** The part of `points` a window `share` long shows at `phase`: it enters at one end and leaves by the other. */
function stretch(points: Vector2[], share: number, phase: number): Vector2[] {
    const turn = phase - Math.floor(phase);
    const end = turn * (1 + share);
    const from = Math.max(0, end - share);
    const to = Math.min(1, end);
    if (!(to > from)) return [];
    const last = points.length - 1;
    return points.slice(Math.floor(from * last), Math.ceil(to * last) + 1);
}

/** A share of a turn that differs from line to line and never from frame to frame, so the stretches do not march in step. */
function stagger(index: number): number {
    const mixed = Math.sin(index * 12.9898) * 43758.5453;
    return mixed - Math.floor(mixed);
}
