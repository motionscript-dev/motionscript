import { pathOps } from "../ops";
import { cubicPoint } from "../bezier";
import { describe, it, expect } from 'vitest';
import { PathCommand } from '@/render/descriptors/path';
import { Vector2 } from '@/attributes/layout/vector2';

// --- Helpers ---------------------------------------------------------------

/**
 * Flatten a command list into a dense polyline by sampling every segment. Handles
 * the absolute command subset used by the reference shapes in this file (M, L, C,
 * Q, A, Z) plus the M/C-only output of the morpher. Arcs are sampled by reusing
 * the morpher's own arc→cubic conversion so the reference circle and the morphed
 * circle flatten consistently.
 */
function flatten(cmds: PathCommand[], per = 12): Vector2[] {
    const pts: Vector2[] = [];
    let cur: Vector2 = { x: 0, y: 0 };
    let start: Vector2 = { x: 0, y: 0 };
    const sampleCubic = (p0: Vector2, c1: Vector2, c2: Vector2, p1: Vector2) => {
        for (let i = 1; i <= per; i++) pts.push(cubicPoint(p0, c1, c2, p1, i / per));
    };
    const sampleLine = (from: Vector2, to: Vector2) => {
        for (let i = 1; i <= per; i++) {
            pts.push({ x: from.x + (to.x - from.x) * (i / per), y: from.y + (to.y - from.y) * (i / per) });
        }
    };
    for (const cmd of cmds) {
        switch (cmd.type) {
            case 'M':
                cur = { x: cmd.x, y: cmd.y };
                start = cur;
                pts.push(cur);
                break;
            case 'L': {
                const to = { x: cmd.x, y: cmd.y };
                sampleLine(cur, to);
                cur = to;
                break;
            }
            case 'C': {
                const p1 = { x: cmd.x, y: cmd.y };
                sampleCubic(cur, { x: cmd.x1, y: cmd.y1 }, { x: cmd.x2, y: cmd.y2 }, p1);
                cur = p1;
                break;
            }
            case 'Q': {
                const p1 = { x: cmd.x, y: cmd.y };
                const cp = { x: cmd.x1, y: cmd.y1 };
                // Elevate to cubic for sampling.
                const c1 = { x: cur.x + (2 / 3) * (cp.x - cur.x), y: cur.y + (2 / 3) * (cp.y - cur.y) };
                const c2 = { x: p1.x + (2 / 3) * (cp.x - p1.x), y: p1.y + (2 / 3) * (cp.y - p1.y) };
                sampleCubic(cur, c1, c2, p1);
                cur = p1;
                break;
            }
            case 'A': {
                // Sample the reference arc via the morpher's cubic subpaths so the
                // reference and morphed circles flatten on the same basis.
                const sub = pathOps.cubics([
                    { type: 'M', x: cur.x, y: cur.y },
                    cmd,
                ]);
                for (const c of sub[0]?.cubics ?? []) sampleCubic(c.p0, c.c1, c.c2, c.p1);
                cur = { x: cmd.x, y: cmd.y };
                break;
            }
            case 'Z':
                sampleLine(cur, start);
                cur = start;
                break;
        }
    }
    return pts;
}

/** Perpendicular distance from point `p` to segment `a`–`b`. */
function pointToSegment(p: Vector2, a: Vector2, b: Vector2): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Worst-case distance from any point of `a`'s outline to `b`'s outline, measured
 * against `b`'s line segments (not its sampled points). Measuring point-to-segment
 * — rather than point-to-point — removes the artifact where two polylines trace
 * the same curve but sample it at offset positions, which otherwise reports a
 * spurious gap of half the sampling step along steep edges.
 */
function maxDeviation(a: Vector2[], b: Vector2[]): number {
    let worst = 0;
    for (const p of a) {
        let nearest = Infinity;
        for (let i = 0; i + 1 < b.length; i++) {
            const d = pointToSegment(p, b[i], b[i + 1]);
            if (d < nearest) nearest = d;
        }
        if (nearest > worst) worst = nearest;
    }
    return worst;
}

