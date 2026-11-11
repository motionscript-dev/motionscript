/**
 * The editable vector model: subpaths of anchors, each with the two bezier handles of the segments either side
 * (Figma's model). The **second** boundary where geometry is deliberately flattened to one curve type: an arc has
 * no handles to drag, so it becomes cubics on the way in.
 *
 * **The coordinate space is the node's own box**: `x`/`y` run -0.5 to +0.5 across its width and height, y pointing
 * *down* as in SVG. Resizing is then an ordinary width/height drag, since geometry is a fraction of the box. Points
 * *may* sit outside it (a point dragged past an edge); {@link normalize} pulls the box back around the geometry once,
 * on the way out of an edit.
 */
import { Vector2 } from "@/attributes/layout/vector2";
import { PathCommand, PathData } from "@/render/descriptors/path";
import { arcSweepToCubics, cubicAxis, cubicExtrema, quadToCubic, splitCubicAt } from "./bezier";
import { contours, segmentArc } from "./walk";
import type { Extents } from "@/layout/bounds";
import type { Cubic, PathAnchor, PathContour, PathNormalization, PathSubpath, VectorPath } from "./types";

/** An empty path, as the value an unset `data` field resolves to. */
export const EMPTY_PATH_DATA = "";

/** Whether two points are the same to within serialization noise. */
function samePoint(a: Vector2, b: Vector2): boolean {
    return Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;
}

/** Marks a subpath closed, folding a duplicated last anchor into the first: a `d` ending `… L 0 0 Z` names the start twice, and left alone the round trip would grow an anchor on every load. */
function closeSubpath(subpath: PathSubpath): void {
    subpath.closed = true;
    const { anchors } = subpath;
    if (anchors.length < 2) return;
    const first = anchors[0];
    const last = anchors[anchors.length - 1];
    if (!samePoint(first.point, last.point)) return;
    // The closing segment's own curvature belongs to the join, so the duplicate's
    // in-handle becomes the first anchor's.
    first.inHandle = last.inHandle;
    anchors.pop();
}

/** A copy of a point of the memoized contour — the model is edited in place. */
const copy = (v: Vector2): Vector2 => ({ x: v.x, y: v.y });

function contourToSubpath(contour: PathContour): PathSubpath {
    // Every point and handle is copied out of the memoized contour: `contours`
    // shares its result between callers, and an editor moves these in place.
    const anchors: PathAnchor[] = [
        { point: copy(contour.start), inHandle: null, outHandle: null },
    ];
    const curve = (cubic: Cubic) => {
        anchors[anchors.length - 1].outHandle = copy(cubic.c1);
        anchors.push({ point: copy(cubic.p1), inHandle: copy(cubic.c2), outHandle: null });
    };

    for (const segment of contour.segments) {
        switch (segment.kind) {
            case "line":
                // Both handles stay null, which is what draws a straight segment.
                anchors.push({ point: copy(segment.to), inHandle: null, outHandle: null });
                break;
            case "cubic":
                curve({ p0: segment.from, c1: segment.c1, c2: segment.c2, p1: segment.to });
                break;
            case "quad":
                curve(quadToCubic(segment.from, segment.c, segment.to));
                break;
            case "arc": {
                const arc = segmentArc(segment);
                for (const cubic of arcSweepToCubics(arc, arc.theta1, arc.theta1 + arc.dtheta)) {
                    curve(cubic);
                }
                break;
            }
        }
    }

    const subpath: PathSubpath = { anchors, closed: false };
    if (contour.closed) closeSubpath(subpath);
    return subpath;
}

/** Any {@link PathData} as the editable model. Takes `PathData`, not a string: a morph hands over a `PathCommand[]` at every `t` strictly between 0 and 1, which string-only callers drew as nothing. */
export function anchors(d: PathData | null | undefined): VectorPath {
    return contours(d)
        .map(contourToSubpath)
        .filter((subpath) => subpath.anchors.length > 0);
}

/** Decimals a stored coordinate keeps: sub-pixel on a 10,000px node (a coordinate is a fraction of its size) and stable, so a drag that lands where it started re-serializes identically. */
const COORD_PRECISION = 5;

function fmt(value: number): string {
    if (!Number.isFinite(value)) return "0";
    const rounded = Number(value.toFixed(COORD_PRECISION));
    // `-0` serializes as "0": the two are the same point, and a sign that flips
    // with the wind would make the "did anything change" comparison lie.
    return String(rounded === 0 ? 0 : rounded);
}

/** What one segment between two anchors *is*: a line, or a cubic and its controls. Shared by both output formats (`d` string and `PathCommand`). */
function segmentBetween(from: PathAnchor, to: PathAnchor):
    | { line: true; to: Vector2 }
    | { line: false; c1: Vector2; c2: Vector2; to: Vector2 } {
    if (from.outHandle === null && to.inHandle === null) {
        return { line: true, to: to.point };
    }
    // A missing handle stands in as its own anchor: the degenerate cubic that draws as a straight pull towards the other end.
    return {
        line: false,
        c1: from.outHandle ?? from.point,
        c2: to.inHandle ?? to.point,
        to: to.point,
    };
}

