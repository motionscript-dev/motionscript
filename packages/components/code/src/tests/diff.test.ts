import { describe, it, expect } from 'vitest';
import { diffCode } from '../diff';
import { makeIdLine, makeIdToken, type IdLine } from '../tokens';

/** The per-run budget the README documents. */
const LINE_ALIGN_CELLS = 40_000;

/**
 * Build a structure by hand rather than through the tokenizer: these are tests
 * of the *diff*, and the grammar is not loaded in a unit run anyway (the
 * tokenizer would hand back one flat token per line and hide every alignment
 * question worth asking).
 */
function lines(rows: string[][]): IdLine[] {
    return rows.map(tokens => makeIdLine(tokens.map(t => makeIdToken(t))));
}

function idsOf(line: IdLine): number[] {
    return line.tokens.map(t => t.id);
}

describe('diffCode', () => {
    it('keeps the identity of tokens a one-word edit did not touch', () => {
        const before = lines([['const', ' ', 'variable', ' ', '=', ' ', '3', ';']]);
        const after = lines([['const', ' ', 'number', ' ', '=', ' ', '3', ';']]);
        const kept = idsOf(before[0]);

        const edit = diffCode(before, after);

        // `const`, the spaces, `=`, `3` and `;` all survive — only the name is
        // replaced, which is the whole point: they move, they don't re-enter.
        const surviving = idsOf(edit.lines[0]);
        expect(surviving[0]).toBe(kept[0]);
        expect(surviving[4]).toBe(kept[4]);
        expect(surviving[6]).toBe(kept[6]);
        expect(surviving[7]).toBe(kept[7]);

        expect(edit.removedIds).toEqual(new Set([kept[2]]));
        expect(edit.addedIds).toEqual(new Set([surviving[2]]));
        expect(edit.newLineIds.size).toBe(0);
    });

    it('keeps a line identity when the line was edited, not replaced', () => {
        const before = lines([['a', '(', '1', ')']]);
        const after = lines([['a', '(', '2', ')']]);
        const lineId = before[0].id;

        const edit = diffCode(before, after);

        expect(edit.lines[0].id).toBe(lineId);
        expect(edit.newLineIds.size).toBe(0);
    });

    it('treats a wholly different line as a new row rather than an edit', () => {
        const before = lines([['const', ' ', 'x', ' ', '=', ' ', '1', ';']]);
        const after = lines([['throw', ' ', 'new', ' ', 'Error', '(', ')']]);

        const edit = diffCode(before, after);

        expect(edit.newLineIds).toEqual(new Set([edit.lines[0].id]));
        expect(edit.lines[0].id).not.toBe(before[0].id);
    });

    it('reports appended rows as new and leaves the rest untouched', () => {
        const before = lines([['one'], ['two']]);
        const after = lines([['one'], ['two'], ['three']]);
        const keptLineIds = before.map(l => l.id);
        const keptTokenIds = before.flatMap(idsOf);

        const edit = diffCode(before, after);

        expect(edit.lines.slice(0, 2).map(l => l.id)).toEqual(keptLineIds);
        expect(edit.lines.slice(0, 2).flatMap(idsOf)).toEqual(keptTokenIds);
        expect(edit.newLineIds).toEqual(new Set([edit.lines[2].id]));
        expect(edit.removedIds.size).toBe(0);
    });

    it('reports prepended rows as new without disturbing the rows below', () => {
        const before = lines([['body']]);
        const after = lines([['import'], ['body']]);
        const keptLineId = before[0].id;

        const edit = diffCode(before, after);

        expect(edit.lines[1].id).toBe(keptLineId);
        expect(edit.newLineIds).toEqual(new Set([edit.lines[0].id]));
    });

    it('reports a deleted row as removed and keeps its neighbours', () => {
        const before = lines([['head'], ['debug'], ['tail']]);
        const after = lines([['head'], ['tail']]);
        const goneId = before[1].tokens[0].id;

        const edit = diffCode(before, after);

        expect(edit.removedIds).toEqual(new Set([goneId]));
        expect(edit.addedIds.size).toBe(0);
        expect(edit.lines.map(l => l.id)).toEqual([before[0].id, before[2].id]);
    });

    it('records the previous colour of a token whose highlighting changed', () => {
        const before: IdLine[] = [makeIdLine([makeIdToken('name', '#aaa')])];
        const after: IdLine[] = [makeIdLine([makeIdToken('name', '#bbb')])];
        const id = before[0].tokens[0].id;

        const edit = diffCode(before, after);

        expect(edit.lines[0].tokens[0].id).toBe(id);
        expect(edit.fromColorById.get(id)).toBe('#aaa');
        expect(edit.removedIds.size).toBe(0);
    });

    it('matches on visible content, not on the whitespace between it', () => {
        // Re-indenting a line must not be read as "the two-space token moved and
        // everything else is new".
        const before = lines([['  ', 'return', ' ', 'sum', ';']]);
        const after = lines([['    ', 'return', ' ', 'sum', ';']]);
        const keptReturn = before[0].tokens[1].id;

        const edit = diffCode(before, after);

        expect(edit.lines[0].tokens[1].id).toBe(keptReturn);
        expect(edit.newLineIds.size).toBe(0);
    });

    it('handles an empty starting listing', () => {
        const edit = diffCode([], lines([['hello']]));
        expect(edit.newLineIds.size).toBe(1);
        expect(edit.removedIds.size).toBe(0);
    });
});


