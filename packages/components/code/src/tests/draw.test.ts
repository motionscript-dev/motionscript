import { describe, expect, it } from 'vitest';
import { parseColor, type Command } from '@motionscript/sdk';
import { diffCode } from '../diff';
import { layoutCode, type CodeMetrics } from '../layout';
import { TokenAdvanceCache } from '../measure-cache';
import { drawCode } from '../render';
import { makeIdLine, makeIdToken, type IdLine } from '../tokens';
import { phasesFor, smoothstep, windowProgress, type StructuralTransition, type TokenState } from '../transitions';
import { listingOf } from '../node';
import { LINE_NUMBER_COLOR, Frame, advanceOf, at, make, render } from './harness.fixtures';

/**
 * `drawCode` over state built by hand: a settled frame, and an edit part-way
 * through. The face is half an em a glyph, so at 20 px with one pixel of letter
 * spacing a character advances 11 px, and a row is 30.
 */

const METRICS: CodeMetrics = {
    fontSize: 20,
    fontFamily: 'Mono',
    lineHeight: 1.5,
    letterSpacing: 1,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    showLineNumbers: false,
    lineNumberGap: 2,
};

/** A token as `content` or `content#colour`. */
function tok(spec: string) {
    const [content, color] = spec.split('#');
    return makeIdToken(content, color ? `#${color}` : undefined);
}

function listing(rows: string[][]): IdLine[] {
    return rows.map((row) => makeIdLine(row.map(tok)));
}

function setup(metrics: Partial<CodeMetrics> = {}): { metrics: CodeMetrics; cache: TokenAdvanceCache; frame: Frame } {
    return { metrics: { ...METRICS, ...metrics }, cache: new TokenAdvanceCache(), frame: new Frame() };
}

/** Draws a settled listing. */
function drawSettled(rows: string[][], over: Partial<CodeMetrics> = {}, states = new Map<number, TokenState>(), highlightActive = false) {
    const { metrics, cache, frame } = setup(over);
    const lines = listing(rows);
    const layout = layoutCode(lines, metrics, cache, frame);
    drawCode(frame, { tokenLines: lines, metrics, advanceCache: cache, from: layout, to: layout, edit: null, tokenStates: states, highlightActive });
    return { lines, metrics, cache, frame };
}

