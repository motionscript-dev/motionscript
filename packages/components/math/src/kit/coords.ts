import type { Extents, Vector2 } from "@motionscript/sdk";

/** A closed span of graph values, low to high. */
export type Interval = readonly [number, number];

export type AxisScaling = "linear" | "log";

/**
 * How a coordinate system's graph values land on its pixels. Pixels are y-up
 * from the centre of the system's own box, which is the frame a `Graphics2D` op
 * is written in.
 */
export interface CoordinateMap {
    /** Graph to pixels. Writes into `out` when given, so a sampler allocates nothing. */
    toPoint(x: number, y: number, out?: Vector2): Vector2;
    toCoords(x: number, y: number, out?: Vector2): Vector2;
    /** The plot area. */
    readonly area: Extents;
    readonly xRange: Interval;
    readonly yRange: Interval;
    /** Equal for two maps that place every point alike: what a geometry cache keys on. */
    readonly revision: string;
    /** Set where a straight run of graph values is not a straight run of pixels, so a line through the map is sampled. */
    readonly curved?: boolean;
    /** Set where what is ruled over the ranges can leave the plot area, so the system keeps it in. */
    readonly spills?: boolean;
}

/** One axis: a graph value to a pixel and back. */
export interface AxisScale {
    to(value: number): number;
    from(pixel: number): number;
}

/** `range`, made usable: finite, ordered, non-empty, and positive on a log axis. */
export function resolveInterval(range: Interval | undefined, scaling: AxisScaling = "linear"): Interval {
    let [min, max] = range ?? [0, 1];
    if (!Number.isFinite(min) || !Number.isFinite(max)) [min, max] = [0, 1];
    if (min > max) [min, max] = [max, min];
    if (scaling === "log") {
        if (!(max > 0)) max = 10;
        if (!(min > 0)) min = max / 1000;
    }
    return max > min ? [min, max] : [min, min + 1];
}

/** `range` spread over the pixels from `lo` to `hi`. */
export function axisScale(range: Interval, lo: number, hi: number, scaling: AxisScaling = "linear"): AxisScale {
    const [min, max] = range;
    if (scaling === "log") {
        const from = Math.log10(min);
        const k = (hi - lo) / (Math.log10(max) - from);
        return { to: (v) => lo + (Math.log10(v) - from) * k, from: (p) => 10 ** (from + (p - lo) / k) };
    }
    const k = (hi - lo) / (max - min);
    return { to: (v) => lo + (v - min) * k, from: (p) => min + (p - lo) / k };
}

export interface CartesianOptions {
    xRange: Interval;
    yRange: Interval;
    area: Extents;
    xScaling?: AxisScaling;
    yScaling?: AxisScaling;
}

/** Two independent axes at right angles: what a number line, axes and a number plane share. */
export function cartesianMap({ xRange, yRange, area, xScaling = "linear", yScaling = "linear" }: CartesianOptions): CoordinateMap {
    const x = axisScale(xRange, area.minX, area.maxX, xScaling);
    const y = axisScale(yRange, area.minY, area.maxY, yScaling);
    return {
        toPoint: (gx, gy, out = { x: 0, y: 0 }) => {
            out.x = x.to(gx);
            out.y = y.to(gy);
            return out;
        },
        toCoords: (px, py, out = { x: 0, y: 0 }) => {
            out.x = x.from(px);
            out.y = y.from(py);
            return out;
        },
        area,
        xRange,
        yRange,
        revision: [xRange, yRange, area.minX, area.minY, area.maxX, area.maxY, xScaling, yScaling].join("|"),
    };
}

const UNBOUNDED: Extents = { minX: -Infinity, minY: -Infinity, maxX: Infinity, maxY: Infinity };

/** One graph unit is one pixel: what a mark outside any system is drawn through. */
export const PIXEL_MAP: CoordinateMap = {
    toPoint: (x, y, out = { x: 0, y: 0 }) => {
        out.x = x;
        out.y = y;
        return out;
    },
    toCoords: (x, y, out = { x: 0, y: 0 }) => {
        out.x = x;
        out.y = y;
        return out;
    },
    area: UNBOUNDED,
    xRange: [-Infinity, Infinity],
    yRange: [-Infinity, Infinity],
    revision: "pixels",
};

/** A 2 × 2 matrix, row by row: `[a, b, c, d]` sends `(x, y)` to `(ax + by, cx + dy)`. */
export type Matrix2 = readonly [number, number, number, number];

export const IDENTITY_MATRIX: Matrix2 = [1, 0, 0, 1];

/** A matrix from its rows, or flat; anything else is the identity. */
export function readMatrix(value: unknown, previous: Matrix2 = IDENTITY_MATRIX): Matrix2 {
    const flat = Array.isArray(value) ? value.flat() : [];
    if (flat.length !== 4 || flat.some((entry) => typeof entry !== "number" || !Number.isFinite(entry))) return previous;
    return [flat[0], flat[1], flat[2], flat[3]];
}

export function lerpMatrix(from: Matrix2, to: Matrix2, t: number): Matrix2 {
    return [0, 1, 2, 3].map((i) => from[i] + (to[i] - from[i]) * t) as unknown as Matrix2;
}

export function isIdentityMatrix([a, b, c, d]: Matrix2): boolean {
    return a === 1 && b === 0 && c === 0 && d === 1;
}

/**
 * How far a transformed plane reaches, in half-widths of its own ranges about
 * their middle. Finite on purpose: a plane squeezed towards a line shows the
 * pre-image of its box growing as 1/det, and ruling all of it packs the box
 * with lines, a solid wash just before the plane goes flat.
 */
