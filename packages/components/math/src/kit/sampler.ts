import type { Extents, Vector2 } from "@motionscript/sdk";

/**
 * Turns a curve into the polylines that draw it: adaptively, so a straight
 * stretch costs two points and a tight bend as many as it needs, and broken
 * wherever the curve is, at an asymptote or the edge of its domain.
 */

/** A curve's parameter to its pixel, written into `out`. `false` where the curve is undefined. */
export type CurveProjection = (t: number, out: Vector2) => boolean;

export interface SampleOptions {
    /** The equal steps the parameter range starts as, before any is split. */
    seeds?: number;
    /** A parameter step that is not split again, however bent. */
    minStep?: number;
}

/** Path coordinates are 32-bit floats in the renderer; past this a clamped point still clips to the same edge. */
const COORD_LIMIT = 16_000;
/** How far, in pixels, the drawn chord may stray from the curve. */
const TOLERANCE_PX = 0.25;
/** A turn, in radians, a chord is allowed to hide: what keeps a symmetric bump from reading as flat. */
const ANGLE_TOLERANCE = 0.05;
const MAX_DEPTH = 12;
const MAX_EVALUATIONS = 40_000;
const MAX_POINTS = 24_000;
/** Bisections spent finding where a domain ends. */
const BOUNDARY_STEPS = 60;
const DEFAULT_SEEDS = 256;

interface Sample {
    t: number;
    px: number;
    py: number;
    /** The pixel before clamping: what tells an asymptote from a steep line. */
    rx: number;
    ry: number;
    ok: boolean;
}

// Midpoints are pooled: a refine is a depth-first walk, so a slot is free again
// as soon as the seed interval it was taken for is done.
const arena: Sample[] = [];
let arenaMark = 0;

function takeSample(): Sample {
    let slot = arena[arenaMark];
    if (slot === undefined) {
        slot = blank();
        arena.push(slot);
    }
    arenaMark++;
    return slot;
}

function blank(): Sample {
    return { t: 0, px: 0, py: 0, rx: 0, ry: 0, ok: false };
}

const scratch: Vector2 = { x: 0, y: 0 };

/** The runs of points that draw `project` over `[t0, t1]`, clipped to `clip`. */
export function sampleCurve(
    project: CurveProjection,
    t0: number,
    t1: number,
    clip: Extents,
    { seeds = DEFAULT_SEEDS, minStep = 0 }: SampleOptions = {},
): Vector2[][] {
    if (!(t1 > t0) || !Number.isFinite(t0) || !Number.isFinite(t1)) return [];
    const pen = new CurvePen(clip);
    let spent = 0;

    const write = (slot: Sample, t: number): Sample => {
        const defined = project(t, scratch);
        spent++;
        const ok = defined && Number.isFinite(scratch.x) && Number.isFinite(scratch.y);
        slot.t = t;
        slot.rx = ok ? scratch.x : 0;
        slot.ry = ok ? scratch.y : 0;
        slot.px = clampCoord(slot.rx);
        slot.py = clampCoord(slot.ry);
        slot.ok = ok;
        return slot;
    };
    const at = (t: number): Sample => write(takeSample(), t);

    // The last defined point before `to`, which is not: where `sqrt(x)` meets its axis.
    const edgeOf = (from: Sample, to: Sample): Sample => {
        let inside = from;
        let outsideT = to.t;
        for (let i = 0; i < BOUNDARY_STEPS; i++) {
            if (spent >= MAX_EVALUATIONS || offFrame(inside, clip)) break;
            const midT = (inside.t + outsideT) / 2;
            if (midT === inside.t || midT === outsideT) break;
            const mid = at(midT);
            if (!mid.ok) {
                outsideT = midT;
                continue;
            }
            const settled = Math.abs(mid.px - inside.px) < TOLERANCE_PX && Math.abs(mid.py - inside.py) < TOLERANCE_PX;
            inside = mid;
            if (settled) break;
        }
        return inside;
    };

    const emit = (a: Sample, m: Sample | null, b: Sample, floored: boolean): void => {
        if (a.ok && b.ok) {
            if (floored && diverges(a, m, b, clip)) pen.break();
            else pen.draw(a, b);
            return;
        }
        if (a.ok) {
            const edge = edgeOf(a, b);
            if (edge.t !== a.t) pen.draw(a, edge);
            pen.break();
            return;
        }
        pen.break();
        if (b.ok) {
            const edge = edgeOf(b, a);
            if (edge.t !== b.t) pen.draw(edge, b);
            else pen.start(b);
        }
    };

    const refine = (a: Sample, b: Sample, depth: number): void => {
        if (spent >= MAX_EVALUATIONS || pen.points >= MAX_POINTS) {
            emit(a, null, b, false);
            return;
        }
        const m = at((a.t + b.t) / 2);
        const floored = depth >= MAX_DEPTH || b.t - a.t <= minStep;
        if (floored || flat(a, m, b)) {
            emit(a, m, b, floored);
            return;
        }
        refine(a, m, depth + 1);
        refine(m, b, depth + 1);
    };

    const count = Math.max(1, Math.round(seeds));
    const step = (t1 - t0) / count;
    const ends: [Sample, Sample] = [blank(), blank()];
    let previous = write(ends[0], t0);
    for (let i = 1; i <= count; i++) {
        const next = write(ends[i & 1], i === count ? t1 : t0 + i * step);
        arenaMark = 0;
        refine(previous, next, 0);
        previous = next;
    }
    arenaMark = 0;
    return pen.finish();
}

