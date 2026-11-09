import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { ensureHighlighter, highlightToTokens } from '../highlight';
import { DefaultHighlightStyle, GithubDarkStyle } from '../style';
import { makeIdLine, makeIdToken, splitTokensAt, tokenizeCodeToIdLines, type IdLine } from '../tokens';

/**
 * Tokenizing against a loaded grammar: what a listing is split into, and the
 * colour each piece takes from the theme.
 */

beforeAll(async () => {
    await ensureHighlighter(undefined, ['typescript', 'json', 'python']);
});

let warn: MockInstance<typeof console.warn>;
beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => { });
});
afterEach(() => {
    warn.mockRestore();
});

/** The lines as `content` and `color`, without the ids that are minted fresh every time. */
function flat(lines: IdLine[]) {
    return lines.map((line) => line.tokens.map((token) => [token.content, token.color]));
}

const NORD = {
    keyword: '#5e81ac',
    variable: '#8fbcbb',
    operator: '#a3be8c',
    number: '#b48ead',
    plain: '#d8dee9',
};

describe('tokenizing const a = 1;', () => {
    it('splits at the parse tree\'s leaves, including the gaps between them', () => {
        const [line] = tokenizeCodeToIdLines('const a = 1;', 'typescript', DefaultHighlightStyle);
        expect(line.tokens.map((token) => token.content)).toEqual(['const', ' ', 'a', ' ', '=', ' ', '1', ';']);
    });

    it('colours each run from the theme: the innermost node at its first character, the default colour for a gap', () => {
        const lines = tokenizeCodeToIdLines('const a = 1;', 'typescript', DefaultHighlightStyle);
        expect(flat(lines)).toEqual([
            [
                ['const', NORD.keyword],
                [' ', NORD.plain],
                ['a', NORD.variable],
                [' ', NORD.plain],
                ['=', NORD.operator],
                [' ', NORD.plain],
                ['1', NORD.number],
                [';', NORD.operator],
            ],
        ]);
    });

    it('colours with the theme it is given', () => {
        const lines = tokenizeCodeToIdLines('const a = 1;', 'typescript', GithubDarkStyle);
        expect(lines[0].tokens.map((token) => token.color)).toEqual([
            '#ff7b72', '#c9d1d9', '#79c0ff', '#c9d1d9', '#79c0ff', '#c9d1d9', '#79c0ff', '#c9d1d9',
        ]);
    });

    it('resolves a theme by name', () => {
        const byName = tokenizeCodeToIdLines('const a = 1;', 'typescript', 'github-dark');
        const byStyle = tokenizeCodeToIdLines('const a = 1;', 'typescript', GithubDarkStyle);
        expect(flat(byName)).toEqual(flat(byStyle));
    });

    it('joins back to the source it was given', () => {
        const source = 'function add(a: number, b: number) {\n  // sum\n  return a + b;\n}';
        const lines = tokenizeCodeToIdLines(source, 'typescript', DefaultHighlightStyle);
        expect(lines.map((line) => line.tokens.map((token) => token.content).join('')).join('\n')).toBe(source);
    });
});

describe('lines', () => {
    it('breaks a run at a newline, so no token spans two rows', () => {
        const lines = tokenizeCodeToIdLines('/* a\nb */', 'typescript', DefaultHighlightStyle);
        expect(lines.map((line) => line.tokens.map((token) => token.content))).toEqual([['/* a'], ['b */']]);
        for (const line of lines) for (const token of line.tokens) expect(token.content).not.toContain('\n');
    });

    it('gives a blank line no tokens at all', () => {
        const lines = tokenizeCodeToIdLines('a\n\nb', 'typescript', DefaultHighlightStyle);
        expect(lines.map((line) => line.tokens.length)).toEqual([1, 0, 1]);
    });

    it('is one empty line for no source', () => {
        const lines = tokenizeCodeToIdLines('', 'typescript', DefaultHighlightStyle);
        expect(lines).toHaveLength(1);
        expect(lines[0].tokens).toEqual([]);
    });

    it('reads CRLF as a line break', () => {
        const lines = tokenizeCodeToIdLines('x = 1\r\ny = 2', 'python', DefaultHighlightStyle);
        expect(lines).toHaveLength(2);
        expect(lines.flatMap((line) => line.tokens).every((token) => !token.content.includes('\r'))).toBe(true);
    });

    it('keeps a comment on its own line in the comment colour', () => {
        const lines = tokenizeCodeToIdLines('// hi\nfoo("x")', 'typescript', DefaultHighlightStyle);
        expect(flat(lines)[0]).toEqual([['// hi', '#4c566a']]);
        expect(lines[1].tokens.map((token) => token.content)).toEqual(['foo', '(', '"x"', ')']);
        expect(lines[1].tokens[2].color).toBe('#a3be8c');
    });

    it('colours a JSON document through its own grammar', () => {
        const lines = tokenizeCodeToIdLines('{"a": [1, true, null]}', 'json', DefaultHighlightStyle);
        const byContent = Object.fromEntries(lines[0].tokens.map((token) => [token.content, token.color]));
        expect(byContent['1']).toBe(NORD.number);
        expect(byContent['true']).toBe('#d08770');
        expect(byContent['null']).toBe(NORD.keyword);
    });
});

