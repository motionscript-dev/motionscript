// Contour measurement on PathData, and what is built with it: trimPath keeps
// the [start, end] fraction of the contours' total length, each cut exactly
// (curves split at the parameter whose arc length matches; a segment is never
// closed), and dash fitting cuts a pattern's "on" runs out of them.

import { pathOps } from "@motionscript/core";
import { type PathData, PathBuilder, VERB } from "../doc";

type Seg = { kind: "line" | "quad" | "cubic"; p: number[]; len: number; table: number[] };

const SAMPLES = 32;

function at(s: Seg, t: number): [number, number] {
    const p = s.p, u = 1 - t;
    if (s.kind === "line") return [p[0] + (p[2] - p[0]) * t, p[1] + (p[3] - p[1]) * t];
    if (s.kind === "quad") return [u * u * p[0] + 2 * u * t * p[2] + t * t * p[4], u * u * p[1] + 2 * u * t * p[3] + t * t * p[5]];
    return [
        u * u * u * p[0] + 3 * u * u * t * p[2] + 3 * u * t * t * p[4] + t * t * t * p[6],
        u * u * u * p[1] + 3 * u * u * t * p[3] + 3 * u * t * t * p[5] + t * t * t * p[7],
    ];
}

function measure(kind: Seg["kind"], p: number[]): Seg {
    const table = [0];
    const n = kind === "line" ? 1 : SAMPLES;
    const s: Seg = { kind, p, len: 0, table };
    let prev = at(s, 0);
    for (let i = 1; i <= n; i++) {
        const q = at(s, i / n);
        table.push(table[i - 1] + Math.hypot(q[0] - prev[0], q[1] - prev[1]));
        prev = q;
    }
    s.len = table[n];
    return s;
}

/** Parameter at arc length d along the segment. */
function tAt(s: Seg, d: number): number {
    const n = s.table.length - 1;
    if (d <= 0) return 0;
    if (d >= s.len) return 1;
    let i = 1;
    while (s.table[i] < d) i++;
    const a = s.table[i - 1], b = s.table[i];
    return (i - 1 + (b > a ? (d - a) / (b - a) : 0)) / n;
}

/** The part of a segment between parameters t0 < t1, as control points. */
function slice(s: Seg, t0: number, t1: number): number[] {
    const p = s.p;
    if (s.kind === "line") return [...at(s, t0), ...at(s, t1)];
    // de Casteljau split at t1, then the left part at t0 / t1.
    const split = (pts: number[], t: number): [number[], number[]] => {
        const k = pts.length / 2;
        const rows: number[][] = [pts];
        for (let r = 1; r < k; r++) {
            const prev = rows[r - 1], row: number[] = [];
            for (let j = 0; j < prev.length - 2; j += 2) row.push(prev[j] + (prev[j + 2] - prev[j]) * t, prev[j + 1] + (prev[j + 3] - prev[j + 1]) * t);
            rows.push(row);
        }
        const left: number[] = [], right: number[] = [];
        for (let r = 0; r < k; r++) left.push(rows[r][0], rows[r][1]);
        for (let r = k - 1; r >= 0; r--) right.push(rows[r][rows[r].length - 2], rows[r][rows[r].length - 1]);
        return [left, right];
    };
    const [left] = t1 < 1 ? split(p, t1) : [p];
    if (t0 <= 0) return left;
    return split(left, t0 / t1)[1];
}

function contours(path: PathData): { segs: Seg[]; closed: boolean }[] {
    const out: { segs: Seg[]; closed: boolean }[] = [];
    let cur: { segs: Seg[]; closed: boolean } | null = null;
    let x = 0, y = 0, sx = 0, sy = 0, k = 0;
    const pts = path.points;
    for (const v of path.verbs) {
        if (v === VERB.move) {
            x = sx = pts[k++]; y = sy = pts[k++];
            cur = { segs: [], closed: false };
            out.push(cur);
        } else if (v === VERB.line) {
            const nx = pts[k++], ny = pts[k++];
            cur!.segs.push(measure("line", [x, y, nx, ny])); x = nx; y = ny;
        } else if (v === VERB.quad) {
            const p = [x, y, pts[k], pts[k + 1], pts[k + 2], pts[k + 3]]; k += 4;
            cur!.segs.push(measure("quad", p)); x = p[4]; y = p[5];
        } else if (v === VERB.cubic) {
            const p = [x, y, pts[k], pts[k + 1], pts[k + 2], pts[k + 3], pts[k + 4], pts[k + 5]]; k += 6;
            cur!.segs.push(measure("cubic", p)); x = p[6]; y = p[7];
        } else if (v === VERB.close) {
            if (cur) {
                if (x !== sx || y !== sy) cur.segs.push(measure("line", [x, y, sx, sy]));
                cur.closed = true;
            }
            x = sx; y = sy;
        }
    }
    return out.filter((c) => c.segs.length > 0);
}

