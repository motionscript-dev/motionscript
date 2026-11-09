import { describe, it, expect } from 'vitest';
import { Text, NumberNode } from "@/components/builtins/text/text";
import type { TextSegment, TextState } from '@/render/descriptors/text';
import type { Node2D } from '@/components/trees/2d/node2d';
import { laidOut, recorded } from '@/components/trees/tests/recording-context.fixtures';
import { textStateOf } from '@/components/modules/text-layout';
import type { MeasureContext2D } from '@/render/measure-context';

/** What a glyph node drew: the descriptor the renderer was handed. */
function drawn(node: Text | NumberNode): Partial<TextState> {
    const n = laidOut(node as unknown as Node2D);
    recorded(n);
    return textStateOf(n)!;
}

const buildSegments = (t: Text): TextSegment[] | null => drawn(t).segments ?? null;

// Capitals twice as wide as anything else, so a recased string measures differently.
const scope = {
    measureText: (text: string, fontSize: number) => ({
        width: [...text].reduce((w, ch) => w + (/[A-Z]/.test(ch) ? 1 : 0.5) * fontSize, 0),
        height: fontSize,
    }),
} as unknown as MeasureContext2D;

describe('Text case', () => {
    it('draws the recased string and keeps the typed one', () => {
        const t = new Text({ text: 'hello world', textCase: 'title' });
        expect(drawn(t).text).toBe('Hello World');
        expect(t.text).toBe('hello world');
    });

    it('measures the recased string', () => {
        const typed = new Text({ text: 'ab', fontSize: 10, lineHeight: 1 });
        const upper = new Text({ text: 'ab', fontSize: 10, lineHeight: 1, textCase: 'upper' });
        expect(typed.measure({}, scope).width).toBe(10);
        expect(upper.measure({}, scope).width).toBe(20);
    });

    it('recases the pieces a run cuts, at the same offsets', () => {
        const t = new Text({ text: 'hello world', textCase: 'upper', runs: [{ start: 6, end: 11, fontSize: 60 }] });
        expect(buildSegments(t)!.map(s => [s.text, s.fontSize])).toEqual([['HELLO ', 48], ['WORLD', 60]]);
    });

    it('recases a derived figure too', () => {
        const n = new NumberNode({ value: 1500, format: 'currency', currencySymbol: 'eur ', textCase: 'upper' });
        expect(drawn(n).text).toBe('EUR 1,500');
    });
});

describe('Text decoration and vertical alignment', () => {
    it('hands both to the renderer, defaulting to none and centre', () => {
        const plain = drawn(new Text({ text: 'a' }));
        expect(plain).toMatchObject({ textDecoration: 'none', verticalAlign: 'center' });
        const set = drawn(new Text({ text: 'a', textDecoration: 'underline', verticalAlign: 'bottom' }));
        expect(set).toMatchObject({ textDecoration: 'underline', verticalAlign: 'bottom' });
    });

    it("gives every piece the node's decoration unless a run sets its own", () => {
        const t = new Text({
            text: 'hello world',
            textDecoration: 'underline',
            runs: [{ start: 6, end: 11, textDecoration: 'line-through' }],
        });
        const decorations = Object.fromEntries(buildSegments(t)!.map(s => [s.text, s.textDecoration]));
        expect(decorations).toEqual({ 'hello ': 'underline', world: 'line-through' });
    });
});
