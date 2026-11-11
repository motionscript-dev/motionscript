import { describe, it, expect } from 'vitest';
import { commandSequence, ContextMap, type Command, type Node } from '@motionscript/sdk';
import { ManifestAssetCatalog } from '@motionscript/core';
import { Code, listingOf } from '../node';
import { erase } from './harness.fixtures';
import { lines, word } from '../code-range';

/**
 * Put `node` in a live tree.
 *
 * Measuring, drawing and animating are all gated on a node being attached, so a
 * unit test has to say so explicitly — the runtime does this once per frame for
 * the whole scene.
 */
function attach<T extends Node>(node: T): T {
    node.attach({
        assets: new ManifestAssetCatalog({ image: {}, video: {}, audio: {}, font: {} }),
        context: ContextMap.EMPTY,
        time: 0,
    });
    return node;
}


const SOURCE = 'function add(a, b) {\n  return a + b;\n}';

function make(code = SOURCE): Code {
    return attach(new Code({ code, language: 'typescript' }));
}

/** The source the listing shows, which is its token structure joined. */
function source(node: Code): string {
    return listingOf(node).source;
}

/** How many edits the node has in flight. */
function inFlight(node: Code): number {
    return listingOf(node).edit ? 1 : 0;
}

/**
 * Run a command as a generator, which is still how a sequential scene drives
 * one — `Command` is iterable precisely so `yield*` keeps working.
 */
function drive(command: Command<unknown>, steps: number, dt: number): void {
    const step = command._stepper();
    step.seek(0);
    for (let i = 0; i < steps; i++) step.advance(dt);
}

describe('editing commands', () => {
    it('appends to the end of the source', () => {
        const node = make();
        drive(node.append({ data: { code: '\nadd(1, 2);' }, duration: 1 }), 120, 0.01);
        expect(source(node)).toBe(`${SOURCE}\nadd(1, 2);`);
    });

    it('prepends above the source', () => {
        const node = make();
        drive(node.prepend({ data: { code: '"use strict";\n' }, duration: 1 }), 120, 0.01);
        expect(source(node)).toBe(`"use strict";\n${SOURCE}`);
    });

    it('inserts at a (line, col)', () => {
        const node = make();
        drive(node.insert({ data: { position: [1, 14], code: 'x, ' }, duration: 1 }), 120, 0.01);
        expect(source(node)).toBe('function add(x, a, b) {\n  return a + b;\n}');
    });

    it('takes the line break with a whole-line removal', () => {
        const node = make();
        drive(erase(node, { data: { target: lines(2) }, duration: 1 }), 120, 0.01);
        expect(source(node)).toBe('function add(a, b) {\n}');
    });

    it('leaves the row in place for a removal inside a line', () => {
        const node = make();
        drive(erase(node, { data: { target: word(1, 14, 3) }, duration: 1 }), 120, 0.01);
        expect(source(node)).toBe('function add(b) {\n  return a + b;\n}');
    });

    it('removes a blank row, which has no characters to resolve a range from', () => {
        const node = make('a\n\nb');
        drive(erase(node, { data: { target: lines(2) }, duration: 1 }), 120, 0.01);
        expect(source(node)).toBe('a\nb');
    });

    it('replaces a blank row with real content', () => {
        const node = make('a\n\nb');
        drive(node.replace({ data: { target: lines(2), replacement: 'middle' }, duration: 1 }), 120, 0.01);
        expect(source(node)).toBe('a\nmiddle\nb');
    });

    it('replaces one row with several, as rows rather than as newline glyphs', () => {
        const node = make('a\nb');
        drive(node.replace({ data: { target: lines(2), replacement: 'x\ny\nz' }, duration: 1 }), 120, 0.01);
        expect(source(node)).toBe('a\nx\ny\nz');
    });

    it('replaces a line with new content', () => {
        const node = make();
        drive(node.replace({ data: { target: lines(2), replacement: '  return b + a;' }, duration: 1 }), 120, 0.01);
        expect(source(node)).toBe('function add(a, b) {\n  return b + a;\n}');
    });

    it('leaves nothing in flight once an edit lands', () => {
        const node = make();
        drive(node.append({ data: { code: '\n// done' }, duration: 1 }), 120, 0.01);
        expect(inFlight(node)).toBe(0);
    });
});