function flat(a: Sample, m: Sample, b: Sample): boolean {
    if (a.ok !== m.ok || m.ok !== b.ok) return false;
    if (!a.ok) return true;
    const dx = b.px - a.px;
    const dy = b.py - a.py;
    const length = Math.hypot(dx, dy) || 1;
    if (Math.abs((m.px - a.px) * dy - (m.py - a.py) * dx) / length > TOLERANCE_PX) return false;
    let turn = Math.abs(Math.atan2(m.py - a.py, m.px - a.px) - Math.atan2(b.py - m.py, b.px - m.px));
    if (turn > Math.PI) turn = 2 * Math.PI - turn;
    return turn < ANGLE_TOLERANCE;
}

// Two neighbours on opposite sides of the frame, with nothing between them that
// is between them: an asymptote, not a steep line.
function diverges(a: Sample, m: Sample | null, b: Sample, clip: Extents): boolean {
    const straddles =
        (a.py > clip.maxY && b.py < clip.minY) || (a.py < clip.minY && b.py > clip.maxY) ||
        (a.px > clip.maxX && b.px < clip.minX) || (a.px < clip.minX && b.px > clip.maxX);
    if (!straddles || m === null) return false;
    if (!m.ok) return true;
    return (
        m.ry < Math.min(a.ry, b.ry) || m.ry > Math.max(a.ry, b.ry) ||
        m.rx < Math.min(a.rx, b.rx) || m.rx > Math.max(a.rx, b.rx)
    );
}

function offFrame(sample: Sample, clip: Extents): boolean {
    return sample.py > clip.maxY || sample.py < clip.minY || sample.px > clip.maxX || sample.px < clip.minX;
}

function clampCoord(value: number): number {
    if (value > COORD_LIMIT) return COORD_LIMIT;
    if (value < -COORD_LIMIT) return -COORD_LIMIT;
    return value;
}

class CurvePen {
    points = 0;
    private readonly runs: Vector2[][] = [];
    private open: Vector2[] = [];
    private cursor: Vector2 | null = null;

    constructor(private readonly clip: Extents) {}

    draw(a: Sample, b: Sample): void {
        const segment = clipSegment(a.px, a.py, b.px, b.py, this.clip);
        if (!segment) {
            this.break();
            return;
        }
        const [start, end] = segment;
        if (this.cursor && samePoint(this.cursor, start)) {
            this.push(end);
        } else {
            this.break();
            this.push(start);
            this.push(end);
        }
        this.cursor = end;
    }

    start(b: Sample): void {
        this.break();
        if (!inside(b.px, b.py, this.clip)) return;
        this.cursor = { x: b.px, y: b.py };
        this.push(this.cursor);
    }

    break(): void {
        if (this.open.length >= 2) this.runs.push(this.open);
        this.open = [];
        this.cursor = null;
    }

    finish(): Vector2[][] {
        this.break();
        return this.runs;
    }

    private push(point: Vector2): void {
        this.open.push(point);
        this.points++;
    }
}

function samePoint(a: Vector2, b: Vector2): boolean {
    return Math.abs(a.x - b.x) < 0.1 && Math.abs(a.y - b.y) < 0.1;
}

function inside(x: number, y: number, clip: Extents): boolean {
    return x >= clip.minX && x <= clip.maxX && y >= clip.minY && y <= clip.maxY;
}

// Liang–Barsky: the part of a segment inside the clip, or null when none is.
function clipSegment(ax: number, ay: number, bx: number, by: number, clip: Extents): [Vector2, Vector2] | null {
    const dx = bx - ax;
    const dy = by - ay;
    let t0 = 0;
    let t1 = 1;
    const edges: [number, number][] = [
        [-dx, ax - clip.minX],
        [dx, clip.maxX - ax],
        [-dy, ay - clip.minY],
        [dy, clip.maxY - ay],
    ];
    for (const [p, q] of edges) {
        if (p === 0) {
            if (q < 0) return null;
            continue;
        }
        const r = q / p;
        if (p < 0) {
            if (r > t1) return null;
            if (r > t0) t0 = r;
        } else {
            if (r < t0) return null;
            if (r < t1) t1 = r;
        }
    }
    return [
        { x: ax + t0 * dx, y: ay + t0 * dy },
        { x: ax + t1 * dx, y: ay + t1 * dy },
    ];
}
