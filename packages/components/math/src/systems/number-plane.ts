import {
    component2d,
    Graphics2D,
    Types,
    type Extents,
    type NodeOf,
    type Stroke as _Stroke,

    type StrokeResolved,
    // Named so the emitted declaration reaches these through the sdk, not core.
    type Color as _Color,
    type Fill as _Fill,
    type FillResolved as _FillResolved,
    type Node2D as _Node2D,
    type Node2DProps as _Node2DProps,
    type NormalizedColor as _NormalizedColor,
    type Shadow as _Shadow,
    type ShadowResolved as _ShadowResolved,
} from "@motionscript/sdk";
import {
    isIdentityMatrix,
    lerpMatrix,
    lineThrough,
    readMatrix,
    transformedMap,
    warpedMap,
    type CoordinateMap,
    type Matrix2,
    type Warp,
} from "../kit/coords";
import { fieldParams, parseField } from "../kit/field";
import { AXIS_COLOR } from "../kit/furniture";
import { lerpSource, readSource, type PlotSource } from "../kit/source";
import { drawSystem, plotArea, systemLayout, systemOpenPlane, systemProvides, systemSize } from "../kit/system";
import { AXES, AXES_COMMANDS, axesFurniture, axesMap, axesOf, loadAxes, type AxesValues, type AxisLayout } from "./axes2d";

const state = {
    ...AXES,
    grid: Types.boolean(true, { animatable: false }),
    /** The line at every tick. */
    gridStroke: Types.stroke({ weight: 1.5, fill: "#3b4658", align: "center" }),
    /** The lines between ticks. */
    minorStroke: Types.stroke({ weight: 1, fill: "#232b38", align: "center" }),
    /** How many parts the space between two ticks is cut into; one draws no line between them. */
    minorDivisions: Types.number(2, { min: 1, max: 10, step: 1 }),
    /** A linear map of the plane, row by row: `[a, b, c, d]` sends `(x, y)` to `(ax + by, cx + dy)`. */
    matrix: Types.custom<Matrix2 | readonly (readonly number[])[], Matrix2>([1, 0, 0, 1], { resolve: readMatrix, lerp: lerpMatrix }),
    /**
     * Where each point of the plane is sent, two parts in x and y:
     * `(x + sin(y), y + sin(x))`. Empty leaves the plane flat.
     */
    warp: Types.custom<string | PlotSource, PlotSource>("", { resolve: readSource, lerp: lerpSource, kind: "fieldEquation" }),
    /** Leave the plane as it was, faintly, behind one that has been transformed or warped. */
    ghost: Types.boolean(true, { animatable: false }),
};

type PlaneValues = AxesValues & {
    readonly grid: boolean;
    readonly gridStroke: StrokeResolved[];
    readonly minorStroke: StrokeResolved[];
    readonly minorDivisions: number;
    readonly matrix: Matrix2;
    readonly warp: PlotSource;
    readonly ghost: boolean;
};

/** Axes over a full grid with square units: the plane vectors and transformations are drawn on. `matrix` and `warp` move the grid, the axes and everything on the plane. */
export const NumberPlane = component2d({
    key: "numberPlane",
    state,
    defaults: {
        squareUnits: true,
        stroke: { weight: 2, fill: AXIS_COLOR, align: "center" },
        // A transformed plane reaches past its box, and so does what is on it: both are kept in unless told otherwise.
        clip: (s) => spills(s),
    },
    load: (loader, s) => loadAxes(loader, s),
    commands: {
        ...AXES_COMMANDS,
        /** Send the plane through a matrix: a shear, a turn, a squeeze, a flip. */
        transformTo: { args: ["matrix"] },
        /** Bend the plane, each point travelling to where the warp sends it; an empty one flattens it again. */
        warpTo: { args: ["warp"] },
    },
    provide: (s) => systemProvides(s),
    measure: (_measurer, s) => systemSize(s),
    layout: (box, s, children) => systemLayout(box, s, children, planeMap),
    plane: (box, s) => systemOpenPlane(box, s, planeMap),
    render: (ctx, s) => {
        const { flat, map } = planeMaps(plotArea(ctx.size, s.padding), s);
        drawSystem(ctx, s, map, (on) => axesFurniture(on, s, (x, y) => grid(s, flat, on, x, y)));
    },
});

export type NumberPlane = NodeOf<typeof NumberPlane>;

/** The plane's map on a plot area: the flat one, sent through its matrix and its warp. */
export function planeMap(area: Extents, s: PlaneValues): CoordinateMap {
    return planeMaps(area, s).map;
}

