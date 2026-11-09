import { pathOps } from "../ops";
import { describe, it, expect } from 'vitest';
import { PathCommand } from '@/render/descriptors/path';

const line: PathCommand[] = [
    { type: 'M', x: 0, y: 0 },
    { type: 'L', x: 100, y: 0 },
];

describe('applyDashPattern – guards', () => {
    it('returns empty string for an empty dash array', () => {
        expect(pathOps.dash(line, [])).toBe('');
    });

    it('returns empty string when the dash cycle sums to zero', () => {
        expect(pathOps.dash(line, [0, 0])).toBe('');
    });

    it('returns empty string for a zero-length path', () => {
        const point: PathCommand[] = [{ type: 'M', x: 5, y: 5 }];
        expect(pathOps.dash(point, [4, 4])).toBe('');
    });
});

describe('applyDashPattern – output', () => {
    it('produces an SVG path string containing move and line commands', () => {
        const out = pathOps.dash(line, [10, 10]);
        expect(out).toMatch(/M /);
        expect(out).toMatch(/L /);
    });

    it('begins drawing (an "on" run) at the path start', () => {
        const out = pathOps.dash(line, [10, 10]);
        expect(out.trimStart().startsWith('M')).toBe(true);
    });

    it('emits dashes only along an "on" run, leaving gaps for "off"', () => {
        // A coarse pattern over a 100px line should yield multiple separate runs.
        const out = pathOps.dash(line, [10, 10]);
        const moveCount = (out.match(/M /g) ?? []).length;
        expect(moveCount).toBeGreaterThan(1);
    });

    it('ends an open path on a dash, as it starts on one', () => {
        // Whole cycles would end 100px on a gap; six dashes and five gaps fit.
        const out = pathOps.dash(line, [10, 10]);
        expect((out.match(/M /g) ?? []).length).toBe(6);
        expect(out.trimEnd().endsWith('L 100 0')).toBe(true);
    });

    it('draws a zero-length dash as a dot, one on each end of an open path', () => {
        // Each dot is a sliver along the path so its cap has a direction.
        const runs = pathOps.dash(line, [0, 20]).split(/(?=M )/).map(run => run.trim());
        expect(runs).toHaveLength(6);
        expect(runs[0]).toBe('M 0 0 L 0.002 0');
        expect(runs[5]).toBe('M 100 0 L 99.998 0');
    });

    it('starts `offset` into the pattern', () => {
        // A full dash in: the path opens on a gap.
        const out = pathOps.dash(line, [10, 10], 10);
        expect(out.startsWith('M 0 0')).toBe(false);
        expect(out.startsWith('M 9.09')).toBe(true);
    });
});

describe('dashScale', () => {
    const pattern = [10, 10];

    it('fits a closed contour to whole cycles of the path', () => {
        expect(pathOps.dashScale(pattern, { length: 100, closed: true }, 100)).toBe(1);
        expect(pathOps.dashScale(pattern, { length: 50, closed: true }, 110)).toBeCloseTo(110 / 120);
    });

    it('fits an open contour alone, to whole cycles less the final gap', () => {
        expect(pathOps.dashScale(pattern, { length: 100, closed: false }, 300)).toBeCloseTo(100 / 110);
    });

    it('fits an odd pattern as closed, having no final gap to drop', () => {
        expect(pathOps.dashScale([10, 5, 5], { length: 100, closed: false }, 100)).toBe(1);
    });

    it('has nothing to fit on an empty cycle or path', () => {
        expect(pathOps.dashScale([0, 0], { length: 100, closed: false }, 100)).toBeNull();
        expect(pathOps.dashScale(pattern, { length: 0, closed: false }, 0)).toBeNull();
    });
});

/** The numbers of a dashed `d` string, run by run: `[[x0, y0, x1, y1, …], …]`. */
function runsOf(d: string): number[][] {
    return d.split(/(?=M )/).map((run) => run.trim()).filter(Boolean)
        .map((run) => (run.match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/g) ?? []).map(Number));
}

function expectRuns(d: string, expected: number[][]) {
    const actual = runsOf(d);
    expect(actual).toHaveLength(expected.length);
    actual.forEach((run, i) => {
        expect(run).toHaveLength(expected[i].length);
        run.forEach((value, j) => expect(value).toBeCloseTo(expected[i][j], 6));
    });
}

describe('dash – a closed contour', () => {
    const square = 'M 0 0 L 10 0 L 10 10 L 0 10 Z';

    it('walks the closing edge too, with dashes that fit the loop exactly', () => {
        // 40 round, fit to whole cycles of [5, 5]: four dashes, the last on the closing edge.
        expectRuns(pathOps.dash(square, [5, 5]), [
            [0, 0, 5, 0],
            [10, 0, 10, 5],
            [10, 10, 5, 10],
            [0, 10, 0, 5],
        ]);
    });

    it('lets a dash run round a corner as one run', () => {
        expectRuns(pathOps.dash(square, [4, 4]), [
            [0, 0, 4, 0],
            [8, 0, 10, 0, 10, 2],
            [10, 6, 10, 10],
            [6, 10, 2, 10],
            [0, 8, 0, 4],
        ]);
    });

    it('does not add the end-on-a-dash dot an open contour gets', () => {
        // The open square ends on a dash at (0, 10); the closed one just stops where the loop does.
        const open = runsOf(pathOps.dash('M 0 0 L 10 0 L 10 10 L 0 10', [5, 5]));
        const closed = runsOf(pathOps.dash(square, [5, 5]));
        expect(open[open.length - 1].slice(-2)).toEqual([0, 10]);
        expect(closed[closed.length - 1].slice(-2)).toEqual([0, 5]);
    });
});

