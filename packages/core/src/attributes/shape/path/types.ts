/**
 * Every type the path module names, in one place.
 *
 * The vocabulary is small and it is worth seeing all of it at once, because the
 * whole module is four representations and the conversions between them:
 *
 *     PathData ─▶ PathCommand[] ─▶ PathContour[] ─┬─▶ CubicSubpath[]  (morph)
 *      a string      as written      the normal   └─▶ VectorPath      (editing)
 *      or commands                      form
 */
import type { Vector2 } from "@/attributes/layout/vector2";

// ── Geometry ───────────────────────────────────────────────────────────────

// `Extents` — the `{ minX, minY, maxX, maxY }` box — is `@/layout/bounds`'s,
// not a second copy. A path's bounding box and a node's are the same idea, and
// the two were already the same four fields under two names.

/**
 * A single cubic Bézier: start anchor `p0`, controls `c1`/`c2`, end anchor `p1`.
 * The end anchor of one cubic is the start of the next within a subpath.
 */
export interface Cubic {
    p0: Vector2;
    c1: Vector2;
    c2: Vector2;
    p1: Vector2;
}

/** An SVG `A` command re-expressed as the ellipse arc it names. */
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

// ── The normal form ────────────────────────────────────────────────────────

/**
 * One piece of a contour, keeping its own kind.
 *
 * Normalizing everything to cubics would be simpler by one dimension and wrong
 * in a way that shows on screen: an arc is not a cubic, so `length`, `sampler`,
 * `dash` and `trim` would all inherit an approximation only *morph* and the
 * anchor model actually need.
 *
 * Plain data, not a bundle of closures: `contours` runs inside `measure()` on
 * every layout pass, and arc-length parameterization is the expensive part of
 * path geometry. Nothing here samples a curve — `Extents` come from
 * closed-form extrema, and arc length is a separate, lazy table.
 */
export type PathSegment =
    | { kind: "line"; from: Vector2; to: Vector2 }
    | { kind: "quad"; from: Vector2; c: Vector2; to: Vector2 }
    | { kind: "cubic"; from: Vector2; c1: Vector2; c2: Vector2; to: Vector2 }
    | {
        kind: "arc"; from: Vector2; to: Vector2;
        rx: number; ry: number; rotation: number; largeArc: 0 | 1; sweep: 0 | 1;
    };

/**
 * One connected run — everything between an `M` and the next one.
 *
 * `start` is carried separately because a contour can legitimately have no
 * segments: a lone `M` is a real thing to write, it occupies a point that bounds
 * must account for, and the anchor model round-trips it as a single anchor.
 *
 * The closing edge of a `closed` contour is **not** in `segments` — `closed`
 * carries it. Storing it would mean a zero-length segment whenever the geometry
 * already ends where it started, which is most of the time.
 */
export interface PathContour {
    start: Vector2;
    segments: PathSegment[];
    /** Whether the run ended with a `Z`. */
    closed: boolean;
}

// ── Arc-length measurement ─────────────────────────────────────────────────

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

/** A point on the path with the unit tangent direction there. */
export interface PathFrame {
    x: number;
    y: number;
    /** Unit tangent (direction of travel along the path). */
    tx: number;
    ty: number;
}

export interface PathSampler {
    /** Total arc length across all contours. */
    readonly length: number;
    /**
     * Point and unit tangent at arc-length distance `d` from the path start.
     * `d` is clamped to `[0, length]`. Returns `null` only for a degenerate
     * (zero-length) path. Keeps an internal cursor so repeated calls with
     * non-decreasing `d` are amortized O(1).
     */
    frameAt(d: number): PathFrame | null;
}

// ── Morphing ───────────────────────────────────────────────────────────────

/** A connected run of cubics (one `M` followed by curves), optionally closed. */
export interface CubicSubpath {
    cubics: Cubic[];
    /** True for subpaths that ended with a `Z` — eligible for rotation/reversal. */
    closed: boolean;
}

/** A correspondence between two paths, pre-aligned so it can be sampled at any `t`. */
export interface MorphPlan {
    /** Subpath pairs; each pair has the same number of cubics on both sides. */
    pairs: Array<{
        from: Cubic[];
        to: Cubic[];
        /**
         * Whether the sampled subpath should be closed with a `Z`. A pair is
         * closed when both sides were closed rings — a closed shape morphing to
         * another closed shape stays closed, so the stroke forms a proper join
         * at the seam instead of leaving two unconnected free ends.
         */
        closed: boolean;
    }>;
}

// ── The editable anchor model ──────────────────────────────────────────────

/**
 * One anchor on a subpath, with the two control points that shape the segments
 * meeting at it.
 *
 * Handles are **absolute** points in the same space as {@link PathAnchor.point},
 * not offsets from it. That is what an SVG cubic stores, so serializing is a
 * copy rather than an addition, and it is the space a canvas editor drags them
 * in — an offset model would convert twice per pointer event for no gain.
 *
 * `null` means "no handle on this side", which draws as a straight segment. A
 * corner point has both null; a smooth point has both, mirrored through the
 * anchor; an asymmetric point has both, pointing opposite ways at different
 * lengths. The model does not record which of the three a point *is* — that is
 * derived from the handles, so a file cannot claim to be smooth while holding
 * handles that aren't.
 */
export interface PathAnchor {
    point: Vector2;
    /** Control point for the segment **arriving** at this anchor. */
    inHandle: Vector2 | null;
    /** Control point for the segment **leaving** it. */
    outHandle: Vector2 | null;
}

/** A single contiguous run of anchors — one `M …` in the `d` string. */
export interface PathSubpath {
    anchors: PathAnchor[];
    /** Whether the last anchor joins back to the first (`Z`). */
    closed: boolean;
}

/** A whole path: zero or more subpaths. */
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

// ── The operation surface ──────────────────────────────────────────────────