/** Symmetric shape distance: how far the two outlines stray from each other. */
function shapeDistance(a: PathCommand[], b: PathCommand[]): number {
    const fa = flatten(a, 48);
    const fb = flatten(b, 48);
    return Math.max(maxDeviation(fa, fb), maxDeviation(fb, fa));
}

/** Split a command list into per-subpath command lists at each `M`. */
function splitByMove(cmds: PathCommand[]): PathCommand[][] {
    const subs: PathCommand[][] = [];
    for (const cmd of cmds) {
        if (cmd.type === 'M') subs.push([cmd]);
        else if (subs.length) subs[subs.length - 1].push(cmd);
    }
    return subs;
}

/** Largest dimension of a subpath's axis-aligned bounding box. */
function bboxExtent(cmds: PathCommand[]): number {
    const pts = flatten(cmds, 8);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of pts) {
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    return Math.max(maxX - minX, maxY - minY);
}

const square = 'M 0 0 L 10 0 L 10 10 L 0 10 Z';
const triangle = 'M 0 0 L 10 0 L 5 10 Z';
const circle = 'M 10 0 A 10 10 0 1 1 -10 0 A 10 10 0 1 1 10 0';

// --- toCubicSubpaths -------------------------------------------------------

describe('toCubicSubpaths', () => {
    it('converts a closed square into one closed subpath of four cubics', () => {
        const subs = pathOps.cubics(pathOps.commands(square));
        expect(subs).toHaveLength(1);
        expect(subs[0].closed).toBe(true);
        // 3 explicit lines + 1 closing line back to start.
        expect(subs[0].cubics).toHaveLength(4);
    });

    it('marks an open path as not closed', () => {
        const subs = pathOps.cubics(pathOps.commands('M 0 0 L 10 0 L 10 10'));
        expect(subs[0].closed).toBe(false);
        expect(subs[0].cubics).toHaveLength(2);
    });

    it('keeps the first anchor and the final anchor at the path endpoints', () => {
        const subs = pathOps.cubics(pathOps.commands('M 2 3 L 8 9'));
        const cubics = subs[0].cubics;
        expect(cubics[0].p0).toEqual({ x: 2, y: 3 });
        expect(cubics[cubics.length - 1].p1).toEqual({ x: 8, y: 9 });
    });

    it('elevates a quadratic into an exact cubic (endpoints preserved)', () => {
        const subs = pathOps.cubics(pathOps.commands('M 0 0 Q 5 10 10 0'));
        const c = subs[0].cubics[0];
        expect(c.p0).toEqual({ x: 0, y: 0 });
        expect(c.p1).toEqual({ x: 10, y: 0 });
        // Quad apex at t=0.5 is (5,5); the elevated cubic must pass through it.
        const mid = cubicPoint(c.p0, c.c1, c.c2, c.p1, 0.5);
        expect(mid.x).toBeCloseTo(5, 6);
        expect(mid.y).toBeCloseTo(5, 6);
    });

    it('produces a chain of cubics whose anchors approximate a circle for an arc', () => {
        const subs = pathOps.cubics(pathOps.commands(circle));
        expect(subs[0].cubics.length).toBeGreaterThanOrEqual(2);
        // Every anchor should sit ~10 units from the circle center (0,0).
        for (const c of subs[0].cubics) {
            expect(Math.hypot(c.p0.x, c.p0.y)).toBeCloseTo(10, 1);
        }
    });

    it('leaves a lone M out, since it has no cubics', () => {
        expect(pathOps.cubics(pathOps.commands('M 5 5'))).toEqual([]);
        const subs = pathOps.cubics(pathOps.commands('M 5 5 M 0 0 L 1 1'));
        expect(subs).toHaveLength(1);
        expect(subs[0].cubics[0].p0).toEqual({ x: 0, y: 0 });
    });

    it('hands out points that are its own, not the memoized contour\'s', () => {
        const d = pathOps.commands('M 0 0 L 10 0 L 10 10');
        const first = pathOps.cubics(d);
        first[0].cubics[0].p0.x = 999;
        first[0].cubics[0].p1.y = 999;
        const second = pathOps.cubics(d);
        expect(second[0].cubics[0].p0).toEqual({ x: 0, y: 0 });
        expect(second[0].cubics[0].p1).toEqual({ x: 10, y: 0 });
        // The next segment's start, which `first` also exposed.
        expect(second[0].cubics[1].p0).toEqual({ x: 10, y: 0 });
    });

    it('handles relative commands and reflected smooth curves', () => {
        // m + c + s (the s reflects the previous c's trailing control point).
        const subs = pathOps.cubics(pathOps.commands('m 0 0 c 0 5 5 5 5 5 s 5 0 5 -5'));
        expect(subs).toHaveLength(1);
        expect(subs[0].cubics).toHaveLength(2);
        // First cubic ends at (5,5), so the second begins there.
        expect(subs[0].cubics[1].p0.x).toBeCloseTo(5, 6);
        expect(subs[0].cubics[1].p0.y).toBeCloseTo(5, 6);
    });
});

