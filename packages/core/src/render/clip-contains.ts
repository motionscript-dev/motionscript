import { Vector2 } from "@/attributes/layout/vector2";
import { Clip, ClipOp, ClipShapeOp } from "./clip";
import { withRectDescriptor } from "./descriptors/rect";
import { withEllipseDescriptor } from "./descriptors/ellipse";
import { withPolygonDescriptor } from "./descriptors/polygon";
import { withPolygramDescriptor } from "./descriptors/polygram";
import { withLineDescriptor } from "./descriptors/line";
import { cornerRadiusOps } from "@/attributes/shape/corners/corner-radius";

/**
 * Point-in-region tests for {@link Clip}, so a click follows a shape's silhouette rather than its bounding box.
 * Geometry only, since a `Clip` is a declarative record of primitives rather than a built path: a shape declares its
 * outline once in `clipSelf()` and both the pixels and the grab region derive from it. Points and descriptor
 * coordinates are **y-up author space** (the renderer flips at draw time, see `flipPositionY`), so
 * `startAngle`/`sweep` measure counter-clockwise from +x.
 */

const EPS = 1e-9;

/** Whether `point` is inside the region a {@link Clip} describes, within `tolerance` scene units of its edge. Shape ops union; a `cut` subtracts the preceding shape from everything before it, as the renderer replays. `tolerance` widens each shape outward, a cutter included (a slightly larger bite), keeping the test forgiving rather than making a hole's rim unpickable. */
export function containsClip(clip: Clip, point: Vector2, tolerance = 0): boolean {
    return containsOps(clip.ops(), point, tolerance);
}

export function containsOps(ops: readonly ClipOp[], point: Vector2, tolerance = 0): boolean {
    let inside = false;
    // Held back so a following `cut` can subtract it instead of unioning it.
    let pending: ClipShapeOp | null = null;

    const flush = (): void => {
        if (pending && containsShape(pending, point, tolerance)) inside = true;
        pending = null;
    };

    for (const op of ops) {
        if (op.kind === "cut") {
            // The pending shape is the cutter: it never joins the union and punches what came before.
            if (pending && containsShape(pending, point, tolerance)) inside = false;
            pending = null;
            continue;
        }
        flush();
        pending = op;
    }
    flush();
    return inside;
}

/** Dispatches a shape op to its containment test after undoing its local rotation/scale about its pivot, mirroring `BaseShape.applyShapeTransform`. */
function containsShape(op: ClipShapeOp, point: Vector2, tolerance: number): boolean {
    switch (op.kind) {
        case "rect": {
            const s = withRectDescriptor(op.state);
            const p = toShapeLocal(point, s, s.width, s.height);
            return p !== null && containsRect(p, s.width, s.height, cornerRadiusOps.resolve(s.cornerRadius), tolerance);
        }
        case "ellipse": {
            const s = withEllipseDescriptor(op.state);
            const p = toShapeLocal(point, s, s.width, s.height);
            return p !== null && containsEllipse(p, s.width, s.height, s.ratio, s.sweep, s.startAngle, tolerance);
        }
        case "polygon": {
            const s = withPolygonDescriptor(op.state);
            const p = toShapeLocal(point, s, s.width, s.height);
            return p !== null && containsPolyline(p, polygonVertices(s.width, s.height, s.sides), true, tolerance);
        }
        case "polygram": {
            const s = withPolygramDescriptor(op.state);
            const p = toShapeLocal(point, s, s.width, s.height);
            return p !== null && containsPolyline(p, polygramVertices(s.width, s.height, s.sides, s.ratio), true, tolerance);
        }
        case "line": {
            const s = withLineDescriptor(op.state);
            const p = toShapeLocal(point, s, s.width, s.height);
            if (p === null || s.points.length === 0) return false;
            // As a clip region a polyline is filled with its contour implicitly closed, so test the enclosed area first, then the band around the stroke.
            if (s.points.length >= 3 && containsPolyline(p, s.points, true, tolerance)) return true;
            return nearPolyline(p, s.points, s.closed, tolerance);
        }
        case "path": {
            // A Bézier winding test isn't worth carrying and no built-in shape emits a `path` clip, only a hand-built `Clip`; fall back to the declared box.
            const s = op.state;
            const local = { x: point.x - (s.x ?? 0), y: point.y - (s.y ?? 0) };
            return containsRect(local, s.width ?? 0, s.height ?? 0, cornerRadiusOps.resolve(0), tolerance);
        }
    }
}

