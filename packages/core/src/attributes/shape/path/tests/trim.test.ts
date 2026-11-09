import { pathOps } from "../ops";
import { describe, it, expect } from 'vitest';
import { PathCommand } from '@/render/descriptors/path';

const line: PathCommand[] = [
    { type: 'M', x: 0, y: 0 },
    { type: 'L', x: 10, y: 0 },
];

describe('extractSubpath – fast paths', () => {
    it('returns the input unchanged for the full 0..1 range', () => {
        expect(pathOps.trim(line, 0, 1)).toBe(line);
    });

    it('trims a string path, rather than passing it through', () => {
        // This used to short-circuit on `typeof d === "string"` and return the
        // whole path, so `start`/`end` did nothing at all to the most common way
        // a path is written.
        expect(pathOps.trim('M0 0 L10 0', 0.2, 0.8)).toEqual([
            { type: 'M', x: 2, y: 0 },
            { type: 'L', x: 8, y: 0 },
        ]);
    });

    it('opens a move per contour instead of joining them', () => {
        // One shared `M` across a flat segment list drew a line across the gap
        // between two contours that the source never had.
        const trimmed = pathOps.trim('M0 0 L10 0 M20 0 L30 0', 0.25, 0.75) as PathCommand[];
        expect(trimmed.filter(c => c.type === 'M')).toHaveLength(2);
    });

    it('returns the input for an empty command array', () => {
        const empty: PathCommand[] = [];
        expect(pathOps.trim(empty, 0.2, 0.8)).toBe(empty);
    });

    it('returns [] when the range is empty or inverted', () => {
        expect(pathOps.trim(line, 0.8, 0.2)).toEqual([]);
        expect(pathOps.trim(line, 0.5, 0.5)).toEqual([]);
    });
});

describe('extractSubpath – trimming a line', () => {
    it('trims the first half of a horizontal line', () => {
        const result = pathOps.trim(line, 0, 0.5) as PathCommand[];
        expect(result[0]).toEqual({ type: 'M', x: 0, y: 0 });
        expect(result[1]).toMatchObject({ type: 'L', x: 5, y: 0 });
    });

    it('trims a middle segment, starting the result at the cut point', () => {
        const result = pathOps.trim(line, 0.25, 0.75) as PathCommand[];
        const move = result[0] as Extract<PathCommand, { type: 'M' }>;
        expect(move.type).toBe('M');
        expect(move.x).toBeCloseTo(2.5, 4);
        const draw = result[1] as Extract<PathCommand, { type: 'L' }>;
        expect(draw.x).toBeCloseTo(7.5, 4);
    });

    it('clamps out-of-range start/end into 0..1', () => {
        const result = pathOps.trim(line, -1, 2);
        // -1..2 clamps to 0..1 → returns the original input.
        expect(result).toBe(line);
    });
});

describe('extractSubpath – curves', () => {
    it('emits a cubic command when trimming a cubic segment', () => {
        const cubic: PathCommand[] = [
            { type: 'M', x: 0, y: 0 },
            { type: 'C', x1: 0, y1: 10, x2: 10, y2: 10, x: 10, y: 0 },
        ];
        const result = pathOps.trim(cubic, 0.2, 0.8) as PathCommand[];
        expect(result[0].type).toBe('M');
        expect(result.some((c) => c.type === 'C')).toBe(true);
    });
});

