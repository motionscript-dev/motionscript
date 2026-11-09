import { beforeAll, describe, expect, it } from 'vitest';
import { Registry, type Size2D } from '@motionscript/sdk';
import { Code } from '../node';
import { NODES } from '../nodes';
import { ensureHighlighter } from '../highlight';
import { Frame, advanceOf, at, attach, make, measured } from './harness.fixtures';

/**
 * What a `Code` measures to, and what its props default to. The scenarios are the
 * spec's own: a 0.6 em advance, a 16 px face, no letter spacing and a line height
 * of 1.6, so a glyph is 9.6 px and a row 25.6.
 */

beforeAll(async () => {
    await ensureHighlighter(undefined, ['typescript']);
});

/** A face whose advance is 0.6 em, as the spec's probes measure with. */
class SixTenths extends Frame {
    override measureText(text: string, fontSize: number, _family: string, _weight?: number, letterSpacing = 0): Size2D {
        return { width: text.length * (fontSize * 0.6 + letterSpacing), height: fontSize };
    }
}

const SOURCE = 'ab\n\nabcdefghij';
const PROPS = { letterSpacing: 0, fontSize: 16, lineHeight: 1.6 };

const size = (code: string, props: Record<string, unknown> = {}, constraints = {}) =>
    measured(make(code, { ...PROPS, ...props } as never), constraints, new SixTenths());

describe('Code.measure: hugging', () => {
    it('is the longest line wide and a row tall for each line', () => {
        const { width, height } = size(SOURCE);
        expect(width).toBeCloseTo(96);
        expect(height).toBeCloseTo(76.8);
    });

    it('widens by the gutter with line numbers: a digit and a gap of two spaces', () => {
        const { width, height } = size(SOURCE, { showLineNumbers: true });
        expect(width).toBeCloseTo(124.8);
        expect(height).toBeCloseTo(76.8);
    });

    it('widens the gutter with lineNumberGap', () => {
        expect(size(SOURCE, { showLineNumbers: true, lineNumberGap: 0 }).width).toBeCloseTo(105.6);
        expect(size(SOURCE, { showLineNumbers: true, lineNumberGap: 4 }).width).toBeCloseTo(144);
    });

    it('adds the padding on every side', () => {
        const { width, height } = size(SOURCE, { padding: 10 });
        expect(width).toBeCloseTo(116);
        expect(height).toBeCloseTo(96.8);
    });

    it('adds each side of an uneven padding', () => {
        const { width, height } = size(SOURCE, { padding: { top: 1, right: 2, bottom: 4, left: 8 } });
        expect(width).toBeCloseTo(96 + 10);
        expect(height).toBeCloseTo(76.8 + 5);
    });

    it('is one row tall and nothing wide for an empty listing', () => {
        const { width, height } = size('');
        expect(width).toBe(0);
        expect(height).toBeCloseTo(25.6);
    });

    it('is the padding and a row for an empty listing with padding', () => {
        const { width, height } = size('', { padding: 5 });
        expect(width).toBe(10);
        expect(height).toBeCloseTo(35.6);
    });

    it('grows with the font size, the line height and the letter spacing', () => {
        expect(size('abcd', { fontSize: 20 }).width).toBeCloseTo(48);
        expect(size('a\nb', { lineHeight: 2 }).height).toBeCloseTo(64);
        expect(size('abcd', { letterSpacing: 1 }).width).toBeCloseTo(4 * (9.6 + 1));
    });

    it('does not depend on the theme or the language the colours come from', () => {
        const dark = size(SOURCE, { theme: 'github-dark' });
        const light = size(SOURCE, { theme: 'vscode-light' });
        const flat = size(SOURCE, { language: 'klingon' });
        expect(dark).toEqual(light);
        expect(flat).toEqual(dark);
    });

    it('measures a hugged width by the tokens when the grammar splits a line into several', () => {
        expect(size('const a = 1;').width).toBeCloseTo(12 * 9.6);
    });
});

