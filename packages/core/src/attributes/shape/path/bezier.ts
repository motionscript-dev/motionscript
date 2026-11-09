import { Vector2, lerpVector2 } from "@/attributes/layout/vector2";
import { PathCommand } from "@/render/descriptors/path";
import type { ArcParams, Cubic } from "./types";

/**
 * Shared Bézier, arc and path-geometry primitives.
 *
 * Everything under `shape/path/` that evaluates, splits, measures or bounds a
 * curve reaches for these rather than carrying its own copy. That used to be an
 * aspiration this file's header stated and only three of seven callers honoured:
 * De Casteljau existed three times, quad→cubic and cubic evaluation twice each,
 * and the arc's endpoint→center conversion twice — once returning a sampler and
 * once returning cubics, differing in nothing else.
 *
 * Two evaluation styles are provided:
 *  - Scalar (`cubicAxis` / `quadAxis`) — evaluate a single axis. Cheaper when you
 *    already have loose x/y numbers and want to avoid allocating a {@link Vector2}.
 *  - Vector (`cubicPoint` / `quadPoint`) — evaluate both axes into a {@link Vector2}.
 */

/** SVG curve commands whose tangent feeds the reflected control point of a following S/s/T/t. */
const SMOOTH_CURVE_TYPES: ReadonlySet<PathCommand["type"]> = new Set([
    "C", "c", "S", "s", "Q", "q", "T", "t",
]);



/**
 * True when a command's trailing control point should be remembered so the next
 * smooth command (S/s/T/t) can reflect it. Per the SVG spec, if the previous
 * command was not one of these, the implied control point is the current point.
 */
export function isSmoothCurveType(type: PathCommand["type"]): boolean {
    return SMOOTH_CURVE_TYPES.has(type);
}

/** Reflect a control point through the current point: `2 * current - control`. */
export function reflectControlPoint(current: number, control: number): number {
    return 2 * current - control;
}

/** Euclidean distance between two points. */
export function distance(a: Vector2, b: Vector2): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    return Math.sqrt(dx * dx + dy * dy);
}