describe('to({ code })', () => {
    const NEXT = 'function add(a, b) {\n  return a - b;\n}';

    it('animates rather than snapping, and settles on the target', () => {
        const node = make();
        const chain = node.to({ data: { code: NEXT }, duration: 1 });
        const stepper = chain._stepper();

        stepper.seek(0);
        expect(source(node)).toBe(SOURCE);
        expect(inFlight(node)).toBe(0);

        stepper.seek(0.5);
        // Mid-flight the listing already holds the target structure — the frame
        // is drawn by interpolating between the two, not by holding the old one.
        expect(source(node)).toBe(NEXT);
        expect(inFlight(node)).toBe(1);

        stepper.seek(1);
        expect(source(node)).toBe(NEXT);
        expect(inFlight(node)).toBe(0);
    });

    it('scrubs backwards to the listing that preceded it', () => {
        const node = make();
        const stepper = node.to({ data: { code: NEXT }, duration: 1 })._stepper();
        stepper.seek(1);
        stepper.seek(0);
        expect(source(node)).toBe(SOURCE);
        expect(inFlight(node)).toBe(0);
    });

    it('writes the code prop through, so a later edit diffs against it', () => {
        const node = make();
        drive(node.to({ data: { code: NEXT }, duration: 1 }), 120, 0.01);
        expect(node.code).toBe(NEXT);
    });

    it('tweens sibling props in the same step', () => {
        const node = make();
        drive(node.to({ data: { code: NEXT, fontSize: 40 }, duration: 1 }), 120, 0.01);
        expect(node.fontSize).toBe(40);
        expect(source(node)).toBe(NEXT);
    });

    it('falls through to the ordinary tween when code is unchanged', () => {
        const node = make();
        drive(node.to({ data: { code: SOURCE, opacity: 0.5 }, duration: 1 }), 120, 0.01);
        expect(node.opacity).toBeCloseTo(0.5);
        expect(inFlight(node)).toBe(0);
    });

    it('sequences, each step diffing against where the previous one left off', () => {
        const node = make();
        const third = 'function add(a, b) {\n  return a * b;\n}';
        // `commandSequence` rather than the old `sequence`: a command is a value
        // with a declared duration, so running one after another is composition
        // rather than control flow. `to()` still prepares lazily, so the second
        // step's `from` is read when it first runs — which is the whole point of
        // this test.
        drive(
            commandSequence(node, node.to({ data: { code: NEXT }, duration: 1 }), node.to({ data: { code: third }, duration: 1 })) as Command<unknown>,
            240,
            0.01,
        );
        expect(source(node)).toBe(third);
    });
});

describe('one edit carries every change in it', () => {
    // A caller that splits a multi-part change across several commands and runs
    // them together loses all but one: each command resolves and writes back the
    // *whole* listing, so two built from the same starting point are rival copies
    // of the document rather than patches, and the last one driven wins.
    // Everything a step changes therefore has to travel as one edit, and this is
    // the contract that makes that possible.
    it('changes a line and splices another in the same step', () => {
        const node = make();
        const next = 'function add(a, b) {\n  // sum\n  return a + b + 1;\n}';
        drive(node.to({ data: { code: next }, duration: 1 }), 120, 0.01);
        expect(source(node)).toBe(next);
    });

    it('rewrites several separated lines at once', () => {
        const node = make('let a = 1;\nlet b = 2;\nlet c = 3;\nlet d = 4;');
        const next = 'let a = 9;\nlet b = 2;\nlet c = 8;\nlet d = 4;';
        drive(node.to({ data: { code: next }, duration: 1 }), 120, 0.01);
        expect(source(node)).toBe(next);
    });
});