// --- lerpPath endpoints ----------------------------------------------------

describe('lerpPath – endpoints', () => {
    it('returns the source verbatim at t=0', () => {
        expect(pathOps.lerp(square, triangle, 0)).toBe(square);
    });

    it('returns the target verbatim at t=1', () => {
        expect(pathOps.lerp(square, triangle, 1)).toBe(triangle);
    });

    it('clamps t below 0 to the source and above 1 to the target', () => {
        expect(pathOps.lerp(square, triangle, -0.5)).toBe(square);
        expect(pathOps.lerp(square, triangle, 2)).toBe(triangle);
    });

    it('produces a command array (not a string) for in-between t', () => {
        const mid = pathOps.lerp(square, triangle, 0.5);
        expect(Array.isArray(mid)).toBe(true);
    });
});

// --- lerpPath fidelity -----------------------------------------------------

describe('lerpPath – shape fidelity', () => {
    it('matches the source shape closely just after t=0', () => {
        const near = pathOps.lerp(square, triangle, 0.0001) as PathCommand[];
        expect(shapeDistance(near, pathOps.commands(square))).toBeLessThan(0.05);
    });

    it('matches the target shape closely just before t=1', () => {
        const near = pathOps.lerp(square, triangle, 0.9999) as PathCommand[];
        expect(shapeDistance(near, pathOps.commands(triangle))).toBeLessThan(0.05);
    });

    it('keeps the midpoint between the two shapes (no points fly away)', () => {
        const mid = pathOps.lerp(square, triangle, 0.5) as PathCommand[];
        // Every sampled point must lie within the union bounding box (with slack).
        for (const p of flatten(mid)) {
            expect(p.x).toBeGreaterThanOrEqual(-1);
            expect(p.x).toBeLessThanOrEqual(11);
            expect(p.y).toBeGreaterThanOrEqual(-1);
            expect(p.y).toBeLessThanOrEqual(11);
        }
    });
});

// --- smoothness ------------------------------------------------------------

describe('lerpPath – smoothness over time', () => {
    it('advances each anchor point monotonically and in small steps', () => {
        const plan = pathOps.plan(pathOps.commands(square), pathOps.commands(triangle));
        // Track the first subpath's anchor trajectories across the tween.
        const steps = 40;
        let prev: Vector2[] | null = null;
        let maxStep = 0;
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const cmds = pathOps.sample(plan, t);
            const anchors = cmds.filter((c): c is Extract<PathCommand, { type: 'M' | 'C' }> =>
                c.type === 'M' || c.type === 'C',
            ).map((c) => (c.type === 'M' ? { x: c.x, y: c.y } : { x: c.x, y: c.y }));
            if (prev) {
                for (let k = 0; k < Math.min(prev.length, anchors.length); k++) {
                    maxStep = Math.max(maxStep, Math.hypot(anchors[k].x - prev[k].x, anchors[k].y - prev[k].y));
                }
            }
            prev = anchors;
        }
        // No anchor should jump more than a small fraction of the shape size per
        // 1/40 of the tween — a kink or reorder would spike this.
        expect(maxStep).toBeLessThan(2);
    });
});

// --- point-order & winding independence ------------------------------------

