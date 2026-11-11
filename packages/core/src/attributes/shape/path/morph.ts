/**
 * Path morphing: interpolation between two arbitrary path shapes (the GSAP MorphSVGPlugin approach). Commands can't be
 * lerped pairwise (different counts, types, start points, winding), so both paths are reshaped into a common form:
 *  1. {@link cubics} rewrites each path as {@link CubicSubpath}s (every drawing command becomes a cubic Bézier).
 *  2. {@link plan} pairs subpaths (padding the shorter side with collapsed ones), equalizes cubic counts by
 *     subdividing the coarser along its perimeter, and rotates/reverses closed rings to start and wind together.
 *  3. {@link lerpPathData} samples that correspondence at `t`, lerping every control point.
 * The result is a {@link PathCommand} list (one `M` + N `C`s per subpath) the renderer draws unchanged.
 */
import { Vector2, lerpVector2 } from "@/attributes/layout/vector2";
import { PathCommand, PathData } from "@/render/descriptors/path";
import { distance, cubicPoint } from "./bezier";
import { commands, contourSegments, contours, segmentCubics } from "./walk";
import type { Cubic, CubicSubpath, MorphPlan } from "./types";

/** A path as cubic subpaths: one of the two boundaries where geometry is deliberately flattened to a single curve type (an arc becomes cubics here and in the anchor model only). */
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

/** Subdivides until it has exactly `target` cubics (>= current), splitting the longest segments first so added anchors land evenly along the perimeter; each becomes a correspondence point with the other shape. */
function subdivideTo(cubics: Cubic[], target: number): Cubic[] {
    let work = cubics.slice();
    while (work.length < target) {
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

function reverseCubics(cubics: Cubic[]): Cubic[] {
    const out: Cubic[] = [];
    for (let i = cubics.length - 1; i >= 0; i--) {
        const c = cubics[i];
        out.push({ p0: c.p1, c1: c.c2, c2: c.c1, p1: c.p0 });
    }
    return out;
}

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

/** Aligns a closed `to` ring against a fixed `from` ring (same cubic count): tries every rotation offset in both windings and keeps the one with least total anchor travel, so any point order or winding morphs without spinning or folding. */
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

/** For an open subpath only the winding can flip (rotating would change the shape): picks the direction whose endpoints best match `from`. */
function alignOpenSubpath(from: Cubic[], to: Cubic[]): Cubic[] {
    const reversed = reverseCubics(to);
    return anchorCost(from, to) <= anchorCost(from, reversed) ? to : reversed;
}

/** A subpath collapsed onto point `at` with `count` zero-length cubics: pairing a real subpath with one makes it grow out of / shrink into a point (added or removed subpaths). */
function degenerateSubpath(at: Vector2, count: number): Cubic[] {
    const cubics: Cubic[] = [];
    for (let i = 0; i < count; i++) {
        cubics.push({ p0: { ...at }, c1: { ...at }, c2: { ...at }, p1: { ...at } });
    }
    return cubics;
}

/** Greedily pairs `from` subpaths with the nearest unused `to` subpath (by centroid), not by list order. Leftovers on either side pair with a degenerate partner at their own centroid and grow/shrink in place. */
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

/** Builds a reusable {@link MorphPlan}. All the expensive work (cubics, pairing, equalizing, ring alignment) happens once here; {@link sample} is cheap per frame. */
export function plan(from: PathCommand[], to: PathCommand[]): MorphPlan {
    const fromSubs = cubics(from);
    const toSubs = cubics(to);

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

function lerpCubic(from: Cubic, to: Cubic, t: number): Cubic {
    return {
        p0: lerpVector2(from.p0, to.p0, t),
        c1: lerpVector2(from.c1, to.c1, t),
        c2: lerpVector2(from.c2, to.c2, t),
        p1: lerpVector2(from.p1, to.p1, t),
    };
}

/** Samples a {@link MorphPlan} at progress `t` into a fresh {@link PathCommand} list. Closed subpaths end with `Z` rather than a line back to the start: the last cubic already lands on the first anchor, and `Z` makes the stroke join cleanly at the seam instead of two unjoined caps. */
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

/** One-entry plan cache: a tween holds its `(from, to)` pair fixed while `t` sweeps 0→1 and {@link lerp} runs per frame, so rebuilding (subdivision + ring alignment) every frame is avoided. */
let cachedPlan: { from: PathData; to: PathData; plan: MorphPlan } | null = null;

function planFor(from: PathData, to: PathData): MorphPlan {
    if (cachedPlan && cachedPlan.from === from && cachedPlan.to === to) {
        return cachedPlan.plan;
    }
    const built = plan(commands(from), commands(to));
    cachedPlan = { from, to, plan: built };
    return built;
}

/** The {@link PathData} tween used by `Path`'s animatable `d` (usable as a `LerpFunction`). Endpoints need not share structure; they are reconciled into a cubic correspondence. At `t = 0` and `1` the endpoints are returned verbatim so the first and last frames are pixel-exact. */
export function lerp(from: PathData, to: PathData, t: number): PathData {
    if (t <= 0) return from;
    if (t >= 1) return to;
    return sample(planFor(from, to), t);
}
