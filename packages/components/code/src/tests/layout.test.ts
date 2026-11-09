import { describe, expect, it } from 'vitest';
import type { InsetsResolved, MeasureContext2D } from '@motionscript/sdk';
import { layoutCode, metricsSignature, type CodeMetrics } from '../layout';
import { TokenAdvanceCache } from '../measure-cache';
import { makeIdLine, makeIdToken, type IdLine } from '../tokens';
import { CountingMeasurer, advanceOf } from './harness.fixtures';

/**
 * Where a listing's tokens go, from the advances a measurer gives them. The face
 * these tests pretend to have is half an em a glyph, so a 20 px face with one
 * pixel of letter spacing advances 11 px a character and a space-width is 10.
 */

const PADDING: InsetsResolved = { top: 10, right: 20, bottom: 30, left: 40 };

const METRICS: CodeMetrics = {
    fontSize: 20,
    fontFamily: 'Mono',
    lineHeight: 1.5,
    letterSpacing: 1,
    padding: PADDING,
    showLineNumbers: false,
    lineNumberGap: 2,
};

function listing(rows: string[][]): IdLine[] {
    return rows.map((tokens) => makeIdLine(tokens.map((content) => makeIdToken(content))));
}

function lay(lines: IdLine[], metrics: Partial<CodeMetrics> = {}, measurer: MeasureContext2D = new CountingMeasurer()) {
    return layoutCode(lines, { ...METRICS, ...metrics }, new TokenAdvanceCache(), measurer);
}

describe('layoutCode: the block', () => {
    const lines = listing([['const', ' ', 'a', ' ', '=', ' ', '1', ';'], ['b'], []]);

    it('sizes the content from the longest line and a row height of fontSize x lineHeight', () => {
        const layout = lay(lines);
        // `const a = 1;` is twelve characters at 11 px; a row is 30 px and there are three.
        expect(layout.innerW).toBe(advanceOf(12, 20, 1));
        expect(layout.innerH).toBe(90);
    });

    it('adds the padding to make the block', () => {
        const layout = lay(lines);
        expect(layout.blockW).toBe(132 + 20 + 40);
        expect(layout.blockH).toBe(90 + 10 + 30);
    });

    it('starts the code column at the block\'s left edge plus the left padding', () => {
        const layout = lay(lines);
        expect(layout.startX).toBe(-layout.blockW / 2 + 40);
    });

    it('measures the ink of each line, so a blank line is 0 and a short line is short', () => {
        expect(lay(lines).lineW).toEqual([132, 11, 0]);
    });

    it('is a ragged block: the width is the longest line, not the last', () => {
        const layout = lay(listing([['a'], ['aaaaaaaa'], ['aa']]));
        expect(layout.lineW).toEqual([11, 88, 22]);
        expect(layout.innerW).toBe(88);
    });
});

describe('layoutCode: where tokens sit', () => {
    const lines = listing([['const', ' ', 'a'], ['b']]);
    const layout = lay(lines);
    const [first, second] = lines;

    it('puts a token\'s left edge at the sum of its predecessors\' advances', () => {
        const [keyword, space, name] = first.tokens;
        expect(layout.tokens.get(keyword.id)!.x).toBe(layout.startX);
        expect(layout.tokens.get(space.id)!.x).toBe(layout.startX + advanceOf(5, 20, 1));
        expect(layout.tokens.get(name.id)!.x).toBe(layout.startX + advanceOf(6, 20, 1));
        expect(layout.tokens.get(second.tokens[0].id)!.x).toBe(layout.startX);
    });

    it('puts the first row at the top of the block, stepping down a row height each', () => {
        // y is up: the first row's centre is half a row below the top padding.
        const top = layout.blockH / 2 - 10;
        expect(layout.lineY).toEqual([top - 15, top - 45]);
        expect(layout.tokens.get(first.tokens[0].id)!.y).toBe(top - 15);
        expect(layout.tokens.get(second.tokens[0].id)!.y).toBe(top - 45);
    });

    it('keeps every token of a row on its row\'s centre', () => {
        for (const token of first.tokens) expect(layout.tokens.get(token.id)!.y).toBe(layout.lineY[0]);
    });

    it('indexes the lines by id', () => {
        expect(layout.lineIndex.get(first.id)).toBe(0);
        expect(layout.lineIndex.get(second.id)).toBe(1);
        expect(layout.lineIndex.size).toBe(2);
    });

    it('places a token with no content and a blank line without a gap in the numbering', () => {
        const withBlank = lay(listing([['a'], [], ['b']]));
        expect(withBlank.lineY).toHaveLength(3);
        expect(withBlank.lineW).toEqual([11, 0, 11]);
        expect(withBlank.lineY[0] - withBlank.lineY[1]).toBe(30);
        expect(withBlank.lineY[1] - withBlank.lineY[2]).toBe(30);
    });

    it('measures a token\'s advance with the letter spacing', () => {
        const spaced = lay(listing([['abcd']]), { letterSpacing: 4 });
        expect(spaced.lineW).toEqual([advanceOf(4, 20, 4)]);
        const tight = lay(listing([['abcd']]), { letterSpacing: 0 });
        expect(tight.lineW).toEqual([40]);
    });
});