const REACH = 4;

function reach([min, max]: Interval): Interval {
    const middle = (min + max) / 2;
    const half = ((max - min) / 2) * REACH;
    return [middle - half, middle + half];
}

/**
 * `base` with every graph point sent through `matrix` first: a plane sheared,
 * turned or squeezed about its origin. Its ranges are what the plot area then
 * shows, up to {@link REACH}, so a grid ruled over them fills the box under a
 * turn, a shear or a fourfold shrink, and folds into a band as it goes flat.
 */
export function transformedMap(base: CoordinateMap, matrix: Matrix2): CoordinateMap {
    const [a, b, c, d] = matrix;
    const det = a * d - b * c;
    // A plane squeezed onto a line has no way back: a point is read as the untransformed plane has it.
    const flat = Math.abs(det) < 1e-9;
    const back = (u: number, v: number, out: Vector2): Vector2 => {
        if (flat) {
            out.x = u;
            out.y = v;
        } else {
            out.x = (d * u - b * v) / det;
            out.y = (a * v - c * u) / det;
        }
        return out;
    };
    const xReach = reach(base.xRange);
    const yReach = reach(base.yRange);
    let xRange = xReach;
    let yRange = yReach;
    if (!flat) {
        const corner: Vector2 = { x: 0, y: 0 };
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const u of base.xRange) {
            for (const v of base.yRange) {
                back(u, v, corner);
                minX = Math.min(minX, corner.x);
                maxX = Math.max(maxX, corner.x);
                minY = Math.min(minY, corner.y);
                maxY = Math.max(maxY, corner.y);
            }
        }
        xRange = [Math.max(minX, xReach[0]), Math.min(maxX, xReach[1])];
        yRange = [Math.max(minY, yReach[0]), Math.min(maxY, yReach[1])];
    }
    return {
        toPoint: (x, y, out = { x: 0, y: 0 }) => base.toPoint(a * x + b * y, c * x + d * y, out),
        toCoords: (px, py, out = { x: 0, y: 0 }) => {
            base.toCoords(px, py, out);
            return back(out.x, out.y, out);
        },
        area: base.area,
        xRange,
        yRange,
        revision: `${base.revision}|m${matrix.join(",")}`,
        spills: true,
    };
}

/** Where a warp sends a graph point, written into `out`; `false` where it has no value. */
export type Warp = (x: number, y: number, out: Vector2) => boolean;

/**
 * `base` with every graph point sent to where `warp` sends it: a plane bent by
 * a function of its own points. `key` names the warp for the revision, since a
 * function has no text of its own.
 */
export function warpedMap(base: CoordinateMap, warp: Warp, key: string): CoordinateMap {
    const bend = (x: number, y: number, out: Vector2): Vector2 => {
        // A point the warp has no value at stays where it is, so a pole does not tear the grid.
        if (!warp(x, y, out)) {
            out.x = x;
            out.y = y;
        }
        return out;
    };
    const at: Vector2 = { x: 0, y: 0 };
    const dx: Vector2 = { x: 0, y: 0 };
    const dy: Vector2 = { x: 0, y: 0 };
    const H = 1e-4;
    return {
        toPoint: (x, y, out = { x: 0, y: 0 }) => {
            bend(x, y, out);
            return base.toPoint(out.x, out.y, out);
        },
        // No closed form: a few Newton steps from where the unbent plane has the point.
        toCoords: (px, py, out = { x: 0, y: 0 }) => {
            const target = base.toCoords(px, py);
            let gx = target.x;
            let gy = target.y;
            for (let i = 0; i < 8; i++) {
                bend(gx, gy, at);
                const ex = at.x - target.x;
                const ey = at.y - target.y;
                if (Math.abs(ex) + Math.abs(ey) < 1e-9) break;
                bend(gx + H, gy, dx);
                bend(gx, gy + H, dy);
                const j00 = (dx.x - at.x) / H;
                const j10 = (dx.y - at.y) / H;
                const j01 = (dy.x - at.x) / H;
                const j11 = (dy.y - at.y) / H;
                const det = j00 * j11 - j01 * j10;
                if (!(Math.abs(det) > 1e-12)) break;
                gx -= (j11 * ex - j01 * ey) / det;
                gy -= (j00 * ey - j10 * ex) / det;
            }
            out.x = Number.isFinite(gx) ? gx : target.x;
            out.y = Number.isFinite(gy) ? gy : target.y;
            return out;
        },
        area: base.area,
        // A bent plane pulls its edges in somewhere: it is ruled a little past them so the box stays full.
        xRange: widened(base.xRange),
        yRange: widened(base.yRange),
        revision: `${base.revision}|w${key}`,
        curved: true,
        spills: true,
    };
}

/** How much further than its range, as a share of it, a warped plane is ruled each way. */
const WARP_MARGIN = 0.3;

function widened([min, max]: Interval): Interval {
    const margin = (max - min) * WARP_MARGIN;
    return Number.isFinite(margin) ? [min - margin, max + margin] : [min, max];
}

/** How many pieces a line through a curved map is drawn in. */
const CURVED_STEPS = 48;

/** The pixel points that draw the straight run of graph values from one point to another. */
export function lineThrough(map: CoordinateMap, x0: number, y0: number, x1: number, y1: number): Vector2[] {
    if (!map.curved) return [map.toPoint(x0, y0), map.toPoint(x1, y1)];
    const run: Vector2[] = [];
    for (let i = 0; i <= CURVED_STEPS; i++) {
        const t = i / CURVED_STEPS;
        run.push(map.toPoint(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t));
    }
    return run;
}
