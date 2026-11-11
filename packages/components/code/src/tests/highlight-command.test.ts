import { beforeAll, describe, expect, it } from 'vitest';
import type { Command } from '@motionscript/sdk';
import { ensureHighlighter } from '../highlight';
import { lines, word } from '../code-range';
import type { Code } from '../node';
import { at, make, render } from './harness.fixtures';

/**
 * `highlight` and `resetHighlight`: a persistent dim over everything outside a
 * range, cross-faded in and out, whose state is committed at the end of the
 * command and put back below it.
 *
 *   1  function add(a, b) {
 *   2    return a + b;
 *   3  }
 */

beforeAll(async () => {
    await ensureHighlighter(['typescript']);
});

/** The three tokens that tell the lines apart. */
const frame = (node: Code) => {
    const drawn = render(node).tokens;
    const opacity = (text: string) => drawn.find((t) => t.text === text)?.opacity;
    return { first: opacity('function'), second: opacity('return'), third: opacity('}') };
};

// The highlight a command left, as the node holds it: what stays bright, and what the rest dims to.
const dimOf = (node: Code) => node.focus.dim;
const idsOf = (node: Code) => node.focus.ids;

describe('highlight', () => {
    it('dims everything outside the range to 0.4 by default, and leaves what is inside at full', () => {
        const node = make();
        at(node.highlight({ data: { target: lines(1) }, duration: 1 }), 1);
        expect(frame(node)).toEqual({ first: 1, second: 0.4, third: 0.4 });
        expect(dimOf(node)).toBe(0.4);
    });

    it('dims to the opacity it is given', () => {
        const node = make();
        at(node.highlight({ data: { target: lines(2), dim: 0.15 }, duration: 1 }), 1);
        expect(frame(node)).toEqual({ first: 0.15, second: 1, third: 0.15 });
        expect(dimOf(node)).toBe(0.15);
    });

    it('dims to nothing for a dim of 0: what is outside the range is not drawn at all', () => {
        const node = make();
        at(node.highlight({ data: { target: lines(1), dim: 0 }, duration: 1 }), 1);
        expect(frame(node)).toEqual({ first: 1, second: undefined, third: undefined });
        expect(dimOf(node)).toBe(0);
    });

    it('dims nothing visible for a dim of 1, though it is committed', () => {
        const node = make();
        at(node.highlight({ data: { target: lines(1), dim: 1 }, duration: 1 }), 1);
        expect(frame(node)).toEqual({ first: 1, second: 1, third: 1 });
        expect(dimOf(node)).toBe(1);
    });

    it('selects the tokens the range overlaps, partly or wholly', () => {
        const node = make();
        at(node.highlight({ data: { target: word(1, 10, 3) }, duration: 1 }), 1);
        // `add` (columns 10 to 12) alone.
        const bright = render(node).tokens.filter((t) => t.opacity === 1).map((t) => t.text);
        expect(bright).toEqual(['add']);
    });

    it('cross-fades from fully shown to the dim over the command, straight when it has no easing', () => {
        const node = make();
        const command = node.highlight({ data: { target: lines(1) }, duration: 1 });
        at(command, 0.25);
        expect(frame(node).second).toBeCloseTo(0.85);
        at(command, 0.5);
        expect(frame(node).second).toBeCloseTo(0.7);
        expect(frame(node).first).toBe(1);
        at(command, 0.75);
        expect(frame(node).second).toBeCloseTo(0.55);
    });

    it('goes through the easing it is given', () => {
        const node = make();
        const command = node.highlight({ data: { target: lines(1) }, duration: 1, easing: (t: number) => t * t });
        at(command, 0.5);
        // An eased progress of a quarter: a quarter of the way from 1 to 0.4.
        expect(frame(node).second).toBeCloseTo(0.85);
    });

    it('shows everything before it starts', () => {
        const node = make();
        const command = node.highlight({ data: { target: lines(1) }, duration: 1 });
        at(command, 0);
        expect(frame(node)).toEqual({ first: 1, second: 1, third: 1 });
        expect(dimOf(node)).toBeNull();
    });

    it('takes a command of the duration it is given', () => {
        expect(make().highlight({ data: { target: lines(1) }, duration: 2.5 }).duration).toBe(2.5);
    });
});