/** Evaluate one axis of a cubic Bézier at parameter `t` (0..1). */
export function cubicAxis(t: number, p0: number, p1: number, p2: number, p3: number): number {
    const u = 1 - t;
    return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

/** Evaluate one axis of a quadratic Bézier at parameter `t` (0..1). */
export function quadAxis(t: number, p0: number, p1: number, p2: number): number {
    const u = 1 - t;
    return u * u * p0 + 2 * u * t * p1 + t * t * p2;
}

/** Evaluate a cubic Bézier at parameter `t` (0..1) into a {@link Vector2}. */
export function cubicPoint(p0: Vector2, p1: Vector2, p2: Vector2, p3: Vector2, t: number): Vector2 {
    return {
        x: cubicAxis(t, p0.x, p1.x, p2.x, p3.x),
        y: cubicAxis(t, p0.y, p1.y, p2.y, p3.y),
    };
}

/** Evaluate a quadratic Bézier at parameter `t` (0..1) into a {@link Vector2}. */
export function quadPoint(p0: Vector2, p1: Vector2, p2: Vector2, t: number): Vector2 {
    return {
        x: quadAxis(t, p0.x, p1.x, p2.x),
        y: quadAxis(t, p0.y, p1.y, p2.y),
    };
}

/**
 * Approximate the arc length of a parametric curve by sampling it into a polyline
 * and summing the segment distances. More `steps` trade speed for accuracy.
 */
export function sampleCurveLength(pointAt: (t: number) => Vector2, steps = 32): number {
    let length = 0;
    let prev = pointAt(0);
    for (let i = 1; i <= steps; i++) {
        const next = pointAt(i / steps);
        length += distance(prev, next);
        prev = next;
    }
    return length;
}

/**
 * Binary-search the curve parameter `t` whose arc length from the start equals
 * `targetDist`. Used to find exactly where a curve should be cut. The curve is
 * re-sampled on each probe, so this is intentionally simple rather than fast;
 * 20 iterations give sub-pixel precision for typical path lengths.
 */
export function paramAtDistance(
    pointAt: (t: number) => Vector2,
    targetDist: number,
    totalLen: number,
): number {
    if (totalLen === 0 || targetDist <= 0) return 0;
    if (targetDist >= totalLen) return 1;

    let lo = 0, hi = 1;
    for (let i = 0; i < 20; i++) {
        const mid = (lo + hi) / 2;
        let len = 0;
        let prev = pointAt(0);
        const steps = 16;
        for (let j = 1; j <= steps; j++) {
            const p = pointAt(mid * j / steps);
            len += distance(prev, p);
            prev = p;
        }
        if (len < targetDist) lo = mid;
        else hi = mid;
    }
    return (lo + hi) / 2;
}

// --- Degree conversion -----------------------------------------------------

/** A straight line as a cubic: controls sit on the line at 1/3 and 2/3. */
export function lineToCubic(from: Vector2, to: Vector2): Cubic {
    return {
        p0: from,
        c1: lerpVector2(from, to, 1 / 3),
        c2: lerpVector2(from, to, 2 / 3),
        p1: to,
    };
}

/** Elevate a quadratic Bézier to the equivalent cubic (exact, not an approximation). */
export function quadToCubic(from: Vector2, cp: Vector2, to: Vector2): Cubic {
    return {
        p0: from,
        c1: { x: from.x + (2 / 3) * (cp.x - from.x), y: from.y + (2 / 3) * (cp.y - from.y) },
        c2: { x: to.x + (2 / 3) * (cp.x - to.x), y: to.y + (2 / 3) * (cp.y - to.y) },
        p1: to,
    };
}

// --- De Casteljau splitting ---
// Splitting a Bézier at parameter `t` yields two sub-curves that together trace
// the exact same shape, so trimming preserves curvature instead of polylining it.

export function splitCubicAt(p0: Vector2, p1: Vector2, p2: Vector2, p3: Vector2, t: number) {
    const a = lerpVector2(p0, p1, t);
    const b = lerpVector2(p1, p2, t);
    const c = lerpVector2(p2, p3, t);
    const d = lerpVector2(a, b, t);
    const e = lerpVector2(b, c, t);
    const f = lerpVector2(d, e, t);
    return {
        left: { from: p0, cp1: a, cp2: d, to: f },
        right: { from: f, cp1: e, cp2: c, to: p3 },
    };
}

/** The sub-cubic spanning parameters `t0..t1` of the original cubic. */
export function extractCubicRange(p0: Vector2, p1: Vector2, p2: Vector2, p3: Vector2, t0: number, t1: number) {
    if (t0 === 0) return splitCubicAt(p0, p1, p2, p3, t1).left;
    const { right } = splitCubicAt(p0, p1, p2, p3, t0);
    const adj = (t1 - t0) / (1 - t0);
    return splitCubicAt(right.from, right.cp1, right.cp2, right.to, adj).left;
}

export function splitQuadAt(p0: Vector2, p1: Vector2, p2: Vector2, t: number) {
    const a = lerpVector2(p0, p1, t);
    const b = lerpVector2(p1, p2, t);
    const c = lerpVector2(a, b, t);
    return {
        left: { from: p0, cp: a, to: c },
        right: { from: c, cp: b, to: p2 },
    };
}

/** The sub-quadratic spanning parameters `t0..t1` of the original quadratic. */
export function extractQuadRange(p0: Vector2, p1: Vector2, p2: Vector2, t0: number, t1: number) {
    if (t0 === 0) return splitQuadAt(p0, p1, p2, t1).left;
    const { right } = splitQuadAt(p0, p1, p2, t0);
    const adj = (t1 - t0) / (1 - t0);
    return splitQuadAt(right.from, right.cp, right.to, adj).left;
}

// --- Extrema ---------------------------------------------------------------

/** The `t` values in (0, 1) where a cubic's one-dimensional derivative is zero. */
export function cubicExtrema(p0: number, p1: number, p2: number, p3: number): number[] {
    // B'(t) = 3[(p1−p0)(1−t)² + 2(p2−p1)t(1−t) + (p3−p2)t²], written as at² + bt + c.
    const a = -p0 + 3 * p1 - 3 * p2 + p3;
    const b = 2 * (p0 - 2 * p1 + p2);
    const c = p1 - p0;
    const roots: number[] = [];
    const push = (t: number) => {
        if (t > 0 && t < 1) roots.push(t);
    };
    if (Math.abs(a) < 1e-12) {
        if (Math.abs(b) > 1e-12) push(-c / b);
        return roots;
    }
    const disc = b * b - 4 * a * c;
    if (disc < 0) return roots;
    const root = Math.sqrt(disc);
    push((-b + root) / (2 * a));
    push((-b - root) / (2 * a));
    return roots;
}

/** The `t` value in (0, 1) where a quadratic's one-dimensional derivative is zero. */
export function quadExtrema(p0: number, p1: number, p2: number): number[] {
    // B'(t) = 2[(p1−p0)(1−t) + (p2−p1)t] = 0.
    const denominator = p0 - 2 * p1 + p2;
    if (Math.abs(denominator) < 1e-12) return [];
    const t = (p0 - p1) / denominator;
    return t > 0 && t < 1 ? [t] : [];
}

// --- Arc endpoint-to-center conversion -------------------------------------

function angleBetween(ux: number, uy: number, vx: number, vy: number): number {
    const dot = ux * vx + uy * vy;
    const len = Math.sqrt(ux * ux + uy * uy) * Math.sqrt(vx * vx + vy * vy);
    let angle = Math.acos(Math.max(-1, Math.min(1, dot / len)));
    if (ux * vy - uy * vx < 0) angle = -angle;
    return angle;
}


/**
 * The endpoint→center conversion of an SVG `A` command.
 *
 * Returned as the ellipse's own parameters rather than as a sampler, because the
 * two things that need an arc want different halves of it: flattening wants
 * points, and bounding wants the angles where each axis turns around. A sampler
 * alone forces the second to guess.
 */
export function arcParams(
    from: Vector2, to: Vector2,
    rxRaw: number, ryRaw: number, rotation: number, largeArc: 0 | 1, sweep: 0 | 1,
): ArcParams {
    const phi = rotation * Math.PI / 180;
    const cosPhi = Math.cos(phi), sinPhi = Math.sin(phi);

    const dx = (from.x - to.x) / 2;
    const dy = (from.y - to.y) / 2;
    const x1p = cosPhi * dx + sinPhi * dy;
    const y1p = -sinPhi * dx + cosPhi * dy;

    let rx = Math.abs(rxRaw), ry = Math.abs(ryRaw);
    const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
    if (lambda > 1) {
        const s = Math.sqrt(lambda);
        rx *= s;
        ry *= s;
    }

    const rx2 = rx * rx, ry2 = ry * ry;
    const x1p2 = x1p * x1p, y1p2 = y1p * y1p;
    const sq = Math.max(0, (rx2 * ry2 - rx2 * y1p2 - ry2 * x1p2) / (rx2 * y1p2 + ry2 * x1p2));
    const sign = (largeArc === sweep) ? -1 : 1;
    const cxp = sign * Math.sqrt(sq) * (rx * y1p / ry);
    const cyp = sign * Math.sqrt(sq) * -(ry * x1p / rx);

    const cx = cosPhi * cxp - sinPhi * cyp + (from.x + to.x) / 2;
    const cy = sinPhi * cxp + cosPhi * cyp + (from.y + to.y) / 2;

    const theta1 = angleBetween(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
    let dtheta = angleBetween((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
    if (sweep === 0 && dtheta > 0) dtheta -= 2 * Math.PI;
    if (sweep === 1 && dtheta < 0) dtheta += 2 * Math.PI;

    return { cx, cy, rx, ry, phi, theta1, dtheta };
}

/** The point on an arc at ellipse angle `theta`. */
export function arcPointAtAngle(arc: ArcParams, theta: number): Vector2 {
    const cosPhi = Math.cos(arc.phi), sinPhi = Math.sin(arc.phi);
    const cosT = Math.cos(theta), sinT = Math.sin(theta);
    return {
        x: cosPhi * arc.rx * cosT - sinPhi * arc.ry * sinT + arc.cx,
        y: sinPhi * arc.rx * cosT + cosPhi * arc.ry * sinT + arc.cy,
    };
}

/** A parametric function tracing the arc from its start (`t=0`) to its end (`t=1`). */
export function arcPointFunction(arc: ArcParams): (t: number) => Vector2 {
    return (t: number) => arcPointAtAngle(arc, arc.theta1 + t * arc.dtheta);
}

/** The derivative of {@link arcPointAtAngle} with respect to `theta`. */
function arcDerivativeAtAngle(arc: ArcParams, theta: number): Vector2 {
    const cosPhi = Math.cos(arc.phi), sinPhi = Math.sin(arc.phi);
    const cosT = Math.cos(theta), sinT = Math.sin(theta);
    return {
        x: -arc.rx * cosPhi * sinT - arc.ry * sinPhi * cosT,
        y: -arc.rx * sinPhi * sinT + arc.ry * cosPhi * cosT,
    };
}

/**
 * The arc's `theta0..theta1` span as cubics — the one place an arc is
 * approximated.
 *
 * Split so no piece spans more than 90°, which is the standard bound: the
 * `(4/3)·tan(Δ/4)` construction is exact at both endpoints and at the midpoint,
 * and its worst-case radial error over a quarter turn is about 2.7e-4 of the
 * radius. There were two implementations of this before — one splitting by
 * angle, one fitting sampled points with a "catmull-rom-like" guess — and only
 * the first was worth keeping.
 */
export function arcSweepToCubics(arc: ArcParams, theta0: number, theta1: number): Cubic[] {
    const sweep = theta1 - theta0;
    if (Math.abs(sweep) < 1e-12) return [];
    const pieces = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2)));
    const step = sweep / pieces;
    const alpha = (4 / 3) * Math.tan(step / 4);

    const cubics: Cubic[] = [];
    for (let i = 0; i < pieces; i++) {
        const a0 = theta0 + step * i;
        const a1 = a0 + step;
        const p0 = arcPointAtAngle(arc, a0);
        const p1 = arcPointAtAngle(arc, a1);
        const d0 = arcDerivativeAtAngle(arc, a0);
        const d1 = arcDerivativeAtAngle(arc, a1);
        cubics.push({
            p0,
            c1: { x: p0.x + alpha * d0.x, y: p0.y + alpha * d0.y },
            c2: { x: p1.x - alpha * d1.x, y: p1.y - alpha * d1.y },
            p1,
        });
    }
    return cubics;
}

/**
 * The ellipse angles at which each axis turns around — the candidates an exact
 * bounding box tests against the swept range.
 */
export function arcAxisAngles(arc: ArcParams): { x: number[]; y: number[] } {
    const cosPhi = Math.cos(arc.phi), sinPhi = Math.sin(arc.phi);
    // dx/dθ = 0 and dy/dθ = 0, each giving one angle and its antipode.
    const tx = Math.atan2(-arc.ry * sinPhi, arc.rx * cosPhi);
    const ty = Math.atan2(arc.ry * cosPhi, arc.rx * sinPhi);
    return {
        x: [tx, tx + Math.PI],
        y: [ty, ty + Math.PI],
    };
}

/**
 * Whether ellipse angle `theta` lies within the arc's swept range.
 *
 * Compared as a distance travelled in the sweep's own direction rather than as
 * an interval, because `theta1 + dtheta` routinely leaves `[-π, π]` and an
 * interval test would then reject the very angles that are inside it.
 */
export function arcContainsAngle(arc: ArcParams, theta: number): boolean {
    const TAU = Math.PI * 2;
    const forward = arc.dtheta >= 0;
    const delta = forward ? theta - arc.theta1 : arc.theta1 - theta;
    const travelled = ((delta % TAU) + TAU) % TAU;
    return travelled <= Math.abs(arc.dtheta) + 1e-9;
}

/** Re-exported so curve math and point lerping live behind a single import. */
export { lerpVector2 };