describe('Code.measure: fixed and fill', () => {
    it('is the width it is given, whatever the source', () => {
        expect(size(SOURCE, { width: 50 }).width).toBe(50);
        expect(size(SOURCE, { width: 50 }).height).toBeCloseTo(76.8);
        expect(size(SOURCE, { height: 30 }).height).toBe(30);
        expect(size(SOURCE, { height: 30 }).width).toBeCloseTo(96);
    });

    it('is the given size on both sides, padding or not', () => {
        expect(size(SOURCE, { width: 50, height: 30, padding: 10 })).toEqual({ width: 50, height: 30 });
    });

    it('fills the constraint\'s maximum', () => {
        const { width, height } = size(SOURCE, { width: 'fill', height: 'fill' }, { maxWidth: 500, maxHeight: 300 });
        expect([width, height]).toEqual([500, 300]);
    });

    it('fills one side and hugs the other', () => {
        const { width, height } = size(SOURCE, { width: 'fill' }, { maxWidth: 500 });
        expect(width).toBe(500);
        expect(height).toBeCloseTo(76.8);
    });

    it('fills nothing when the constraint states no maximum', () => {
        expect(size(SOURCE, { width: 'fill', height: 'fill' })).toEqual({ width: 0, height: 0 });
    });
});

describe('Code.measure: during an edit', () => {
    it('is between the two listings by the eased move progress', () => {
        const node = make('ab', { ...PROPS } as never);
        const frame = new SixTenths();
        const before = measured(node, {}, frame);
        const edit = node.append({ data: { code: '\ncdefghij\nxy' }, duration: 1 });
        at(edit, 1);
        const after = measured(node, {}, frame);
        expect(after.width).toBeGreaterThan(before.width);

        // Adding only: the move window is [0, 0.55], so a progress of 0.275 is half way through it, and smoothstep(0.5) is 0.5.
        at(edit, 0.275);
        const mid = measured(node, {}, frame);
        expect(mid.width).toBeCloseTo((before.width + after.width) / 2);
        expect(mid.height).toBeCloseTo((before.height + after.height) / 2);
    });

    it('is the old size at the start of the edit and the new size at its end', () => {
        const node = make('ab', { ...PROPS } as never);
        const frame = new SixTenths();
        const before = measured(node, {}, frame);
        const edit = node.append({ data: { code: '\ncdefghij' }, duration: 1 });
        at(edit, 0);
        expect(measured(node, {}, frame)).toEqual(before);
        at(edit, 1);
        expect(measured(node, {}, frame).width).toBeCloseTo(8 * 9.6);
    });
});

describe('Code: props and their defaults', () => {
    it('declares the defaults the spec gives', () => {
        const node = new Code();
        expect(node.code).toBe('');
        expect(node.language).toBe('typescript');
        expect(node.fontFamily).toBe('Fira Mono');
        expect(node.theme).toBe('motion-canvas-default');
        expect(node.fontSize).toBe(16);
        expect(node.lineHeight).toBe(1.6);
        expect(node.letterSpacing).toBe(1.1);
        expect(node.showLineNumbers).toBe(false);
        expect(node.lineNumberGap).toBe(2);
        expect(node.padding).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    });

    it('hugs by default, both ways', () => {
        const node = new Code();
        expect(node.width).toBe('hug');
        expect(node.height).toBe('hug');
    });

    it('keeps a width and a height it is given', () => {
        const node = new Code({ width: 120, height: 'fill' });
        expect(node.width).toBe(120);
        expect(node.height).toBe('fill');
    });

    it('resolves a padding given as one number to all four sides', () => {
        expect(new Code({ padding: 7 }).padding).toEqual({ top: 7, right: 7, bottom: 7, left: 7 });
    });

    it('publishes the same defaults to a host that lists the properties', () => {
        const props = new Registry({ nodes: NODES }).describe('code')!.properties!;
        expect(props.code.default).toBe('');
        expect(props.language.default).toBe('typescript');
        expect(props.fontFamily.default).toBe('Fira Mono');
        expect(props.fontSize.default).toBe(16);
        expect(props.lineHeight.default).toBe(1.6);
        expect(props.letterSpacing.default).toBe(1.1);
        expect(props.showLineNumbers.default).toBe(false);
        expect(props.lineNumberGap.default).toBe(2);
    });

    it('measures its default face as the spec\'s unit: a glyph of half an em plus the 1.1 px of letter spacing', () => {
        const node = attach(new Code({ code: 'abcd' }));
        expect(node.measure({} as never, new Frame()).width).toBeCloseTo(advanceOf(4, 16, 1.1));
    });
});
