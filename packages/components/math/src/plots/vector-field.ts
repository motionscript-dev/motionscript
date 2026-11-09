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
import { drawField, FIELD_COMMANDS, FIELD_STATE, traceField, type FieldDrawing, type FieldProps, type FieldValues, type FieldSampler, type FieldStroke } from "../kit/field-mark";
import { PLOT_COLOR } from "../kit/furniture";
import { inkSize, reading, traced, type MarkReading } from "../kit/mark";

export interface VectorFieldProps extends FieldProps {
    spacing?: number;
    arrowScale?: number;
}

/** Past this many arrows the spacing is widened, so a field over a huge range is still a field and not a wash. */
const MAX_ARROWS = 2400;
/** An arrow's head, as a share of its length and in pixels at most, and the half-angle it opens to. */
const HEAD_SHARE = 0.38;
const HEAD_MAX = 11;
const HEAD_ANGLE = (26 * Math.PI) / 180;

const state = {
    ...FIELD_STATE,
    /** How far apart the arrows stand, in graph units. */
    spacing: Types.number(1, { min: 0.01, step: 0.1 }),
    /** How long an arrow is drawn for a vector of length one, in graph units. */
    arrowScale: Types.number(0.4, { min: 0, step: 0.05 }),
};

interface ArrowsValues extends FieldValues {
    readonly spacing: number;
    readonly arrowScale: number;
}

const ARROWS: FieldDrawing<ArrowsValues> = {
    own: (s) => `${s.spacing}|${s.arrowScale}`,
    strokes: (s, map, field) => arrows(s, map, field),
};

const traceArrows = (s: ArrowsValues, read: MarkReading) => traceField("vectorField", ARROWS, s, read);

/**
 * A grid of arrows showing a vector field, two parts in x and y: `(-y, x)`.
 * Each arrow is centred on its point and is as long as the field is strong
 * there, up to the spacing.
 */
export const VectorField = traced(component2d({
    key: "vectorField",
    state,
    defaults: { stroke: { weight: 2.5, fill: PLOT_COLOR, align: "center", cap: "round", join: "round" }, width: "hug", height: "hug" },
    commands: FIELD_COMMANDS,
    measure: (_measurer, s) => inkSize(traceArrows(s, reading(s)).runs),
    render: (ctx, s) => drawField(ctx, s, traceArrows(s, reading(s))),
}), (s: ArrowsValues, read: MarkReading) => traceArrows(s, read).runs);

export type VectorField = NodeOf<typeof VectorField>;

function arrows(s: ArrowsValues, map: CoordinateMap, field: FieldSampler): FieldStroke[] {
    const [x0, x1] = map.xRange;
    const [y0, y1] = map.yRange;
    let spacing = Math.max(s.spacing, 1e-6);
    const count = () => (Math.floor((x1 - x0) / spacing) + 1) * (Math.floor((y1 - y0) / spacing) + 1);
    while (count() > MAX_ARROWS) spacing *= 2;

    const drawn: FieldStroke[] = [];
    const v: Vector2 = { x: 0, y: 0 };
    const longest = spacing * 0.9;
    for (let i = Math.ceil(x0 / spacing - 1e-9); i * spacing <= x1 + 1e-9; i++) {
        for (let j = Math.ceil(y0 / spacing - 1e-9); j * spacing <= y1 + 1e-9; j++) {
            const gx = i * spacing;
            const gy = j * spacing;
            if (!field(gx, gy, v)) continue;
            const magnitude = Math.hypot(v.x, v.y);
            const length = Math.min(magnitude * s.arrowScale, longest);
            if (!(length > 0)) continue;
            const hx = ((v.x / magnitude) * length) / 2;
            const hy = ((v.y / magnitude) * length) / 2;
            const tail = map.toPoint(gx - hx, gy - hy);
            const head = map.toPoint(gx + hx, gy + hy);
            drawn.push({ runs: arrow(tail, head), magnitude });
        }
    }
    return drawn;
}

/** A shaft and the two barbs of its head, in pixels. */
function arrow(tail: Vector2, head: Vector2): Vector2[][] {
    const dx = head.x - tail.x;
    const dy = head.y - tail.y;
    const length = Math.hypot(dx, dy);
    if (!(length > 0)) return [];
    const barb = Math.min(length * HEAD_SHARE, HEAD_MAX);
    const back = Math.atan2(dy, dx) + Math.PI;
    const at = (angle: number): Vector2 => ({ x: head.x + Math.cos(angle) * barb, y: head.y + Math.sin(angle) * barb });
    return [[tail, head], [at(back - HEAD_ANGLE), head, at(back + HEAD_ANGLE)]];
}