/** A listing of `count` rows, each a handful of tokens that differ from every other row's. */
function listing(count: number, tag = 'row'): IdLine[] {
    return lines(Array.from({ length: count }, (_, n) => ['const', ' ', `${tag}${n}`, ' ', '=', ' ', `${n}`, ';']));
}

describe('diffCode on a long listing', () => {
    it('keeps every row it did not edit, wherever the edits are', () => {
        const before = listing(600);
        const ids = before.map(line => line.id);
        const after = listing(600);
        after[0] = lines([['const', ' ', 'row0', ' ', '=', ' ', '"first"', ';']])[0];
        after[300] = lines([['const', ' ', 'row300', ' ', '=', ' ', '"middle"', ';']])[0];
        after.splice(450, 0, ...lines([['// inserted']]));
        after[after.length - 1] = lines([['const', ' ', 'row599', ' ', '=', ' ', '"last"', ';']])[0];

        const edit = diffCode(before, after);

        // Edited rows are the same rows with one changed token; the inserted row is new.
        expect(edit.newLineIds.size).toBe(1);
        expect(edit.lines[0].id).toBe(ids[0]);
        expect(edit.lines[300].id).toBe(ids[300]);
        expect(edit.lines[451].id).toBe(ids[450]);
        expect(edit.lines[after.length - 1].id).toBe(ids[599]);
        expect(edit.lines.filter((line, k) => k !== 450 && !ids.includes(line.id))).toHaveLength(0);
    });

    it('does not pay for a listing it mostly leaves alone', () => {
        // 4,000 rows would be 16 million line pairs to score; only the rows between
        // the anchors are scored now.
        const before = listing(4000);
        const after = listing(4000);
        after[10] = lines([['changed', ' ', 'row']])[0];
        after[2000] = lines([['changed', ' ', 'again']])[0];
        after[3990] = lines([['changed', ' ', 'last']])[0];

        const started = performance.now();
        const edit = diffCode(before, after);
        const elapsed = performance.now() - started;

        expect(elapsed).toBeLessThan(1000);
        expect(edit.removedIds.size).toBeGreaterThan(0);
        expect(edit.lines[11].id).toBe(before[11].id);
    });

    it('compares a run of changed rows within the budget', () => {
        const rows = Math.floor(Math.sqrt(LINE_ALIGN_CELLS)) - 1;
        const before = listing(rows, 'old');
        const after = lines(before.map(line => line.tokens.map(t => (t.content.startsWith('old') ? t.content.replace('old', 'new') : t.content))));
        const edit = diffCode(before, after);
        // Same shape, one word differs on every row: they are edits, not new rows.
        expect(edit.newLineIds.size).toBe(0);
        expect(edit.lines[5].id).toBe(before[5].id);
    });

    it('turns a run past the budget into whole rows leaving and entering', () => {
        const rows = Math.ceil(Math.sqrt(LINE_ALIGN_CELLS)) + 5;
        expect(rows * rows).toBeGreaterThan(LINE_ALIGN_CELLS);
        const before = listing(rows, 'old');
        const after = lines(before.map(line => line.tokens.map(t => (t.content.startsWith('old') ? t.content.replace('old', 'new') : t.content))));

        const edit = diffCode(before, after);

        expect(edit.newLineIds.size).toBe(rows);
        expect(edit.removedIds.size).toBe(before.reduce((n, line) => n + line.tokens.length, 0));
    });
});


