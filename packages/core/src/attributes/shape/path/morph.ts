/**
 * Path morphing — smooth interpolation between two arbitrary path shapes.
 *
 * Lerping two SVG paths command-by-command only works when they happen to share
 * the same command structure; in general one path is a triangle and the other a
 * star with a different number of points, different command types, a different
 * start point, and the opposite winding. Naively pairing commands produces
 * kinks, self-intersections, and points that fly across the canvas.
 *
 * This module reshapes both paths into a common, directly-interpolatable form —
 * the same approach GSAP's MorphSVGPlugin uses:
 *
 *  1. {@link cubics} converts each path into a list of {@link CubicSubpath}s.
 *     Every drawing command (L/H/V/Q/A/Z-close) is rewritten as a cubic Bézier, so
 *     a subpath becomes a uniform chain of cubics described purely by anchor and
 *     control points.
 *  2. {@link plan} pairs the two paths' subpaths (padding the shorter side
 *     with degenerate, collapsed subpaths so every subpath has a partner),
 *     equalizes the number of cubics in each pair by subdividing the coarser
 *     subpath along its perimeter, and — for closed rings — rotates and optionally
 *     reverses one ring so the two start at the same place and wind the same way.
 *  3. {@link lerpPathData} samples that aligned correspondence at a given `t`,
 *     interpolating every control point with {@link lerpVector2}.
 *
 * The result is a {@link PathCommand} list (one `M` + N `C`s per subpath) that the
 * existing renderer draws unchanged.
 */
import { Vector2, lerpVector2 } from "@/attributes/layout/vector2";
import { PathCommand, PathData } from "@/render/descriptors/path";
import { distance, cubicPoint } from "./bezier";
import { commands, contourSegments, contours, segmentCubics } from "./walk";
import type { Cubic, CubicSubpath, MorphPlan } from "./types";

/**
 * A path as cubic subpaths — one of the two boundaries where geometry is
 * deliberately flattened to a single curve type.
 *
 * A morph has to pair segments up and interpolate them, which needs both sides
 * speaking one language, so an arc becomes cubics here (and only here, and in
 * the anchor model). This used to carry the sixth copy of the pen walk; the one
 * thing it got wrong that the shared walk does not is `Z`, which it marked
 * without closing the run — so `M0 0 L10 0 Z L20 0` came back as one subpath
 * where SVG says two.
 */
export function cubics(d: PathData | null | undefined): CubicSubpath[] {
    const out: CubicSubpath[] = [];
    for (const contour of contours(d)) {
        // A lone `M` has nothing to interpolate: it draws nothing and has no
        // first anchor to seed a partner from, so it is not a subpath here. It
        // stays in `contours`, where it still occupies a point of the bounds.
        const chain = contourSegments(contour).flatMap(segmentCubics);
        if (chain.length === 0) continue;
        // `contours` is memoized and shared, so hand out copies of its points: a
        // caller moving an anchor of the result must not move the cached path.
        out.push({
            cubics: chain.map((c) => ({ p0: { ...c.p0 }, c1: { ...c.c1 }, c2: { ...c.c2 }, p1: { ...c.p1 } })),
            closed: contour.closed,
        });
    }
    return out;
}

/** First anchor of a subpath (the implicit `M` target). */
function startPoint(cubics: Cubic[]): Vector2 {
    return cubics[0].p0;
}

/** Approximate length of a cubic by flattening — cheap, used only for weighting. */
function cubicLength(c: Cubic, steps = 8): number {
    let len = 0;
    let prev = c.p0;
    for (let i = 1; i <= steps; i++) {
        const p = cubicPoint(c.p0, c.c1, c.c2, c.p1, i / steps);
        len += distance(prev, p);
        prev = p;
    }
    return len;
}

/** Centroid of a subpath's anchor points — used to pair subpaths by proximity. */
function centroid(cubics: Cubic[]): Vector2 {
    let x = 0, y = 0;
    for (const c of cubics) { x += c.p0.x; y += c.p0.y; }
    return { x: x / cubics.length, y: y / cubics.length };
}