/** The flat plane on a plot area, and the plane as its matrix and its warp have it. */
function planeMaps(area: Extents, s: PlaneValues): { flat: CoordinateMap; map: CoordinateMap } {
    const flat = axesMap(area, s);
    const map = isIdentityMatrix(s.matrix) ? flat : transformedMap(flat, s.matrix);
    const { source, blend } = s.warp;
    const to = warpOf(source);
    if (!blend) return { flat, map: to ? warpedMap(map, to, source) : map };
    // Mid-warp each point is part of the way from where the old warp had it to where the new one sends it.
    const from = warpOf(blend.from);
    if (!from && !to) return { flat, map };
    const start = { x: 0, y: 0 };
    return {
        flat,
        map: warpedMap(
            map,
            (x, y, out) => {
                if (!(from ?? STAY)(x, y, start) || !(to ?? STAY)(x, y, out)) return false;
                out.x = start.x + (out.x - start.x) * blend.t;
                out.y = start.y + (out.y - start.y) * blend.t;
                return true;
            },
            `${blend.from}>${source}@${blend.t}`,
        ),
    };
}

/** Whether the plane reaches past its box: it is transformed or warped. */
function spills(s: PlaneValues): boolean {
    if (!isIdentityMatrix(s.matrix)) return true;
    const { source, blend } = s.warp;
    return warpOf(source) !== null || (blend !== undefined && warpOf(blend.from) !== null);
}

/** The grid behind the axes, with the flat plane faintly behind a transformed one. */
function grid(s: PlaneValues, flat: CoordinateMap, map: CoordinateMap, x: AxisLayout, y: AxisLayout): Graphics2D[] {
    if (!s.grid) return [];
    const parts: Graphics2D[] = [];
    if (s.ghost && flat.revision !== map.revision) {
        const [gx, gy] = axesOf(flat, s);
        parts.push(...ruled(s, flat, gx, gy, true));
    }
    parts.push(...ruled(s, map, x, y, false));
    return parts;
}

/** The grid of `map`: every line, or only the ones at a tick, in the fainter stroke, for a ghost. */
function ruled(s: PlaneValues, map: CoordinateMap, x: AxisLayout, y: AxisLayout, ghost: boolean): Graphics2D[] {
    const { start, end } = s;
    const [xMin, xMax] = map.xRange;
    const [yMin, yMax] = map.yRange;
    const lines = (values: readonly number[], vertical: boolean): Graphics2D => {
        const g = new Graphics2D();
        for (const value of values) {
            g.line({
                points: vertical ? lineThrough(map, value, yMin, value, yMax) : lineThrough(map, xMin, value, xMax, value),
                radius: 0,
                start,
                end,
            });
        }
        return g;
    };
    const parts: Graphics2D[] = [];
    const minor = s.minorStroke;
    if (ghost) {
        if (minor.length === 0) return parts;
        if (x.marks.values.length > 0) parts.push(lines(x.marks.values, true).stroke(minor));
        if (y.marks.values.length > 0) parts.push(lines(y.marks.values, false).stroke(minor));
        return parts;
    }
    const divisions = Math.round(s.minorDivisions);
    if (minor.length > 0 && divisions > 1) {
        const between = (axis: AxisLayout, [min, max]: readonly [number, number]): number[] => {
            const { step, values } = axis.marks;
            if (!(step > 0) || values.length === 0) return [];
            const out: number[] = [];
            for (let base = values[0] - step; base < max; base += step) {
                for (let i = 1; i < divisions; i++) {
                    const value = base + (step * i) / divisions;
                    if (value > min && value < max) out.push(value);
                }
            }
            return out;
        };
        const xs = between(x, map.xRange);
        const ys = between(y, map.yRange);
        if (xs.length > 0) parts.push(lines(xs, true).stroke(minor));
        if (ys.length > 0) parts.push(lines(ys, false).stroke(minor));
    }
    const major = s.gridStroke;
    if (major.length > 0) {
        if (x.marks.values.length > 0) parts.push(lines(x.marks.values, true).stroke(major));
        if (y.marks.values.length > 0) parts.push(lines(y.marks.values, false).stroke(major));
    }
    return parts;
}

const STAY: Warp = (x, y, out) => {
    out.x = x;
    out.y = y;
    return true;
};

/** `source` as a warp, or `null` for text that is empty or not a field: the plane is then left as it is. */
function warpOf(source: string): Warp | null {
    const field = source.trim() === "" ? null : parseField(source, fieldParams(source));
    if (!field || field instanceof Error) return null;
    const { x, y } = field;
    return (gx, gy, out) => {
        const wx = x(gx, gy);
        const wy = y(gx, gy);
        out.x = wx;
        out.y = wy;
        return Number.isFinite(wx) && Number.isFinite(wy);
    };
}
