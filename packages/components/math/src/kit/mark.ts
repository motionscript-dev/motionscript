import {
    Graphics2D,
    type ChildView,
    type Extents,
    type Fill,
    type RenderContext,
    type Shadow,
    type Size2D,
    type Stroke,
    type StrokeResolved,
    type Vector2,
} from "@motionscript/sdk";
import { painted } from "./component";
import { PIXEL_MAP, type CoordinateMap } from "./coords";
import { boundsOfRuns, runsToPath } from "./geometry";
import type { GraphPlane } from "./graph";

/**
 * What a mark is traced through: the map, its own `x`/`y` as a shift, and the
 * plane it reads curves from. A mark is a shape whose box is the tight box of its
 * ink; outside a system a graph unit is a pixel and `x`/`y` the usual offset.
 */
export interface MarkReading {
    readonly map: CoordinateMap;
    /** Zero outside a system, where `x`/`y` are pixels. */
    readonly shift: Vector2;
    readonly plane: GraphPlane | null;
}

/** The runs a mark draws, in pixels, y-up from the system's centre. */
export type Tracer<V> = (state: V, read: MarkReading) => Vector2[][];

/** What every mark's state reads: its place, and the plane it is laid out on. */
export interface MarkState {
    readonly x: number;
    readonly y: number;
    readonly graph: GraphPlane | null;
}

const NO_SHIFT: Vector2 = { x: 0, y: 0 };

const tracers: { readonly is: (child: ChildView) => boolean; readonly trace: Tracer<never> }[] = [];

/** `component`, declared a mark: a holder lays it out on the ink `trace` draws. Hand back the component. */
export function traced<C extends { is(child: ChildView): boolean }>(component: C, trace: Tracer<never>): C {
    tracers.push({ is: (child) => component.is(child), trace });
    return component;
}

/** The runs `child` draws on `plane`, or `undefined` for a child that is no mark. */
export function markRuns(child: ChildView, map: CoordinateMap, plane: GraphPlane): Vector2[][] | undefined {
    const mark = tracers.find((entry) => entry.is(child));
    if (!mark) return undefined;
    const state = child.state as unknown as MarkState;
    return (mark.trace as Tracer<MarkState>)(state, { map, shift: { x: state.x, y: state.y }, plane });
}

/** How a mark's own fields read it: through its plane's map when one lays it out, through pixels when none does. */
export function reading(state: MarkState): MarkReading {
    const plane = state.graph;
    return plane ? { map: plane.map, shift: { x: state.x, y: state.y }, plane } : { map: PIXEL_MAP, shift: NO_SHIFT, plane: null };
}

/** The size of a mark's ink: its box when a node other than a system lays it out. */
export function inkSize(runs: readonly (readonly Vector2[])[]): Size2D {
    const ink = boundsOfRuns(runs);
    return ink ? { width: ink.maxX - ink.minX, height: ink.maxY - ink.minY } : { width: 0, height: 0 };
}

/** The centre of `runs`' ink in the map's pixels: where a mark's children are placed from. */
export function inkCentre(runs: readonly (readonly Vector2[])[]): Vector2 {
    const ink = boundsOfRuns(runs);
    return ink ? { x: (ink.minX + ink.maxX) / 2, y: (ink.minY + ink.maxY) / 2 } : NO_SHIFT;
}

/** A graph point in a mark's own frame, where a handle on it sits. */
export function ownPoint(read: MarkReading, runs: readonly (readonly Vector2[])[], point: Vector2): Vector2 {
    const at = read.map.toPoint(point.x + read.shift.x, point.y + read.shift.y);
    const centre = inkCentre(runs);
    return { x: at.x - centre.x, y: at.y - centre.y };
}

/** The graph point at `at` in a mark's own frame: {@link ownPoint} undone. */
export function graphPoint(read: MarkReading, runs: readonly (readonly Vector2[])[], at: Vector2): Vector2 {
    const centre = inkCentre(runs);
    const point = read.map.toCoords(at.x + centre.x, at.y + centre.y);
    return { x: point.x - read.shift.x, y: point.y - read.shift.y };
}

/** What a mark paints with. */
export interface MarkPaint {
    readonly fill?: Fill;
    readonly stroke?: Stroke;
    readonly shadow: Shadow;
    readonly start?: number;
    readonly end?: number;
}

export interface MarkOptions {
    /** Whether each run is closed into an outline. */
    readonly closed?: boolean;
    /** Whether the fill is painted: a mark whose ink has no inside yet (an open line) says no. */
    readonly fills?: boolean;
    /** The stroke along the ink, when it is not the plain one. */
    readonly ink?: (ctx: RenderContext, ink: Extents) => void;
}

const NONE: never[] = [];

/** One mark's outline, the same commands for each paint. */
export function markShape(runs: readonly (readonly Vector2[])[], s: MarkPaint, closed = false): (() => Graphics2D) | null {
    const ink = boundsOfRuns(runs);
    const data = runsToPath(runs, closed);
    if (!ink || data.length === 0) return null;
    const centerBounds: [number, number, number, number] = [ink.minX, ink.minY, ink.maxX, ink.maxY];
    return () => new Graphics2D().path({ data, centerBounds, start: s.start ?? 0, end: s.end ?? 1 });
}

/**
 * A mark's paint: the fill under the stroke along its ink, both before its
 * children, so a point or a tangent riding a plot sits on the curve.
 */
export function drawMark(ctx: RenderContext, s: MarkPaint, runs: readonly (readonly Vector2[])[], options: MarkOptions = {}): void {
    const shape = markShape(runs, s, options.closed);
    const fill = s.fill ?? NONE;
    painted(ctx, () => {
        if (shape && options.fills !== false) ctx.draw(shape().shadow(s.shadow).fill(fill));
        const ink = options.ink ? boundsOfRuns(runs) : null;
        if (ink && options.ink) options.ink(ctx, ink);
        else if (shape) strokeShape(ctx, shape, s);
    });
}

/** The stroke along a shape, casting the shadow when nothing fills it. */
export function strokeShape(ctx: RenderContext, shape: () => Graphics2D, s: MarkPaint): void {
    const stroke = (s.stroke ?? NONE) as StrokeResolved[];
    if (stroke.length === 0) return;
    ctx.draw(castsShadow(s) ? shape().shadow(s.shadow).stroke(stroke) : shape().stroke(stroke));
}

/** A shadow is cast by the stroke when nothing visible fills the shape. */
export function castsShadow(s: MarkPaint): boolean {
    if ((s.shadow as unknown[]).length === 0) return false;
    return !((s.fill ?? NONE) as { opacity?: number }[]).some((layer) => (layer.opacity ?? 1) > 0);
}