describe('drawCode: a settled frame', () => {
    it('draws each token as one text op, in order', () => {
        const { frame } = drawSettled([['const', ' ', 'a'], ['b']]);
        expect(frame.tokens.map((t) => t.text)).toEqual(['const', ' ', 'a', 'b']);
    });

    it('anchors each token at the centre of its cell, left-aligned, on the row\'s centre', () => {
        const { frame } = drawSettled([['const', ' ', 'a'], ['b']]);
        const [constant, space, name, other] = frame.tokens;
        // Cells start at the block's left edge, which is half its width left of the centre.
        const left = -advanceOf(7, 20, 1) / 2;
        expect(constant.x).toBeCloseTo(left + advanceOf(5, 20, 1) / 2);
        expect(space.x).toBeCloseTo(left + advanceOf(5, 20, 1) + advanceOf(1, 20, 1) / 2);
        expect(name.x).toBeCloseTo(left + advanceOf(6, 20, 1) + advanceOf(1, 20, 1) / 2);
        expect(other.x).toBeCloseTo(left + advanceOf(1, 20, 1) / 2);
        expect(constant.y).toBe(15);
        expect(other.y).toBe(-15);
        for (const t of frame.tokens) expect(t.textAlign).toBe('left');
    });

    it('sets each token in the face, size, line height and letter spacing the metrics name', () => {
        const { frame } = drawSettled([['a']], { fontSize: 18, fontFamily: 'Face', lineHeight: 2, letterSpacing: 3 });
        expect(frame.tokens[0]).toMatchObject({ fontSize: 18, fontFamily: 'Face', lineHeight: 2, letterSpacing: 3 });
    });

    it('paints each token solid in its own colour, fully opaque', () => {
        const { frame } = drawSettled([['const#5e81ac', ' #d8dee9', 'a#8fbcbb']]);
        expect(frame.tokens.map((t) => t.color)).toEqual([parseColor('#5e81ac'), parseColor('#d8dee9'), parseColor('#8fbcbb')]);
        expect(frame.tokens.map((t) => t.opacity)).toEqual([1, 1, 1]);
    });

    it('paints a token with no colour in the default token colour', () => {
        const { frame } = drawSettled([['x']]);
        expect(frame.tokens[0].color).toEqual([0.82, 0.84, 0.86, 1]);
    });

    it('parses a colour once: two tokens of one colour share it', () => {
        const { frame } = drawSettled([['a#123456', 'b#123456']]);
        expect(frame.tokens[0].color).toBe(frame.tokens[1].color);
    });

    it('draws a token at the opacity its state names, and the rest at full', () => {
        const rows = [['a', 'b', 'c']];
        const lines = listing(rows);
        const { metrics, cache, frame } = setup();
        const layout = layoutCode(lines, metrics, cache, frame);
        const states = new Map<number, TokenState>([[lines[0].tokens[1].id, { opacity: 0.4 }]]);
        drawCode(frame, { tokenLines: lines, metrics, advanceCache: cache, from: layout, to: layout, edit: null, tokenStates: states, highlightActive: true });
        expect(frame.tokens.map((t) => t.opacity)).toEqual([1, 0.4, 1]);
    });

    it('draws nothing for a token at opacity 0, and nothing for a token with no text', () => {
        const lines = listing([['a', '', 'b']]);
        const { metrics, cache, frame } = setup();
        const layout = layoutCode(lines, metrics, cache, frame);
        const states = new Map<number, TokenState>([[lines[0].tokens[2].id, { opacity: 0 }]]);
        drawCode(frame, { tokenLines: lines, metrics, advanceCache: cache, from: layout, to: layout, edit: null, tokenStates: states, highlightActive: true });
        expect(frame.tokens.map((t) => t.text)).toEqual(['a']);
    });

    it('draws nothing for a listing of blank lines', () => {
        const { frame } = drawSettled([[], []]);
        expect(frame.texts).toEqual([]);
    });

    it('draws no line numbers without showLineNumbers', () => {
        const { frame } = drawSettled([['a'], ['b']]);
        expect(frame.numbers).toEqual([]);
    });
});

describe('drawCode: the gutter', () => {
    const NUMBERED = { showLineNumbers: true };

    it('draws one number per line, from 1, blank lines included, in the gutter colour', () => {
        const { frame } = drawSettled([['a'], [], ['c']], NUMBERED);
        expect(frame.numbers.map((n) => n.text)).toEqual(['1', '2', '3']);
        for (const n of frame.numbers) expect(n.color).toEqual(LINE_NUMBER_COLOR);
    });

    it('sets a number in the face and size of the code, without its letter spacing', () => {
        const { frame } = drawSettled([['a']], { ...NUMBERED, letterSpacing: 6, fontSize: 18, fontFamily: 'Face' });
        expect(frame.numbers[0]).toMatchObject({ fontSize: 18, fontFamily: 'Face', textAlign: 'left' });
        expect(frame.numbers[0].letterSpacing).toBeUndefined();
    });

    it('puts a number on its row\'s centre', () => {
        const { frame } = drawSettled([['a'], ['b']], NUMBERED);
        expect(frame.numbers.map((n) => n.y)).toEqual(frame.tokens.map((t) => t.y));
    });

    it('right-aligns the numbers, one gap to the left of where the code starts', () => {
        const { frame } = drawSettled([['a'], ['b'], ['c'], ['d'], ['e'], ['f'], ['g'], ['h'], ['i'], ['j']], NUMBERED);
        const code = frame.tokens[0];
        const gap = advanceOf(1, 20, 0) * 2;
        // Every number ends the same distance from the code, a digit wide or two.
        for (const n of frame.numbers) {
            const width = advanceOf(n.text.length, 20, 0);
            expect(n.x + width / 2).toBeCloseTo(code.x - advanceOf(1, 20, 1) / 2 - gap);
        }
    });

    it('draws no number the code has no line for', () => {
        const { frame } = drawSettled([['a']], NUMBERED);
        expect(frame.numbers).toHaveLength(1);
    });
});

