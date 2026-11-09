/**
 * Arc length, and everything measured in it: total length, the sampler, dashing
 * and trimming.
 *
 * Separate from the normal form because it is the expensive half of path
 * geometry and most callers never need it — bounding a path solves extrema in
 * closed form, and `Path.measure` / `Text.measure` run on every layout pass. So
 * flattening happens here, on demand.
 *
 * **One resolution.** There used to be three — 20 steps for
 * `length`, 32 for the trim segments, 50 for the sampler and the
 * dash walker — and `dash` combined two of them, scaling its dash
 * cycle against a length measured at 20 while walking the path at 50. Sharing
 * one number makes `length(d) === sampler(d).length` an invariant rather than a
 * coincidence.
 */
import { Vector2 } from "@/attributes/layout/vector2";
import { PathCommand, PathData } from "@/render/descriptors/path";
import { distance } from "./bezier";
import { contourSegments, contours, segmentPointAt, segmentSplit } from "./walk";
import type {
    ContourMetric, PathContour, PathFrame, PathMetric, PathSampler, PathSegment, SegmentMetric,
} from "./types";

/** Line segments each curve is flattened into. */
export const SAMPLE_STEPS = 50;

function flatten(segment: PathSegment): Vector2[] {
    // A line is already a polyline. Skipping the loop matters: a polygon path is
    // all lines, and 50 collinear samples per edge is pure waste.
    if (segment.kind === "line") return [segment.from, segment.to];
    const points: Vector2[] = [segment.from];
    for (let i = 1; i < SAMPLE_STEPS; i++) points.push(segmentPointAt(segment, i / SAMPLE_STEPS));
    points.push(segment.to);
    return points;
}

export function measureSegment(segment: PathSegment): SegmentMetric {
    const points = flatten(segment);
    const cumulative: number[] = [0];
    let total = 0;
    for (let i = 1; i < points.length; i++) {
        total += distance(points[i - 1], points[i]);
        cumulative.push(total);
    }
    return { segment, points, cumulative, length: total };
}

export function measureContours(contours: PathContour[]): PathMetric {
    let total = 0;
    const measured = contours.map((contour) => {
        const metrics = contourSegments(contour).map(measureSegment);
        const length = metrics.reduce((sum, m) => sum + m.length, 0);
        total += length;
        return { contour, metrics, length };
    });
    return { contours: measured, length: total };
}

/**
 * The parameter `t` at arc-length distance `d` into a segment.
 *
 * Read off the flattened table rather than binary-searched: the table is already
 * built, and a search that re-samples the curve on every probe cost 320 point
 * evaluations per query to answer the same question less consistently — its
 * answer disagreed with the sampler's, which read the same curve off a polyline.
 */
export function paramAtDist(metric: SegmentMetric, d: number): number {
    const { cumulative, length } = metric;
    if (length <= 0) return 0;
    if (d <= 0) return 0;
    if (d >= length) return 1;

    let lo = 0;
    let hi = cumulative.length - 1;
    while (lo < hi - 1) {
        const mid = (lo + hi) >> 1;
        if (cumulative[mid] <= d) lo = mid;
        else hi = mid;
    }
    const span = cumulative[hi] - cumulative[lo];
    const within = span > 0 ? (d - cumulative[lo]) / span : 0;
    const steps = cumulative.length - 1;
    return (lo + within) / steps;
}

export function length(d: PathData | null | undefined): number {
    return measureContours(contours(d)).length;
}

/**
 * Build a {@link PathSampler} from any {@link PathData}.
 *
 * The tangent is the chord of the flattened segment the distance lands in, not
 * the curve's analytic derivative. Less exact, and deliberately kept: every
 * glyph on every text-on-path is placed with it, so changing it is a visual
 * change that deserves its own commit rather than a side effect of this one.
 */
