import { pathOps } from "../ops";
import { describe, it, expect } from 'vitest';
import { PathCommand } from '@/render/descriptors/path';

describe('pathOps.length', () => {
    it('returns 0 for an empty path', () => {
        expect(pathOps.length([])).toBe(0);
    });

    it('measures a single straight line', () => {
        const path: PathCommand[] = [
            { type: 'M', x: 0, y: 0 },
            { type: 'L', x: 3, y: 4 },
        ];
        expect(pathOps.length(path)).toBe(5);
    });

    it('sums H/V/Z into a closed-square perimeter', () => {
        const path: PathCommand[] = [
            { type: 'M', x: 0, y: 0 },
            { type: 'H', x: 10 },
            { type: 'V', y: 10 },
            { type: 'H', x: 0 },
            { type: 'Z' },
        ];
        expect(pathOps.length(path)).toBe(40);
    });

    it('treats a move (M) as zero-length travel', () => {
        const path: PathCommand[] = [
            { type: 'M', x: 0, y: 0 },
            { type: 'L', x: 10, y: 0 },
            { type: 'M', x: 100, y: 100 },
            { type: 'L', x: 110, y: 100 },
        ];
        expect(pathOps.length(path)).toBe(20);
    });

    it('handles relative line commands', () => {
        const path: PathCommand[] = [
            { type: 'm', x: 5, y: 5 },
            { type: 'l', x: 3, y: 4 },
        ];
        expect(pathOps.length(path)).toBe(5);
    });

    it('measures a cubic curve as positive length close to its chord for a flat curve', () => {
        const path: PathCommand[] = [
            { type: 'M', x: 0, y: 0 },
            { type: 'C', x1: 3.33, y1: 0, x2: 6.66, y2: 0, x: 10, y: 0 },
        ];
        // Control points colinear with endpoints → length equals the chord.
        expect(pathOps.length(path)).toBeCloseTo(10, 5);
    });

    it('measures an arc along the arc, not across its chord', () => {
        const path: PathCommand[] = [
            { type: 'M', x: 0, y: 0 },
            { type: 'A', rx: 5, ry: 5, rotation: 0, largeArc: 0, sweep: 1, x: 0, y: 10 },
        ];
        // A half-circle of radius 5. This used to return the chord, 10, and said
        // so — "convert arcs to cubic beziers before passing to this function".
        // `applyDashPattern` did not, and scaled its cycle against that number.
        expect(pathOps.length(path)).toBeCloseTo(Math.PI * 5, 1);
    });

    it('agrees with the sampler it shares a metric table with', () => {
        const d = 'M 0 0 A 5 5 0 0 1 0 10 L 30 10 Q 40 0 50 10';
        // To within summation order — the sampler accumulates across the whole
        // path where this sums per segment. They walk the same table, which is
        // the point: these two used to flatten at 20 steps and 50.
        expect(pathOps.length(d)).toBeCloseTo(pathOps.sampler(d).length, 9);
    });
});