describe('drawCode: the number of a line under a highlight', () => {
    const NUMBERED = { showLineNumbers: true };

    function dimmed(opacities: number[][], active = true, rows?: string[][]) {
        const spec = rows ?? opacities.map((row) => row.map((_, i) => `t${i}`));
        const lines = listing(spec);
        const states = new Map<number, TokenState>();
        lines.forEach((line, i) => line.tokens.forEach((token, j) => states.set(token.id, { opacity: opacities[i][j] })));
        const { metrics, cache, frame } = setup(NUMBERED);
        const layout = layoutCode(lines, metrics, cache, frame);
        drawCode(frame, { tokenLines: lines, metrics, advanceCache: cache, from: layout, to: layout, edit: null, tokenStates: states, highlightActive: active });
        return frame.numbers.map((n) => n.opacity);
    }

    it('takes the lowest opacity among the line\'s tokens, so a number stays bright only when the whole line does', () => {
        expect(dimmed([[1, 0.4, 0.7], [1, 1], [0.3, 0.3]])).toEqual([0.4, 1, 0.3]);
    });

    it('stays at full for a line whose every token is bright', () => {
        expect(dimmed([[1, 1, 1]])).toEqual([1]);
    });

    it('ignores a token with no text', () => {
        expect(dimmed([[1, 0.1]], true, [['a', '']])).toEqual([1]);
    });

    it('reads a token with no state as full', () => {
        const lines = listing([['a', 'b']]);
        const states = new Map<number, TokenState>([[lines[0].tokens[1].id, { opacity: 0.5 }]]);
        const { metrics, cache, frame } = setup(NUMBERED);
        const layout = layoutCode(lines, metrics, cache, frame);
        drawCode(frame, { tokenLines: lines, metrics, advanceCache: cache, from: layout, to: layout, edit: null, tokenStates: states, highlightActive: true });
        expect(frame.numbers[0].opacity).toBe(0.5);
    });

    it('is not dimmed when no highlight is engaged, whatever the tokens\' states say', () => {
        expect(dimmed([[1, 0.2]], false)).toEqual([1]);
    });

    it('draws no number at all for a line dimmed to nothing', () => {
        expect(dimmed([[0, 0], [1]])).toHaveLength(1);
        expect(dimmed([[0, 0], [1]])).toEqual([1]);
    });
});

/**
 * An edit part-way: `from` and `to` diffed, and the frame drawn at `progress`
 * of the way through the command (before any easing).
 */
function editFrame(fromRows: string[][], toRows: string[][], progress: number, over: Partial<CodeMetrics> = {}) {
    const { metrics, cache, frame } = setup(over);
    const from = listing(fromRows);
    const to = listing(toRows);
    const fromIds = from.map((line) => [line.id, ...line.tokens.map((t) => t.id)]);
    const edit = diffCode(from, to);
    const transition: StructuralTransition = {
        kind: 'structural',
        from,
        to: edit.lines,
        removedIds: edit.removedIds,
        addedIds: edit.addedIds,
        enteringLineIds: edit.newLineIds,
        fromColorById: edit.fromColorById,
        phases: phasesFor(edit.removedIds.size > 0, edit.addedIds.size > 0),
        progress,
        layoutKey: null,
        fromLayout: null,
        toLayout: null,
    };
    const fromLayout = layoutCode(from, metrics, cache, frame);
    const toLayout = layoutCode(edit.lines, metrics, cache, frame);
    drawCode(frame, {
        tokenLines: edit.lines,
        metrics,
        advanceCache: cache,
        from: fromLayout,
        to: toLayout,
        edit: transition,
        tokenStates: new Map(),
        highlightActive: false,
    });
    return { frame, transition, fromLayout, toLayout, fromIds, from, to: edit.lines, metrics };
}