describe('highlight: committing and rolling back', () => {
    it('commits the dim and the selection at the end', () => {
        const node = make();
        const command = node.highlight({ data: { target: lines(1) }, duration: 1 });
        at(command, 1);
        expect(dimOf(node)).toBe(0.4);
        expect(idsOf(node).size).toBeGreaterThan(0);
    });

    it('holds the state it started from below the end, because a frame is a function of its time', () => {
        const node = make();
        const command = node.highlight({ data: { target: lines(1) }, duration: 1 });
        at(command, 1);
        at(command, 0.5);
        expect(dimOf(node)).toBeNull();
        expect(idsOf(node).size).toBe(0);
        at(command, 0);
        expect(dimOf(node)).toBeNull();
        expect(idsOf(node).size).toBe(0);
        at(command, 1);
        expect(dimOf(node)).toBe(0.4);
    });

    it('draws the same frame at a time whichever way the playhead came', () => {
        const node = make();
        const command = node.highlight({ data: { target: lines(1) }, duration: 1 });
        at(command, 0.3);
        const forward = frame(node);
        at(command, 1);
        at(command, 0.9);
        at(command, 0.3);
        expect(frame(node)).toEqual(forward);
    });

    it('puts back the previous highlight below its end, when there was one', () => {
        const node = make();
        at(node.highlight({ data: { target: lines(1), dim: 0.3 }, duration: 1 }), 1);
        const previous = new Set(idsOf(node));
        const second = node.highlight({ data: { target: lines(3), dim: 0.1 }, duration: 1 });
        at(second, 1);
        expect(dimOf(node)).toBe(0.1);
        expect(idsOf(node)).not.toEqual(previous);
        at(second, 0.5);
        expect(dimOf(node)).toBe(0.3);
        expect(idsOf(node)).toEqual(previous);
        at(second, 0);
        expect(dimOf(node)).toBe(0.3);
        expect(idsOf(node)).toEqual(previous);
    });
});

describe('highlight: from a previous highlight', () => {
    function afterFirst() {
        const node = make();
        at(node.highlight({ data: { target: lines(1), dim: 0.3 }, duration: 1 }), 1);
        return node;
    }

    it('cross-fades what was bright and is now dim, and what was dim and is now bright', () => {
        const node = afterFirst();
        const second = node.highlight({ data: { target: lines(3), dim: 0.3 }, duration: 1 });
        at(second, 0.5);
        const mid = frame(node);
        // The first line leaves the highlight: 1 down to 0.3. The last joins it: 0.3 up to 1.
        expect(mid.first).toBeCloseTo(0.65);
        expect(mid.third).toBeCloseTo(0.65);
        // The middle line was dim and stays dim: it does not move.
        expect(mid.second).toBeCloseTo(0.3);
    });

    it('ends with the new range bright and the rest dim', () => {
        const node = afterFirst();
        at(node.highlight({ data: { target: lines(3), dim: 0.3 }, duration: 1 }), 1);
        expect(frame(node)).toEqual({ first: 0.3, second: 0.3, third: 1 });
    });

    it('moves the dim of what stays outside from the old dim to the new one', () => {
        const node = afterFirst();
        const second = node.highlight({ data: { target: lines(1), dim: 0.1 }, duration: 1 });
        at(second, 0.5);
        expect(frame(node).first).toBe(1);
        expect(frame(node).second).toBeCloseTo(0.2);
        at(second, 1);
        expect(frame(node).second).toBeCloseTo(0.1);
    });

    it('leaves what is bright before and after untouched', () => {
        const node = afterFirst();
        const second = node.highlight({ data: { target: CodeRangesOf(lines(1), lines(2)), dim: 0.3 }, duration: 1 });
        at(second, 0.5);
        expect(frame(node).first).toBe(1);
        expect(frame(node).second).toBeCloseTo(0.65);
    });
});

