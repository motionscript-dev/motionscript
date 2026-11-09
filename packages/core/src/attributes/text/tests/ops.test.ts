import { describe, it, expect, afterEach } from 'vitest';
import { EMPTY_TEXT_STYLE, textOps } from '../ops';
import { setTheme } from '@/attributes/shape/fill/color/parser';
import { setHostTextFamily } from '@/components/builtins/text/text-defaults';

describe('textOps.lerp', () => {
    it('returns from at t<=0 and to at t>=1', () => {
        expect(textOps.lerp('abc', 'xyz', 0)).toBe('abc');
        expect(textOps.lerp('abc', 'xyz', 1)).toBe('xyz');
        expect(textOps.lerp('abc', 'xyz', -0.5)).toBe('abc');
        expect(textOps.lerp('abc', 'xyz', 2)).toBe('xyz');
    });

    it('returns to immediately when the strings are identical', () => {
        expect(textOps.lerp('same', 'same', 0.5)).toBe('same');
    });

    it('preserves a common prefix and suffix throughout', () => {
        // "cat" -> "cot": prefix "c", suffix "t", middle a->o.
        for (let t = 0; t <= 1; t += 0.1) {
            const out = textOps.lerp('cat', 'cot', t);
            expect(out.startsWith('c')).toBe(true);
            expect(out.endsWith('t')).toBe(true);
        }
    });

    it('shrinks the removed middle before growing the added middle', () => {
        // Pure append: "go" -> "going". prefix "go", nothing removed.
        const early = textOps.lerp('go', 'going', 0.25);
        const late = textOps.lerp('go', 'going', 0.9);
        expect(early.length).toBeLessThanOrEqual(late.length);
        expect(late.startsWith('go')).toBe(true);
    });

    it('handles truncation (to is a prefix of from)', () => {
        const mid = textOps.lerp('hello', 'hel', 0.5);
        expect(mid.startsWith('hel')).toBe(true);
        expect(mid.length).toBeGreaterThanOrEqual(3);
        expect(mid.length).toBeLessThanOrEqual(5);
    });

    it('never produces a string longer than both endpoints combined', () => {
        const out = textOps.lerp('abcdef', 'uvwxyz', 0.5);
        expect(out.length).toBeLessThanOrEqual('abcdef'.length + 'uvwxyz'.length);
    });
});

describe('textOps.mergeStyle', () => {
    it('returns base itself when over sets nothing', () => {
        const base = { fontSize: 12 };
        expect(textOps.mergeStyle(base, undefined)).toBe(base);
        expect(textOps.mergeStyle(base, {})).toBe(base);
        expect(textOps.mergeStyle(base, { fontWeight: undefined })).toBe(base);
    });

    it('lays the keys over sets onto base without mutating either', () => {
        const base = { fontSize: 12, fontWeight: 400 };
        const over = { fontWeight: 700, textAlign: 'left' as const };
        expect(textOps.mergeStyle(base, over)).toEqual({ fontSize: 12, fontWeight: 700, textAlign: 'left' });
        expect(base).toEqual({ fontSize: 12, fontWeight: 400 });
        expect(over).toEqual({ fontWeight: 700, textAlign: 'left' });
    });

    it('copies a frozen base rather than writing into it', () => {
        expect(textOps.mergeStyle(EMPTY_TEXT_STYLE, { fontSize: 20 })).toEqual({ fontSize: 20 });
        expect(EMPTY_TEXT_STYLE).toEqual({});
    });
});

describe('textOps.preset', () => {
    afterEach(() => setTheme());

    it('looks a preset up by name, case-insensitively', () => {
        setTheme({ typography: { header: { fontSize: 96 } } });
        expect(textOps.preset('HEADER')).toEqual({ fontSize: 96 });
    });

    it('gives the empty style for a name nobody registered', () => {
        expect(textOps.preset('missing')).toBe(EMPTY_TEXT_STYLE);
    });
});