/** The path's signed area over its control polygons (> 0: clockwise, y down). */
export function signedArea(path: PathData): number {
    let area = 0, k = 0, sx = 0, sy = 0, px = 0, py = 0;
    const pts = path.points;
    const to = (x: number, y: number) => {
        area += px * y - x * py;
        px = x; py = y;
    };
    for (const v of path.verbs) {
        if (v === VERB.move) {
            to(sx, sy);
            sx = px = pts[k++]; sy = py = pts[k++];
        } else if (v !== VERB.close) {
            const n = v === VERB.line ? 1 : v === VERB.quad ? 2 : 3;
            for (let i = 0; i < n; i++, k += 2) to(pts[k], pts[k + 1]);
        }
    }
    to(sx, sy);
    return area / 2;
}

/** The path traced backwards, contour by contour. */
export function reversePath(path: PathData): PathData {
    const b = new PathBuilder();
    const pts = path.points;
    let k = 0, i = 0;
    const verbs = path.verbs;
    while (i < verbs.length) {
        if (verbs[i] !== VERB.move) { i++; continue; }
        // One contour: its segments as [verb, points from its start].
        let x = pts[k++], y = pts[k++];
        const segs: { v: number; p: number[] }[] = [];
        let closed = false;
        for (i++; i < verbs.length && verbs[i] !== VERB.move; i++) {
            const v = verbs[i];
            if (v === VERB.close) { closed = true; continue; }
            const n = v === VERB.line ? 1 : v === VERB.quad ? 2 : 3;
            const p = [x, y];
            for (let j = 0; j < n; j++, k += 2) p.push(pts[k], pts[k + 1]);
            x = p[p.length - 2]; y = p[p.length - 1];
            segs.push({ v, p });
        }
        b.moveTo(x, y);
        for (let s = segs.length - 1; s >= 0; s--) {
            const { v, p } = segs[s];
            if (v === VERB.line) b.lineTo(p[0], p[1]);
            else if (v === VERB.quad) b.quadTo(p[2], p[3], p[0], p[1]);
            else b.cubicTo(p[4], p[5], p[2], p[3], p[0], p[1]);
        }
        if (closed) b.close();
    }
    return b.build();
}

/** Every contour closed (the shape has an interior to align a stroke against). */
export function isClosed(path: PathData): boolean {
    const cs = contours(path);
    return cs.length > 0 && cs.every((c) => c.closed);
}

/** getSegment(a, z, startWithMoveTo = true) of one contour, appended to `b`; false when nothing was. */
function segment(segs: Seg[], a: number, z: number, b: PathBuilder): boolean {
    let pos = 0, moved = false;
    for (const s of segs) {
        const s0 = pos, s1 = pos + s.len;
        pos = s1;
        if (s1 <= a || s0 >= z) continue;
        const t0 = tAt(s, a - s0), t1 = tAt(s, z - s0);
        const q = slice(s, t0, t1);
        if (!moved) { b.moveTo(q[0], q[1]); moved = true; }
        if (s.kind === "line") b.lineTo(q[2], q[3]);
        else if (s.kind === "quad") b.quadTo(q[2], q[3], q[4], q[5]);
        else b.cubicTo(q[2], q[3], q[4], q[5], q[6], q[7]);
    }
    return moved;
}

export function trimPath(path: PathData, start: number, end: number): PathData {
    const cs = contours(path);
    const total = cs.reduce((n, c) => n + c.segs.reduce((m, s) => m + s.len, 0), 0);
    if (total <= 0) return path;
    const d0 = start * total, d1 = end * total;
    const b = new PathBuilder();
    let acc = 0;
    let any = false;
    for (const c of cs) {
        const len = c.segs.reduce((m, s) => m + s.len, 0);
        const cs0 = acc, ce = acc + len;
        acc = ce;
        if (!(ce > d0 && cs0 < d1)) continue;
        any = segment(c.segs, Math.max(0, d0 - cs0), Math.min(len, d1 - cs0), b) || any;
    }
    return any ? b.build() : { verbs: new Uint8Array(0), points: new Float32Array(0) };
}

/** Position and unit tangent: x, y, tx, ty. */
export type PosTan = [number, number, number, number];

/** One contour, measured. */
export interface Contour {
    length: number;
    closed: boolean;
    posTan(d: number): PosTan;
    /** The stretch between two arc lengths, appended to `b` as an open contour. */
    segment(from: number, to: number, b: PathBuilder): boolean;
}