/** A plain array of ranges, which a highlight takes as well as one range. */
function CodeRangesOf(...ranges: ReturnType<typeof lines>[]) {
    return ranges;
}

describe('resetHighlight', () => {
    function highlighted(dim = 0.3) {
        const node = make();
        at(node.highlight({ data: { target: lines(1), dim }, duration: 1 }), 1);
        return node;
    }

    it('fades every dimmed token back to full and leaves the bright ones alone', () => {
        const node = highlighted();
        const reset = node.resetHighlight({ duration: 1 });
        at(reset, 0.5);
        expect(frame(node).first).toBe(1);
        expect(frame(node).second).toBeCloseTo(0.65);
        expect(frame(node).third).toBeCloseTo(0.65);
    });

    it('clears the dim and the selection at the end', () => {
        const node = highlighted();
        at(node.resetHighlight({ duration: 1 }), 1);
        expect(dimOf(node)).toBeNull();
        expect(idsOf(node).size).toBe(0);
        expect(frame(node)).toEqual({ first: 1, second: 1, third: 1 });
    });

    it('holds the highlight below the end', () => {
        const node = highlighted();
        const reset = node.resetHighlight({ duration: 1 });
        at(reset, 1);
        at(reset, 0.5);
        expect(dimOf(node)).toBe(0.3);
        expect(idsOf(node).size).toBeGreaterThan(0);
        at(reset, 0);
        expect(dimOf(node)).toBe(0.3);
        expect(frame(node)).toEqual({ first: 1, second: 0.3, third: 0.3 });
    });

    it('is a no-op command of the same duration when nothing is highlighted', () => {
        const node = make();
        const reset = node.resetHighlight({ duration: 3 });
        expect(reset.duration).toBe(3);
        at(reset, 1.5);
        expect(dimOf(node)).toBeNull();
        expect(frame(node)).toEqual({ first: 1, second: 1, third: 1 });
        at(reset, 3);
        expect(dimOf(node)).toBeNull();
    });

    it('lets a highlight be made again afterwards', () => {
        const node = highlighted();
        at(node.resetHighlight({ duration: 1 }), 1);
        at(node.highlight({ data: { target: lines(2), dim: 0.2 }, duration: 1 }), 1);
        expect(frame(node)).toEqual({ first: 0.2, second: 1, third: 0.2 });
    });
});

describe('a highlight that does nothing', () => {
    it('is a no-op command of the same duration when the range matches no token', () => {
        const node = make();
        const command = node.highlight({ data: { target: word(1, 400, 3) }, duration: 2 }) as Command<unknown>;
        expect(command.duration).toBe(2);
        at(command, 1);
        expect(dimOf(node)).toBeNull();
        expect(idsOf(node).size).toBe(0);
        expect(frame(node)).toEqual({ first: 1, second: 1, third: 1 });
    });

    it('is a no-op for a range of no width', () => {
        const node = make();
        at(node.highlight({ data: { target: word(1, 3, 0) }, duration: 1 }), 1);
        expect(dimOf(node)).toBeNull();
    });

    it('is a no-op for a listing with nothing in it', () => {
        const node = make('');
        at(node.highlight({ data: { target: lines(1) }, duration: 1 }), 1);
        expect(dimOf(node)).toBeNull();
    });

    it('leaves a highlight already made as it was', () => {
        const node = make();
        at(node.highlight({ data: { target: lines(1), dim: 0.3 }, duration: 1 }), 1);
        const before = new Set(idsOf(node));
        at(node.highlight({ data: { target: word(1, 400, 3), dim: 0.9 }, duration: 1 }), 1);
        expect(dimOf(node)).toBe(0.3);
        expect(idsOf(node)).toEqual(before);
    });
});