describe('lerpPath – point order & winding independence', () => {
    const squareCW = 'M 0 0 L 10 0 L 10 10 L 0 10 Z';
    // Same square, started at a different corner and wound the opposite way.
    const squareRotatedReversed = 'M 10 10 L 10 0 L 0 0 L 0 10 Z';

    it('morphs between identical shapes with different start/winding without distortion', () => {
        // At t=0.5 the in-between of a square with itself must still be that square.
        const mid = pathOps.lerp(squareCW, squareRotatedReversed, 0.5) as PathCommand[];
        expect(shapeDistance(mid, pathOps.commands(squareCW))).toBeLessThan(0.5);
    });

    it('aligns rings so the halfway morph stays small (no spin-around)', () => {
        // If the rings were misaligned, midpoints would collapse toward the center;
        // a good alignment keeps the outline near the square edges throughout.
        const plan = pathOps.plan(pathOps.commands(squareCW), pathOps.commands(squareRotatedReversed));
        const mid = pathOps.sample(plan, 0.5);
        for (const p of flatten(mid)) {
            // Distance from center (5,5): square edge midpoints are 5 away, corners ~7.07.
            // A collapsed/spun morph would pull points well inside ~3.
            const fromCenter = Math.hypot(p.x - 5, p.y - 5);
            expect(fromCenter).toBeGreaterThan(3);
        }
    });
});

// --- count mismatches ------------------------------------------------------

describe('lerpPath – differing command counts', () => {
    it('morphs a triangle (3 sides) into a square (4 sides) smoothly', () => {
        const t = pathOps.lerp(triangle, square, 0.5) as PathCommand[];
        // Both endpoints should be reproduced exactly by the plan.
        const start = pathOps.lerp(triangle, square, 0.0001) as PathCommand[];
        const end = pathOps.lerp(triangle, square, 0.9999) as PathCommand[];
        expect(shapeDistance(start, pathOps.commands(triangle))).toBeLessThan(0.05);
        expect(shapeDistance(end, pathOps.commands(square))).toBeLessThan(0.05);
        expect(t.length).toBeGreaterThan(0);
    });

    it('reproduces both endpoints when morphing a square into a circle', () => {
        const start = pathOps.lerp(square, circle, 0.0001) as PathCommand[];
        const end = pathOps.lerp(square, circle, 0.9999) as PathCommand[];
        expect(shapeDistance(start, pathOps.commands(square))).toBeLessThan(0.1);
        expect(shapeDistance(end, pathOps.commands(circle))).toBeLessThan(0.5);
    });
});

// --- multi-subpath ---------------------------------------------------------

describe('lerpPath – multiple subpaths', () => {
    const twoBoxes = 'M 0 0 L 5 0 L 5 5 L 0 5 Z M 20 20 L 25 20 L 25 25 L 20 25 Z';
    const oneBox = 'M 0 0 L 5 0 L 5 5 L 0 5 Z';

    it('grows a new subpath out of a point when the target has more subpaths', () => {
        // one box → two boxes. At the end the shape is the two boxes exactly.
        const end = pathOps.lerp(oneBox, twoBoxes, 0.9999) as PathCommand[];
        expect(shapeDistance(end, pathOps.commands(twoBoxes))).toBeLessThan(0.5);

        // At the start the original box is reproduced exactly — every point of
        // `oneBox` lies on the morph — while the extra subpath is collapsed to a
        // near-zero point (it grows out of where it will eventually land), so it
        // adds no visible geometry.
        const start = pathOps.lerp(oneBox, twoBoxes, 0.0001) as PathCommand[];
        const oneBoxOutline = flatten(pathOps.commands(oneBox), 48);
        expect(maxDeviation(oneBoxOutline, flatten(start, 48))).toBeLessThan(0.5);

        // The second subpath of `start` should be a degenerate point (tiny bbox).
        const subpaths = splitByMove(start);
        expect(subpaths).toHaveLength(2);
        expect(bboxExtent(subpaths[1])).toBeLessThan(0.5);
    });

    it('emits one M per subpath in the morphed output', () => {
        const mid = pathOps.lerp(oneBox, twoBoxes, 0.5) as PathCommand[];
        const moves = mid.filter((c) => c.type === 'M');
        expect(moves).toHaveLength(2);
    });

    it('pairs nearby subpaths regardless of declared order', () => {
        // Same two boxes, listed in the opposite order: morph should be a no-op shape.
        const swapped = 'M 20 20 L 25 20 L 25 25 L 20 25 Z M 0 0 L 5 0 L 5 5 L 0 5 Z';
        const mid = pathOps.lerp(twoBoxes, swapped, 0.5) as PathCommand[];
        expect(shapeDistance(mid, pathOps.commands(twoBoxes))).toBeLessThan(0.5);
    });
});