/** Serializes the model back to a `d` string. Only `M`, `L`, `C` and `Z` are emitted, so what is stored can always be edited. */
export function fromAnchors(path: VectorPath): string {
    const parts: string[] = [];
    for (const { anchors, closed } of path) {
        if (anchors.length === 0) continue;
        parts.push(`M ${fmt(anchors[0].point.x)} ${fmt(anchors[0].point.y)}`);
        for (let i = 1; i < anchors.length; i++) {
            const segment = segmentBetween(anchors[i - 1], anchors[i]);
            parts.push(segment.line
                ? `L ${fmt(segment.to.x)} ${fmt(segment.to.y)}`
                : `C ${fmt(segment.c1.x)} ${fmt(segment.c1.y)} ${fmt(segment.c2.x)} ${fmt(segment.c2.y)} ${fmt(segment.to.x)} ${fmt(segment.to.y)}`);
        }
        if (closed) {
            if (anchors.length > 1) {
                const join = segmentBetween(anchors[anchors.length - 1], anchors[0]);
                // A straight closing segment is what `Z` already draws, so emitting
                // it as well would add the duplicate anchor `closeSubpath` undoes.
                if (!join.line) {
                    parts.push(`C ${fmt(join.c1.x)} ${fmt(join.c1.y)} ${fmt(join.c2.x)} ${fmt(join.c2.y)} ${fmt(join.to.x)} ${fmt(join.to.y)}`);
                }
            }
            parts.push("Z");
        }
    }
    return parts.join(" ");
}

const identity = (point: Vector2): Vector2 => point;

/** The model as drawable commands, with a transform (unit box -> laid-out pixels, y-down -> y-up) folded into the same pass: one allocation per repaint instead of two. */
export function anchorCommands(
    path: VectorPath,
    transform: (point: Vector2) => Vector2 = identity,
): PathCommand[] {
    const out: PathCommand[] = [];
    const emit = (from: PathAnchor, to: PathAnchor) => {
        const segment = segmentBetween(from, to);
        const end = transform(segment.to);
        if (segment.line) {
            out.push({ type: "L", x: end.x, y: end.y });
            return;
        }
        const c1 = transform(segment.c1);
        const c2 = transform(segment.c2);
        out.push({ type: "C", x1: c1.x, y1: c1.y, x2: c2.x, y2: c2.y, x: end.x, y: end.y });
    };

    for (const { anchors, closed } of path) {
        if (anchors.length === 0) continue;
        const start = transform(anchors[0].point);
        out.push({ type: "M", x: start.x, y: start.y });
        for (let i = 1; i < anchors.length; i++) emit(anchors[i - 1], anchors[i]);
        if (closed) {
            if (anchors.length > 1) {
                const from = anchors[anchors.length - 1];
                const to = anchors[0];
                if (from.outHandle !== null || to.inHandle !== null) emit(from, to);
            }
            out.push({ type: "Z" });
        }
    }
    return out;
}

/** The path's tight bounding box (a cubic's own extrema, not the handle hull, which would leave a gap to the node's edge), or `null` when it has no points. */
export function anchorBounds(path: VectorPath): Extents | null {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let seen = false;

    const includeX = (x: number) => { seen = true; if (x < minX) minX = x; if (x > maxX) maxX = x; };
    const includeY = (y: number) => { seen = true; if (y < minY) minY = y; if (y > maxY) maxY = y; };

    for (const { anchors, closed } of path) {
        for (const anchor of anchors) {
            includeX(anchor.point.x);
            includeY(anchor.point.y);
        }
        // The closing join exists only with a second anchor to join: the writers
        // emit none for a lone one (`M x y Z` draws nothing), so its self-loop
        // must not widen the box either.
        const last = closed && anchors.length > 1 ? anchors.length : anchors.length - 1;
        for (let i = 0; i < last; i++) {
            const from = anchors[i];
            const to = anchors[(i + 1) % anchors.length];
            if (from.outHandle === null && to.inHandle === null) continue;
            const c1 = from.outHandle ?? from.point;
            const c2 = to.inHandle ?? to.point;
            for (const t of cubicExtrema(from.point.x, c1.x, c2.x, to.point.x)) {
                includeX(cubicAxis(t, from.point.x, c1.x, c2.x, to.point.x));
            }
            for (const t of cubicExtrema(from.point.y, c1.y, c2.y, to.point.y)) {
                includeY(cubicAxis(t, from.point.y, c1.y, c2.y, to.point.y));
            }
        }
    }

    return seen ? { minX, minY, maxX, maxY } : null;
}

export function map(path: VectorPath, fn: (point: Vector2) => Vector2): VectorPath {
    return path.map((subpath) => ({
        closed: subpath.closed,
        anchors: subpath.anchors.map((anchor) => ({
            point: fn(anchor.point),
            inHandle: anchor.inHandle ? fn(anchor.inHandle) : null,
            outHandle: anchor.outHandle ? fn(anchor.outHandle) : null,
        })),
    }));
}

