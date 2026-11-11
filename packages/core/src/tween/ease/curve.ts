import type { EasingFunction } from "./type";
import { describeEase } from "./describe";

/** A hand-drawn timing function: cubic Bézier segments from (0, 0) to (1, 1), x being progress and y how far along the animation is. It is what an `EaseSpec` of `kind: "custom"` carries inline, so a drawn curve travels with the document. Two things keep it a function of x, both enforced: a control point is clamped into its own segment's x span, and an absent handle resolves to the Catmull-Rom tangent. y is deliberately unclamped: overshooting and settling back is a real move. */

/** A point in curve space, or a handle offset within it. */
export interface CurveVector {
    x: number;
    y: number;
}

/** One control point of a custom easing curve. */
export interface CurvePoint {
    x: number;
    y: number;
    /** The handle steering the segment leaving this point. Absent = auto. */
    out?: CurveVector;
    /** The handle steering the segment arriving at it. Absent = auto. */
    in?: CurveVector;
}

/** One cubic Bézier segment of the curve, in absolute curve space. */
export interface EaseCurveSegment {
    p0: CurveVector;
    c1: CurveVector;
    c2: CurveVector;
    p3: CurveVector;
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** The curve as Bézier segments, every auto handle and every clamp resolved. */
export function curveSegments(points: readonly CurvePoint[]): EaseCurveSegment[] {
    const segments: EaseCurveSegment[] = [];
    for (let i = 0; i < points.length - 1; i++) {
        const p0 = points[i];
        const p3 = points[i + 1];
        const before = points[i - 1] ?? p0;
        const after = points[i + 2] ?? p3;

        const c1 = p0.out
            ? { x: p0.x + p0.out.x, y: p0.y + p0.out.y }
            : { x: p0.x + (p3.x - before.x) / 6, y: p0.y + (p3.y - before.y) / 6 };
        const c2 = p3.in
            ? { x: p3.x + p3.in.x, y: p3.y + p3.in.y }
            : { x: p3.x - (after.x - p0.x) / 6, y: p3.y - (after.y - p0.y) / 6 };

        segments.push({
            p0: { x: p0.x, y: p0.y },
            c1: { x: clamp(c1.x, p0.x, p3.x), y: c1.y },
            c2: { x: clamp(c2.x, p0.x, p3.x), y: c2.y },
            p3: { x: p3.x, y: p3.y },
        });
    }
    return segments;
}

/** A cubic Bézier evaluated on one axis. */
function bezier(a: number, b: number, c: number, d: number, t: number): number {
    const mt = 1 - t;
    return mt * mt * mt * a + 3 * mt * mt * t * b + 3 * mt * t * t * c + t * t * t * d;
}

/** The curve parameter at which a segment reaches `x`: bisection rather than Newton, since x is monotonic along the segment while Newton's derivative goes to zero at the flat ends of an ease-in-out. */
export function curveSegmentT(segment: EaseCurveSegment, x: number): number {
    let low = 0;
    let high = 1;
    for (let i = 0; i < 30; i++) {
        const mid = (low + high) / 2;
        const at = bezier(segment.p0.x, segment.c1.x, segment.c2.x, segment.p3.x, mid);
        if (at < x) low = mid;
        else high = mid;
    }
    return (low + high) / 2;
}

/** Whether `value` is a drawable curve: two or more finite points. */
export function isEaseCurve(value: unknown): value is CurvePoint[] {
    return Array.isArray(value) && value.length >= 2 && value.every(isFinitePoint);
}

function isFinitePoint(value: unknown): value is CurveVector {
    if (typeof value !== "object" || value === null) return false;
    const { x, y } = value as Partial<CurveVector>;
    return typeof x === "number" && Number.isFinite(x) && typeof y === "number" && Number.isFinite(y);
}

/** The easing a curve runs as: progress in, eased progress out. */
export function curveEase(points: readonly CurvePoint[]): EasingFunction {
    const segments = curveSegments(points);
    if (segments.length === 0) return describeEase((x) => x, 'lin');

    return describeEase((x) => {
        if (x <= 0) return segments[0].p0.y;
        const last = segments[segments.length - 1];
        if (x >= 1) return last.p3.y;

        let segment = last;
        for (const candidate of segments) {
            if (x <= candidate.p3.x) {
                segment = candidate;
                break;
            }
        }
        const t = curveSegmentT(segment, x);
        return bezier(segment.p0.y, segment.c1.y, segment.c2.y, segment.p3.y, t);
    }, `curve:${JSON.stringify(points)}`);
}
