import { describe, it, expect } from 'vitest';
import { Text } from "@/components/builtins/text/text";
import { textStateOf } from '@/components/modules/text-layout';
import type { Node2D } from '@/components/trees/2d/node2d';
import { laidOut, recorded } from '@/components/trees/tests/recording-context.fixtures';
import type { TextSegment } from '@/render/descriptors/text';
import type { MeasureContext2D } from '@/render/measure-context';

/** The pieces a drawn text set its string in. */
function buildSegments(t: Text): TextSegment[] | null {
    const n = laidOut(t as unknown as Node2D);
    recorded(n);
    return textStateOf(n)!.segments ?? null;
}

// Every glyph half its size wide, so widths are easy to reason about.
const scope = {
    measureText: (text: string, fontSize: number) => ({ width: text.length * fontSize * 0.5, height: fontSize }),
} as unknown as MeasureContext2D;

describe('Text runs', () => {
    it('stays on the null fast path with no runs', () => {
        expect(buildSegments(new Text({ text: 'hello', runs: [] }))).toBeNull();
    });

    it('styles only the characters a run covers', () => {
        const t = new Text({
            text: 'hello world',
            fontFamily: 'Inter',
            fontSize: 24,
            runs: [{ start: 6, end: 11, fontSize: 48, fontWeight: 700, fontFamily: 'Georgia', fill: '#ff0000' }],
        });
        const segs = buildSegments(t)!;
        const world = segs.find(s => s.text === 'world')!;
        const hello = segs.find(s => s.text === 'hello ')!;
        expect(world).toMatchObject({ fontSize: 48, fontWeight: 700, fontFamily: 'Georgia' });
        expect(world.fill).not.toBe(t.fill);
        expect(hello).toMatchObject({ fontSize: 24, fontWeight: 400, fontFamily: 'Inter' });
        expect(hello.fill).toBe(t.fill);
    });

    it('lets the later run win where two overlap, and ignores offsets past the end', () => {
        const t = new Text({
            text: 'abcdef',
            runs: [{ start: 0, end: 4, fontSize: 10 }, { start: 2, end: 99, fontSize: 20 }],
        });
        const sizes = Object.fromEntries(buildSegments(t)!.map(s => [s.text, s.fontSize]));
        expect(sizes).toEqual({ ab: 10, cd: 20, ef: 20 });
    });

    it('declares every face a run is set in', () => {
        const t = new Text({ text: 'hi there', fontFamily: 'Inter', runs: [{ start: 3, end: 8, fontFamily: 'Georgia', fontWeight: 700 }] });
        const fonts: [string, number][] = [];
        const assets = new Proxy({}, {
            get: (_, key) => key === 'font' ? (f: string, w: number) => fonts.push([f, w]) : () => {},
        });
        t.declareAssets(assets as never);
        expect(fonts).toContainEqual(['Georgia', 700]);
    });

    it('measures a line as tall as its largest run', () => {
        const t = new Text({ text: 'ab', fontSize: 10, lineHeight: 1, runs: [{ start: 1, end: 2, fontSize: 30 }] });
        expect(t.measure({}, scope)).toEqual({ width: 5 + 15, height: 30 });
    });

    it('wraps each piece at its own width and height', () => {
        // "aa bb" at 10px is 25 wide; "bb" at 20px pushes the line to 35, so a
        // 30-wide box breaks before it and the second line is 20 tall.
        const t = new Text({
            text: 'aa bb',
            fontSize: 10,
            lineHeight: 1,
            wrap: true,
            width: 30,
            runs: [{ start: 3, end: 5, fontSize: 20 }],
        });
        expect(t.measure({ maxWidth: 30 }, scope).height).toBe(10 + 20);
    });
});
