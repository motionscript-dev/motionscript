import { beforeAll, describe, expect, it } from 'vitest';
import { ensureHighlighter } from '../highlight';
import { lines, word, CodeRanges } from '../code-range';
import type { Code } from '../node';
import { at, make, render } from './harness.fixtures';

/**
 * `highlightRows` and `resetRowHighlight`: bands laid behind whole rows, across
 * the block, that slide onto the next rows they are given and follow their lines
 * through an edit.
 *
 *   1  function add(a, b) {
 *   2    return a + b;
 *   3  }
 *
 * At the default 16px and 1.6 line height a row is 25.6 tall, and the three rows
 * are centred on 25.6, 0 and -25.6.
 */

beforeAll(async () => {
    await ensureHighlighter(['typescript']);
});

const ROW = 16 * 1.6;

const bands = (node: Code) => render(node).rects;

describe('highlightRows', () => {
    it('draws nothing until it is asked to', () => {
        expect(bands(make())).toEqual([]);
    });

    it('lays one band behind the row, as wide as the block and under the text', () => {
        const node = make();
        at(node.highlightRows({ data: { target: lines(2) }, duration: 1 }), 1);
        const frame = render(node);
        expect(frame.rects).toHaveLength(1);
        const [band] = frame.rects;
        expect(band.y).toBeCloseTo(0);
        expect(band.height).toBeCloseTo(ROW);
        expect(band.width).toBeCloseTo(node.layoutBounds.width);
        expect(band.before).toBe(0);
        expect(band.opacity).toBe(1);
    });

    it('spans every line a range touches, whole, whatever its columns', () => {
        const node = make();
        at(node.highlightRows({ data: { target: { startLine: 1, startCol: 10, endLine: 2, endCol: 4 } }, duration: 1 }), 1);
        const [band] = bands(node);
        expect(band.height).toBeCloseTo(2 * ROW);
        expect(band.y).toBeCloseTo(ROW / 2);
    });

    it('covers the whole row for a word', () => {
        const node = make();
        at(node.highlightRows({ data: { target: word(3, 1, 1) }, duration: 1 }), 1);
        const [band] = bands(node);
        expect(band.y).toBeCloseTo(-ROW);
        expect(band.width).toBeCloseTo(node.layoutBounds.width);
    });

    it('paints the colour and radius it is given', () => {
        const node = make();
        at(node.highlightRows({ data: { target: lines(1), color: '#ff000080', radius: 0 }, duration: 1 }), 1);
        const [band] = bands(node);
        expect(band.color[0]).toBeCloseTo(1);
        expect(band.color[3]).toBeCloseTo(0.5, 1);
        expect(band.cornerRadius).toBe(0);
    });

    it('fades in where it lands when there was none', () => {
        const node = make();
        const command = node.highlightRows({ data: { target: lines(2) }, duration: 1 });
        at(command, 0.25);
        const [band] = bands(node);
        expect(band.opacity).toBeCloseTo(0.25);
        expect(band.y).toBeCloseTo(0);
    });

    it('slides and resizes onto the next rows rather than cross-fading', () => {
        const node = make();
        at(node.highlightRows({ data: { target: lines(1) }, duration: 1 }), 1);
        const command = node.highlightRows({ data: { target: lines(2, 3) }, duration: 1 });
        at(command, 0.5);
        const moving = bands(node);
        expect(moving).toHaveLength(1);
        // Top edge from 38.4 to 12.8, bottom from 12.8 to -38.4.
        expect(moving[0].y + moving[0].height / 2).toBeCloseTo(25.6);
        expect(moving[0].y - moving[0].height / 2).toBeCloseTo(-12.8);
        expect(moving[0].opacity).toBe(1);

        at(command, 1);
        const [landed] = bands(node);
        expect(landed.height).toBeCloseTo(2 * ROW);
        expect(landed.y).toBeCloseTo(-ROW / 2);
    });

    it('lays one band per range, and fades the ones the next call has no place for', () => {
        const node = make();
        at(node.highlightRows({ data: { target: CodeRanges.lines(1).lines(3) }, duration: 1 }), 1);
        expect(bands(node).map((band) => Math.round(band.y * 10) / 10)).toEqual([25.6, -25.6]);

        const command = node.highlightRows({ data: { target: lines(2) }, duration: 1 });
        at(command, 0.5);
        const [kept, leaving] = bands(node);
        expect(kept.y).toBeCloseTo(ROW / 2);
        expect(kept.opacity).toBe(1);
        expect(leaving.y).toBeCloseTo(-ROW);
        expect(leaving.opacity).toBeCloseTo(0.5);
    });

    it('applies its easing to the slide', () => {
        const node = make();
        at(node.highlightRows({ data: { target: lines(1) }, duration: 1 }), 1);
        const command = node.highlightRows({ data: { target: lines(3) }, duration: 1, easing: (t) => t * t });
        at(command, 0.5);
        expect(bands(node)[0].y).toBeCloseTo(ROW - 2 * ROW * 0.25);
    });

    it('draws nothing for a range past the end of the listing', () => {
        const node = make();
        at(node.highlightRows({ data: { target: lines(9) }, duration: 1 }), 1);
        expect(bands(node)).toEqual([]);
    });

    it('leaves the text at full opacity: it is not the dimming highlight', () => {
        const node = make();
        at(node.highlightRows({ data: { target: lines(2) }, duration: 1 }), 1);
        expect(render(node).tokens.every((token) => token.opacity === 1)).toBe(true);
    });

    it('stays behind its line when an edit moves it', () => {
        const node = make();
        at(node.highlightRows({ data: { target: lines(2) }, duration: 1 }), 1);
        at(node.prepend({ data: { code: '// sum\n' }, duration: 1 }), 1);
        const frame = render(node);
        const returnAt = frame.tokens.find((token) => token.text === 'return')?.y;
        expect(frame.rects).toHaveLength(1);
        expect(frame.rects[0].y).toBeCloseTo(returnAt as number);
    });
});

describe('resetRowHighlight', () => {
    it('fades the bands out and leaves none', () => {
        const node = make();
        at(node.highlightRows({ data: { target: lines(2) }, duration: 1 }), 1);
        const command = node.resetRowHighlight({ duration: 1 });
        at(command, 0.75);
        expect(bands(node)[0].opacity).toBeCloseTo(0.25);
        at(command, 1);
        expect(bands(node)).toEqual([]);
    });

    it('does nothing when there are none', () => {
        const node = make();
        at(node.resetRowHighlight({ duration: 1 }), 0.5);
        expect(bands(node)).toEqual([]);
    });
});
