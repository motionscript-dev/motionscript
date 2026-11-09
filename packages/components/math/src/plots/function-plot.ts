import {
    component2d,
    provides,
    Types,
    type EntryOptions,
    type NodeOf,
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
import { createBoundedCache } from "../kit/cache";
import { omit, PAINT, PAINT_COMMANDS } from "../kit/component";
import { traceContour } from "../kit/contour";
import type { CoordinateMap, Interval } from "../kit/coords";
import { equationParams, parseEquation, type Equation } from "../kit/equation";
import type { ExpressionScope } from "../kit/expression";
import { PLOT_COLOR } from "../kit/furniture";
import { PLOT, plotPlane, SYSTEM, SYSTEM_ENTRY } from "../kit/graph";
import { drawMark, inkCentre, inkSize, reading, traced, type MarkReading } from "../kit/mark";
import { openPlane, placeOnMap } from "../kit/place";
import { sampleCurve, type CurveProjection } from "../kit/sampler";
import { lerpDomain, lerpParams, lerpSource, readSource, scopeFor, type PlotSource } from "../kit/source";

export interface FunctionPlotProps extends PaintProps {
    expression?: string | PlotSource;
    domain?: Interval | null;
    params?: ExpressionScope;
}

const TAU = Math.PI * 2;

/** A plot's entries: what a traced path is built on too. It is only a line, so it has no fill. */
export const PLOT_STATE = {
    ...omit(PAINT, "fill"),
    expression: Types.custom<string | PlotSource, PlotSource>("", { resolve: readSource, lerp: lerpSource, kind: "equation" }),
    /**
     * The span of the free variable that is drawn. Left out, a function runs the
     * width of its system, a polar curve one turn and a parametric one from 0 to 1.
     */
    domain: Types.custom<Interval | null, Interval | null, EntryOptions & { readonly defaultMin: number; readonly defaultMax: number }>(null, { lerp: lerpDomain, kind: "range", defaultMin: -5, defaultMax: 5 }),
    /**
     * The equation's named values: any name in it that is not a variable, a
     * function or a constant. One left unset is 1, and a formula can bind each
     * to a variable.
     */
    params: Types.custom<ExpressionScope>({}, { lerp: lerpParams }),
    graph: SYSTEM_ENTRY,
};

/** A plot's own commands, beside a line's paints. */
export const PLOT_COMMANDS = {
    ...omit(PAINT_COMMANDS, "fillTo"),
    /** Change the equation, the curve bending from the one into the other. */
    morphTo: { args: ["expression"] as const },
    /** Animate the equation's named values. */
    paramsTo: { args: ["params"] as const },
    /** Animate the span that is drawn. */
    domainTo: { args: ["domain"] as const },
};

export const PLOT_STROKE = { weight: 3, fill: PLOT_COLOR, align: "center", cap: "round", join: "round" } as const;

/** What a plot's curve is drawn from. */
export interface PlotValues {
    readonly expression: PlotSource;
    readonly params: ExpressionScope;
}

/**
 * The curve of an equation, drawn in the coordinate system it is a child of.
 * How the equation is written says what it is: see `Equation`. A mark put
 * inside it reads it: the area under it, a tangent, a point that rides it.
 */
export const FunctionPlot = traced(component2d({
    key: "functionPlot",
    state: PLOT_STATE,
    defaults: { stroke: PLOT_STROKE, width: "hug", height: "hug" },
    commands: PLOT_COMMANDS,
    // The marks inside it ride it, on its system's map.
    provide: (s, inherited) => [provides(PLOT, plotPlane(s, inherited(SYSTEM)))],
    measure: (_measurer, s) => inkSize(tracePlot(s, reading(s), s.domain)),
    layout: (box, s, children) => {
        const read = reading(s);
        return placeOnMap(children, read.map, inkCentre(tracePlot(s, read, s.domain)), box, plotPlane(s, s.graph));
    },
    plane: (_box, s) => {
        const read = reading(s);
        return openPlane(read.map, inkCentre(tracePlot(s, read, s.domain)));
    },
    render: (ctx, s) => drawMark(ctx, s, tracePlot(s, reading(s), s.domain)),
}), (s: PlotValues & { readonly domain: Interval | null }, read: MarkReading) => tracePlot(s, read, s.domain));

export type FunctionPlot = NodeOf<typeof FunctionPlot>;

const traces = createBoundedCache<Vector2[][]>(256);

/** The runs a plot of `s` draws through `read`, over `span` of its free variable (all of it for `null`). */
export function tracePlot(s: PlotValues, read: MarkReading, span: Interval | null): Vector2[][] {
    const { map, shift } = read;
    const { area } = map;
    if (!Number.isFinite(area.maxX - area.minX)) return [];
    const { source, blend } = s.expression;
    const key = [source, blend?.from, blend?.t, map.revision, span, JSON.stringify(s.params), shift.x, shift.y].join("|");
    const known = traces.get(key);
    if (known) return known;

    let runs: Vector2[][];
    // A curve with no parameter to walk cannot bend into another: it changes over half way.
    const shown = blend && blend.t < 0.5 ? blend.from : source;
    if (equationOf(source)?.kind === "implicit" || (blend && equationOf(blend.from)?.kind === "implicit")) {
        runs = contour(shown, s.params, map, shift);
    } else {
        let curve = projectionOf(source, s.params, span, map, shift);
        if (curve && blend) {
            const from = projectionOf(blend.from, s.params, span, map, shift);
            if (from) curve = between(from, curve, blend.t);
        }
        const width = area.maxX - area.minX;
        runs = curve
            ? sampleCurve(curve, 0, 1, area, { seeds: Math.min(512, Math.max(64, Math.round(width / 8))), minStep: 0.5 / Math.max(1, width) })
            : [];
    }
    traces.set(key, runs);
    return runs;
}

function equationOf(source: string): Equation | null {
    const equation = parseEquation(source, equationParams(source));
    return equation instanceof Error ? null : equation;
}

/** Where an implicit `source` holds, over what the system shows, as pixel runs. */
function contour(source: string, params: ExpressionScope, map: CoordinateMap, shift: Vector2): Vector2[][] {
    const equation = equationOf(source);
    if (equation?.kind !== "implicit") return [];
    const scope = scopeFor(equationParams(source), params);
    const { area } = map;
    const cells = (pixels: number) => Math.min(CONTOUR_MAX, Math.max(8, Math.round(pixels / CONTOUR_CELL)));
    const { f } = equation;
    const runs = traceContour(
        (x, y) => f(x - shift.x, y - shift.y, scope),
        map.xRange,
        map.yRange,
        cells(area.maxX - area.minX),
        cells(area.maxY - area.minY),
    );
    return runs.map((run) => run.map((point) => map.toPoint(point.x, point.y)));
}

/** `source` as a pixel curve over a parameter running 0 to 1. */
function projectionOf(source: string, params: ExpressionScope, domain: Interval | null, map: CoordinateMap, shift: Vector2): CurveProjection | null {
    const equation = equationOf(source);
    if (!equation || equation.kind === "implicit") return null;
    const scope = scopeFor(equationParams(source), params);
    switch (equation.kind) {
        case "function": {
            const horizontal = equation.of === "x";
            const [lo, hi] = horizontal ? map.xRange : map.yRange;
            const offset = horizontal ? shift.x : shift.y;
            // Only what the system shows is sampled, however wide the domain.
            const a = Math.max(lo - offset, domain?.[0] ?? -Infinity);
            const b = Math.min(hi - offset, domain?.[1] ?? Infinity);
            if (!(b > a)) return null;
            const { f } = equation;
            return (u, out) => {
                const v = a + (b - a) * u;
                const w = f(v, 0, scope);
                if (!Number.isFinite(w)) return false;
                if (horizontal) map.toPoint(v + shift.x, w + shift.y, out);
                else map.toPoint(w + shift.x, v + shift.y, out);
                return true;
            };
        }
        case "polar": {
            const [a, b] = domain ?? [0, TAU];
            const { f } = equation;
            return (u, out) => {
                const theta = a + (b - a) * u;
                const r = f(theta, 0, scope);
                if (!Number.isFinite(r)) return false;
                map.toPoint(r * Math.cos(theta) + shift.x, r * Math.sin(theta) + shift.y, out);
                return true;
            };
        }
        case "parametric": {
            const [a, b] = domain ?? [0, 1];
            const { x, y } = equation;
            return (u, out) => {
                const t = a + (b - a) * u;
                const gx = x(t, 0, scope);
                const gy = y(t, 0, scope);
                if (!Number.isFinite(gx) || !Number.isFinite(gy)) return false;
                map.toPoint(gx + shift.x, gy + shift.y, out);
                return true;
            };
        }
    }
}

// Roughly one cell of the contour's grid to this many pixels, each way.
const CONTOUR_CELL = 5;
const CONTOUR_MAX = 220;

// Two curves blended point for point along their parameters, in pixels, so any
// kind bends into any other.
function between(from: CurveProjection, to: CurveProjection, t: number): CurveProjection {
    const a: Vector2 = { x: 0, y: 0 };
    return (u, out) => {
        if (!from(u, a) || !to(u, out)) return false;
        out.x = a.x + (out.x - a.x) * t;
        out.y = a.y + (out.y - a.y) * t;
        return true;
    };
}