function derivative(s: Seg, t: number): [number, number] {
    const p = s.p, u = 1 - t;
    if (s.kind === "line") return [p[2] - p[0], p[3] - p[1]];
    if (s.kind === "quad") return [2 * (u * (p[2] - p[0]) + t * (p[4] - p[2])), 2 * (u * (p[3] - p[1]) + t * (p[5] - p[3]))];
    return [
        3 * (u * u * (p[2] - p[0]) + 2 * u * t * (p[4] - p[2]) + t * t * (p[6] - p[4])),
        3 * (u * u * (p[3] - p[1]) + 2 * u * t * (p[5] - p[3]) + t * t * (p[7] - p[5])),
    ];
}

/** The path's contours of non-zero length (ContourMeasureIter, forceClosed = false). */
export function measureContours(path: PathData): Contour[] {
    return contours(path).map((c): Contour => {
        const segs = c.segs.filter((s) => s.len > 0);
        const length = segs.reduce((m, s) => m + s.len, 0);
        return {
            length,
            closed: c.closed,
            posTan(d: number): PosTan {
                d = Math.max(0, Math.min(length, d));
                let pos = 0, s = segs[segs.length - 1];
                for (const seg of segs) {
                    if (pos + seg.len >= d) { s = seg; break; }
                    pos += seg.len;
                }
                const t = tAt(s, d - pos);
                const [x, y] = at(s, t);
                let [tx, ty] = derivative(s, t);
                // A control point on the end leaves no derivative there: step inward.
                if (Math.hypot(tx, ty) < 1e-9) {
                    const a = at(s, Math.max(0, t - 1e-3)), b = at(s, Math.min(1, t + 1e-3));
                    tx = b[0] - a[0]; ty = b[1] - a[1];
                }
                const n = Math.hypot(tx, ty) || 1;
                return [x, y, tx / n, ty / n];
            },
            segment: (from, to, b) => segment(segs, from, to, b),
        };
    }).filter((c) => c.length > 0);
}

/** The shortest dash worth cutting from its contour; anything shorter is a dot. */
const DOT_LENGTH = 1e-3;

/** One stretch of the dash pattern for the whole path (core's dashScale). */
export function dashFit(cs: Contour[], dash: number[]): { scale: number; total: number; open: boolean } | null {
    let total = 0, open = false;
    for (const c of cs) {
        total += c.length;
        if (!c.closed) open = true;
    }
    const scale = pathOps.dashScale(dash, { length: total, closed: true }, total);
    return scale === null ? null : { scale, total, open };
}

/** The dash pattern's stretch for one contour: closed ones share the path's, open ones fit their own. */
export function contourDashScale(c: Contour, dash: number[], fit: { scale: number; total: number }): number {
    return c.closed ? fit.scale : pathOps.dashScale(dash, { length: c.length, closed: false }, fit.total) ?? fit.scale;
}

/** The dash pattern's "on" runs along a contour, [from, to] pairs (StrokeHandler.buildDashedPath). */
export function dashRuns(c: Contour, dash: number[], offset: number, scale: number): [number, number][] {
    const scaled = dash.map((d) => d * scale);
    const cycle = scaled.reduce((a, b) => a + b, 0);
    const runs: [number, number][] = [];
    if (!(cycle > 0)) return runs;
    const startOffset = (((offset * scale) % cycle) + cycle) % cycle;
    let i = 0, segStart = 0;
    while (segStart + scaled[i] <= startOffset && i < scaled.length) {
        if (scaled[i] <= DOT_LENGTH && Math.abs(startOffset - segStart) < 1e-6) break;
        segStart += scaled[i];
        i = (i + 1) % scaled.length;
        if (i === 0) break;
    }
    let remaining = scaled[i] - (startOffset - segStart);
    let drawing = i % 2 === 0;
    let t = 0;
    while (t < c.length - 1e-6) {
        const len = Math.min(remaining, c.length - t);
        if (drawing) runs.push([t, t + len]);
        t += len;
        remaining -= len;
        if (remaining <= 1e-6) {
            i = (i + 1) % scaled.length;
            remaining = scaled[i];
            drawing = !drawing;
        }
    }
    // An open contour fit to end on a dot has it exactly at its end.
    if (drawing && remaining <= 1e-6 && !c.closed) runs.push([c.length, c.length]);
    return runs;
}

/** The dashes as open contours; a dash too short to cut is a dot when `dots` (the dash cap has a shape). */
export function dashedPath(cs: Contour[], dash: number[], offset: number, dots: boolean, fit: { scale: number; total: number }): PathData | null {
    const b = new PathBuilder();
    let any = false;
    for (const c of cs) {
        for (const [from, to] of dashRuns(c, dash, offset, contourDashScale(c, dash, fit))) {
            if (to - from > DOT_LENGTH) any = c.segment(from, to, b) || any;
            else if (dots) {
                const [x, y, tx, ty] = c.posTan(from);
                const along = from > c.length - DOT_LENGTH ? -DOT_LENGTH : DOT_LENGTH;
                b.moveTo(x, y).lineTo(x + tx * along, y + ty * along);
                any = true;
            }
        }
    }
    return any ? b.build() : null;
}