export function sampler(d: PathData): PathSampler {
    const metric = measureContours(contours(d));

    // One point list across every contour. The jump from one contour's end to the
    // next one's start carries no length — text does not flow across it, matching
    // SVG `textPath` — so it is recorded as a zero-length step rather than a gap
    // in the table.
    const points: Vector2[] = [];
    const cumulative: number[] = [];
    let total = 0;
    for (const contourMetric of metric.contours) {
        const first = contourMetric.metrics[0]?.segment.from ?? contourMetric.contour.start;
        points.push(first);
        cumulative.push(total);
        for (const segmentMetric of contourMetric.metrics) {
            for (let i = 1; i < segmentMetric.points.length; i++) {
                total += distance(segmentMetric.points[i - 1], segmentMetric.points[i]);
                points.push(segmentMetric.points[i]);
                cumulative.push(total);
            }
        }
    }

    let cursor = 0; // last segment index used, for the monotonic fast path.

    const frameAt = (d: number): PathFrame | null => {
        if (total <= 0 || points.length < 2) return null;
        const target = Math.max(0, Math.min(total, d));

        // Reset the cursor if the caller stepped backwards.
        if (cumulative[cursor] > target) cursor = 0;
        // Advance to the step containing `target`, skipping the zero-length steps
        // that bridge contours so we land on real geometry.
        while (
            cursor < points.length - 2 &&
            (cumulative[cursor + 1] < target || cumulative[cursor + 1] === cumulative[cursor])
        ) {
            cursor++;
        }

        const a = points[cursor];
        const b = points[cursor + 1];
        const segStart = cumulative[cursor];
        const segLen = cumulative[cursor + 1] - segStart;
        const t = segLen > 0 ? (target - segStart) / segLen : 0;

        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const segDist = Math.hypot(dx, dy);
        // Degenerate step: fall back to the point with no meaningful tangent.
        const tx = segDist > 0 ? dx / segDist : 1;
        const ty = segDist > 0 ? dy / segDist : 0;

        return { x: a.x + dx * t, y: a.y + dy * t, tx, ty };
    };

    return { length: total, frameAt };
}

/** A contour's flattened polyline. */
function contourPoints(metric: ContourMetric): Vector2[] {
    const first = metric.metrics[0]?.segment.from ?? metric.contour.start;
    const points: Vector2[] = [first];
    for (const segment of metric.metrics) {
        for (let i = 1; i < segment.points.length; i++) points.push(segment.points[i]);
    }
    return points;
}

/**
 * Walks a flattened subpath at constant speed, emitting `M`/`L` commands for the
 * "on" runs of the dash pattern. `scaledDash` alternates on/off lengths starting
 * with "on"; the index wraps so the pattern repeats along the whole subpath, and
 * `offset` is how far into it the subpath starts. A zero-length dash is a dot:
 * a run a sliver long along the path, so the cap drawn on it has a direction —
 * including the dots an open subpath is fit to start and end on.
 */
function dashSubpath(points: Vector2[], scaledDash: number[], offset: number, closed: boolean): string {
    if (points.length < 2) return '';

    const cycle = scaledDash.reduce((a, b) => a + b, 0);
    const sliver = cycle * 1e-4;
    const tolerance = cycle * 1e-9;
    const into = ((offset % cycle) + cycle) % cycle;
    let dashIndex = 0;
    let passed = 0;
    while (passed + scaledDash[dashIndex] <= into) {
        if (scaledDash[dashIndex] === 0 && into - passed <= tolerance) break;
        passed += scaledDash[dashIndex];
        dashIndex = (dashIndex + 1) % scaledDash.length;
        if (dashIndex === 0) break;
    }

    const parts: string[] = [];
    let remaining = scaledDash[dashIndex] - (into - passed); // Distance left in the current dash segment.
    let isOn = dashIndex % 2 === 0;                          // Whether we're currently drawing (on) or skipping (off).
    let needMove = true;                                     // Whether the next "on" run still needs an opening M.
    let last: { point: Vector2; x: number; y: number } | null = null;

    for (let i = 1; i < points.length; i++) {
        const p0 = points[i - 1];
        const p1 = points[i];
        const dx = p1.x - p0.x;
        const dy = p1.y - p0.y;
        const segLen = distance(p0, p1);

        if (segLen === 0) continue;
        last = { point: p1, x: dx / segLen, y: dy / segLen };

        let walked = 0;

        while (walked < segLen) {
            const available = segLen - walked;

            if (remaining >= available) {
                if (isOn) {
                    if (needMove) {
                        const t = walked / segLen;
                        parts.push(`M ${p0.x + t * dx} ${p0.y + t * dy}`);
                        needMove = false;
                    }
                    parts.push(`L ${p1.x} ${p1.y}`);
                }
                remaining -= available;
                walked = segLen;

                if (remaining <= tolerance) {
                    dashIndex = (dashIndex + 1) % scaledDash.length;
                    isOn = !isOn;
                    remaining = scaledDash[dashIndex];
                    if (isOn) needMove = true;
                }
            } else {
                const endT = (walked + remaining) / segLen;
                const endX = p0.x + endT * dx;
                const endY = p0.y + endT * dy;

                if (isOn) {
                    if (needMove) {
                        const startT = walked / segLen;
                        parts.push(`M ${p0.x + startT * dx} ${p0.y + startT * dy}`);
                        needMove = false;
                    }
                    const reach = remaining > 0 ? 0 : sliver / segLen;
                    parts.push(`L ${endX + reach * dx} ${endY + reach * dy}`);
                }

                walked += remaining;
                dashIndex = (dashIndex + 1) % scaledDash.length;
                isOn = !isOn;
                remaining = scaledDash[dashIndex];
                if (isOn) needMove = true;
            }
        }
    }

    if (!closed && isOn && remaining <= tolerance && last) {
        const { point, x, y } = last;
        parts.push(`M ${point.x} ${point.y} L ${point.x - x * sliver} ${point.y - y * sliver}`);
    }

    return parts.join(' ');
}