interface ShapePlacement {
    x: number;
    y: number;
    rotation: number;
    scale: number;
    pivot: unknown;
}

/** Maps `point` out of the shape's `x`/`y`/`rotation`/`scale` (about its pivot) into its un-transformed, centred frame; `null` when scale is zero (collapsed, encloses nothing). */
function toShapeLocal(point: Vector2, s: ShapePlacement, width: number, height: number): Vector2 | null {
    if (s.scale === 0) return null;
    const pivot = s.pivot as Vector2;
    // Pivot is normalised [-1, 1] about the centre, y-up here (the renderer negates y in canvas space).
    const px = pivot.x * (width / 2);
    const py = pivot.y * (height / 2);
    const dx = point.x - (s.x + px);
    const dy = point.y - (s.y + py);
    // Undo the clockwise rotation: in y-up space the forward map is
    // (cos·x + sin·y, -sin·x + cos·y), so the inverse swaps the sine signs.
    const rad = (s.rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const rx = (cos * dx - sin * dy) / s.scale;
    const ry = (sin * dx + cos * dy) / s.scale;
    return { x: rx + px, y: ry + py };
}

interface Corners4 { topLeft: number; topRight: number; bottomRight: number; bottomLeft: number }

/** Box centred on the origin with per-corner rounding; a corner excludes the point only beyond its quarter-circle, so a plain rect reduces to the box test. `cornerStyle` is ignored: an `'angled'` chamfer cuts inside the arc, so the arc over-estimates by a sliver, the forgiving direction for a grab. */
function containsRect(p: Vector2, width: number, height: number, radius: Corners4, tolerance: number): boolean {
    const halfW = width / 2 + tolerance;
    const halfH = height / 2 + tolerance;
    if (Math.abs(p.x) > halfW || Math.abs(p.y) > halfH) return false;

    // Test the nearest corner's arc; radii clamp to half the side as any rounded-rect rasteriser clamps them.
    const maxR = Math.min(width, height) / 2;
    const r = Math.min(
        maxR,
        p.x <= 0
            ? (p.y >= 0 ? radius.topLeft : radius.bottomLeft)
            : (p.y >= 0 ? radius.topRight : radius.bottomRight),
    );
    if (r <= 0) return true;

    // Centre of that corner's arc, then the "outside the quarter-circle" check, which only bites inside the corner square.
    const sx = Math.sign(p.x || 1);
    const sy = Math.sign(p.y || 1);
    const dx = p.x - sx * (width / 2 - r);
    const dy = p.y - sy * (height / 2 - r);
    if (Math.sign(dx || 1) !== sx || Math.sign(dy || 1) !== sy) return true;
    return dx * dx + dy * dy <= (r + tolerance) * (r + tolerance);
}

/**
 * Ellipse with the `ratio`/`sweep`/`startAngle` family the renderer draws (see `EllipseShape.buildSVGPath`), so the
 * grab region is what was painted: `ratio` <= 0 is a disk (or wedge for a partial sweep); 0 < `ratio` < 1 an annulus /
 * annular sector (the hole is not hittable); `ratio` >= 1 collapses to the bare outer curve, hit only near it.
 */
function containsEllipse(
    p: Vector2, width: number, height: number,
    ratio: number, sweep: number, startAngle: number,
    tolerance: number,
): boolean {
    const rx = width / 2;
    const ry = height / 2;
    if (rx <= 0 || ry <= 0) return false;

    const clamped = Math.max(0, Math.min(1, ratio));
    const full = Math.abs(sweep) >= 360;

    // Outside the outer curve (grown by tolerance) can never hit.
    if (norm(p, rx + tolerance, ry + tolerance) > 1) return false;

    if (clamped > 0) {
        const inner = norm(p, Math.max(EPS, rx * clamped - tolerance), Math.max(EPS, ry * clamped - tolerance));
        if (inner < 1) return false;
    }

    if (full) return true;
    return withinSweep(Math.atan2(p.y / ry, p.x / rx) * (180 / Math.PI), startAngle, sweep, p, tolerance);
}

/** Normalised radius of `p` on an ellipse of half-axes `rx`/`ry` (1 = on the curve). */
function norm(p: Vector2, rx: number, ry: number): number {
    return Math.hypot(p.x / rx, p.y / ry);
}

/** Whether `angleDeg` is in the arc `[startAngle, startAngle + sweep]` (negative sweeps handled), with `tolerance` converted to angular slack at the point's radius so grab-slop widens the wedge's straight edges too. */
function withinSweep(
    angleDeg: number, startAngle: number, sweep: number,
    p: Vector2, tolerance: number,
): boolean {
    const lo = sweep >= 0 ? startAngle : startAngle + sweep;
    const span = Math.abs(sweep);
    // Near the centre every angle is within tolerance of the wedge.
    const radius = Math.hypot(p.x, p.y);
    if (radius <= tolerance) return true;
    const slack = tolerance > 0 ? (tolerance / Math.max(radius, EPS)) * (180 / Math.PI) : 0;
    let delta = (angleDeg - lo) % 360;
    if (delta < 0) delta += 360;
    // Accept the wrap-around side within slack as well.
    return delta <= span + slack || delta >= 360 - slack;
}

/** Vertices of a regular polygon inscribed in `width` x `height`, y-up. The renderer starts at the top vertex and steps clockwise in canvas space; in y-up that is `+π/2` stepping negative. */
export function polygonVertices(width: number, height: number, sides: number): Vector2[] {
    const n = Math.max(3, Math.round(sides));
    const rx = width / 2;
    const ry = height / 2;
    const step = (2 * Math.PI) / n;
    const out: Vector2[] = [];
    for (let i = 0; i < n; i++) {
        const a = Math.PI / 2 - i * step;
        out.push({ x: rx * Math.cos(a), y: ry * Math.sin(a) });
    }
    return out;
}

/** Vertices of a star polygon: outer radius 1 alternating with inner radius `ratio`. */
export function polygramVertices(width: number, height: number, sides: number, ratio: number): Vector2[] {
    const n = Math.max(3, Math.round(sides));
    const r = Math.max(0, Math.min(1, ratio));
    const rx = width / 2;
    const ry = height / 2;
    const step = Math.PI / n;
    const out: Vector2[] = [];
    for (let i = 0; i < n * 2; i++) {
        const a = Math.PI / 2 - i * step;
        const k = i % 2 === 0 ? 1 : r;
        out.push({ x: rx * k * Math.cos(a), y: ry * k * Math.sin(a) });
    }
    return out;
}

/** Even-odd crossing test against a polygon, widened by `tolerance` (a point just outside an edge counts). `closed` also closes the last-to-first segment for the tolerance band. */
function containsPolyline(p: Vector2, verts: readonly Vector2[], closed: boolean, tolerance: number): boolean {
    if (verts.length >= 3 && pointInPolygon(p, verts)) return true;
    return tolerance > 0 && nearPolyline(p, verts, closed, tolerance);
}

/** Even-odd crossing test against a closed polygon. No tolerance band. */
export function pointInPolygon(p: Vector2, verts: readonly Vector2[]): boolean {
    if (verts.length < 3) return false;
    let inside = false;
    for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
        const a = verts[i];
        const b = verts[j];
        if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
            inside = !inside;
        }
    }
    return inside;
}

/** Whether `p` is within `tolerance` of any segment of the polyline. */
export function nearPolyline(p: Vector2, pts: readonly Vector2[], closed: boolean, tolerance: number): boolean {
    if (pts.length === 0) return false;
    if (pts.length === 1) return Math.hypot(p.x - pts[0].x, p.y - pts[0].y) <= tolerance;
    const last = closed ? pts.length : pts.length - 1;
    for (let i = 0; i < last; i++) {
        if (distanceToSegment(p, pts[i], pts[(i + 1) % pts.length]) <= tolerance) return true;
    }
    return false;
}

/** Shortest distance from `p` to the segment `a`–`b`. */
export function distanceToSegment(p: Vector2, a: Vector2, b: Vector2): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq <= EPS) return Math.hypot(p.x - a.x, p.y - a.y);
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