describe('insert: where the position lands', () => {
    // The position is a (line, col) pair, 1-indexed, and is clamped into the document.
    const inserted = (code: string, position: [number, number], text = '#') => {
        const node = make(code);
        drive(node.insert({ data: { position, code: text }, duration: 1 }), 120, 0.01);
        return source(node);
    };

    it('clamps a position past the end of the document to the end of the last line', () => {
        expect(inserted('ab\ncd', [99, 99])).toBe('ab\ncd#');
    });

    it('clamps a column past the end of its line to the end of that line', () => {
        expect(inserted('ab\ncd', [1, 99])).toBe('ab#\ncd');
    });

    it('clamps a line past the end of the document to the last line', () => {
        expect(inserted('ab\ncd', [99, 1])).toBe('ab\n#cd');
    });

    it('clamps a position before the start to the start', () => {
        expect(inserted('ab\ncd', [0, 0])).toBe('#ab\ncd');
        expect(inserted('ab\ncd', [-4, -4])).toBe('#ab\ncd');
    });

    it('inserts before the column named, so column 1 is the start of the line', () => {
        expect(inserted('ab\ncd', [2, 1])).toBe('ab\n#cd');
        expect(inserted('ab\ncd', [2, 2])).toBe('ab\nc#d');
        expect(inserted('ab\ncd', [2, 3])).toBe('ab\ncd#');
    });

    it('inserts into an empty listing, wherever the position says', () => {
        expect(inserted('', [1, 1])).toBe('#');
        expect(inserted('', [99, 99])).toBe('#');
        expect(inserted('', [0, 0])).toBe('#');
    });

    it('inserts on a blank line, which has a column 1 and no more', () => {
        expect(inserted('a\n\nb', [2, 1])).toBe('a\n#\nb');
        expect(inserted('a\n\nb', [2, 9])).toBe('a\n#\nb');
    });

    it('splits the row for a newline in the code, mid-line', () => {
        expect(inserted('abcd', [1, 3], '\n')).toBe('ab\ncd');
        expect(inserted('abcd', [1, 3], 'X\nY')).toBe('abX\nYcd');
    });
});

describe('edits that change nothing', () => {
    const noop = (build: (node: ReturnType<typeof make>) => Command<unknown>, code = SOURCE) => {
        const node = make(code);
        const command = build(node);
        const step = command._stepper();
        step.seek(0);
        step.seek(0.5);
        const midway = { source: source(node), inFlight: inFlight(node) };
        step.seek(1);
        return { duration: command.duration, midway, source: source(node), inFlight: inFlight(node), node };
    };

    it('appends nothing, and leaves the source and the transitions as they were', () => {
        const result = noop((node) => node.append({ data: { code: '' }, duration: 2 }));
        expect(result.duration).toBe(2);
        expect(result.midway).toEqual({ source: SOURCE, inFlight: 0 });
        expect(result.source).toBe(SOURCE);
        expect(result.inFlight).toBe(0);
    });

    it('prepends nothing', () => {
        const result = noop((node) => node.prepend({ data: { code: '' }, duration: 1 }));
        expect(result.midway.inFlight).toBe(0);
        expect(result.source).toBe(SOURCE);
    });

    it('inserts nothing', () => {
        const result = noop((node) => node.insert({ data: { position: [2, 3], code: '' }, duration: 1 }));
        expect(result.midway.inFlight).toBe(0);
        expect(result.source).toBe(SOURCE);
    });

    it('replaces text with the same text', () => {
        const result = noop((node) => node.replace({ data: { target: word(1, 10, 3), replacement: 'add' }, duration: 1 }));
        expect(result.midway.inFlight).toBe(0);
        expect(result.source).toBe(SOURCE);
    });

    it('animates to the source it already shows as an ordinary tween with no edit in it', () => {
        const result = noop((node) => node.to({ data: { code: SOURCE }, duration: 1 }));
        expect(result.midway.inFlight).toBe(0);
        expect(result.source).toBe(SOURCE);
    });

    it('erases an empty range, and takes the command\'s duration all the same', () => {
        const result = noop((node) => erase(node, { data: { target: word(1, 3, 0) }, duration: 3 }));
        expect(result.duration).toBe(3);
        expect(result.midway).toEqual({ source: SOURCE, inFlight: 0 });
        expect(result.source).toBe(SOURCE);
    });

    it('erases an empty range at the end of a line', () => {
        const result = noop((node) => erase(node, { data: { target: word(1, 21, 0) }, duration: 1 }));
        expect(result.source).toBe(SOURCE);
    });

    it('erases the blank row of a listing whose only row is blank, which has nothing to take', () => {
        const result = noop((node) => erase(node, { data: { target: lines(1) }, duration: 1 }), '');
        expect(result.source).toBe('');
    });

    it('erases a range that lies in an empty listing', () => {
        const result = noop((node) => erase(node, { data: { target: word(1, 1, 5) }, duration: 1 }), '');
        expect(result.midway.inFlight).toBe(0);
        expect(result.source).toBe('');
    });
});