// --- Subdivision: grow a subpath to a target number of cubics ---------------

/** Split one cubic at parameter `t` into two cubics tracing the same curve (De Casteljau). */
function splitCubic(c: Cubic, t: number): [Cubic, Cubic] {
    const a = lerpVector2(c.p0, c.c1, t);
    const b = lerpVector2(c.c1, c.c2, t);
    const d = lerpVector2(c.c2, c.p1, t);
    const e = lerpVector2(a, b, t);
    const f = lerpVector2(b, d, t);
    const g = lerpVector2(e, f, t);
    return [
        { p0: c.p0, c1: a, c2: e, p1: g },
        { p0: g, c1: f, c2: d, p1: c.p1 },
    ];
}

/**
 * Subdivide `cubics` until it has exactly `target` cubics (target ≥ current).
 * Splits are spread across the longest segments first so the added anchor points
 * land roughly evenly along the perimeter — the key to a smooth morph, since each
 * added point becomes a correspondence point with the other shape.
 */
function subdivideTo(cubics: Cubic[], target: number): Cubic[] {
    let work = cubics.slice();
    while (work.length < target) {
        // Find the longest cubic and split it in half.
        let longest = 0;
        let maxLen = -1;
        for (let i = 0; i < work.length; i++) {
            const len = cubicLength(work[i]);
            if (len > maxLen) { maxLen = len; longest = i; }
        }
        const [left, right] = splitCubic(work[longest], 0.5);
        work.splice(longest, 1, left, right);
    }
    return work;
}

// --- Ring alignment: rotate + reverse a closed subpath ----------------------

/** Reverse a chain of cubics so it traces the same shape in the opposite direction. */
function reverseCubics(cubics: Cubic[]): Cubic[] {
    const out: Cubic[] = [];
    for (let i = cubics.length - 1; i >= 0; i--) {
        const c = cubics[i];
        out.push({ p0: c.p1, c1: c.c2, c2: c.c1, p1: c.p0 });
    }
    return out;
}

/** Rotate a closed ring so it begins at cubic index `offset` (wraps around). */
function rotateCubics(cubics: Cubic[], offset: number): Cubic[] {
    if (offset === 0) return cubics.slice();
    return cubics.slice(offset).concat(cubics.slice(0, offset));
}

/** Sum of squared distances between paired anchor points — the alignment cost. */
function anchorCost(a: Cubic[], b: Cubic[]): number {
    let cost = 0;
    for (let i = 0; i < a.length; i++) {
        const dx = a[i].p0.x - b[i].p0.x;
        const dy = a[i].p0.y - b[i].p0.y;
        cost += dx * dx + dy * dy;
    }
    return cost;
}

/**
 * Align a closed `to` ring against a fixed `from` ring (same cubic count). Tries
 * every rotation offset, in both winding directions, and keeps whichever pairs the
 * anchor points with the least total travel. This is what lets two shapes whose
 * points are listed in any order — or that wind in opposite directions — morph
 * without spinning or folding through themselves.
 */
function alignClosedRing(from: Cubic[], to: Cubic[]): Cubic[] {
    const n = from.length;
    let best = to;
    let bestCost = Infinity;

    for (const candidate of [to, reverseCubics(to)]) {
        for (let offset = 0; offset < n; offset++) {
            const rotated = rotateCubics(candidate, offset);
            const cost = anchorCost(from, rotated);
            if (cost < bestCost) {
                bestCost = cost;
                best = rotated;
            }
        }
    }
    return best;
}

/**
 * For an open subpath, only the winding can be flipped (rotation would change the
 * shape). Pick the direction whose endpoints best match the `from` subpath.
 */
function alignOpenSubpath(from: Cubic[], to: Cubic[]): Cubic[] {
    const reversed = reverseCubics(to);
    return anchorCost(from, to) <= anchorCost(from, reversed) ? to : reversed;
}

// --- Degenerate subpaths (for count mismatches) -----------------------------