describe('drawCode: an edit in flight', () => {
    const REPLACE_FROM = [['let', ' ', 'alpha', ' ', '=', ' ', '1']];
    const REPLACE_TO = [['let', ' ', 'beta', ' ', '=', ' ', '1']];

    it('fades what is removed out by the out window, from where it was', () => {
        // Removing and adding: out [0, .38], so 0.19 is half way out.
        const { frame, fromLayout, from } = editFrame(REPLACE_FROM, REPLACE_TO, 0.19);
        const gone = frame.tokens.filter((t) => t.text === 'alpha');
        expect(gone).toHaveLength(1);
        expect(gone[0].opacity).toBeCloseTo(0.5);
        const box = fromLayout.tokens.get(from[0].tokens[2].id)!;
        expect(gone[0].x).toBeCloseTo(box.x + advanceOf(5, 20, 1) / 2);
    });

    it('draws what is removed at full before the edit begins to go, and not at all once it has', () => {
        expect(editFrame(REPLACE_FROM, REPLACE_TO, 0).frame.tokens.find((t) => t.text === 'alpha')?.opacity).toBe(1);
        expect(editFrame(REPLACE_FROM, REPLACE_TO, 0.38).frame.tokens.find((t) => t.text === 'alpha')).toBeUndefined();
        expect(editFrame(REPLACE_FROM, REPLACE_TO, 0.9).frame.tokens.find((t) => t.text === 'alpha')).toBeUndefined();
    });

    it('fades what is added in by the in window, and draws nothing of it until the window opens', () => {
        expect(editFrame(REPLACE_FROM, REPLACE_TO, 0.3).frame.tokens.find((t) => t.text === 'beta')).toBeUndefined();
        // in [.52, 1]: 0.76 is half way.
        const half = editFrame(REPLACE_FROM, REPLACE_TO, 0.76).frame.tokens.find((t) => t.text === 'beta');
        expect(half?.opacity).toBeCloseTo(0.5);
        expect(editFrame(REPLACE_FROM, REPLACE_TO, 1).frame.tokens.find((t) => t.text === 'beta')?.opacity).toBe(1);
    });

    it('moves what survives from its old column to its new one by the eased move window', () => {
        // The name shrinks by a glyph, so the `=` after it moves left by 11 px. move [.10, .68]: 0.39 is half way.
        const { frame, fromLayout, toLayout, from, to } = editFrame(REPLACE_FROM, REPLACE_TO, 0.39);
        const equals = frame.tokens.find((t) => t.text === '=')!;
        const was = fromLayout.tokens.get(from[0].tokens[4].id)!;
        const now = toLayout.tokens.get(to[0].tokens[4].id)!;
        expect(now.x).toBeLessThan(was.x);
        expect(equals.x).toBeCloseTo((was.x + now.x) / 2 + advanceOf(1, 20, 1) / 2);
    });

    it('holds what survives at its old column until the move begins, and at its new one after it ends', () => {
        const start = editFrame(REPLACE_FROM, REPLACE_TO, 0.05);
        const equalsStart = start.frame.tokens.find((t) => t.text === '=')!;
        expect(equalsStart.x).toBeCloseTo(start.fromLayout.tokens.get(start.from[0].tokens[4].id)!.x + advanceOf(1, 20, 1) / 2);
        const end = editFrame(REPLACE_FROM, REPLACE_TO, 0.9);
        const equalsEnd = end.frame.tokens.find((t) => t.text === '=')!;
        expect(equalsEnd.x).toBeCloseTo(end.toLayout.tokens.get(end.to[0].tokens[4].id)!.x + advanceOf(1, 20, 1) / 2);
    });

    it('eases the move: a quarter of the window is less than a quarter of the way', () => {
        // move [.10, .68]: 0.245 is a quarter through it.
        const { frame, fromLayout, toLayout, from, to } = editFrame(REPLACE_FROM, REPLACE_TO, 0.245);
        const equals = frame.tokens.find((t) => t.text === '=')!;
        const was = fromLayout.tokens.get(from[0].tokens[4].id)!.x + advanceOf(1, 20, 1) / 2;
        const now = toLayout.tokens.get(to[0].tokens[4].id)!.x + advanceOf(1, 20, 1) / 2;
        expect(equals.x).toBeCloseTo(was + (now - was) * smoothstep(0.25));
        expect(equals.x).toBeGreaterThan(was + (now - was) * 0.25);
    });

    it('cross-fades a token\'s colour from the old to the new over the move window', () => {
        const rows = (colour: string) => [[`x#${colour}`]];
        // Neither adds nor removes: the move window is the whole of it, so 0.5 is half way, and smoothstep(0.5) is 0.5.
        const { frame } = editFrame(rows('ff0000'), rows('0000ff'), 0.5);
        const mixed = frame.tokens[0].color;
        expect(mixed[0]).toBeCloseTo(0.5);
        expect(mixed[2]).toBeCloseTo(0.5);
        expect(editFrame(rows('ff0000'), rows('0000ff'), 0).frame.tokens[0].color).toEqual(parseColor('#ff0000'));
        expect(editFrame(rows('ff0000'), rows('0000ff'), 1).frame.tokens[0].color).toEqual(parseColor('#0000ff'));
    });

    it('does not cross-fade a token whose colour is the same', () => {
        const { frame } = editFrame([['x#ff0000', ' ', 'y']], [['x#ff0000', ' ', 'z']], 0.5);
        expect(frame.tokens.find((t) => t.text === 'x')?.color).toEqual(parseColor('#ff0000'));
    });

    it('moves a row to its new height by the move window, and fades a new row in place', () => {
        // One row appended above `old`: the new row is a whole row entering, `old` moves down.
        const { frame, fromLayout, toLayout } = editFrame([['old']], [['new', ' ', 'row'], ['old']], 0.275);
        const old = frame.tokens.find((t) => t.text === 'old')!;
        const was = fromLayout.lineY[0];
        const now = toLayout.lineY[1];
        // Adding only: move [0, .55], so 0.275 is half way; smoothstep(0.5) is 0.5.
        expect(old.y).toBeCloseTo((was + now) / 2);
        // The new row is not drawn until its window opens (in [.38, 1])…
        expect(frame.tokens.find((t) => t.text === 'new')).toBeUndefined();
    });

    it('draws a new row at the place it lands, fading as one piece', () => {
        const half = editFrame([['old']], [['new', ' ', 'row'], ['old']], 0.69);
        const row = half.frame.tokens.filter((t) => ['new', ' ', 'row'].includes(t.text));
        expect(row).toHaveLength(3);
        for (const t of row) expect(t.opacity).toBeCloseTo(0.5);
        for (const t of row) expect(t.y).toBe(half.toLayout.lineY[0]);
    });

    it('draws a token spliced into a row that was already there at its landing column, fading', () => {
        // `c` is added to a row that survives: no row is new, and the token fades in where it will sit.
        const { frame, transition, toLayout, to } = editFrame([['a', ' ', 'b']], [['a', ' ', 'b', ' ', 'c']], 0.69);
        expect(transition.enteringLineIds.size).toBe(0);
        const c = frame.tokens.find((t) => t.text === 'c')!;
        expect(c.opacity).toBeCloseTo(windowProgress(transition.phases.in, 0.69));
        expect(c.x).toBeCloseTo(toLayout.tokens.get(to[0].tokens[4].id)!.x + advanceOf(1, 20, 1) / 2);
    });

    it('is the settled frame at progress 1', () => {
        const { frame, to, toLayout } = editFrame(REPLACE_FROM, REPLACE_TO, 1);
        expect(frame.tokens.map((t) => t.text)).toEqual(to[0].tokens.map((t) => t.content));
        expect(frame.tokens.map((t) => t.opacity)).toEqual(to[0].tokens.map(() => 1));
        expect(toLayout.lineY).toHaveLength(1);
    });
});