describe('replace takes no line break with it', () => {
    it('replaces whole lines with nothing and leaves a blank row, where erase closes the gap', () => {
        const replaced = make('a\nb\nc');
        drive(replaced.replace({ data: { target: lines(2), replacement: '' }, duration: 1 }), 120, 0.01);
        expect(source(replaced)).toBe('a\n\nc');

        const erased = make('a\nb\nc');
        drive(erase(erased, { data: { target: lines(2) }, duration: 1 }), 120, 0.01);
        expect(source(erased)).toBe('a\nc');
    });

    it('agrees with erase inside a line', () => {
        const replaced = make('abcdef');
        drive(replaced.replace({ data: { target: word(1, 2, 3), replacement: '' }, duration: 1 }), 120, 0.01);
        const erased = make('abcdef');
        drive(erase(erased, { data: { target: word(1, 2, 3) }, duration: 1 }), 120, 0.01);
        expect(source(replaced)).toBe('aef');
        expect(source(erased)).toBe('aef');
    });

    it('leaves a blank row that is a row of the listing: three rows still', () => {
        const node = make('a\nb\nc');
        drive(node.replace({ data: { target: lines(2), replacement: '' }, duration: 1 }), 120, 0.01);
        expect(listingOf(node).lines).toHaveLength(3);
    });

    it('takes the last line along with its preceding break when erase removes the end of the listing', () => {
        const node = make('a\nb\nc');
        drive(erase(node, { data: { target: lines(3) }, duration: 1 }), 120, 0.01);
        expect(source(node)).toBe('a\nb');
    });

    it('takes the first line with its following break', () => {
        const node = make('a\nb\nc');
        drive(erase(node, { data: { target: lines(1) }, duration: 1 }), 120, 0.01);
        expect(source(node)).toBe('b\nc');
    });

    it('takes several whole lines and the break after them', () => {
        const node = make('a\nb\nc\nd');
        drive(erase(node, { data: { target: lines(2, 3) }, duration: 1 }), 120, 0.01);
        expect(source(node)).toBe('a\nd');
    });
});

describe('inserting a row in the middle of a line', () => {
    const INSERT_SOURCE = 'function add(a: number, b: number) {\n  return a + b;\n}';

    it('inserts at line 2 col 3, splitting the row where the new text ends in a break', () => {
        const node = make(INSERT_SOURCE);
        drive(node.insert({ data: { position: [2, 3], code: 'if (a < 0) return b;\n  ' }, duration: 1 }), 200, 0.01);
        expect(source(node)).toBe('function add(a: number, b: number) {\n  if (a < 0) return b;\n  return a + b;\n}');
    });

    it('does nothing for a listing that is not in a tree: an edit is animated, and nothing animates unmounted', () => {
        const node = new Code({ code: INSERT_SOURCE, language: 'typescript' });
        drive(node.insert({ data: { position: [2, 3], code: 'x' }, duration: 1 }), 200, 0.01);
        expect(source(node)).toBe(INSERT_SOURCE);
    });
});