describe('textOps.lerpStyle', () => {
    it('interpolates magnitudes and steps categorical fields at the midpoint', () => {
        const from = textOps.resolveStyle({ fontSize: 10, fontFamily: 'A' }, {});
        const to = textOps.resolveStyle({ fontSize: 20, fontFamily: 'B' }, {});
        expect(textOps.lerpStyle(from, to, 0.25)).toMatchObject({ fontSize: 12.5, fontFamily: 'A' });
        expect(textOps.lerpStyle(from, to, 0.75)).toMatchObject({ fontSize: 17.5, fontFamily: 'B' });
    });

    it('steps an autofit size and a one-sided field at the midpoint', () => {
        const from = textOps.resolveStyle({ fontSize: 'autofit' }, {});
        const to = textOps.resolveStyle({ fontSize: 20, fontWeight: 700 }, {});
        expect(textOps.lerpStyle(from, to, 0.4)).toMatchObject({ fontSize: 'autofit', fontWeight: undefined });
        expect(textOps.lerpStyle(from, to, 0.6)).toMatchObject({ fontSize: 20, fontWeight: 700 });
    });
});

describe('textOps.styleProps', () => {
    afterEach(() => setHostTextFamily(''));

    it('drops unset keys', () => {
        expect(textOps.styleProps({ fontSize: 20, fontWeight: undefined })).toEqual({ fontSize: 20 });
    });

    it('keeps a family the style states', () => {
        expect(textOps.styleProps({ fontFamily: 'Georgia' }).fontFamily).toBe('Georgia');
    });

    it('leaves an unstated family unset even when the host declares one', () => {
        // The host family is the *last* rung (`requireFontFamily`), not a prop.
        // Written here it would count as author-set and `applyTextDefaults`
        // would skip the key, so a chart axis would outrank the document's own
        // `<DefaultTextStyle>` and `theme.typography.default`.
        setHostTextFamily('Inter');
        expect(textOps.styleProps({ fontSize: 20 })).not.toHaveProperty('fontFamily');
    });
});

describe('textOps.flatten', () => {
    const base = {
        fontFamily: 'Inter', fontSize: 16, fontWeight: 400, fontStyle: 'normal' as const,
        letterSpacing: 0, fill: [], stroke: [],
    };

    it('inherits from the parent span and lets a child override', () => {
        const out = textOps.flatten([
            { fontWeight: 700, children: [{ text: 'a' }, { text: 'b', fontWeight: 300 }] },
        ], base);
        expect(out.map(s => [s.text, s.fontWeight, s.fontFamily])).toEqual([
            ['a', 700, 'Inter'],
            ['b', 300, 'Inter'],
        ]);
    });

    it("contributes a span's own text before its children's", () => {
        const out = textOps.flatten([{ text: 'x', children: [{ text: 'y' }] }], base);
        expect(out.map(s => s.text)).toEqual(['x', 'y']);
    });

    it("resolves a span's paint", () => {
        const [span] = textOps.flatten([{ text: 'a', fill: '#ff0000' }], base);
        expect(span.fill.length).toBeGreaterThan(0);
    });
});

describe('textOps.applyCase', () => {
    it('leaves the text as typed for none', () => {
        expect(textOps.applyCase('Hello World', 'none')).toBe('Hello World');
    });

    it('upper- and lowercases', () => {
        expect(textOps.applyCase('Hello World', 'upper')).toBe('HELLO WORLD');
        expect(textOps.applyCase('Hello World', 'lower')).toBe('hello world');
    });

    it('capitalises the first letter of each word and keeps the rest as typed', () => {
        expect(textOps.applyCase('the iPhone launch', 'title')).toBe('The IPhone Launch');
        expect(textOps.applyCase('HELLO world', 'title')).toBe('HELLO World');
    });

    it('treats punctuation as a word break but not an apostrophe or a digit', () => {
        expect(textOps.applyCase("well-known (don't) 3rd", 'title')).toBe("Well-Known (Don't) 3rd");
    });

    it('keeps a character whose case mapping would change the length', () => {
        const out = textOps.applyCase('straße', 'upper');
        expect(out).toBe('STRAßE');
        expect(out.length).toBe('straße'.length);
    });
});