describe('drawCode: the gutter during an edit', () => {
    const NUMBERED = { showLineNumbers: true };
    const rows = (count: number) => Array.from({ length: count }, (_, i) => [`line${i}`]);

    it('travels a number both structures have to its new row', () => {
        // A row prepended: every old number keeps its slot, but the rows move down.
        const { frame, fromLayout, toLayout } = editFrame([['a'], ['b']], [['new', ' ', 'row'], ['a'], ['b']], 0.275, NUMBERED);
        const one = frame.numbers.find((n) => n.text === '1')!;
        expect(one.y).toBeCloseTo((fromLayout.lineY[0] + toLayout.lineY[0]) / 2);
    });

    it('fades in a number the block grew to reach, by the in window', () => {
        const { frame, transition } = editFrame(rows(2), rows(3), 0.69, NUMBERED);
        const three = frame.numbers.find((n) => n.text === '3')!;
        expect(three.opacity).toBeCloseTo(windowProgress(transition.phases.in, 0.69));
        expect(editFrame(rows(2), rows(3), 0.2, NUMBERED).frame.numbers.find((n) => n.text === '3')).toBeUndefined();
    });

    it('fades out a number the block shrank past, by the out window', () => {
        const { frame, transition } = editFrame(rows(3), rows(2), 0.2, NUMBERED);
        const three = frame.numbers.find((n) => n.text === '3')!;
        expect(three.opacity).toBeCloseTo(1 - windowProgress(transition.phases.out, 0.2));
        expect(editFrame(rows(3), rows(2), 0.9, NUMBERED).frame.numbers.find((n) => n.text === '3')).toBeUndefined();
    });

    it('keeps a number that both structures have at full opacity throughout', () => {
        for (const progress of [0, 0.2, 0.5, 0.8, 1]) {
            const { frame } = editFrame(rows(2), rows(3), progress, NUMBERED);
            expect(frame.numbers.find((n) => n.text === '1')?.opacity, `at ${progress}`).toBe(1);
            expect(frame.numbers.find((n) => n.text === '2')?.opacity, `at ${progress}`).toBe(1);
        }
    });

    it('interpolates the gutter: the numbers sit between where they were and where they land when it widens', () => {
        // Nine rows to ten: the widest number goes from one digit to two.
        const before = editFrame(rows(9), rows(10), 0, NUMBERED).frame.numbers.find((n) => n.text === '1')!;
        const after = editFrame(rows(9), rows(10), 1, NUMBERED).frame.numbers.find((n) => n.text === '1')!;
        const middle = editFrame(rows(9), rows(10), 0.5, NUMBERED).frame.numbers.find((n) => n.text === '1')!;
        expect(after.x).not.toBe(before.x);
        const low = Math.min(before.x, after.x);
        const high = Math.max(before.x, after.x);
        expect(middle.x).toBeGreaterThan(low);
        expect(middle.x).toBeLessThan(high);
    });
});