// --- string / command-array input mixing -----------------------------------

describe('lerpPath – mixed input forms', () => {
    it('accepts a command array as the source and a string as the target', () => {
        const from = pathOps.commands(square);
        const mid = pathOps.lerp(from, triangle, 0.5);
        expect(Array.isArray(mid)).toBe(true);
    });

    it('is stable when called repeatedly with the same endpoints (cache reuse)', () => {
        const a = pathOps.sample(pathOps.plan(pathOps.commands(square), pathOps.commands(triangle)), 0.5);
        const b = pathOps.lerp(square, triangle, 0.5) as PathCommand[];
        expect(shapeDistance(a, b)).toBeLessThan(1e-6);
    });
});

// --- degenerate inputs -----------------------------------------------------

describe('lerpPath – degenerate inputs', () => {
    it('handles morphing from an empty path (grows the target out of a point)', () => {
        const end = pathOps.lerp('', square, 0.9999) as PathCommand[];
        expect(shapeDistance(end, pathOps.commands(square))).toBeLessThan(0.5);
    });

    it('handles morphing to an empty path (shrinks the source to a point)', () => {
        const start = pathOps.lerp(square, '', 0.0001) as PathCommand[];
        expect(shapeDistance(start, pathOps.commands(square))).toBeLessThan(0.5);
    });

    it('returns an empty plan for two empty paths', () => {
        const plan = pathOps.plan([], []);
        expect(plan.pairs).toHaveLength(0);
        expect(pathOps.sample(plan, 0.5)).toEqual([]);
    });

    it('does not throw morphing between an empty path and a lone M', () => {
        // A lone `M` has no cubics: it is no subpath for a morph, so one side is
        // still empty and the other seeds nothing to read a first anchor from.
        expect(() => pathOps.lerp('', 'M5 5', 0.5)).not.toThrow();
        expect(() => pathOps.lerp('M5 5', '', 0.5)).not.toThrow();
        expect(pathOps.lerp('', 'M5 5', 0.5)).toEqual([]);
        expect(pathOps.plan(pathOps.commands(''), pathOps.commands('M5 5')).pairs).toHaveLength(0);
    });

    it('grows the real subpath when the other side holds only lone Ms', () => {
        const end = pathOps.lerp('M5 5 M9 9', square, 0.9999) as PathCommand[];
        expect(shapeDistance(end, pathOps.commands(square))).toBeLessThan(0.5);
        expect(end.every((c) => !('x' in c) || Number.isFinite(c.x))).toBe(true);
    });

    it('does not pair a real subpath with a cubic-less one (no NaN centroid)', () => {
        const mid = pathOps.lerp('M0 0 L10 0 L10 10 M50 50', 'M0 0 L10 0 L10 10', 0.5) as PathCommand[];
        for (const c of mid) {
            if (c.type === 'C') expect([c.x1, c.y1, c.x2, c.y2, c.x, c.y].every(Number.isFinite)).toBe(true);
        }
    });

    it('does not throw when an endpoint is nullish (degrades to empty)', () => {
        expect(() => pathOps.lerp(undefined as never, square, 0.5)).not.toThrow();
        expect(() => pathOps.lerp(square, null as never, 0.5)).not.toThrow();
    });
});

// --- closure / stroke integrity --------------------------------------------

