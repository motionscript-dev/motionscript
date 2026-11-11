/**
 * The path module's types: four representations and the conversions between them.
 *
 *     PathData ─▶ PathCommand[] ─▶ PathContour[] ─┬─▶ CubicSubpath[]  (morph)
 *      a string      as written      the normal   └─▶ VectorPath      (editing)
 *      or commands                      form
 */
import type { Vector2 } from "@/attributes/layout/vector2";

// `Extents` is `@/layout/bounds`'s: a path's bounding box and a node's are the same idea.

/** A cubic Bézier; the end anchor of one is the start of the next within a subpath. */
export interface Cubic {
    p0: Vector2;
    c1: Vector2;
    c2: Vector2;
    p1: Vector2;
}

export interface ArcParams {
    cx: number;
    cy: number;
    /** Radii after the spec's "scale up until the endpoints are reachable" correction. */
    rx: number;
    ry: number;
    /** x-axis rotation, in **radians** (the command carries degrees). */
    phi: number;
    /** Start angle, and the signed sweep from it — `sweep`/`largeArc` already folded in. */
    theta1: number;
    dtheta: number;
}

/** One piece of a contour, keeping its own kind: normalizing to cubics would make `length`, `sampler`, `dash` and `trim` inherit an approximation only morph and the anchor model need. Plain data, not closures: `contours` runs inside `measure()` on every layout pass, so nothing here samples a curve (extents are closed-form, arc length a separate lazy table). */
export type PathSegment =
    | { kind: "line"; from: Vector2; to: Vector2 }
    | { kind: "quad"; from: Vector2; c: Vector2; to: Vector2 }
    | { kind: "cubic"; from: Vector2; c1: Vector2; c2: Vector2; to: Vector2 }
    | {
        kind: "arc"; from: Vector2; to: Vector2;
        rx: number; ry: number; rotation: number; largeArc: 0 | 1; sweep: 0 | 1;
    };

/** One connected run (an `M` to the next). `start` is separate because a contour may have no segments: a lone `M` occupies a point bounds must account for. The closing edge of a `closed` contour is **not** in `segments` (it would be a zero-length segment whenever the geometry already ends where it started). */
export interface PathContour {
    start: Vector2;
    segments: PathSegment[];
    closed: boolean;
}

export interface SegmentMetric {
    segment: PathSegment;
    /** The flattened polyline, `from` first and `to` last. */
    points: Vector2[];
    /** Length along the polyline at each point; the last entry is `length`. */
    cumulative: number[];
    length: number;
}

export interface ContourMetric {
    contour: PathContour;
    /** Every segment, the closed contour's implied join included. */
    metrics: SegmentMetric[];
    length: number;
}

export interface PathMetric {
    contours: ContourMetric[];
    length: number;
}

export interface PathFrame {
    x: number;
    y: number;
    /** Unit tangent (direction of travel along the path). */
    tx: number;
    ty: number;
}

export interface PathSampler {
    readonly length: number;
    /** Point and unit tangent at arc-length `d` (clamped to `[0, length]`), `null` only for a zero-length path. Keeps an internal cursor, so calls with non-decreasing `d` are amortized O(1). */
    frameAt(d: number): PathFrame | null;
}

export interface CubicSubpath {
    cubics: Cubic[];
    closed: boolean;
}

/** A correspondence between two paths, pre-aligned so it can be sampled at any `t`. */
export interface MorphPlan {
    /** Subpath pairs; each pair has the same number of cubics on both sides. */
    pairs: Array<{
        from: Cubic[];
        to: Cubic[];
        /** A pair is closed when both sides were closed rings, so the stroke joins at the seam instead of leaving two free ends. */
        closed: boolean;
    }>;
}

/**
 * One anchor with the two control points of the segments meeting at it. Handles are **absolute** points in the same
 * space as {@link PathAnchor.point} (what an SVG cubic stores and the canvas editor drags), not offsets. `null` means
 * no handle on that side (a straight segment). Corner, smooth and asymmetric are not recorded; they derive from the
 * handles, so a file cannot claim to be smooth while holding handles that aren't.
 */
export interface PathAnchor {
    point: Vector2;
    /** Control point for the segment **arriving** at this anchor. */
    inHandle: Vector2 | null;
    /** Control point for the segment **leaving** it. */
    outHandle: Vector2 | null;
}

export interface PathSubpath {
    anchors: PathAnchor[];
    closed: boolean;
}

export type VectorPath = PathSubpath[];

/** Scale and offset applied on each axis, as `pathOps.normalize` reports it. */
export interface PathNormalization {
    /** The path, remapped so its bounds are exactly the unit box. */
    path: VectorPath;
    /** How much wider the geometry became, as a multiple of the old box. */
    scaleX: number;
    scaleY: number;
    /** Where the old geometry's centre sat, in the *old* unit space. */
    centerX: number;
    centerY: number;
}