describe('layoutCode: the gutter', () => {
    const rows = (count: number) => listing(Array.from({ length: count }, () => ['xx']));

    it('is 0 without line numbers, and the gap is 0 with it', () => {
        const layout = lay(rows(12));
        expect(layout.gutter).toBe(0);
        expect(layout.gutterGap).toBe(0);
    });

    it('is the widest number plus a gap of lineNumberGap space-widths, both measured without letter spacing', () => {
        // A space-width is 10 and the gap is two of them; "10" is two characters of 10.
        const layout = lay(rows(10), { showLineNumbers: true, lineNumberGap: 2, letterSpacing: 5 });
        expect(layout.gutterGap).toBe(20);
        expect(layout.gutter).toBe(20 + 20);
    });

    it('widens a digit at a time as the count of lines grows', () => {
        const gutter = (count: number) => lay(rows(count), { showLineNumbers: true }).gutter;
        expect(gutter(1)).toBe(10 + 20);
        expect(gutter(9)).toBe(10 + 20);
        expect(gutter(10)).toBe(20 + 20);
        expect(gutter(99)).toBe(20 + 20);
        expect(gutter(100)).toBe(30 + 20);
    });

    it('scales the gap with lineNumberGap', () => {
        const gap = (lineNumberGap: number) => lay(rows(1), { showLineNumbers: true, lineNumberGap }).gutterGap;
        expect(gap(0)).toBe(0);
        expect(gap(1)).toBe(10);
        expect(gap(3)).toBe(30);
    });

    it('is part of the content width, and shifts the code column right', () => {
        const without = lay(rows(3));
        const withNumbers = lay(rows(3), { showLineNumbers: true });
        expect(withNumbers.innerW).toBe(without.innerW + withNumbers.gutter);
        expect(withNumbers.blockW).toBe(without.blockW + withNumbers.gutter);
        // The block grew, so its left edge moved out by half; the column starts one gutter in from it.
        expect(withNumbers.startX).toBe(-withNumbers.blockW / 2 + 40 + withNumbers.gutter);
    });

    it('numbers a listing with no lines as one', () => {
        const layout = lay([], { showLineNumbers: true });
        expect(layout.gutter).toBe(10 + 20);
        expect(layout.innerH).toBe(0);
    });
});