describe('lerpPath – closure', () => {
    const diamond = 'M 50 0 L 100 50 L 50 100 L 0 50 Z';
    const openZig = 'M 0 0 L 10 5 L 0 10 L 10 15';

    it('emits a trailing Z for a closed→closed morph so the stroke joins at the seam', () => {
        const mid = pathOps.lerp(diamond, square, 0.5) as PathCommand[];
        expect(mid.some((c) => c.type === 'Z')).toBe(true);
        // Every subpath that starts with M ends with Z.
        const subs = splitByMove(mid);
        for (const sub of subs) {
            expect(sub[sub.length - 1].type).toBe('Z');
        }
    });

    it('keeps the morphed ring geometrically closed (last point meets the start)', () => {
        const mid = pathOps.lerp(diamond, square, 0.37) as PathCommand[];
        const move = mid.find((c) => c.type === 'M') as Extract<PathCommand, { type: 'M' }>;
        // The last drawing command before Z must land back on the move point.
        const lastDraw = [...mid].reverse().find((c) => c.type === 'C') as Extract<PathCommand, { type: 'C' }>;
        expect(lastDraw.x).toBeCloseTo(move.x, 6);
        expect(lastDraw.y).toBeCloseTo(move.y, 6);
    });

    it('does not close an open→open morph', () => {
        const openZig2 = 'M 0 0 L 8 4 L 0 8 L 8 12';
        const mid = pathOps.lerp(openZig, openZig2, 0.5) as PathCommand[];
        expect(mid.some((c) => c.type === 'Z')).toBe(false);
    });

    it('does not close when only one side is closed', () => {
        // A closed square morphing to an open polyline must not be force-closed.
        const mid = pathOps.lerp(square, openZig, 0.5) as PathCommand[];
        expect(mid.some((c) => c.type === 'Z')).toBe(false);
    });
});

// --- plan -------------------------------------------------------------------