/**
 * A subpath collapsed onto a single point `at`, with `count` zero-length cubics.
 * Pairing a real subpath with one of these makes it grow out of / shrink into a
 * point, which is how added or removed subpaths animate.
 */
function degenerateSubpath(at: Vector2, count: number): Cubic[] {
    const cubics: Cubic[] = [];
    for (let i = 0; i < count; i++) {
        cubics.push({ p0: { ...at }, c1: { ...at }, c2: { ...at }, p1: { ...at } });
    }
    return cubics;
}

// --- Subpath pairing --------------------------------------------------------

/**
 * Greedily pair `from` subpaths with the nearest unused `to` subpath (by centroid),
 * so morphing maps each shape onto its closest counterpart rather than by list
 * order. Leftover subpaths on either side are paired with a degenerate partner
 * collapsed at their own centroid, so they grow/shrink in place.
 */
function pairSubpaths(
    fromSubs: CubicSubpath[],
    toSubs: CubicSubpath[],
): Array<{ from: CubicSubpath; to: CubicSubpath }> {
    const pairs: Array<{ from: CubicSubpath; to: CubicSubpath }> = [];
    const toUsed = new Array(toSubs.length).fill(false);

    for (const f of fromSubs) {
        const fc = centroid(f.cubics);
        let bestIdx = -1;
        let bestDist = Infinity;
        for (let j = 0; j < toSubs.length; j++) {
            if (toUsed[j]) continue;
            const d = distance(fc, centroid(toSubs[j].cubics));
            if (d < bestDist) { bestDist = d; bestIdx = j; }
        }
        if (bestIdx >= 0) {
            toUsed[bestIdx] = true;
            pairs.push({ from: f, to: toSubs[bestIdx] });
        } else {
            // No `to` subpath left → collapse to this subpath's own centroid.
            pairs.push({
                from: f,
                to: { cubics: degenerateSubpath(fc, f.cubics.length), closed: f.closed },
            });
        }
    }

    // Any unused `to` subpaths grow out of their own centroid.
    for (let j = 0; j < toSubs.length; j++) {
        if (toUsed[j]) continue;
        const t = toSubs[j];
        const tc = centroid(t.cubics);
        pairs.push({
            from: { cubics: degenerateSubpath(tc, t.cubics.length), closed: t.closed },
            to: t,
        });
    }

    return pairs;
}

// --- Building the morph plan ------------------------------------------------

/**
 * Build a reusable {@link MorphPlan} aligning `from` to `to`. All the expensive
 * work — converting to cubics, pairing subpaths, equalizing counts, and rotating
 * rings — happens here once; {@link sample} then samples it cheaply per frame.
 */
export function plan(from: PathCommand[], to: PathCommand[]): MorphPlan {
    const fromSubs = cubics(from);
    const toSubs = cubics(to);

    // Both empty → nothing to morph.
    if (fromSubs.length === 0 && toSubs.length === 0) {
        return { pairs: [] };
    }

    // One side empty → collapse/grow the other against a point at its start.
    if (fromSubs.length === 0) {
        const seed = startPoint(toSubs[0].cubics);
        fromSubs.push({ cubics: degenerateSubpath(seed, 1), closed: toSubs[0].closed });
    }
    if (toSubs.length === 0) {
        const seed = startPoint(fromSubs[0].cubics);
        toSubs.push({ cubics: degenerateSubpath(seed, 1), closed: fromSubs[0].closed });
    }

    const subPairs = pairSubpaths(fromSubs, toSubs);

    const pairs = subPairs.map(({ from: f, to: t }) => {
        // Equalize cubic counts by subdividing the coarser side.
        const count = Math.max(f.cubics.length, t.cubics.length);
        const fromCubics = subdivideTo(f.cubics, count);
        let toCubics = subdivideTo(t.cubics, count);

        // Align the `to` side to the `from` side so points correspond and travel
        // the shortest path. Closed rings can rotate + reverse; open paths only
        // reverse (rotating an open path would tear it).
        const bothClosed = f.closed && t.closed;
        toCubics = bothClosed
            ? alignClosedRing(fromCubics, toCubics)
            : alignOpenSubpath(fromCubics, toCubics);

        return { from: fromCubics, to: toCubics, closed: bothClosed };
    });

    return { pairs };
}

