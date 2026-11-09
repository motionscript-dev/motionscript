// Stroke cap planning and dash fitting on PathData: which path ends want a
// cap other than the stroker's, where each sits and which way it faces, and
// the dash pattern stretched to fit the path (dashes cut here as open
// contours when the band needs its ends fixed up).

import { isStrokeMarker, type StrokeEnd, type StrokeMarker, type StrokeResolved } from "@motionscript/core";
import { markerIsPointed, markerPolygon } from "./geometry/markers";
import { type PathData, PathBuilder } from "../doc";
import { type Contour, dashedPath, dashFit, contourDashScale, dashRuns, measureContours, type PosTan } from "./path-measure";

export { markerInset } from "./geometry/markers";

type Cap = StrokeResolved["cap"];

/** One end of an open contour, with the unit direction pointing out past it. */
export interface PathEnd {
    x: number;
    y: number;
    dx: number;
    dy: number;
    cap: StrokeEnd;
    /** A marker's length, already fitted to its contour. */
    size: number;
    weight: number;
    /** Whether the band reaches the end (a dash gap can leave it bare). */
    reached: boolean;
}

export interface StrokePlan {
    /** The cap the stroker draws: the dash cap, or for an undashed stroke the end cap. */
    cap: Cap;
    /** The ends that want another, fixed up after. */
    ends: PathEnd[];
    /** What to stroke instead of the shape's own contour (its cut dashes). */
    source?: PathData;
    /** The fitted pattern the renderer dashes with (unset when `source` carries the dashes). */
    dash?: number[];
    dashPhase?: number;
}

/** The plan for stroking `path` `width` wide; null when its dashes leave nothing. */
export function strokePlan(st: StrokeResolved, path: PathData, width: number, thin: boolean): StrokePlan | null {
    const dashed = !!st.dash?.length;
    const start = st.startCap ?? st.cap, end = st.endCap ?? st.cap;
    const cap: Cap = dashed ? st.cap : isStrokeMarker(end) ? "butt" : (end as Cap);
    const differs = start !== cap || end !== cap;
    if (!dashed && !differs) return { cap, ends: [] };
    const cs = measureContours(path);
    const fit = dashed ? dashFit(cs, st.dash!) : null;
    // A degenerate pattern draws the plain stroke (makeUniformDashEffect returns null).
    if (dashed && !fit) return { cap, ends: differs ? capEnds(cs, st, start, end, cap, width, null) : [] };
    if (!fit) return { cap, ends: capEnds(cs, st, start, end, cap, width, null) };
    const runs = (c: Contour) => dashRuns(c, st.dash!, st.dashOffset ?? 0, contourDashScale(c, st.dash!, fit));
    const ends = differs ? capEnds(cs, st, start, end, cap, width, runs) : [];
    // An end capped unlike the rest needs the band, and so do dashes along an
    // open contour (fit per contour) and thin ones; otherwise the renderer
    // dashes with the fitted pattern.
    if (thin || ends.length || fit.open) {
        const source = dashedPath(cs, st.dash!, st.dashOffset ?? 0, st.cap !== "butt", fit);
        return source ? { cap, ends, source } : null;
    }
    return { cap, ends, dash: st.dash!.map((d) => d * fit.scale), dashPhase: (st.dashOffset ?? 0) * fit.scale };
}

function capEnds(cs: Contour[], st: StrokeResolved, start: StrokeEnd, end: StrokeEnd, cap: Cap, width: number, runs: ((c: Contour) => [number, number][]) | null): PathEnd[] {
    const ends: PathEnd[] = [];
    const marked = (isStrokeMarker(start) ? 1 : 0) + (isStrokeMarker(end) ? 1 : 0);
    const half = width / 2;
    // band.contains(end − dir·inset): a dash covers the end, or its cap does.
    const inset = Math.min(half, 1) / 2;
    const ext = st.cap !== "butt" ? half : 0;
    for (const c of cs) {
        if (c.closed) continue;
        // Two heads share a contour too short for both.
        const size = Math.min(st.capScale * width, c.length / Math.max(1, marked));
        const on = runs?.(c);
        const reached = (d: number) => !on || on.some(([a, b]) => d >= a - ext - 1e-6 && d <= b + ext + 1e-6);
        if (start !== cap) pushEnd(ends, c.posTan(0), c.posTan(size), -1, start, size, width, reached(inset));
        if (end !== cap) pushEnd(ends, c.posTan(c.length), c.posTan(c.length - size), 1, end, size, width, reached(c.length - inset));
    }
    return ends;
}

// `inner` is the point a marker's length back along the contour: a pointed
// head is turned by the chord to it, so its base sits on a curved path.
function pushEnd(ends: PathEnd[], [x, y, tx, ty]: PosTan, inner: PosTan, outward: 1 | -1, cap: StrokeEnd, size: number, weight: number, reached: boolean) {
    let dx = outward * tx, dy = outward * ty;
    if (isStrokeMarker(cap) && markerIsPointed(cap) && Math.hypot(x - inner[0], y - inner[1]) > 1e-6) {
        dx = x - inner[0];
        dy = y - inner[1];
    }
    const length = Math.hypot(dx, dy);
    if (length < 1e-9) return;
    ends.push({ x, y, dx: dx / length, dy: dy / length, cap, size, weight, reached });
}

// Every end shape winds the same way, so several merged into one path union
// under the non-zero rule instead of cancelling where they overlap.

/** The rectangle past `end`: `depth` along its outward direction, `half` to either side. */
export function endBox({ x, y, dx, dy }: PathEnd, depth: number, half: number): PathData {
    const nx = -dy * half, ny = dx * half, ex = dx * depth, ey = dy * depth;
    return new PathBuilder().moveTo(x - nx, y - ny).lineTo(x - nx + ex, y - ny + ey).lineTo(x + nx + ex, y + ny + ey).lineTo(x + nx, y + ny).close().build();
}

/** The half disc past `end`, from one side of the band through the outward direction to the other. */
export function endDisc({ x, y, dx, dy }: PathEnd, r: number): PathData {
    const b = new PathBuilder();
    const n = 32;
    for (let i = 0; i <= n; i++) {
        const a = -Math.PI / 2 + (Math.PI * i) / n, c = Math.cos(a) * r, s = Math.sin(a) * r;
        const px = x + c * dx - s * dy, py = y + c * dy + s * dx;
        if (i === 0) b.moveTo(px, py);
        else b.lineTo(px, py);
    }
    return b.close().build();
}

/** A marker's outline on its end (addMarker): its polygon in the end's frame, or a disc `size` across. */
export function markerPath(e: PathEnd, marker: StrokeMarker): PathData {
    const { x, y, dx, dy, size, weight } = e;
    const polygon = markerPolygon(marker, size, weight);
    const b = new PathBuilder();
    if (!polygon) {
        const r = size / 2, k = 0.5522848 * r;
        b.moveTo(x + r, y).cubicTo(x + r, y + k, x + k, y + r, x, y + r).cubicTo(x - k, y + r, x - r, y + k, x - r, y)
            .cubicTo(x - r, y - k, x - k, y - r, x, y - r).cubicTo(x + k, y - r, x + r, y - k, x + r, y);
        return b.close().build();
    }
    for (let i = 0; i < polygon.length; i += 2) {
        const px = x + polygon[i] * dx - polygon[i + 1] * dy, py = y + polygon[i] * dy + polygon[i + 1] * dx;
        if (i === 0) b.moveTo(px, py);
        else b.lineTo(px, py);
    }
    return b.close().build();
}