/** A line of `n` visible characters, as one token. */
const run = (n: number, char = 'a') => char.repeat(n);

describe('diffCode: when two lines are one line edited', () => {
    // A pair scores its similarity minus 0.45, and only a positive score pairs. Similarity is twice the
    // shared visible characters over both lines' visible characters, so these share 9, 10 or 8 of 40.
    const edit = (shared: number) => {
        const before = lines([[run(shared), run(20 - shared, 'b')]]);
        const after = lines([[run(shared), run(20 - shared, 'c')]]);
        return { before, after, edit: diffCode(before, after) };
    };

    it('pairs the lines above the floor, keeping the line and the shared token', () => {
        const { before, edit: result } = edit(10);
        expect(result.lines[0].id).toBe(before[0].id);
        expect(result.newLineIds.size).toBe(0);
        expect(result.lines[0].tokens[0].id).toBe(before[0].tokens[0].id);
    });

    it('does not pair lines exactly at the floor: a score must be above nothing', () => {
        const { before, edit: result } = edit(9);
        expect(result.lines[0].id).not.toBe(before[0].id);
        expect(result.newLineIds).toEqual(new Set([result.lines[0].id]));
    });

    it('does not pair lines below it', () => {
        const { before, edit: result } = edit(8);
        expect(result.newLineIds).toEqual(new Set([result.lines[0].id]));
        expect(result.removedIds).toEqual(new Set(before[0].tokens.map((t) => t.id)));
        expect(result.addedIds).toEqual(new Set(result.lines[0].tokens.map((t) => t.id)));
    });

    it('makes a line that is not paired a whole row leaving and another entering', () => {
        const { before, edit: result } = edit(8);
        // Nothing of the old row survives: every one of its tokens is removed, every new one added.
        expect(result.removedIds.size).toBe(before[0].tokens.length);
        expect(result.addedIds.size).toBe(result.lines[0].tokens.length);
    });

    it('weighs a token by its visible characters, so a long word outweighs several short ones', () => {
        const before = lines([['longword', ' ', 'a', ' ', 'b', ' ', 'c']]);
        const keepsLong = lines([['longword', ' ', 'x', ' ', 'y', ' ', 'z']]);
        const keepsShort = lines([['qqqqqqqq', ' ', 'a', ' ', 'b', ' ', 'c']]);
        expect(diffCode(before, keepsLong).newLineIds.size).toBe(0);
        // The three short tokens are 3 of 11 visible characters: below the floor.
        expect(diffCode(lines([['longword', ' ', 'a', ' ', 'b', ' ', 'c']]), keepsShort).newLineIds.size).toBe(1);
    });

    it('counts a repeated token as many times as it repeats', () => {
        const before = lines([['ab', ' ', 'ab', ' ', 'ab']]);
        const after = lines([['ab', ' ', 'ab', ' ', 'cd']]);
        const result = diffCode(before, after);
        expect(result.newLineIds.size).toBe(0);
        expect(result.removedIds.size).toBe(1);
        expect(result.addedIds.size).toBe(1);
    });
});