describe('layoutCode: padding and an empty listing', () => {
    it('grows the block by the padding on each side', () => {
        const none = lay(listing([['abc']]), { padding: { top: 0, right: 0, bottom: 0, left: 0 } });
        const padded = lay(listing([['abc']]), { padding: { top: 1, right: 2, bottom: 4, left: 8 } });
        expect(padded.blockW - none.blockW).toBe(10);
        expect(padded.blockH - none.blockH).toBe(5);
    });

    it('keeps the block centred, so padding on one side moves the rows by half of it the other way', () => {
        const none = { top: 0, right: 0, bottom: 0, left: 0 };
        const base = lay(listing([['a']]), { padding: none });
        const top = lay(listing([['a']]), { padding: { ...none, top: 10 } });
        const bottom = lay(listing([['a']]), { padding: { ...none, bottom: 10 } });
        // The block grows by 10 about its centre. Padding above pushes the row down 5 from where it sat; below, up 5.
        expect(top.lineY[0] - base.lineY[0]).toBe(-5);
        expect(bottom.lineY[0] - base.lineY[0]).toBe(5);
        const left = lay(listing([['a']]), { padding: { ...none, left: 10 } });
        const right = lay(listing([['a']]), { padding: { ...none, right: 10 } });
        expect(left.startX - base.startX).toBe(5);
        expect(right.startX - base.startX).toBe(-5);
    });

    it('is the padding alone for no lines', () => {
        const layout = lay([]);
        expect(layout.innerW).toBe(0);
        expect(layout.innerH).toBe(0);
        expect(layout.blockW).toBe(60);
        expect(layout.blockH).toBe(40);
        expect(layout.tokens.size).toBe(0);
        expect(layout.lineY).toEqual([]);
        expect(layout.lineW).toEqual([]);
    });

    it('is a row tall for one blank line', () => {
        const layout = lay(listing([[]]));
        expect(layout.innerW).toBe(0);
        expect(layout.innerH).toBe(30);
    });

    it('is finite throughout', () => {
        const layout = lay(listing([['const', ' ', 'a'], [], ['b']]), { showLineNumbers: true });
        for (const value of [layout.gutter, layout.gutterGap, layout.innerW, layout.innerH, layout.blockW, layout.blockH, layout.startX, ...layout.lineY, ...layout.lineW]) {
            expect(Number.isFinite(value)).toBe(true);
        }
        for (const box of layout.tokens.values()) expect(Number.isFinite(box.x) && Number.isFinite(box.y)).toBe(true);
    });
});

describe('layoutCode: what it asks the measurer', () => {
    it('measures each distinct token once, however often it appears', () => {
        const measurer = new CountingMeasurer();
        lay(listing([['a', ' ', 'a'], ['a', ' ', 'b']]), {}, measurer);
        expect(measurer.asked.sort()).toEqual([' ', 'a', 'b']);
    });

    it('measures nothing for a blank token', () => {
        const measurer = new CountingMeasurer();
        lay(listing([['', ''], []]), {}, measurer);
        expect(measurer.calls).toBe(0);
    });

    it('measures the line numbers and their gap only when they show', () => {
        const hidden = new CountingMeasurer();
        lay(listing([['a']]), {}, hidden);
        expect(hidden.asked).toEqual(['a']);
        const shown = new CountingMeasurer();
        lay(listing([['a']]), { showLineNumbers: true }, shown);
        expect(shown.asked.sort()).toEqual([' ', '1', 'a']);
    });
});

describe('metricsSignature', () => {
    it('is the same for the same metrics', () => {
        expect(metricsSignature({ ...METRICS })).toBe(metricsSignature({ ...METRICS, padding: { ...PADDING } }));
    });

    it.each<[string, Partial<CodeMetrics>]>([
        ['fontSize', { fontSize: 21 }],
        ['fontFamily', { fontFamily: 'Other' }],
        ['lineHeight', { lineHeight: 1.6 }],
        ['letterSpacing', { letterSpacing: 2 }],
        ['padding.top', { padding: { ...PADDING, top: 11 } }],
        ['padding.right', { padding: { ...PADDING, right: 21 } }],
        ['padding.bottom', { padding: { ...PADDING, bottom: 31 } }],
        ['padding.left', { padding: { ...PADDING, left: 41 } }],
        ['showLineNumbers', { showLineNumbers: true }],
        ['lineNumberGap', { lineNumberGap: 3 }],
    ])('changes with %s', (_, change) => {
        expect(metricsSignature({ ...METRICS, ...change })).not.toBe(metricsSignature(METRICS));
    });

    it('does not mistake one padding side for another', () => {
        const left = metricsSignature({ ...METRICS, padding: { top: 0, right: 0, bottom: 0, left: 5 } });
        const right = metricsSignature({ ...METRICS, padding: { top: 0, right: 5, bottom: 0, left: 0 } });
        expect(left).not.toBe(right);
    });
});
