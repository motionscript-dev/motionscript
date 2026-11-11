import { Node2D } from "@/components/trees/2d/node2d";
import { BoxBounds } from "@/layout/bounds";
import { Vector2 } from "@/attributes/layout/vector2";
import { multiply, translation } from "@/attributes/layout/matrix2d";
import { worldAnchors } from "@/components/trees/2d/node-transform";

/**
 * The ink extent of a node whose drawing is made **out of its children** (a {@link BooleanGroup}, a
 * {@link MaskGroup}), whose layout cell is otherwise a fiction: nothing is drawn or grabbable at its edges and it
 * doesn't move with the parts. This is what {@link Node2D._localBounds} exists to fix, a separate seam from
 * `measure()` (the box moves, the layout does not).
 *
 * A bounding box is what you *can* work out without running the boolean. A union is exact
 * (`bounds(A ∪ B) = bounds(A) ∪ bounds(B)`) and also the honest answer for `exclude` (a subset, parts still visible).
 * `subtract` can only cut into the first child and `intersect` lives inside every child. Each mode states which it
 * is; the result is a *superset* of the true silhouette for `subtract`/`intersect` and exact for the others, never a
 * box the drawing spills out of.
 *
 * This composes with a resize that scales the children about the corner the drag holds still: an axis-aligned scale
 * about a point commutes with union and intersection, so scaling every child by `k` scales the answer by exactly `k`.
 */
export type ChildBoundsMode =
    /** Every child's ink, together — `union` and `exclude`. */
    | "union"
    /** The first child's ink alone — `subtract`'s base, and a mask's stencil. */
    | "first"
    /** Where every child's ink overlaps — `intersect`. */
    | "intersect";

/** Min/max in the node's own local space, y-up, relative to its centre. */
interface Span {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

/** The four corners of `child`'s ink in its **parent's** local space (y-up from the parent's centre): shift the child's matrix onto the ink's own centre (canvas y-down vs y-up bounds, hence the sign), then read the corners, as `nodeBox` does. Correct for rotated, scaled or off-centre ink. */
function inkCorners(child: Node2D): Vector2[] {
    const b = child._localBounds();
    const local = child._localMatrix();
    const m =
        b.x === 0 && b.y === 0 ? local : multiply(local, translation(b.x, -b.y));
    const a = worldAnchors(m, b.width / 2, b.height / 2);
    return [a.topLeft, a.topRight, a.bottomRight, a.bottomLeft];
}

/** The axis-aligned span of a point set, or `null` for an empty one. */
function spanOf(points: Vector2[]): Span | null {
    if (points.length === 0) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of points) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
    }
    return { minX, minY, maxX, maxY };
}

function toBounds(span: Span): BoxBounds {
    return {
        x: (span.minX + span.maxX) / 2,
        y: (span.minY + span.maxY) / 2,
        width: span.maxX - span.minX,
        height: span.maxY - span.minY,
    };
}

/** The extent of `node`'s children's ink in its own local space, or `null` with nothing to measure (no children, or an `intersect` whose parts don't overlap). `null` is the caller's cue to keep the layout cell: it stays put and grabbable, which a node you need to drop another child into must be. */
export function childInkBounds(
    node: Node2D,
    mode: ChildBoundsMode
): BoxBounds | null {
    const children = node.children;
    if (children.length === 0) return null;

    if (mode === "first") {
        const span = spanOf(inkCorners(children[0]));
        return span ? toBounds(span) : null;
    }

    if (mode === "union") {
        const span = spanOf(children.flatMap(inkCorners));
        return span ? toBounds(span) : null;
    }

    let span: Span | null = null;
    for (const child of children) {
        const next = spanOf(inkCorners(child));
        if (!next) return null;
        span = span
            ? {
                  minX: Math.max(span.minX, next.minX),
                  minY: Math.max(span.minY, next.minY),
                  maxX: Math.min(span.maxX, next.maxX),
                  maxY: Math.min(span.maxY, next.maxY),
              }
            : next;
        // The parts have stopped overlapping: nothing is drawn, so there is no box.
        if (span.minX > span.maxX || span.minY > span.maxY) return null;
    }
    return span ? toBounds(span) : null;
}