describe('diffCode: blank lines', () => {
    it('pairs a blank line with a blank line, so the rows around an edit hold their places', () => {
        const before = lines([['head'], [], ['tail']]);
        const after = lines([['head'], [], ['tail', ' ', 'more']]);
        const result = diffCode(before, after);
        expect(result.lines.map((l) => l.id)).toEqual(before.map((l) => l.id));
        expect(result.newLineIds.size).toBe(0);
    });

    it('pairs a blank line with a line of nothing but whitespace, and drops the whitespace', () => {
        const before = lines([['one'], ['   '], ['two']]);
        const after = lines([['one'], [], ['two']]);
        const spaces = before[1].tokens[0].id;
        const result = diffCode(before, after);
        expect(result.lines[1].id).toBe(before[1].id);
        expect(result.removedIds).toEqual(new Set([spaces]));
    });

    it('pairs two blank rows whether each is no tokens or one empty one', () => {
        for (const blank of [[], ['']]) {
            const before = lines([['a'], blank, ['b']]);
            const after = lines([['a'], blank, ['b']]);
            const result = diffCode(before, after);
            expect(result.newLineIds.size, JSON.stringify(blank)).toBe(0);
            expect(result.lines.map((l) => l.id)).toEqual(before.map((l) => l.id));
        }
    });

    it('never pairs a blank line with code: a blank row is a new row and the code row leaves', () => {
        const before = lines([['code']]);
        const after = lines([[]]);
        const result = diffCode(before, after);
        expect(result.lines[0].id).not.toBe(before[0].id);
        expect(result.newLineIds).toEqual(new Set([result.lines[0].id]));
        expect(result.removedIds).toEqual(new Set([before[0].tokens[0].id]));
    });

    it('does not anchor on a blank line: a blank that moved is a new blank', () => {
        const before = lines([['a'], [], ['b']]);
        const after = lines([['a'], ['b']]);
        const result = diffCode(before, after);
        expect(result.lines.map((l) => l.id)).toEqual([before[0].id, before[2].id]);
        expect(result.newLineIds.size).toBe(0);
    });
});

describe('diffCode: tokens within a pair of lines', () => {
    it('pairs tokens only when their content is equal, however alike the text is', () => {
        const before = lines([['const', ' ', 'variable', ' ', '=', ' ', '1']]);
        const after = lines([['const', ' ', 'variables', ' ', '=', ' ', '1']]);
        const result = diffCode(before, after);
        expect(result.removedIds).toEqual(new Set([before[0].tokens[2].id]));
        expect(result.addedIds).toEqual(new Set([result.lines[0].tokens[2].id]));
    });

    it('gives a paired token the old id, and a token with no partner a new one', () => {
        const before = lines([['a', ' ', 'b', ' ', 'c']]);
        const after = lines([['a', ' ', 'x', ' ', 'c']]);
        const old = before[0].tokens.map((t) => t.id);
        const result = diffCode(before, after);
        expect(result.lines[0].tokens.map((t) => t.id)).toEqual([old[0], old[1], result.lines[0].tokens[2].id, old[3], old[4]]);
        expect(old).not.toContain(result.lines[0].tokens[2].id);
    });

    it('keeps the order of the tokens it pairs: a token that moved past another is removed and added', () => {
        const before = lines([['a', ' ', 'b', ' ', 'c']]);
        const after = lines([['c', ' ', 'b', ' ', 'a']]);
        const result = diffCode(before, after);
        // Three words in reverse can keep only one of them in order.
        const keptWords = result.lines[0].tokens.filter((t) => before[0].tokens.some((old) => old.id === t.id) && t.content.trim() !== '');
        expect(keptWords).toHaveLength(1);
    });

    it('pairs whitespace, weakly, so indentation holds together without outranking content', () => {
        const before = lines([['  ', 'a', '  ', 'b']]);
        const after = lines([['  ', 'a', '  ', 'b', ' ', 'c']]);
        const result = diffCode(before, after);
        expect(result.removedIds.size).toBe(0);
        expect(result.lines[0].tokens.slice(0, 4).map((t) => t.id)).toEqual(before[0].tokens.map((t) => t.id));
    });

    it('prefers keeping a word to keeping several spaces', () => {
        // Aligning the word costs the spaces either side of it.
        const before = lines([['    ', 'items', '.', 'reduce']]);
        const after = lines([['items', '.', 'reduce', '    ']]);
        const result = diffCode(before, after);
        const kept = new Set(before[0].tokens.map((t) => t.id));
        expect(result.lines[0].tokens.filter((t) => kept.has(t.id)).map((t) => t.content)).toEqual(['items', '.', 'reduce']);
    });
});

