import { beforeAll, describe, expect, it } from 'vitest';
import { Code, findAllRanges, findFirstRange, findRangeAt } from '../node';
import { ensureHighlighter } from '../highlight';
import { rangeToCharOffsets, type CodeRange } from '../code-range';
import { SOURCE, at, drive, erase, make, sourceOf } from './harness.fixtures';

/**
 * Finding text in a listing's source: literal, case-sensitive, non-overlapping,
 * and answered in the 1-indexed ranges the commands take.
 *
 *   function add(a, b) {
 *     return a + b;
 *   }
 */

beforeAll(async () => {
    await ensureHighlighter(undefined, ['typescript']);
});

const range = (startLine: number, startCol: number, endLine: number, endCol: number): CodeRange => ({ startLine, startCol, endLine, endCol });

describe('findAllRanges', () => {
    it('returns the range of a word on one line', () => {
        expect(findAllRanges(make().code, 'add')).toEqual([range(1, 10, 1, 13)]);
    });

    it('returns every match, in order, across lines', () => {
        expect(findAllRanges(make().code, 'return')).toEqual([range(2, 3, 2, 9)]);
        expect(findAllRanges(make().code, ' b')).toEqual([range(1, 16, 1, 18), range(2, 13, 2, 15)]);
    });

    it('matches a run that spans a line break', () => {
        expect(findAllRanges(make().code, ';\n}')).toEqual([range(2, 15, 3, 2)]);
        expect(findAllRanges(make().code, '{\n  return')).toEqual([range(1, 20, 2, 9)]);
    });

    it('matches the literal text, not a pattern', () => {
        const node = make('a.c abc a+c');
        expect(findAllRanges(node.code, 'a.c')).toEqual([range(1, 1, 1, 4)]);
        expect(findAllRanges(node.code, 'a+c')).toEqual([range(1, 9, 1, 12)]);
        expect(findAllRanges(node.code, '.*')).toEqual([]);
    });

    it('is case-sensitive', () => {
        expect(findAllRanges(make().code, 'Add')).toEqual([]);
        expect(findAllRanges(make().code, 'FUNCTION')).toEqual([]);
    });

    it('does not overlap matches', () => {
        const node = make('aaaa');
        expect(findAllRanges(node.code, 'aa')).toEqual([range(1, 1, 1, 3), range(1, 3, 1, 5)]);
        expect(findAllRanges(make('aaa').code, 'aa')).toEqual([range(1, 1, 1, 3)]);
    });

    it('is empty for text that is not there', () => {
        expect(findAllRanges(make().code, 'nowhere')).toEqual([]);
    });

    it('is empty for empty text, rather than matching everywhere', () => {
        expect(findAllRanges(make().code, '')).toEqual([]);
    });

    it('finds the text of a listing that is empty', () => {
        expect(findAllRanges(make('').code, 'a')).toEqual([]);
    });

    it('reads a range back as the characters it matched', () => {
        const node = make();
        const lengths = SOURCE.split('\n').map((line) => line.length);
        for (const text of ['add', 'a + b', ';\n}', 'function']) {
            for (const found of findAllRanges(node.code, text)) {
                const { start, end } = rangeToCharOffsets(found, lengths);
                expect(SOURCE.slice(start, end)).toBe(text);
            }
        }
    });

    it('counts a blank line between matches', () => {
        const node = make('x\n\nx');
        expect(findAllRanges(node.code, 'x')).toEqual([range(1, 1, 1, 2), range(3, 1, 3, 2)]);
    });

    it('reads a source with CRLF line breaks as the lines they break', () => {
        expect(findFirstRange(make('one\r\ntwo').code, 'two')).toEqual(range(2, 1, 2, 4));
    });

    it('answers for the source a finished edit left behind', () => {
        const node = make();
        drive(node.append({ data: { code: '\nadd(1, 2);' }, duration: 1 }), 120, 0.01);
        expect(sourceOf(node)).toBe(`${SOURCE}\nadd(1, 2);`);
        expect(findAllRanges(node.code, 'add')).toEqual([range(1, 10, 1, 13), range(4, 1, 4, 4)]);
    });

    it('answers for the listing the props describe before any edit has begun', () => {
        const node = make('first');
        const edit = node.append({ data: { code: '\nsecond' }, duration: 1 });
        at(edit, 0);
        expect(findAllRanges(node.code, 'second')).toEqual([]);
        at(edit, 1);
        expect(findAllRanges(node.code, 'second')).toEqual([range(2, 1, 2, 7)]);
    });
});

describe('findRangeAt', () => {
    it('returns the nth match', () => {
        const node = make();
        expect(findRangeAt(node.code, ' b', 0)).toEqual(range(1, 16, 1, 18));
        expect(findRangeAt(node.code, ' b', 1)).toEqual(range(2, 13, 2, 15));
    });

    it('is null past the last match, and for an index below 0', () => {
        const node = make();
        expect(findRangeAt(node.code, ' b', 2)).toBeNull();
        expect(findRangeAt(node.code, ' b', -1)).toBeNull();
        expect(findRangeAt(node.code, 'nowhere', 0)).toBeNull();
    });

    it('is null for empty text', () => {
        expect(findRangeAt(make().code, '', 0)).toBeNull();
    });
});

describe('findFirstRange', () => {
    it('returns the first match', () => {
        expect(findFirstRange(make().code, ' b')).toEqual(range(1, 16, 1, 18));
    });

    it('is null when there is none', () => {
        expect(findFirstRange(make().code, 'nowhere')).toBeNull();
        expect(findFirstRange(make().code, '')).toBeNull();
    });
});

describe('a range that was found', () => {
    it('is the target a command takes: erase it and it is gone', () => {
        const node = make();
        const target = findFirstRange(node.code, 'a + b')!;
        drive(erase(node, { data: { target }, duration: 1 }), 120, 0.01);
        expect(sourceOf(node)).toBe('function add(a, b) {\n  return ;\n}');
    });

    it('selects exactly the tokens it spells: highlight and find agree', () => {
        const node = make();
        const target = findFirstRange(node.code, 'return')!;
        drive(node.highlight({ data: { target }, duration: 1 }), 120, 0.01);
        const ids = node.focus.ids;
        expect(ids.size).toBe(1);
    });

    it('works on a node that was never given a grammar', () => {
        const flat = new Code({ code: 'a b\nc a', language: 'klingon' });
        expect(findAllRanges(flat.code, 'a')).toEqual([range(1, 1, 1, 2), range(2, 3, 2, 4)]);
    });
});
