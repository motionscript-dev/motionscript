import {
    Graphics2D,
    Types,
    component2d,
    lerpNumber,
    lerpVector2,
    type BoxBounds,
    type NodeOf,
    type PathCommand,
    type RenderContext,
    type ShadowResolved,
    type FillResolved,
    type StrokeResolved,
    type Vector2,
    // Named so the emitted declaration reaches these through the sdk, not core.
    type Alignment as _Alignment,
    type Fill as _Fill,
    type FlowMode as _FlowMode,
    type FlowResolved as _FlowResolved,
    type GapSize as _GapSize,
    type Node2D as _Node2D,
    type Node2DProps as _Node2DProps,
    type Shadow as _Shadow,
    type Stroke as _Stroke,
} from "@motionscript/sdk";

import { centered, defaultSubStroke, gridLinePaths, gridLines, maxWeight, ViewportPattern, type GridAxis } from "../kit";

/**
 * An infinite line grid that fills the camera's visible region: like
 * `LineGridPattern`, but it tiles a world-anchored grid (spacing `cellSize`)
 * across what the nearest `Camera` sees, regenerated each frame. With no camera it
 * fills its own layout rect.
 */
export const GridPattern = component2d({
    key: "gridPattern",
    state: {
        ...ViewportPattern.state,
        /** Spacing between grid lines in world units: one number for both axes, or `{ x, y }`. */
        cellSize: Types.custom<number | Vector2>(100, { lerp: lerpCellSize }),
        /** Finer cells each cell is split into, as in `LineGridPattern.subdivisions`. */
        subdivisions: 1,
        /** Stroke for the minor lines. Unset, the major `stroke` at half opacity when `subdivisions > 1`. */
        subStroke: Types.stroke,
        /** Scrolls the pattern relative to the world, which it is otherwise anchored to. */
        offset: Types.custom<Vector2>({ x: 0, y: 0 }, { lerp: lerpVector2 }),
    },
    defaults: { subStroke: (_state, given) => defaultSubStroke(given) },
    commands: { ...ViewportPattern.commands },
    measure: ViewportPattern.measure,
    layout: ViewportPattern.layout,
    render: (ctx, state) => ViewportPattern.draw(ctx, (bounds) => drawGrid(ctx, state, bounds)),
});

export type GridPattern = NodeOf<typeof GridPattern>;

interface GridState {
    readonly fill: FillResolved[];
    readonly stroke: StrokeResolved[];
    readonly shadow: ShadowResolved[];
    readonly start: number;
    readonly end: number;
    readonly cellSize: number | Vector2;
    readonly subdivisions: number;
    readonly subStroke: StrokeResolved[];
    readonly offset: Vector2;
}

function drawGrid(ctx: RenderContext, s: GridState, bounds: BoxBounds): void {
    const halfW = bounds.width / 2;
    const halfH = bounds.height / 2;
    // `bounds` is centred on (x, y) in y-up world space.
    const left = bounds.x - halfW;
    const right = bounds.x + halfW;
    const top = bounds.y - halfH;
    const bottom = bounds.y + halfH;

    ctx.draw(new Graphics2D()
        .rect({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, start: s.start, end: s.end })
        .shadow(s.shadow)
        .fill(s.fill));

    const subdivisions = Math.max(1, Math.floor(s.subdivisions));
    const cell = s.cellSize;
    const cellX = Math.max(1e-3, typeof cell === "number" ? cell : cell.x);
    const cellY = Math.max(1e-3, typeof cell === "number" ? cell : cell.y);
    const stepX = cellX / subdivisions;
    const stepY = cellY / subdivisions;

    const major = centered(s.stroke);
    const minorStroke = centered(s.subStroke);
    const overscan = Math.max(maxWeight(major), maxWeight(minorStroke)) / 2;

    const xAxis: GridAxis = { min: left, max: right, step: stepX, offset: s.offset.x };
    const yAxis: GridAxis = { min: top, max: bottom, step: stepY, offset: s.offset.y };

    // Minor lines first so the major lines sit on top.
    if (subdivisions > 1 && minorStroke.length > 0) {
        drawGroup(ctx, xAxis, yAxis, subdivisions, overscan, minorStroke, false);
    }
    if (major.length > 0) {
        drawGroup(ctx, xAxis, yAxis, subdivisions, overscan, major, true);
    }
}

// A solid stroke paints the group as one union path. A dashed one draws each line on its
// own, dash phase anchored to its world coordinate, so dashes never crawl as the camera pans.
function drawGroup(
    ctx: RenderContext,
    xAxis: GridAxis,
    yAxis: GridAxis,
    subdivisions: number,
    overscan: number,
    stroke: StrokeResolved[],
    isMajor: boolean,
): void {
    // Symmetric centerBounds give a zero recentre offset, so local coordinates draw verbatim.
    const centerBounds = [-1, -1, 1, 1] as const;

    const cycle = dashCycle(stroke);
    if (cycle <= 0) {
        const data = gridLinePaths(xAxis, yAxis, subdivisions, overscan)[isMajor ? "major" : "minor"];
        if (data.length > 0) ctx.draw(new Graphics2D().path({ data, centerBounds }).stroke(stroke));
        return;
    }

    // Each line spans a whole number of dash cycles, so the renderer's per-path dash-fit
    // is a no-op and every line dashes identically.
    const g = gridLines(xAxis, yAxis, subdivisions, overscan, cycle);
    const verticals = isMajor ? g.verticalMajor : g.verticalMinor;
    const horizontals = isMajor ? g.horizontalMajor : g.horizontalMinor;

    for (const px of verticals) {
        const data: PathCommand[] = [{ type: "M", x: px, y: g.top }, { type: "L", x: px, y: g.bottom }];
        ctx.draw(new Graphics2D().path({ data, centerBounds }).stroke(phaseShift(stroke, g.top)));
    }
    for (const py of horizontals) {
        const data: PathCommand[] = [{ type: "M", x: g.left, y: py }, { type: "L", x: g.right, y: py }];
        ctx.draw(new Graphics2D().path({ data, centerBounds }).stroke(phaseShift(stroke, g.left)));
    }
}

// The largest dash-array sum across the layers, or 0 when none is dashed.
function dashCycle(strokes: StrokeResolved[]): number {
    let cycle = 0;
    for (const s of strokes) {
        if (s.dash && s.dash.length > 0) {
            const sum = s.dash.reduce((a, b) => a + b, 0);
            if (sum > cycle) cycle = sum;
        }
    }
    return cycle;
}

// `dashOffset` advances the pattern, so it is negated to give the phase one infinite line would have at this world coordinate.
function phaseShift(strokes: StrokeResolved[], worldStart: number): StrokeResolved[] {
    return strokes.map(s => (s.dash && s.dash.length > 0)
        ? { ...s, dashOffset: (s.dashOffset ?? 0) - worldStart }
        : s);
}

// A number and a vector tween by promoting the number to a uniform vector.
function lerpCellSize(from: number | Vector2, to: number | Vector2, t: number): number | Vector2 {
    if (typeof from === "number" && typeof to === "number") return lerpNumber(from, to, t);
    const a = typeof from === "number" ? { x: from, y: from } : from;
    const b = typeof to === "number" ? { x: to, y: to } : to;
    return lerpVector2(a, b, t);
}