describe('diffCode: colour', () => {
    it('records the colour a surviving token had, only for a token whose colour changed', () => {
        const before: IdLine[] = [makeIdLine([makeIdToken('const', '#aaa'), makeIdToken(' ', '#bbb'), makeIdToken('x', '#ccc')])];
        const after: IdLine[] = [makeIdLine([makeIdToken('const', '#aaa'), makeIdToken(' ', '#bbb'), makeIdToken('x', '#ddd')])];
        const changed = before[0].tokens[2].id;
        const result = diffCode(before, after);
        expect(result.fromColorById).toEqual(new Map([[changed, '#ccc']]));
    });

    it('records an undefined colour as a change from it', () => {
        const before: IdLine[] = [makeIdLine([makeIdToken('x')])];
        const after: IdLine[] = [makeIdLine([makeIdToken('x', '#ddd')])];
        const id = before[0].tokens[0].id;
        const result = diffCode(before, after);
        expect(result.fromColorById.has(id)).toBe(true);
        expect(result.fromColorById.get(id)).toBeUndefined();
    });

    it('records nothing for a token that was removed', () => {
        const before: IdLine[] = [makeIdLine([makeIdToken('gone', '#aaa'), makeIdToken(' ', '#bbb'), makeIdToken('kept', '#ccc')])];
        const after: IdLine[] = [makeIdLine([makeIdToken('kept', '#ccc')])];
        expect(diffCode(before, after).fromColorById.size).toBe(0);
    });

    it('records colour on the lines that were paired by identity too', () => {
        const before: IdLine[] = [makeIdLine([makeIdToken('a', '#111')]), makeIdLine([makeIdToken('b', '#111')])];
        const after: IdLine[] = [makeIdLine([makeIdToken('a', '#222')]), makeIdLine([makeIdToken('b', '#111')])];
        const result = diffCode(before, after);
        expect(result.fromColorById).toEqual(new Map([[before[0].tokens[0].id, '#111']]));
    });
});

describe('diffCode: the same listing', () => {
    it('is no change at all: every id carried over and nothing added, removed or new', () => {
        const before = lines([['const', ' ', 'a', ' ', '=', ' ', '1', ';'], [], ['  ', 'x']]);
        const ids = before.flatMap((l) => [l.id, ...idsOf(l)]);
        const after = lines([['const', ' ', 'a', ' ', '=', ' ', '1', ';'], [], ['  ', 'x']]);
        const result = diffCode(before, after);
        expect(result.lines.flatMap((l) => [l.id, ...idsOf(l)])).toEqual(ids);
        expect(result.removedIds.size + result.addedIds.size + result.newLineIds.size + result.fromColorById.size).toBe(0);
    });

    it('is no change for two empty listings', () => {
        const result = diffCode([], []);
        expect(result.lines).toEqual([]);
        expect(result.removedIds.size + result.addedIds.size + result.newLineIds.size).toBe(0);
    });

    it('removes every row of a listing that ends up empty', () => {
        const before = lines([['a'], ['b']]);
        const result = diffCode(before, []);
        expect(result.removedIds).toEqual(new Set(before.flatMap(idsOf)));
        expect(result.newLineIds.size).toBe(0);
    });
});

describe('diffCode: order', () => {
    it('keeps the order of the lines it pairs: two rows that swapped are one kept and one new', () => {
        const before = lines([['alpha', ' ', 'one'], ['beta', ' ', 'two']]);
        const after = lines([['beta', ' ', 'two'], ['alpha', ' ', 'one']]);
        const result = diffCode(before, after);
        const kept = result.lines.filter((l) => before.some((old) => old.id === l.id));
        expect(kept).toHaveLength(1);
        expect(result.newLineIds.size).toBe(1);
    });

    it('pairs a line that appears twice with its own copy each time, never crossing them', () => {
        // The rows between the copies share nothing, so only the copies can pair.
        const before = lines([['first', ' ', 'row'], ['dup', ';'], ['middle', ' ', 'row'], ['dup', ';'], ['last', ' ', 'row']]);
        const after = lines([['other', ' ', 'start'], ['dup', ';'], ['another', ' ', 'mid'], ['dup', ';'], ['final', ' ', 'end']]);
        const result = diffCode(before, after);
        expect(result.lines[1].id).toBe(before[1].id);
        expect(result.lines[3].id).toBe(before[3].id);
        expect(result.newLineIds).toEqual(new Set([result.lines[0].id, result.lines[2].id, result.lines[4].id]));
    });
});
