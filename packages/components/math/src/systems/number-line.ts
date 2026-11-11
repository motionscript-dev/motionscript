import {
    component2d,
    Graphics2D,
    Types,
    type Extents,
    type NodeOf,
    type Color as _Color,
    type NormalizedColor,
    type StrokeResolved,
    type Values,
    type Vector2,
    // Named so the emitted declaration reaches these through the sdk, not core.
    type Fill as _Fill,
    type FillResolved as _FillResolved,
    type Node2D as _Node2D,
    type Node2DProps as _Node2DProps,
    type Shadow as _Shadow,
    type ShadowResolved as _ShadowResolved,
    type Stroke as _Stroke,
} from "@motionscript/sdk";
import { listed, PAINT, PAINT_COMMANDS } from "../kit/component";
import { cartesianMap, resolveInterval, type CoordinateMap } from "../kit/coords";
import { along, AXIS_COLOR, drawLabels, drawn, intervalEntry, withoutTips, type Label } from "../kit/furniture";
import { drawSystem, systemLayout, systemMap, systemOpenPlane, systemProvides, systemSize } from "../kit/system";
import { formatTick, ticksFor } from "../kit/ticks";

const state = {
    ...PAINT,
    range: intervalEntry([-5, 5]),
    /** The spacing of the ticks; zero picks a tidy one for the line's length. */
    step: Types.number(0, { min: 0 }),
    scaling: listed(["linear", "log"], "linear", { animatable: false }),
    ticks: Types.boolean(true, { animatable: false }),
    tickSize: Types.number(12, { min: 0, unit: "px" }),
    /** Values whose ticks are drawn twice as long. */
    longTicks: Types.custom<number[]>([], { animatable: false }),
    labels: Types.boolean(true, { animatable: false }),
    labelExclude: Types.custom<number[]>([], { animatable: false }),
    labelSide: listed(["below", "above"], "below", { animatable: false }),
    labelSize: Types.number(18, { min: 1, unit: "px" }),
    labelColor: Types.color(AXIS_COLOR),
    fontFamily: Types.text("", { animatable: false }),
};

type LineValues = Values<typeof state>;

/**
 * One axis with ticks and numbers. A child's `x` is a value on the line and its
 * `y` is pixels above it, so a dot or a label sits on a number.
 */
export const NumberLine = component2d({
    key: "numberLine",
    state,
    defaults: { stroke: { weight: 2, fill: AXIS_COLOR, align: "center" } },
    load: (loader, s) => {
        if (s.fontFamily !== "") loader.font(s.fontFamily);
    },
    commands: {
        ...PAINT_COMMANDS,
        /** Animate the span of values the line shows: a pan when both ends move alike, a zoom when they do not. */
        rangeTo: { args: ["range"] },
    },
    provide: (s) => systemProvides(s),
    measure: (_measurer, s) => systemSize(s),
    layout: (box, s, children) => systemLayout(box, s, children, lineMap),
    plane: (box, s) => systemOpenPlane(box, s, lineMap),
    render: (ctx, s) => drawSystem(ctx, s, systemMap(ctx.size, s, lineMap), (map) => lineFurniture(map, s)),
});

export type NumberLine = NodeOf<typeof NumberLine>;

function lineMap(area: Extents, s: LineValues): CoordinateMap {
    return cartesianMap({
        xRange: resolveInterval(s.range, s.scaling),
        yRange: [area.minY, area.maxY],
        area,
        xScaling: s.scaling,
    });
}

function lineFurniture(map: CoordinateMap, s: LineValues): Graphics2D[] {
    const stroke = s.stroke as StrokeResolved[];
    const { start, end } = s;
    const [min, max] = map.xRange;
    const from = map.toPoint(min, 0);
    const to = map.toPoint(max, 0);
    const parts: Graphics2D[] = [];
    if (stroke.length > 0) parts.push(new Graphics2D().line({ points: [from, to], radius: 0, start, end }).stroke(stroke));

    const marks = ticksFor(map.xRange, s.step, to.x - from.x, s.scaling);
    const sign = s.labelSide === "below" ? -1 : 1;
    const tickMarks = new Graphics2D();
    const labels: Label[] = [];
    let ticked = false;
    for (const value of marks.values) {
        const at: Vector2 = map.toPoint(value, 0);
        if (!drawn(along(at, from, to), start, end)) continue;
        const half = s.longTicks.includes(value) ? s.tickSize : s.tickSize / 2;
        if (s.ticks && half > 0) {
            tickMarks.line({ points: [{ x: at.x, y: at.y - half }, { x: at.x, y: at.y + half }], radius: 0 });
            ticked = true;
        }
        if (s.labels && !s.labelExclude.includes(value)) {
            labels.push({
                text: formatTick(value, marks.step),
                at: { x: at.x, y: at.y + sign * (s.tickSize / 2 + s.labelSize * 0.9) },
                align: "center",
            });
        }
    }
    if (ticked && stroke.length > 0) parts.push(tickMarks.stroke(withoutTips(stroke)));
    parts.push(...drawLabels(labels, { fontSize: s.labelSize, fontFamily: s.fontFamily, color: s.labelColor as NormalizedColor }));
    return parts;
}