describe('dash – several contours', () => {
    it('fits each open contour alone, so every one starts and ends on a dash', () => {
        const out = pathOps.dash('M 0 0 L 100 0 M 0 50 L 50 50', [10, 10]);
        const runs = runsOf(out);
        // The 100-long line stretches six dashes over its length; the 50-long one fits three exactly.
        expect(runs.filter((run) => run[1] === 0)).toHaveLength(6);
        const second = runs.filter((run) => run[1] === 50);
        expect(second).toEqual([[0, 50, 10, 50], [20, 50, 30, 50], [40, 50, 50, 50]]);
        expect(runs[0].slice(0, 2)).toEqual([0, 0]);
        expect(runs.filter((run) => run[1] === 0).pop()!.slice(-2)).toEqual([100, 0]);
    });

    it('fits closed contours to whole cycles of the total length, shared between them', () => {
        const triangles = 'M 0 0 L 10 0 L 10 10 Z M 100 0 L 110 0 L 110 10 Z';
        const runs = runsOf(pathOps.dash(triangles, [5, 5]));
        // Each triangle is 34.14 round; the pair (68.28) takes round(68.28 / 10) = 7 cycles, so the pattern stretches by 68.28 / 70.
        const first = runs.filter((run) => run[0] < 50);
        const second = runs.filter((run) => run[0] >= 50);
        expect(first.length).toBeGreaterThan(0);
        expect(second.length).toBe(first.length);
        expect(first[0][2]).toBeCloseTo(5 * (68.28427 / 70), 4);
    });

    it('starts every contour at the start of the pattern', () => {
        const runs = runsOf(pathOps.dash('M 0 0 L 40 0 M 0 20 L 40 20', [10, 10]));
        expect(runs.filter((run) => run[1] === 0)[0][0]).toBe(0);
        expect(runs.filter((run) => run[1] === 20)[0][0]).toBe(0);
    });

    it('skips a contour with no length and dashes the others', () => {
        expectRuns(pathOps.dash('M 0 0 L 0 0 Z M 0 5 L 50 5', [10, 10]), [
            [0, 5, 10, 5],
            [20, 5, 30, 5],
            [40, 5, 50, 5],
        ]);
    });
});

describe('dash – offset', () => {
    const line = 'M 0 0 L 100 0';

    it('reads a negative offset from the end of the cycle', () => {
        expect(pathOps.dash(line, [10, 10], -10)).toBe(pathOps.dash(line, [10, 10], 10));
        expectRuns(pathOps.dash(line, [10, 10], -5), runsOf(pathOps.dash(line, [10, 10], 15)));
    });

    it('wraps an offset longer than the cycle', () => {
        expectRuns(pathOps.dash(line, [10, 10], 45), runsOf(pathOps.dash(line, [10, 10], 5)));
    });

    it('moves the pattern along the contour: more offset, earlier dashes', () => {
        const none = runsOf(pathOps.dash(line, [10, 10]));
        const shifted = runsOf(pathOps.dash(line, [10, 10], 5));
        // The pattern starts 5 in, so the first dash is cut short by 5 (scaled by the fit).
        expect(shifted[0][2] - shifted[0][0]).toBeLessThan(none[0][2] - none[0][0]);
        expect(shifted[0][0]).toBe(0);
    });
});

describe('dash – an odd-length pattern', () => {
    it('alternates on and off across repeats of the pattern', () => {
        // [10, 5, 5] over 100: pass one is on, off, on; pass two is off, on, off; and so on.
        expectRuns(pathOps.dash('M 0 0 L 100 0', [10, 5, 5]), [
            [0, 0, 10, 0],
            [15, 0, 20, 0],
            [30, 0, 35, 0],
            [40, 0, 50, 0],
            [55, 0, 60, 0],
            [70, 0, 75, 0],
            [80, 0, 90, 0],
            [95, 0, 100, 0],
        ]);
    });

    it('fits an open contour as a closed one, with whole cycles and no final gap to drop', () => {
        const out = runsOf(pathOps.dash('M 0 0 L 90 0', [10, 5, 5]));
        // 90 over cycles of 20 is 4.5 -> 5 cycles of 20 = 100, so the pattern shrinks to 90%.
        expect(out[0][2]).toBeCloseTo(9, 6);
        expect(out[1][0]).toBeCloseTo(13.5, 6);
    });
});

describe('dash – input forms', () => {
    it('reads a command list as well as a string', () => {
        const list = pathOps.commands('M 0 0 L 100 0');
        expect(pathOps.dash(list, [10, 10])).toBe(pathOps.dash('M 0 0 L 100 0', [10, 10]));
    });

    it('gives nothing for a nullish or empty path', () => {
        expect(pathOps.dash(null, [10, 10])).toBe('');
        expect(pathOps.dash(undefined, [10, 10])).toBe('');
        expect(pathOps.dash('', [10, 10])).toBe('');
    });
});