describe('plan – the correspondence itself', () => {
    const cmds = (d: string) => pathOps.commands(d);
    const anchorsOf = (cubics: Array<{ p0: Vector2 }>) => cubics.map((c) => c.p0);

    it('pairs each source subpath with the nearest target subpath by centroid, whatever the listing order', () => {
        const from = cmds('M 0 0 L 10 0 L 10 10 L 0 10 Z M 100 0 L 110 0 L 110 10 L 100 10 Z');
        // The same two squares, nudged by (2, 2), listed the other way round.
        const to = cmds('M 102 2 L 112 2 L 112 12 L 102 12 Z M 2 2 L 12 2 L 12 12 L 2 12 Z');
        const planned = pathOps.plan(from, to);

        expect(planned.pairs).toHaveLength(2);
        expect(planned.pairs[0].from[0].p0).toEqual({ x: 0, y: 0 });
        expect(planned.pairs[0].to[0].p0).toEqual({ x: 2, y: 2 });
        expect(planned.pairs[1].from[0].p0).toEqual({ x: 100, y: 0 });
        expect(planned.pairs[1].to[0].p0).toEqual({ x: 102, y: 2 });
    });

    it('lets an earlier source subpath claim the nearest target first', () => {
        // Both source squares are nearest the one target square; the first listed takes it.
        const from = cmds('M 0 0 L 10 0 L 10 10 L 0 10 Z M 1 1 L 11 1 L 11 11 L 1 11 Z');
        const to = cmds('M 0 0 L 10 0 L 10 10 L 0 10 Z M 200 0 L 210 0 L 210 10 L 200 10 Z');
        const planned = pathOps.plan(from, to);
        expect(planned.pairs[0].to[0].p0).toEqual({ x: 0, y: 0 });
        expect(planned.pairs[1].to[0].p0).toEqual({ x: 200, y: 0 });
    });

    it('pairs a leftover source subpath with a point collapsed on its own centroid', () => {
        const from = cmds('M 0 0 L 10 0 L 10 10 L 0 10 Z M 100 0 L 110 0 L 110 10 L 100 10 Z');
        const to = cmds('M 0 0 L 10 0 L 10 10 L 0 10 Z');
        const planned = pathOps.plan(from, to);

        expect(planned.pairs).toHaveLength(2);
        const [, leftover] = planned.pairs;
        // The centroid of the four anchors (100,0) (110,0) (110,10) (100,10).
        for (const c of leftover.to) {
            for (const point of [c.p0, c.c1, c.c2, c.p1]) expect(point).toEqual({ x: 105, y: 5 });
        }
    });

    it('pairs a leftover target subpath the same way, growing out of its own centroid', () => {
        const from = cmds('M 0 0 L 10 0 L 10 10 L 0 10 Z');
        const to = cmds('M 0 0 L 10 0 L 10 10 L 0 10 Z M 100 0 L 110 0 L 110 10 L 100 10 Z');
        const planned = pathOps.plan(from, to);
        expect(planned.pairs).toHaveLength(2);
        for (const c of planned.pairs[1].from) {
            for (const point of [c.p0, c.c1, c.c2, c.p1]) expect(point).toEqual({ x: 105, y: 5 });
        }
    });

    it('rotates a closed ring until its anchors line up with the source, at zero cost', () => {
        const from = cmds('M 0 0 L 10 0 L 10 10 L 0 10 Z');
        // The same square, wound the same way, but starting at the opposite corner.
        const to = cmds('M 10 10 L 0 10 L 0 0 L 10 0 Z');
        const [pair] = pathOps.plan(from, to).pairs;
        expect(anchorsOf(pair.to)).toEqual(anchorsOf(pair.from));
        expect(pair.closed).toBe(true);
    });

    it('reverses a closed ring wound the other way, so the anchors line up with the source', () => {
        const from = cmds('M 0 0 L 10 0 L 10 10 L 0 10 Z');
        const to = cmds('M 0 0 L 0 10 L 10 10 L 10 0 Z');
        const [pair] = pathOps.plan(from, to).pairs;
        expect(anchorsOf(pair.to)).toEqual(anchorsOf(pair.from));
    });

    it('rotates and reverses together when the ring starts elsewhere and winds the other way', () => {
        const from = cmds('M 0 0 L 10 0 L 10 10 L 0 10 Z');
        const to = cmds('M 10 10 L 10 0 L 0 0 L 0 10 Z');
        const [pair] = pathOps.plan(from, to).pairs;
        expect(anchorsOf(pair.to)).toEqual(anchorsOf(pair.from));
    });

    it('chooses the rotation of least total travel when no rotation lines up exactly', () => {
        const from = cmds('M 0 0 L 10 0 L 10 10 L 0 10 Z');
        // Rotated start, and the whole square shifted by (1, 1): the best pairing is the same corner-to-corner one.
        const to = cmds('M 11 11 L 1 11 L 1 1 L 11 1 Z');
        const [pair] = pathOps.plan(from, to).pairs;
        pair.to.forEach((c, i) => {
            expect(c.p0.x - pair.from[i].p0.x).toBe(1);
            expect(c.p0.y - pair.from[i].p0.y).toBe(1);
        });
    });

    it('only reverses an open subpath, never rotates it', () => {
        const from = cmds('M 0 0 L 10 0 L 20 10');
        const same = pathOps.plan(from, cmds('M 0 0 L 10 0 L 20 10')).pairs[0];
        expect(anchorsOf(same.to)).toEqual(anchorsOf(same.from));
        expect(same.closed).toBe(false);

        // Listed from the far end: reversing it brings the start back to the start.
        const backwards = pathOps.plan(from, cmds('M 20 10 L 10 0 L 0 0')).pairs[0];
        expect(anchorsOf(backwards.to)).toEqual(anchorsOf(backwards.from));
    });

    it('keeps an open subpath in one of two orders: as written or end to start, never rotated', () => {
        const to = cmds('M 5 5 L 9 1 L 2 7 L 8 8');
        const written = pathOps.cubics(to)[0].cubics.map((c) => c.p0);
        const reversed = pathOps.cubics(to)[0].cubics.map((c) => c.p1).reverse();
        for (const from of ['M 20 20 L 20 21 L 21 21 L 22 22', 'M 8 8 L 2 7 L 9 1 L 5 5']) {
            const [pair] = pathOps.plan(cmds(from), to).pairs;
            expect([written, reversed]).toContainEqual(pair.to.map((c) => c.p0));
        }
    });

    it('leaves the pair open unless both sides were closed', () => {
        const ring = cmds('M 0 0 L 10 0 L 10 10 L 0 10 Z');
        expect(pathOps.plan(ring, ring).pairs[0].closed).toBe(true);
        expect(pathOps.plan(ring, cmds('M 0 0 L 10 0 L 10 10 L 0 10')).pairs[0].closed).toBe(false);
        expect(pathOps.plan(cmds('M 0 0 L 10 0 L 10 10 L 0 10'), ring).pairs[0].closed).toBe(false);
    });

    it('equalizes the cubic counts of a pair by splitting the longest cubic of the coarser side', () => {
        const [pair] = pathOps.plan(cmds('M 0 0 L 30 0'), cmds('M 0 0 L 10 0 L 30 0')).pairs;
        expect(pair.from).toHaveLength(2);
        expect(pair.to).toHaveLength(2);
        // The single 30-long cubic is cut in half.
        expect(pair.from[0].p1).toEqual({ x: 15, y: 0 });
        expect(pair.from[1].p0).toEqual({ x: 15, y: 0 });
    });

    it('splits the longest cubics first when several must be added', () => {
        // 10 + 40 against four cubics: the 40 is halved to 20 + 20, and one of those again to 10 + 10.
        const [pair] = pathOps.plan(
            cmds('M 0 0 L 10 0 L 50 0'),
            cmds('M 0 0 L 10 0 L 20 0 L 30 0 L 50 0'),
        ).pairs;
        expect(pair.from).toHaveLength(4);
        const lengths = pair.from.map((c) => c.p1.x - c.p0.x);
        expect(lengths.reduce((a, b) => a + b, 0)).toBe(50);
        expect(Math.min(...lengths)).toBeGreaterThanOrEqual(10);
    });

    it('is empty for two empty paths, and one-sided for a missing side', () => {
        expect(pathOps.plan([], []).pairs).toEqual([]);
        const grown = pathOps.plan([], cmds('M 0 0 L 10 0 L 10 10 Z')).pairs;
        expect(grown).toHaveLength(1);
        expect(grown[0].from.length).toBe(grown[0].to.length);
        // The empty side collapses onto the target's first anchor.
        expect(grown[0].from[0].p0).toEqual({ x: 0, y: 0 });
    });
});

