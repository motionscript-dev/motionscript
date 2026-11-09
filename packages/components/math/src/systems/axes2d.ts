import {
    component2d,
    Graphics2D,
    Types,
    type Color,
    type Extents,
    type InsetsResolved,
    type Loader,
    type NodeOf,
    type NormalizedColor,
    type PaintProps,
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
import { cartesianMap, lineThrough, resolveInterval, type AxisScaling, type CoordinateMap, type Interval } from "../kit/coords";
import { clamp } from "../kit/geometry";
import { drawSystem, systemLayout, systemMap, systemOpenPlane, systemProvides, systemSize } from "../kit/system";
import { formatTick, ticksFor, type Ticks } from "../kit/ticks";
import { along, AXIS_COLOR, drawLabels, drawn, loadFormulas, type Label, lerpInterval, readInterval, withoutTips } from "../kit/furniture";

export interface Axes2dProps extends PaintProps {
    xRange?: Interval;
    yRange?: Interval;
    xStep?: number;
    yStep?: number;
    xScaling?: AxisScaling;
    yScaling?: AxisScaling;
    squareUnits?: boolean;
    ticks?: boolean;
    tickSize?: number;
    labels?: boolean;
    labelSize?: number;
    labelColor?: Color;
    fontFamily?: string;
    xLabel?: string;
    yLabel?: string;
}

/** One axis, as its furniture is drawn: its line's ends and what is marked along it. */
export interface AxisLayout {
    from: Vector2;
    to: Vector2;
    /** The pixel points that draw its line: its two ends, or more where the system's map bends it. */
    line: Vector2[];
    marks: Ticks;
    /** The value on this axis the other one crosses at, which is left unmarked. */
    crossing: number;
    /** A mark's pixel point. */
    at(value: number): Vector2;
}

const interval = (initial: Interval) => Types.custom<Interval>(initial, { resolve: readInterval, lerp: lerpInterval });

/** An x and a y axis's entries: what a number plane is built on too. */
export const AXES = {
    ...PAINT,
    xRange: interval([-5, 5]),
    yRange: interval([-3, 3]),
    /** The spacing of each axis's ticks; zero picks a tidy one for the axis's length. */
    xStep: Types.number(0, { min: 0 }),
    yStep: Types.number(0, { min: 0 }),
    xScaling: listed(["linear", "log"], "linear", { animatable: false }),
    yScaling: listed(["linear", "log"], "linear", { animatable: false }),
    /** Give a y unit the length of an x unit: `yRange` keeps its centre and takes the span that fits. */
    squareUnits: Types.boolean(false, { animatable: false }),
    ticks: Types.boolean(true, { animatable: false }),
    tickSize: Types.number(10, { min: 0, unit: "px" }),
    labels: Types.boolean(true, { animatable: false }),
    labelSize: Types.number(18, { min: 1, unit: "px" }),
    labelColor: Types.color(AXIS_COLOR),
    fontFamily: Types.text("", { animatable: false }),
    /** A title at the positive end of each axis. */
    xLabel: Types.text("", { animatable: false }),
    yLabel: Types.text("", { animatable: false }),
};

/** The axes' own commands, beside a shape's paints. */
export const AXES_COMMANDS = {
    ...PAINT_COMMANDS,
    /** Animate the window of values the axes show: a pan when a range's ends move alike, a zoom when they do not. */
    rangeTo: { args: ["xRange", "yRange"] as const },
};

/** What axes are drawn from: their own entries, as a number plane's helpers read them too. */
export type AxesValues = Values<typeof AXES> & { readonly padding: InsetsResolved; readonly clip: boolean };

/** What axes declare before they are laid out: their face, and MathJax for a title written as a formula. */
export function loadAxes(loader: Loader, s: AxesValues): void {
    if (s.fontFamily !== "") loader.font(s.fontFamily);
    loadFormulas(loader, [s.xLabel, s.yLabel]);
}

/** How the axes' values land on a plot area. */
export function axesMap(area: Extents, s: AxesValues): CoordinateMap {
    const xRange = resolveInterval(s.xRange, s.xScaling);
    let yRange = resolveInterval(s.yRange, s.yScaling);
    const width = area.maxX - area.minX;
    if (s.squareUnits && s.xScaling === "linear" && s.yScaling === "linear" && width > 0) {
        const span = ((xRange[1] - xRange[0]) * (area.maxY - area.minY)) / width;
        const centre = (yRange[0] + yRange[1]) / 2;
        if (span > 0) yRange = [centre - span / 2, centre + span / 2];
    }
    return cartesianMap({ xRange, yRange, area, xScaling: s.xScaling, yScaling: s.yScaling });
}

/** The two axes as laid out on `map`: where each runs, what it marks, and where the other crosses it. */
export function axesOf(map: CoordinateMap, s: AxesValues): [AxisLayout, AxisLayout] {
    const [xMin, xMax] = map.xRange;
    const [yMin, yMax] = map.yRange;
    // An axis sits on the other's zero, or on its near edge when zero is out of range or it is logarithmic.
    const crossX = s.xScaling === "log" ? xMin : clamp(0, xMin, xMax);
    const crossY = s.yScaling === "log" ? yMin : clamp(0, yMin, yMax);
    const xFrom = map.toPoint(xMin, crossY);
    const xTo = map.toPoint(xMax, crossY);
    const yFrom = map.toPoint(crossX, yMin);
    const yTo = map.toPoint(crossX, yMax);
    return [
        {
            from: xFrom,
            to: xTo,
            line: lineThrough(map, xMin, crossY, xMax, crossY),
            marks: ticksFor(map.xRange, s.xStep, Math.hypot(xTo.x - xFrom.x, xTo.y - xFrom.y), s.xScaling),
            crossing: crossX,
            at: (value) => map.toPoint(value, crossY),
        },
        {
            from: yFrom,
            to: yTo,
            line: lineThrough(map, crossX, yMin, crossX, yMax),
            marks: ticksFor(map.yRange, s.yStep, Math.hypot(yTo.x - yFrom.x, yTo.y - yFrom.y), s.yScaling),
            crossing: crossY,
            at: (value) => map.toPoint(crossX, value),
        },
    ];
}

/** What the axes draw of themselves on `map`, over what `backdrop` draws behind them (a number plane's grid). */
export function axesFurniture(
    map: CoordinateMap,
    s: AxesValues,
    backdrop: (x: AxisLayout, y: AxisLayout) => Graphics2D[] = () => [],
): Graphics2D[] {
    const stroke = s.stroke as StrokeResolved[];
    const { start, end } = s;
    const [x, y] = axesOf(map, s);
    const parts: Graphics2D[] = [...backdrop(x, y)];
    if (stroke.length === 0 && !s.labels) return parts;

    if (stroke.length > 0) {
        parts.push(
            new Graphics2D()
                .line({ points: x.line, radius: 0, start, end })
                .line({ points: y.line, radius: 0, start, end })
                .stroke(stroke),
        );
    }

    const half = s.tickSize / 2;
    const gap = half + s.labelSize * 0.35;
    const tickMarks = new Graphics2D();
    const labels: Label[] = [];
    let ticked = false;
    const mark = (axis: AxisLayout, horizontal: boolean): void => {
        for (const value of axis.marks.values) {
            if (Math.abs(value - axis.crossing) < 1e-9 * Math.max(1, Math.abs(value))) continue;
            const at = axis.at(value);
            if (!drawn(along(at, axis.from, axis.to), start, end)) continue;
            if (s.ticks && half > 0) {
                tickMarks.line({
                    points: horizontal
                        ? [{ x: at.x, y: at.y - half }, { x: at.x, y: at.y + half }]
                        : [{ x: at.x - half, y: at.y }, { x: at.x + half, y: at.y }],
                    radius: 0,
                });
                ticked = true;
            }
            if (!s.labels) continue;
            labels.push(
                horizontal
                    ? { text: formatTick(value, axis.marks.step), at: { x: at.x, y: at.y - gap - s.labelSize / 2 }, align: "center" }
                    : { text: formatTick(value, axis.marks.step), at: { x: at.x - gap, y: at.y }, align: "right" },
            );
        }
    };
    mark(x, true);
    mark(y, false);
    if (ticked && stroke.length > 0) parts.push(tickMarks.stroke(withoutTips(stroke)));

    if (s.xLabel !== "" && end >= 1) {
        labels.push({ text: s.xLabel, at: { x: x.to.x, y: x.to.y + gap + s.labelSize / 2 }, align: "right" });
    }
    if (s.yLabel !== "" && end >= 1) {
        labels.push({ text: s.yLabel, at: { x: y.to.x + gap, y: y.to.y - s.labelSize / 2 }, align: "left" });
    }
    parts.push(...drawLabels(labels, { fontSize: s.labelSize, fontFamily: s.fontFamily, color: s.labelColor as NormalizedColor }));
    return parts;
}

/**
 * An x and a y axis, crossing at the origin while it is in range and at the
 * nearest edge otherwise. Children sit in its graph coordinates.
 */
export const Axes2d = component2d({
    key: "axes2d",
    state: AXES,
    defaults: { stroke: { weight: 2, fill: AXIS_COLOR, align: "center", endCap: "triangle", capScale: 5 } },
    load: (loader, s) => loadAxes(loader, s),
    commands: AXES_COMMANDS,
    provide: (s) => systemProvides(s),
    measure: (_measurer, s) => systemSize(s),
    layout: (box, s, children) => systemLayout(box, s, children, axesMap),
    plane: (box, s) => systemOpenPlane(box, s, axesMap),
    render: (ctx, s) => drawSystem(ctx, s, systemMap(ctx.size, s, axesMap), (map) => axesFurniture(map, s)),
});

export type Axes2d = NodeOf<typeof Axes2d>;