describe('trim – an arc', () => {
    // A semicircle of radius 50 bulging to y = -50 (sweep 1 is the positive-angle direction).
    const semicircle = 'M -50 0 A 50 50 0 0 1 50 0';
    // Three quarters of a circle of radius 50 centred on (50, 50).
    const threeQuarters = 'M 50 0 A 50 50 0 1 1 0 50';

    it('stays an arc rather than being refitted with cubics', () => {
        const result = pathOps.trim(semicircle, 0.25, 0.75) as PathCommand[];
        expect(result.map((c) => c.type)).toEqual(['M', 'A']);
    });

    it('keeps the radii, the rotation and the sweep, and ends at the trimmed point of the circle', () => {
        const [move, arc] = pathOps.trim(semicircle, 0.25, 0.75) as [
            Extract<PathCommand, { type: 'M' }>, Extract<PathCommand, { type: 'A' }>,
        ];
        expect(move.x).toBeCloseTo(-50 * Math.SQRT1_2, 3);
        expect(move.y).toBeCloseTo(-50 * Math.SQRT1_2, 3);
        expect(arc).toMatchObject({ rx: 50, ry: 50, rotation: 0, largeArc: 0, sweep: 1 });
        expect(arc.x).toBeCloseTo(50 * Math.SQRT1_2, 3);
        expect(arc.y).toBeCloseTo(-50 * Math.SQRT1_2, 3);
    });

    it('lands on the circle: the trimmed ends are 50 from its centre', () => {
        const [move, arc] = pathOps.trim(semicircle, 0.1, 0.9) as [
            Extract<PathCommand, { type: 'M' }>, Extract<PathCommand, { type: 'A' }>,
        ];
        expect(Math.hypot(move.x, move.y)).toBeCloseTo(50, 2);
        expect(Math.hypot(arc.x, arc.y)).toBeCloseTo(50, 2);
    });

    it('sets the large-arc flag from the trimmed span, not the source arc\'s', () => {
        // A 270-degree arc: trimmed to its middle 80% it is 216 degrees; to its first half, 135.
        const long = pathOps.trim(threeQuarters, 0.1, 0.9) as PathCommand[];
        const short = pathOps.trim(threeQuarters, 0, 0.5) as PathCommand[];
        expect(long[1]).toMatchObject({ type: 'A', largeArc: 1, sweep: 1 });
        expect(short[1]).toMatchObject({ type: 'A', largeArc: 0, sweep: 1 });
    });

    it('ends a trim from the start at the source arc\'s start', () => {
        const result = pathOps.trim(threeQuarters, 0, 0.5) as PathCommand[];
        expect(result[0]).toEqual({ type: 'M', x: 50, y: 0 });
    });
});

describe('trim – a closed contour', () => {
    const square = 'M 0 0 L 10 0 L 10 10 L 0 10 Z';

    it('reaches the closing edge, which is part of its length', () => {
        // The 40 round includes the edge from (0, 10) home; the last half runs (10, 10) -> (0, 10) -> (0, 0).
        expect(pathOps.trim(square, 0.5, 1)).toEqual([
            { type: 'M', x: 10, y: 10 },
            { type: 'L', x: 0, y: 10 },
            { type: 'L', x: 0, y: 0 },
        ]);
    });

    it('leaves the result open: no Z even when it runs the whole way round', () => {
        const result = pathOps.trim(square, 0.01, 0.99) as PathCommand[];
        expect(result.some((c) => c.type === 'Z')).toBe(false);
        expect(result[0].type).toBe('M');
    });

    it('trims inside the closing edge alone, running from (0, 10) up to the start', () => {
        const result = pathOps.trim(square, 0.8, 0.9) as PathCommand[];
        expect(result).toHaveLength(2);
        expect(result[0]).toMatchObject({ type: 'M', x: 0 });
        expect((result[0] as Extract<PathCommand, { type: 'M' }>).y).toBeCloseTo(8, 6);
        expect(result[1]).toMatchObject({ type: 'L', x: 0 });
        expect((result[1] as Extract<PathCommand, { type: 'L' }>).y).toBeCloseTo(4, 6);
    });
});

describe('trim – a zero-length path', () => {
    it('returns the input itself, string or commands', () => {
        const lone: PathCommand[] = [{ type: 'M', x: 5, y: 5 }];
        expect(pathOps.trim('M 5 5', 0.2, 0.8)).toBe('M 5 5');
        expect(pathOps.trim(lone, 0.2, 0.8)).toBe(lone);
    });

    it('returns the input for a path whose only segment has no length', () => {
        expect(pathOps.trim('M 5 5 L 5 5', 0.2, 0.8)).toBe('M 5 5 L 5 5');
    });
});

describe('trim – several contours and mixed segments', () => {
    it('measures the fractions against the whole path, across contours', () => {
        // Two 10-long lines: the middle half is the last 5 of the first and the first 5 of the second.
        expect(pathOps.trim('M 0 0 L 10 0 M 20 0 L 30 0', 0.25, 0.75)).toEqual([
            { type: 'M', x: 5, y: 0 },
            { type: 'L', x: 10, y: 0 },
            { type: 'M', x: 20, y: 0 },
            { type: 'L', x: 25, y: 0 },
        ]);
    });

    it('splits a quadratic into a quadratic', () => {
        const result = pathOps.trim('M 0 0 Q 50 100 100 0', 0.25, 0.75) as PathCommand[];
        expect(result.map((c) => c.type)).toEqual(['M', 'Q']);
    });
});
