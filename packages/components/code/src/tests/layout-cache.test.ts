import { beforeAll, describe, expect, it } from 'vitest';
import type { Command } from '@motionscript/sdk';
import { listingOf, type Code } from '../node';
import { ensureHighlighter } from '../highlight';
import { CountingMeasurer, Frame, at, attach, make, measured } from './harness.fixtures';

/**
 * A settled listing is laid out once, and the layout is reused for as long as
 * nothing it depends on has moved. An edit holds two layouts of its own, where
 * the tokens were and where they are going, built once for the metrics in force
 * and reused for every frame of the edit. Each is seen from outside by what the
 * measurer is asked, and by what the listing measures and draws to.
 */

beforeAll(async () => {
    await ensureHighlighter(['typescript']);
});

/** Measures `node` with `measurer` as its parent would, lays it out at that size and draws it. */
function frame(node: Code, measurer: CountingMeasurer = new CountingMeasurer()): Frame {
    attach(node);
    const { width, height } = node.measure({}, measurer);
    node.layout({ x: 0, y: 0, width: width ?? 0, height: height ?? 0 }, measurer);
    const drawn = new Frame();
    drawn.execute(() => node.render(drawn));
    return drawn;
}

describe('the settled layout', () => {
    it('is measured the first time a frame needs it, and not again for the next measure and the next draw', () => {
        const node = make('const a = 1;\nlet b;');
        const counting = new CountingMeasurer();
        frame(node, counting);
        const asked = counting.calls;
        expect(asked).toBeGreaterThan(0);
        frame(node, counting);
        measured(node, {}, counting);
        frame(node, counting);
        expect(counting.calls).toBe(asked);
    });

    it('is kept across frames at different times: the clock is not a metric', () => {
        const node = make('x');
        const counting = new CountingMeasurer();
        frame(node, counting);
        const asked = counting.calls;
        attach(node, 5);
        frame(node, counting);
        expect(counting.calls).toBe(asked);
    });

    it.each<[string, Record<string, unknown>]>([
        ['fontSize', { fontSize: 20 }],
        ['lineHeight', { lineHeight: 2 }],
        ['letterSpacing', { letterSpacing: 3 }],
        ['padding', { padding: 12 }],
        ['showLineNumbers', { showLineNumbers: true }],
    ])('is rebuilt when %s changes', (_, change) => {
        const node = make('const a = 1;\nlet b;');
        const before = measured(node, {}, new CountingMeasurer());
        node.set(change as never);
        const after = measured(node, {}, new CountingMeasurer());
        expect(after).not.toEqual(before);
        expect(after.width).toBeGreaterThan(0);
    });

    it('is rebuilt when fontFamily changes, measuring the tokens in the new face', () => {
        const node = make('const a = 1;');
        const counting = new CountingMeasurer();
        frame(node, counting);
        const asked = counting.calls;
        node.set({ fontFamily: 'Other Mono' } as never);
        frame(node, counting);
        expect(counting.calls).toBeGreaterThan(asked);
    });

    it('is rebuilt when lineNumberGap changes while the line numbers show', () => {
        const node = make('x', { showLineNumbers: true } as never);
        const before = measured(node);
        node.set({ lineNumberGap: 5 } as never);
        expect(measured(node).width).toBeGreaterThan(before.width);
    });

    it('is rebuilt when the source changes, since the structure is new', () => {
        const node = make('a');
        const before = measured(node);
        node.set({ code: 'ab' } as never);
        expect(measured(node).width).toBeGreaterThan(before.width);
    });

    it('is rebuilt when the theme changes, since the structure is re-tokenized', () => {
        const node = make('const a = 1;');
        const dark = frame(node).tokens.map((t) => t.color);
        node.set({ theme: 'github-dark' } as never);
        expect(frame(node).tokens.map((t) => t.color)).not.toEqual(dark);
    });

    it('measures nothing again for a frame it served from the cache', () => {
        const node = make('const a = 1;');
        const counting = new CountingMeasurer();
        measured(node, {}, counting);
        const asked = counting.calls;
        expect(asked).toBeGreaterThan(0);
        measured(node, {}, counting);
        measured(node, {}, counting);
        expect(counting.calls).toBe(asked);
    });

    it('answers a hit test from the metrics in force, measuring again where it must', () => {
        const node = make('abc', { letterSpacing: 0 } as never);
        frame(node);
        const hits = (x: number) => (node as unknown as { _hitTestSelf(p: { x: number; y: number }, t: number): boolean })._hitTestSelf({ x, y: 0 }, 0);
        // Three glyphs of 8 px, centred: the line runs from -12 to 12.
        expect(hits(11)).toBe(true);
        node.set({ fontSize: 8 } as never);
        // Now 4 px a glyph, inside the box it was laid out at: -6 to 6.
        expect(hits(11)).toBe(false);
        expect(hits(5)).toBe(true);
    });
});

describe('an edit\'s two layouts', () => {
    function started(code = 'const a = 1;'): { node: Code; command: Command<unknown>; counting: CountingMeasurer } {
        const node = make(code);
        const counting = new CountingMeasurer();
        frame(node, counting);
        const command = node.append({ data: { code: '\nlet b;' }, duration: 1 }) as Command<unknown>;
        return { node, command, counting };
    }

    it('are measured when the edit is first drawn, and not again for any other frame of it', () => {
        const { node, command, counting } = started();
        at(command, 0.2);
        frame(node, counting);
        const asked = counting.calls;
        for (const t of [0.4, 0.6, 0.8]) {
            at(command, t);
            frame(node, counting);
        }
        expect(counting.calls).toBe(asked);
    });

    it('lay out the structure before and the structure after: the second has the extra row', () => {
        const { node, command } = started();
        at(command, 0);
        const before = measured(node);
        at(command, 1);
        const after = measured(node);
        at(command, 0.5);
        const edit = listingOf(node).edit!;
        expect(edit.from).toHaveLength(1);
        expect(edit.to).toHaveLength(2);
        const mid = measured(node);
        expect(mid.height).toBeGreaterThan(before.height);
        expect(mid.height).toBeLessThan(after.height);
    });

    it.each<[string, Record<string, unknown>]>([
        ['fontSize', { fontSize: 24 }],
        ['padding', { padding: 9 }],
        ['letterSpacing', { letterSpacing: 4 }],
        ['showLineNumbers', { showLineNumbers: true }],
    ])('are rebuilt, both of them, when %s changes in the middle of the edit', (_, change) => {
        const { node, command } = started();
        at(command, 0.5);
        const before = measured(node);
        const edit = listingOf(node).edit;
        node.set(change as never);
        const after = measured(node);
        expect(listingOf(node).edit?.from).toBe(edit?.from);
        expect(after).not.toEqual(before);
    });

    it('give way to the settled layout of the new structure once the edit ends', () => {
        const { node, command } = started();
        at(command, 0.5);
        measured(node);
        at(command, 1);
        expect(listingOf(node).edit).toBeNull();
        const settled = make('const a = 1;\nlet b;');
        expect(measured(node)).toEqual(measured(settled));
    });

    it('are built afresh for an edit that comes after, rather than reused from the last', () => {
        const { node, command } = started();
        at(command, 0.5);
        const first = listingOf(node).edit;
        at(command, 1);
        const twoRows = measured(node);
        const second = node.append({ data: { code: '\nlet c;' }, duration: 1 }) as Command<unknown>;
        at(second, 0.5);
        expect(listingOf(node).edit?.from).not.toBe(first?.from);
        expect(listingOf(node).edit?.to).toHaveLength(3);
        expect(measured(node).height).toBeGreaterThan(twoRows.height);
    });
});
