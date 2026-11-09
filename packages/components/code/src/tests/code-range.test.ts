import { describe, it, expect } from 'vitest';
import { ContextMap, type Command, type Node } from '@motionscript/sdk';
import { ManifestAssetCatalog } from '@motionscript/core';
import { Code } from '../node';
import { lines, word, CodeRanges, CodeRangeChain, rangeToCharOffsets, charOffsetsToRange, type CodeRange } from '../code-range';

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

function drive(command: Command<unknown>, steps: number, dt: number): void {
    const step = command._stepper();
    step.seek(0);
    for (let i = 0; i < steps; i++) step.advance(dt);
}

/** Number of tokens `highlight()` currently considers "in range" (opacity 1). */
function highlightedTokenCount(node: Code): number {
    return node.focus.ids.size;
}

describe('CodeRangeChain', () => {
    it('starts empty', () => {
        expect([...new CodeRangeChain()]).toEqual([]);
    });

    it('accumulates ranges in call order', () => {
        const chain = CodeRanges.lines(2).word(5, 1, 3);
        expect(chain.list).toEqual([lines(2), word(5, 1, 3)]);
    });

    it('accumulates same-kind calls too', () => {
        const chain = CodeRanges.lines(2).lines(9);
        expect(chain.list).toEqual([lines(2), lines(9)]);
    });

    it('is iterable and spreadable', () => {
        const chain = CodeRanges.lines(2).word(5, 1, 3);
        expect([...chain]).toEqual([lines(2), word(5, 1, 3)]);
    });

    it('does not mutate a prior chain when extended — each call returns a new one', () => {
        const first = CodeRanges.lines(2);
        const second = first.word(5, 1, 3);
        expect(first.list).toEqual([lines(2)]);
        expect(second.list).toEqual([lines(2), word(5, 1, 3)]);
        expect(first).not.toBe(second);
    });

    it('leaves the shared CodeRanges entry point empty across uses', () => {
        CodeRanges.lines(2); // built and discarded
        CodeRanges.word(1, 1, 1);
        expect(CodeRanges.list).toEqual([]);
    });
});

describe('Code.highlight() with a multi-range selection', () => {
    it('highlights the union of every range in a CodeRanges chain', () => {
        const singleLine = make();
        drive(singleLine.highlight({ data: { target: lines(1) }, duration: 1 }), 120, 0.01);
        const singleLineCount = highlightedTokenCount(singleLine);
        expect(singleLineCount).toBeGreaterThan(0);

        const twoLines = make();
        drive(twoLines.highlight({ data: { target: CodeRanges.lines(1).lines(3) }, duration: 1 }), 120, 0.01);
        const twoLineCount = highlightedTokenCount(twoLines);

        // Line 3 ("}") contributes at least one more token, so the union must
        // be strictly larger than either range alone — proves both ranges
        // were actually resolved, not just the first/last one.
        expect(twoLineCount).toBeGreaterThan(singleLineCount);
    });

    it('also accepts a plain array of ranges, not just a CodeRangeChain', () => {
        const node = make();
        drive(node.highlight({ data: { target: [lines(1), lines(3)] }, duration: 1 }), 120, 0.01);
        expect(highlightedTokenCount(node)).toBeGreaterThan(0);
    });
});

describe('word and lines', () => {
    it('builds a range of a length from a line and a column', () => {
        expect(word(1, 3, 3)).toEqual({ startLine: 1, startCol: 3, endLine: 1, endCol: 6 });
    });

    it('builds a range to the end of the line when it is given no length', () => {
        expect(word(2, 4)).toEqual({ startLine: 2, startCol: 4, endLine: 2, endCol: Infinity });
    });

    it('builds a range over whole lines, from the first column to the end of the last', () => {
        expect(lines(1, 3)).toEqual({ startLine: 1, startCol: 1, endLine: 3, endCol: Infinity });
        expect(lines(2)).toEqual({ startLine: 2, startCol: 1, endLine: 2, endCol: Infinity });
    });
});