describe('ids', () => {
    it('gives every token and every line a fresh id', () => {
        const lines = tokenizeCodeToIdLines('a = 1\nb = 2', 'python', DefaultHighlightStyle);
        const ids = [...lines.map((line) => line.id), ...lines.flatMap((line) => line.tokens.map((token) => token.id))];
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('does not reuse an id across two tokenizations of the same source', () => {
        const one = tokenizeCodeToIdLines('a = 1', 'python', DefaultHighlightStyle);
        const two = tokenizeCodeToIdLines('a = 1', 'python', DefaultHighlightStyle);
        const idsOne = new Set(one[0].tokens.map((token) => token.id));
        for (const token of two[0].tokens) expect(idsOne.has(token.id)).toBe(false);
        expect(two[0].id).not.toBe(one[0].id);
    });

    it('counts up, so the ids of a listing are increasing', () => {
        const a = makeIdToken('a');
        const b = makeIdToken('b', '#fff');
        expect(b.id).toBeGreaterThan(a.id);
        expect(b).toMatchObject({ content: 'b', color: '#fff' });
        expect(a.color).toBeUndefined();
        expect(makeIdLine([a, b]).tokens).toEqual([a, b]);
    });
});

describe('a grammar that has not loaded', () => {
    it('gives one token per source line, in the fallback colour', () => {
        const lines = tokenizeCodeToIdLines('first\n\nthird', 'klingon', DefaultHighlightStyle);
        expect(flat(lines)).toEqual([[['first', '#d1d5db']], [['', '#d1d5db']], [['third', '#d1d5db']]]);
    });

    it('does not depend on the theme for that colour', () => {
        const lines = tokenizeCodeToIdLines('a', 'klingon', GithubDarkStyle);
        expect(lines[0].tokens[0].color).toBe('#d1d5db');
    });

    it('reports an unknown theme even so', () => {
        tokenizeCodeToIdLines('a', 'klingon', 'no-such-theme-tokens');
        expect(warn.mock.calls.filter((call: unknown[]) => String(call[0]).includes('"no-such-theme-tokens"'))).toHaveLength(1);
    });

    it('hands the highlighter\'s own fallback the theme\'s default colour instead', () => {
        const lines = highlightToTokens('ab\ncd', 'klingon', GithubDarkStyle);
        expect(lines).toEqual([[{ content: 'ab', color: '#c9d1d9' }], [{ content: 'cd', color: '#c9d1d9' }]]);
    });
});

describe('splitTokensAt', () => {
    const tokens = () => [makeIdToken('const', '#1'), makeIdToken(' ', '#2'), makeIdToken('name', '#3')];

    it('splits a token the column falls inside, into two with fresh ids and the same colour', () => {
        const original = tokens();
        const { before, after } = splitTokensAt(original, 8);
        expect(before.map((token) => token.content)).toEqual(['const', ' ', 'na']);
        expect(after.map((token) => token.content)).toEqual(['me']);
        const cut = original[2];
        expect(before[2].id).not.toBe(cut.id);
        expect(after[0].id).not.toBe(cut.id);
        expect(before[2].id).not.toBe(after[0].id);
        expect(before[2].color).toBe('#3');
        expect(after[0].color).toBe('#3');
    });

    it('keeps the tokens on either side of a column that falls between two, ids and all', () => {
        const original = tokens();
        const { before, after } = splitTokensAt(original, 5);
        expect(before).toEqual([original[0]]);
        expect(after).toEqual([original[1], original[2]]);
        expect(before[0]).toBe(original[0]);
    });

    it('puts everything before a column at the end, and everything after one at the start', () => {
        const original = tokens();
        expect(splitTokensAt(original, 99)).toEqual({ before: original, after: [] });
        expect(splitTokensAt(original, 0)).toEqual({ before: [], after: original });
    });

    it('splits nothing for no tokens', () => {
        expect(splitTokensAt([], 3)).toEqual({ before: [], after: [] });
    });
});