// --- Sampling ---------------------------------------------------------------

/** Interpolate a single cubic's four points. */
function lerpCubic(from: Cubic, to: Cubic, t: number): Cubic {
    return {
        p0: lerpVector2(from.p0, to.p0, t),
        c1: lerpVector2(from.c1, to.c1, t),
        c2: lerpVector2(from.c2, to.c2, t),
        p1: lerpVector2(from.p1, to.p1, t),
    };
}

/**
 * Sample a {@link MorphPlan} at progress `t` (0 → `from`, 1 → `to`), producing a
 * fresh {@link PathCommand} list: one `M`, one `C` per cubic, and a trailing `Z`
 * for closed subpaths.
 *
 * Closed subpaths emit `Z` rather than a final line back to the start. The ring's
 * last cubic already lands on its first anchor, so `Z` adds no length; what it does
 * is tell the renderer the contour is closed, which is what makes the stroke join
 * cleanly at the seam instead of drawing two unjoined end caps there.
 */
export function sample(plan: MorphPlan, t: number): PathCommand[] {
    const out: PathCommand[] = [];
    for (const pair of plan.pairs) {
        const n = pair.from.length;
        if (n === 0) continue;
        const first = lerpCubic(pair.from[0], pair.to[0], t);
        out.push({ type: "M", x: first.p0.x, y: first.p0.y });
        out.push({ type: "C", x1: first.c1.x, y1: first.c1.y, x2: first.c2.x, y2: first.c2.y, x: first.p1.x, y: first.p1.y });
        for (let i = 1; i < n; i++) {
            const c = lerpCubic(pair.from[i], pair.to[i], t);
            out.push({ type: "C", x1: c.c1.x, y1: c.c1.y, x2: c.c2.x, y2: c.c2.y, x: c.p1.x, y: c.p1.y });
        }
        if (pair.closed) out.push({ type: "Z" });
    }
    return out;
}

// --- Public tween entry point ----------------------------------------------

/**
 * The morph plan is built from a `(from, to)` pair, which is constant for the
 * duration of one tween while `t` sweeps 0→1. {@link lerp} is invoked once
 * per frame with that same pair, so we cache the most recent plan to avoid
 * rebuilding it (subdivision + ring alignment is the costly part) every frame.
 * A one-entry cache is enough: tweens run one at a time per property and call us
 * with monotonically advancing `t` against fixed endpoints.
 */
let cachedPlan: { from: PathData; to: PathData; plan: MorphPlan } | null = null;

function planFor(from: PathData, to: PathData): MorphPlan {
    if (cachedPlan && cachedPlan.from === from && cachedPlan.to === to) {
        return cachedPlan.plan;
    }
    const built = plan(commands(from), commands(to));
    cachedPlan = { from, to, plan: built };
    return built;
}

/**
 * Smoothly interpolate between two path shapes — the {@link PathData} tween used
 * by `Path`'s animatable `d` property and usable directly as a `LerpFunction`.
 *
 * `from`/`to` may be SVG `d` strings or {@link PathCommand} arrays and need not
 * share structure, command count, subpath count, point order, or winding — the
 * shapes are reconciled into a common cubic correspondence first (see the module
 * overview). At `t = 0` and `t = 1` the endpoints are returned verbatim so the
 * start and end frames are pixel-exact; in between, a morphed command list is
 * produced.
 *
 * @param from Source path (the shape at `t = 0`).
 * @param to   Target path (the shape at `t = 1`).
 * @param t    Progress in `[0, 1]`.
 */
export function lerp(from: PathData, to: PathData, t: number): PathData {
    if (t <= 0) return from;
    if (t >= 1) return to;
    return sample(planFor(from, to), t);
}