describe('rangeToCharOffsets', () => {
    // "hello", "", "abc" joined with newlines: "hello\n\nabc", ten characters, the lines starting at 0, 6 and 7.
    const LENGTHS = [5, 0, 3];
    const range = (startLine: number, startCol: number, endLine: number, endCol: number): CodeRange => ({ startLine, startCol, endLine, endCol });
    const offsets = (r: CodeRange, lengths = LENGTHS) => rangeToCharOffsets(r, lengths);

    it('reads 1-indexed columns as the offsets of the characters between them', () => {
        expect(offsets(range(1, 2, 1, 4))).toEqual({ start: 1, end: 3 });
        expect(offsets(range(3, 1, 3, 3))).toEqual({ start: 7, end: 9 });
    });

    it('counts the newline that joins one line to the next', () => {
        expect(offsets(range(1, 3, 3, 2))).toEqual({ start: 2, end: 8 });
    });

    it('reads an end of Infinity as the end of its line', () => {
        expect(offsets(word(1, 3))).toEqual({ start: 2, end: 5 });
        expect(offsets(lines(1, 3))).toEqual({ start: 0, end: 10 });
    });

    it('reads an end that JSON turned into null as the end of the line and the end of the document', () => {
        const stored = JSON.parse(JSON.stringify(lines(1, 3))) as CodeRange;
        expect(stored.endCol).toBeNull();
        expect(offsets(stored)).toEqual({ start: 0, end: 10 });
        const open = JSON.parse(JSON.stringify({ startLine: 1, startCol: 3, endLine: Infinity, endCol: Infinity })) as CodeRange;
        expect(offsets(open)).toEqual({ start: 2, end: 10 });
    });

    it('clamps a column past the end of its line to the end of the line', () => {
        expect(offsets(range(1, 2, 1, 99))).toEqual({ start: 1, end: 5 });
        expect(offsets(range(1, 99, 1, 99))).toEqual({ start: 5, end: 5 });
    });

    it('clamps a column before the first to the first', () => {
        expect(offsets(range(1, 0, 1, 3))).toEqual({ start: 0, end: 2 });
        expect(offsets(range(1, -4, 1, 3))).toEqual({ start: 0, end: 2 });
    });

    it('clamps a line outside the document to its first or last line', () => {
        expect(offsets(range(0, 1, 1, 3))).toEqual({ start: 0, end: 2 });
        expect(offsets(range(-5, 1, 1, 3))).toEqual({ start: 0, end: 2 });
        expect(offsets(range(3, 1, 99, Infinity))).toEqual({ start: 7, end: 10 });
        expect(offsets(range(99, 1, 99, Infinity))).toEqual({ start: 7, end: 10 });
    });

    it('puts a range on a blank line at its one offset', () => {
        expect(offsets(range(2, 1, 2, Infinity))).toEqual({ start: 6, end: 6 });
        expect(offsets(lines(2))).toEqual({ start: 6, end: 6 });
    });

    it('orders a range that was given backwards', () => {
        expect(offsets(range(3, 3, 1, 2))).toEqual({ start: 1, end: 9 });
        expect(offsets(range(1, 4, 1, 2))).toEqual({ start: 1, end: 3 });
    });

    it('is an empty range at 0 for an empty document', () => {
        expect(offsets(word(1, 1, 5), [])).toEqual({ start: 0, end: 0 });
        expect(offsets(lines(1, 9), [])).toEqual({ start: 0, end: 0 });
    });

    it('is an empty range at 0 for a document of one empty line', () => {
        expect(offsets(lines(1), [0])).toEqual({ start: 0, end: 0 });
    });

    it('never runs past the end of the document, a trailing blank line included', () => {
        // "a\n" is two lines, the second blank: ends at offset 2.
        expect(offsets(lines(1, 2), [1, 0])).toEqual({ start: 0, end: 2 });
        expect(offsets(range(2, 1, 2, 5), [1, 0])).toEqual({ start: 2, end: 2 });
    });
});

describe('charOffsetsToRange', () => {
    const LENGTHS = [5, 0, 3];

    it('reads offsets back as 1-indexed lines and columns', () => {
        expect(charOffsetsToRange(1, 3, LENGTHS)).toEqual({ startLine: 1, startCol: 2, endLine: 1, endCol: 4 });
        expect(charOffsetsToRange(8, 10, LENGTHS)).toEqual({ startLine: 3, startCol: 2, endLine: 3, endCol: 4 });
    });

    it('spans lines', () => {
        expect(charOffsetsToRange(2, 9, LENGTHS)).toEqual({ startLine: 1, startCol: 3, endLine: 3, endCol: 3 });
    });

    it('puts an offset at the end of a line on that line, one past its last character', () => {
        expect(charOffsetsToRange(0, 5, LENGTHS)).toEqual({ startLine: 1, startCol: 1, endLine: 1, endCol: 6 });
    });

    it('puts the offset of a blank line on the blank line', () => {
        expect(charOffsetsToRange(6, 6, LENGTHS)).toEqual({ startLine: 2, startCol: 1, endLine: 2, endCol: 1 });
    });

    it('puts the first offset of a line after the break at column 1 of it', () => {
        expect(charOffsetsToRange(7, 8, LENGTHS)).toEqual({ startLine: 3, startCol: 1, endLine: 3, endCol: 2 });
    });

    it('is the inverse of rangeToCharOffsets for a range inside the document', () => {
        const ranges: CodeRange[] = [
            { startLine: 1, startCol: 2, endLine: 1, endCol: 4 },
            { startLine: 1, startCol: 3, endLine: 3, endCol: 3 },
            { startLine: 3, startCol: 1, endLine: 3, endCol: 4 },
            { startLine: 1, startCol: 1, endLine: 1, endCol: 6 },
        ];
        for (const r of ranges) {
            const { start, end } = rangeToCharOffsets(r, LENGTHS);
            expect(charOffsetsToRange(start, end, LENGTHS), JSON.stringify(r)).toEqual(r);
        }
    });

    it('turns the range of a whole document into lines the first and the last', () => {
        const { start, end } = rangeToCharOffsets(lines(1, 3), LENGTHS);
        expect(charOffsetsToRange(start, end, LENGTHS)).toEqual({ startLine: 1, startCol: 1, endLine: 3, endCol: 4 });
    });
});