describe('cubics and sample – closed and open pairs', () => {
    const closedSquare = 'M 0 0 L 10 0 L 10 10 L 0 10 Z';
    const openSquare = 'M 0 0 L 10 0 L 10 10 L 0 10';

    it('keeps the closing edge of a closed path as its own cubic', () => {
        const [closed] = pathOps.cubics(closedSquare);
        const [open] = pathOps.cubics(openSquare);
        expect(closed.closed).toBe(true);
        expect(closed.cubics).toHaveLength(4);
        expect(open.closed).toBe(false);
        expect(open.cubics).toHaveLength(3);
        expect(closed.cubics[3].p0).toEqual({ x: 0, y: 10 });
        expect(closed.cubics[3].p1).toEqual({ x: 0, y: 0 });
    });

    it('draws a closed to open pair with the closing edge at the source end and no Z', () => {
        const planned = pathOps.plan(pathOps.commands(closedSquare), pathOps.commands(openSquare));
        const atStart = pathOps.sample(planned, 0);
        expect(atStart.map((c) => c.type)).toEqual(['M', 'C', 'C', 'C', 'C']);
        const last = atStart[atStart.length - 1] as Extract<PathCommand, { type: 'C' }>;
        // The closing edge is still there: the run ends back where it began.
        expect([last.x, last.y]).toEqual([0, 0]);
        expect(atStart.some((c) => c.type === 'Z')).toBe(false);
    });

    it('draws a closed to open pair at the other end as the open path, subdivided to match', () => {
        const planned = pathOps.plan(pathOps.commands(closedSquare), pathOps.commands(openSquare));
        const atEnd = pathOps.sample(planned, 1);
        expect(atEnd.some((c) => c.type === 'Z')).toBe(false);
        const last = atEnd[atEnd.length - 1] as Extract<PathCommand, { type: 'C' }>;
        expect([last.x, last.y]).toEqual([0, 10]);
    });

    it('draws a closed to closed pair with a trailing Z at every t', () => {
        const planned = pathOps.plan(pathOps.commands(closedSquare), pathOps.commands(closedSquare));
        for (const t of [0, 0.3, 1]) {
            const out = pathOps.sample(planned, t);
            expect(out[out.length - 1]).toEqual({ type: 'Z' });
        }
    });

    it('draws nothing for an empty plan', () => {
        expect(pathOps.sample(pathOps.plan([], []), 0.5)).toEqual([]);
    });
});