/** The turn-and-scale about `start` that carries `end` onto `to` (how `moveTo` fits a path at another node); translates when `start` and `end` coincide. */
export function endFit(start: Vector2, end: Vector2, to: Vector2): (point: Vector2) => Vector2 {
    const cx = end.x - start.x;
    const cy = end.y - start.y;
    const chord = cx * cx + cy * cy;
    if (chord < 1e-12) {
        const dx = to.x - end.x;
        const dy = to.y - end.y;
        return (p) => ({ x: p.x + dx, y: p.y + dy });
    }
    // (to - start) / (end - start) as complex numbers: a rotation and a uniform scale.
    const tx = to.x - start.x;
    const ty = to.y - start.y;
    const re = (tx * cx + ty * cy) / chord;
    const im = (ty * cx - tx * cy) / chord;
    return (p) => {
        const ux = p.x - start.x;
        const uy = p.y - start.y;
        return { x: start.x + re * ux - im * uy, y: start.y + im * ux + re * uy };
    };
}

export function isEmpty(path: VectorPath): boolean {
    return path.every((subpath) => subpath.anchors.length < 2);
}

/** The unit box's extent: the node's layout rect as a fraction of itself. A renderer scales by it; an editor projects a screen point into it. */
export const PATH_UNIT_EXTENT = 1;

export const PATH_UNIT_HALF = PATH_UNIT_EXTENT / 2;

/** The box a path's coordinates are quoted against: the node's own frame, {@link PATH_UNIT_HALF} either side of centre. */
export const UNIT_PATH_BOX: Extents = {
    minX: -PATH_UNIT_HALF,
    minY: -PATH_UNIT_HALF,
    maxX: PATH_UNIT_HALF,
    maxY: PATH_UNIT_HALF,
};

/** Pulls the unit box back around the geometry, run on the way out of a path edit. The caller pairs it with the node's size and position (grow by `scaleX`/`scaleY`, move by `centerX`/`centerY`) so the drawing doesn't shift on screen. */
export function normalize(path: VectorPath): PathNormalization {
    const bounds = anchorBounds(path);
    if (!bounds) return { path, scaleX: 1, scaleY: 1, centerX: 0, centerY: 0 };
    return fitToBox(path, bounds);
}

/** Re-quotes a path against `box`; {@link normalize} is this with the geometry's own bounds. A dialog can instead *state* the frame (margin, off-centre). A degenerate axis (all points on a line) keeps scale 1 instead of dividing by zero. */
export function fitToBox(path: VectorPath, box: Extents): PathNormalization {
    const width = box.maxX - box.minX;
    const height = box.maxY - box.minY;
    const centerX = (box.minX + box.maxX) / 2;
    const centerY = (box.minY + box.maxY) / 2;
    const scaleX = width > 1e-9 ? width / PATH_UNIT_EXTENT : 1;
    const scaleY = height > 1e-9 ? height / PATH_UNIT_EXTENT : 1;

    return {
        path: map(path, (p) => ({
            x: (p.x - centerX) / scaleX,
            y: (p.y - centerY) / scaleY,
        })),
        scaleX,
        scaleY,
        centerX,
        centerY,
    };
}

export function translate(path: VectorPath, delta: Vector2): VectorPath {
    return map(path, (p) => ({ x: p.x + delta.x, y: p.y + delta.y }));
}

/** A point on the segment between two anchors at `t`: where a click landed, and the preview of the anchor an insertion would create. */
export function pointOn(from: PathAnchor, to: PathAnchor, t: number): Vector2 {
    if (from.outHandle === null && to.inHandle === null) {
        return {
            x: from.point.x + (to.point.x - from.point.x) * t,
            y: from.point.y + (to.point.y - from.point.y) * t,
        };
    }
    const c1 = from.outHandle ?? from.point;
    const c2 = to.inHandle ?? to.point;
    return {
        x: cubicAxis(t, from.point.x, c1.x, c2.x, to.point.x),
        y: cubicAxis(t, from.point.y, c1.y, c2.y, to.point.y),
    };
}

/** Splits the segment at `t` into the three anchors that replace the pair (ends with shortened outer handles, new anchor carrying both halves of the tangent). De Casteljau keeps the curve identical, so insertion is invisible. */
export function split(
    from: PathAnchor, to: PathAnchor, t: number,
): { from: PathAnchor; middle: PathAnchor; to: PathAnchor } {
    if (from.outHandle === null && to.inHandle === null) {
        return {
            from,
            middle: { point: pointOn(from, to, t), inHandle: null, outHandle: null },
            to,
        };
    }

    const { left, right } = splitCubicAt(
        from.point,
        from.outHandle ?? from.point,
        to.inHandle ?? to.point,
        to.point,
        t,
    );
    return {
        from: { ...from, outHandle: left.cp1 },
        middle: { point: left.to, inHandle: left.cp2, outHandle: right.cp1 },
        to: { ...to, inHandle: right.cp2 },
    };
}