describe('an edit\'s progress, from a command', () => {
    const progressOf = (node: ReturnType<typeof make>) => listingOf(node).edit?.progress;

    it('is the command\'s own time when it has no easing', () => {
        const node = make('a');
        const edit = node.append({ data: { code: '\nb' }, duration: 1 }) as Command<unknown>;
        at(edit, 0.5);
        expect(progressOf(node)).toBe(0.5);
        at(edit, 0.25);
        expect(progressOf(node)).toBe(0.25);
    });

    it('goes through the easing the command is given', () => {
        const node = make('a');
        const edit = node.append({ data: { code: '\nb' }, duration: 1, easing: (t: number) => t * t }) as Command<unknown>;
        at(edit, 0.5);
        expect(progressOf(node)).toBe(0.25);
        at(edit, 0.8);
        expect(progressOf(node)).toBeCloseTo(0.64);
    });

    it('draws a frame the easing has moved: the same time looks different eased', () => {
        const straight = make('a');
        const eased = make('a');
        const plain = straight.append({ data: { code: '\nbbbb' }, duration: 1 }) as Command<unknown>;
        const slow = eased.append({ data: { code: '\nbbbb' }, duration: 1, easing: () => 0 }) as Command<unknown>;
        at(plain, 0.69);
        at(slow, 0.69);
        const opacityOfRow = (node: ReturnType<typeof make>) => render(node).tokens.find((t) => t.text === 'bbbb')?.opacity ?? 0;
        expect(opacityOfRow(straight)).toBeGreaterThan(0);
        expect(opacityOfRow(eased)).toBe(0);
    });
});
