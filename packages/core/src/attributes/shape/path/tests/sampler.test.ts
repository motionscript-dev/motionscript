import { pathOps } from "../ops";
import { describe, it, expect } from 'vitest';

describe('createPathSampler – straight line', () => {
    it('reports the line length and samples point + tangent', () => {
        const s = pathOps.sampler('M 0 0 L 100 0');
        expect(s.length).toBeCloseTo(100, 5);

        const mid = s.frameAt(50)!;
        expect(mid.x).toBeCloseTo(50, 5);
        expect(mid.y).toBeCloseTo(0, 5);
        expect(mid.tx).toBeCloseTo(1, 5);
        expect(mid.ty).toBeCloseTo(0, 5);
    });

    it('clamps distances outside [0, length]', () => {
        const s = pathOps.sampler('M 0 0 L 100 0');
        expect(s.frameAt(-10)!.x).toBeCloseTo(0, 5);
        expect(s.frameAt(200)!.x).toBeCloseTo(100, 5);
    });

    it('accepts a PathCommand[] as well as a string', () => {
        const s = pathOps.sampler([
            { type: 'M', x: 0, y: 0 },
            { type: 'L', x: 0, y: 40 },
        ]);
        expect(s.length).toBeCloseTo(40, 5);
        const f = s.frameAt(20)!;
        expect(f.x).toBeCloseTo(0, 5);
        expect(f.y).toBeCloseTo(20, 5);
        // Tangent points down (+y) for a vertical line drawn downward.
        expect(f.tx).toBeCloseTo(0, 5);
        expect(f.ty).toBeCloseTo(1, 5);
    });
});

describe('createPathSampler – accurate arcs', () => {
    // Quarter circle, radius 100, centered at origin: from (100,0) up-and-left to
    // (0,100) via a 90° arc. Sweep=1 (clockwise in y-down space).
    const quarter = 'M 100 0 A 100 100 0 0 1 0 100';

    it('measures the arc length, not the chord', () => {
        const s = pathOps.sampler(quarter);
        const expected = (Math.PI / 2) * 100; // ~157, vs chord ~141
        expect(s.length).toBeCloseTo(expected, 0);
    });

    it('hits the endpoints at d=0 and d=length', () => {
        const s = pathOps.sampler(quarter);
        const start = s.frameAt(0)!;
        expect(start.x).toBeCloseTo(100, 0);
        expect(start.y).toBeCloseTo(0, 0);

        const end = s.frameAt(s.length)!;
        expect(end.x).toBeCloseTo(0, 0);
        expect(end.y).toBeCloseTo(100, 0);
    });

    it('samples the midpoint on the circle (tangent ⟂ radius)', () => {
        const s = pathOps.sampler(quarter);
        const mid = s.frameAt(s.length / 2)!;
        // Midpoint of the quarter circle sits at 45°: (cos45, sin45)*100.
        expect(mid.x).toBeCloseTo(Math.SQRT1_2 * 100, 0);
        expect(mid.y).toBeCloseTo(Math.SQRT1_2 * 100, 0);
        // Tangent is perpendicular to the radius. Compare the *normalized* dot
        // (cos of the angle between them); a flattened polyline tangent has a
        // sub-degree chord error, so allow a small tolerance.
        const r = Math.hypot(mid.x, mid.y);
        const cos = (mid.x * mid.tx + mid.y * mid.ty) / r; // |tangent| == 1
        expect(cos).toBeCloseTo(0, 1);
    });
});

describe('createPathSampler – multi-subpath and degenerate', () => {
    it('flows continuously across subpaths (lengths sum)', () => {
        const s = pathOps.sampler('M 0 0 L 10 0 M 100 0 L 110 0');
        expect(s.length).toBeCloseTo(20, 5);
        // d=15 lands on the second subpath: 5 units into [100,110].
        const f = s.frameAt(15)!;
        expect(f.x).toBeCloseTo(105, 5);
        expect(f.y).toBeCloseTo(0, 5);
    });

    it('returns null frames for a zero-length path', () => {
        expect(pathOps.sampler('M 5 5').frameAt(0)).toBeNull();
        expect(pathOps.sampler('').length).toBe(0);
        expect(pathOps.sampler('').frameAt(0)).toBeNull();
    });
});

describe('createPathSampler – a closed contour', () => {
    const square = 'M 0 0 L 10 0 L 10 10 L 0 10 Z';

    it('counts the closing edge in its length', () => {
        expect(pathOps.sampler(square).length).toBeCloseTo(40, 9);
    });

    it('walks the closing edge back to the start, heading along it', () => {
        const s = pathOps.sampler(square);
        const onClosing = s.frameAt(35)!;
        expect(onClosing.x).toBeCloseTo(0, 9);
        expect(onClosing.y).toBeCloseTo(5, 9);
        expect(onClosing.tx).toBeCloseTo(0, 9);
        expect(onClosing.ty).toBeCloseTo(-1, 9);
    });

    it('ends where it began', () => {
        const s = pathOps.sampler(square);
        const first = s.frameAt(0)!;
        const last = s.frameAt(s.length)!;
        expect([last.x, last.y].map((v) => Math.abs(v))).toEqual([first.x, first.y].map((v) => Math.abs(v)));
        expect(last.x).toBeCloseTo(0, 9);
        expect(last.y).toBeCloseTo(0, 9);
    });

    it('turns the tangent at a corner to the next edge', () => {
        const s = pathOps.sampler(square);
        const before = s.frameAt(9.9)!;
        const after = s.frameAt(10.1)!;
        expect([before.tx, before.ty]).toEqual([1, 0]);
        expect([after.tx, after.ty]).toEqual([0, 1]);
    });
});

describe('createPathSampler – the cursor', () => {
    const curved = 'M 0 0 L 40 0 C 60 0 60 40 40 40 L 0 40 Z';

    it('answers the same wherever it is asked from: backwards after forwards matches a fresh sampler', () => {
        const probes = [5, 35, 90, 15, 120, 0, 60, 60, 59.9, 140, 10];
        const walked = pathOps.sampler(curved);
        for (const d of probes) {
            const fresh = pathOps.sampler(curved).frameAt(d)!;
            const frame = walked.frameAt(d)!;
            expect(frame.x).toBeCloseTo(fresh.x, 9);
            expect(frame.y).toBeCloseTo(fresh.y, 9);
            expect(frame.tx).toBeCloseTo(fresh.tx, 9);
            expect(frame.ty).toBeCloseTo(fresh.ty, 9);
        }
    });

    it('resets when stepped back to the very start after running to the end', () => {
        const s = pathOps.sampler('M 0 0 L 100 0');
        expect(s.frameAt(100)!.x).toBeCloseTo(100, 9);
        expect(s.frameAt(0)!.x).toBeCloseTo(0, 9);
        expect(s.frameAt(30)!.x).toBeCloseTo(30, 9);
    });

    it('steps back across contours', () => {
        const s = pathOps.sampler('M 0 0 L 10 0 M 100 0 L 110 0');
        expect(s.frameAt(15)!.x).toBeCloseTo(105, 9);
        expect(s.frameAt(5)!.x).toBeCloseTo(5, 9);
        expect(s.frameAt(19)!.x).toBeCloseTo(109, 9);
    });

    it('lands on the second contour\'s start at exactly the first one\'s length', () => {
        const s = pathOps.sampler('M 0 0 L 10 0 M 100 0 L 110 0');
        expect(s.frameAt(10)!.x).toBeCloseTo(10, 9);
        expect(s.frameAt(10.0001)!.x).toBeCloseTo(100.0001, 6);
    });
});