/**
 * How far `pattern` is stretched to fit one contour of a path `total` long —
 * the renderer's rule as well as {@link dash}'s. A closed contour is fit with
 * the rest of the path, to whole cycles of `total`; an open one is fit alone to
 * whole cycles less the final gap, so it starts and ends on a dash. An odd
 * pattern alternates across cycles, has no final gap to drop, and fits as
 * closed. `null` when there is nothing to fit.
 */
export function dashScale(
    pattern: number[],
    contour: { length: number; closed: boolean },
    total: number,
): number | null {
    const cycle = pattern.reduce((a, b) => a + b, 0);
    if (cycle <= 0 || total <= 0) return null;
    if (!contour.closed && contour.length > 0 && pattern.length % 2 === 0) {
        const lastGap = pattern[pattern.length - 1];
        const span = Math.max(1, Math.round((contour.length + lastGap) / cycle)) * cycle - lastGap;
        if (span > 0) return contour.length / span;
    }
    return total / (Math.max(1, Math.round(total / cycle)) * cycle);
}

/**
 * Converts path geometry into a dashed SVG path string, each contour fit by
 * {@link dashScale} and starting `offset` into the pattern, as the renderer
 * dashes a stroke.
 *
 * @param d    The path to dash.
 * @param dash Alternating on/off lengths (e.g. `[4, 2]` = 4 on, 2 off).
 * @returns An SVG path `d` string containing only the visible dash segments,
 *          or `''` when there is nothing to draw.
 */
export function dash(d: PathData | null | undefined, dash: number[], offset = 0): string {
    if (!dash || dash.length === 0) return '';

    const metric = measureContours(contours(d));
    const runs: string[] = [];
    for (const contour of metric.contours) {
        const scale = dashScale(dash, { length: contour.length, closed: contour.contour.closed }, metric.length);
        if (scale === null) return '';
        const run = dashSubpath(
            contourPoints(contour), dash.map(value => value * scale), offset * scale, contour.contour.closed,
        );
        if (run) runs.push(run);
    }
    return runs.join(' ');
}

/**
 * The portion of `d` between the normalized arc-length fractions `start` and
 * `end` (both 0..1), as a fresh command list.
 *
 * A full `0..1` range or an empty path is returned unchanged; an empty or
 * inverted range returns `[]`.
 */
export function trim(d: PathData, start: number, end: number): PathData {
    if (start === 0 && end === 1) return d;

    const s = Math.max(0, Math.min(1, start));
    const e = Math.max(s, Math.min(1, end));
    if (s === 0 && e === 1) return d;
    if (s >= e) return [];

    const metric = measureContours(contours(d));
    if (metric.length === 0) return d;

    const startDist = s * metric.length;
    const endDist = e * metric.length;

    const result: PathCommand[] = [];
    let accumulated = 0;

    for (const contour of metric.contours) {
        // Each contour opens its own `M`. Sharing one across all of them — which
        // is what a single flat segment list did — draws a line across the gap
        // between two contours that the source never had.
        let needsMove = true;

        for (const metricEntry of contour.metrics) {
            const { segment, length } = metricEntry;
            const segEnd = accumulated + length;
            if (length === 0 || segEnd <= startDist || accumulated >= endDist) {
                accumulated = segEnd;
                continue;
            }

            const t0 = accumulated < startDist ? paramAtDist(metricEntry, startDist - accumulated) : 0;
            const t1 = segEnd > endDist ? paramAtDist(metricEntry, endDist - accumulated) : 1;

            if (needsMove) {
                const p = segmentPointAt(segment, t0);
                result.push({ type: "M", x: p.x, y: p.y });
                needsMove = false;
            }
            result.push(...segmentSplit(segment, t0, t1));
            accumulated = segEnd;
        }
    }

    return result;
}
