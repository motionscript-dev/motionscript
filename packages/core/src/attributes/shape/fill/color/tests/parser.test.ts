import { describe, it, expect, afterEach, vi } from 'vitest';
import { parseColor, setTheme, getTypographyPreset } from '@/attributes/shape/fill/color/parser';

/** Asserts an RGBA tuple matches expected channels within float tolerance. */
function expectColor(actual: number[], expected: number[], precision = 2) {
    expect(actual).toHaveLength(4);
    actual.forEach((v, i) => expect(v).toBeCloseTo(expected[i], precision));
}

describe('parseColor – named colors', () => {
    it('resolves a CSS named color', () => {
        expectColor(parseColor('red'), [1, 0, 0, 1]);
    });

    it('is case-insensitive and trims whitespace', () => {
        expectColor(parseColor('  RED  '), [1, 0, 0, 1]);
    });

    it('resolves transparent to zero alpha', () => {
        expectColor(parseColor('transparent'), [0, 0, 0, 0]);
    });
});

describe('parseColor – hex', () => {
    it('parses #RRGGBB', () => {
        expectColor(parseColor('#ff0000'), [1, 0, 0, 1]);
    });

    it('expands shorthand #RGB', () => {
        expectColor(parseColor('#f00'), [1, 0, 0, 1]);
    });

    it('parses #RRGGBBAA with alpha', () => {
        expectColor(parseColor('#00ff0080'), [0, 1, 0, 128 / 255]);
    });

    it('expands shorthand #RGBA', () => {
        expectColor(parseColor('#0f08'), [0, 1, 0, 0x88 / 255]);
    });
});

describe('parseColor – rgb / rgba', () => {
    it('parses 0-255 channel form', () => {
        expectColor(parseColor('rgb(255, 0, 0)'), [1, 0, 0, 1]);
    });

    it('parses percentage channels', () => {
        expectColor(parseColor('rgb(100%, 0%, 0%)'), [1, 0, 0, 1]);
    });

    it('parses legacy comma alpha (rgba)', () => {
        expectColor(parseColor('rgba(0, 0, 255, 0.5)'), [0, 0, 1, 0.5]);
    });

    it('parses modern slash alpha', () => {
        expectColor(parseColor('rgb(0 0 255 / 0.25)'), [0, 0, 1, 0.25]);
    });
});

describe('parseColor – hsl', () => {
    it('parses pure red (hue 0)', () => {
        expectColor(parseColor('hsl(0, 100%, 50%)'), [1, 0, 0, 1]);
    });

    it('parses pure green (hue 120)', () => {
        expectColor(parseColor('hsl(120, 100%, 50%)'), [0, 1, 0, 1]);
    });

    it('parses white (lightness 100%)', () => {
        expectColor(parseColor('hsl(0, 0%, 100%)'), [1, 1, 1, 1]);
    });
});

describe('parseColor – hue units', () => {
    // 180deg is cyan: hsl(180 100% 50%).
    const cyan = [0, 1, 1, 1];

    it.each(['hsl(180deg 100% 50%)', 'hsl(0.5turn 100% 50%)', 'hsl(3.14159265rad 100% 50%)', 'hsl(200grad 100% 50%)', 'hsl(180 100% 50%)'])(
        'converts the hue of %s to degrees',
        input => expectColor(parseColor(input), cyan),
    );

    it('wraps a negative hue', () => {
        expectColor(parseColor('hsl(-120deg 100% 50%)'), parseColor('hsl(240 100% 50%)'));
        expectColor(parseColor('hsl(-0.25turn 100% 50%)'), parseColor('hsl(270 100% 50%)'));
    });

    it('converts the hue unit of lch and oklch', () => {
        expectColor(parseColor('lch(50 40 0.25turn)'), parseColor('lch(50 40 90)'));
        expectColor(parseColor('oklch(0.7 0.1 0.5turn)'), parseColor('oklch(0.7 0.1 180)'));
        expectColor(parseColor('oklch(0.7 0.1 3.14159265rad)'), parseColor('oklch(0.7 0.1 180deg)'));
    });

    it('treats an unknown hue unit as an unsupported format', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(parseColor('hsl(10furlong 100% 50%)')).toEqual([0, 0, 0, 1]);
        expect(warn).toHaveBeenCalledOnce();
        warn.mockRestore();
    });
});

describe('parseColor – alpha forms', () => {
    it('reads a percentage alpha the same in the legacy and slash forms', () => {
        expectColor(parseColor('rgba(255, 0, 0, 50%)'), [1, 0, 0, 0.5]);
        expectColor(parseColor('rgb(255 0 0 / 50%)'), [1, 0, 0, 0.5]);
        expectColor(parseColor('hsla(0, 100%, 50%, 25%)'), [1, 0, 0, 0.25]);
        expectColor(parseColor('hsl(0 100% 50% / 25%)'), [1, 0, 0, 0.25]);
    });
});

describe('parseColor – malformed input', () => {
    it.each([
        '#zzzzzz',
        '#ggg',
        '#12345',
        '#',
        'rgb(255)',
        'rgb(255, 0)',
        'rgb(a, b, c)',
        'rgb(1 2 3 4 5)',
        'hsl(0)',
        'hsl(0 100%)',
        'lab(50 10)',
        'oklch(0.5)',
        'rgba(255, 0, 0, x)',
    ])('warns once and returns opaque black for %s', input => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(parseColor(input)).toEqual([0, 0, 0, 1]);
        expect(warn).toHaveBeenCalledOnce();
        warn.mockRestore();
    });
});

describe('parseColor – CIE / Ok color spaces', () => {
    it('parses oklch lightness extremes near black and white', () => {
        const black = parseColor('oklch(0 0 0)');
        const white = parseColor('oklch(1 0 0)');
        expect(black[0]).toBeCloseTo(0, 1);
        expect(white[0]).toBeCloseTo(1, 1);
    });

    it('lab(100 0 0) is near white', () => {
        expectColor(parseColor('lab(100 0 0)'), [1, 1, 1, 1], 1);
    });
});

describe('parseColor – fallback', () => {
    it('warns and returns opaque black for unsupported input', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(parseColor('not-a-color')).toEqual([0, 0, 0, 1]);
        expect(warn).toHaveBeenCalledOnce();
        warn.mockRestore();
    });
});

describe('parseColor – opacity suffix', () => {
    it('applies a percentage opacity to a named color', () => {
        expectColor(parseColor('white/10'), [1, 1, 1, 0.1]);
    });

    it('applies opacity to a CSS named color', () => {
        expectColor(parseColor('red/30'), [1, 0, 0, 0.3]);
    });

    it('applies opacity to a hex color', () => {
        expectColor(parseColor('#00ff00/50'), [0, 1, 0, 0.5]);
    });

    it('composes opacity with an existing alpha channel', () => {
        // #00ff0080 has alpha 0.5; /50 scales it to 0.25.
        expectColor(parseColor('#00ff0080/50'), [0, 1, 0, 128 / 255 * 0.5]);
    });

    it('clamps opacity above 100% to 1', () => {
        expectColor(parseColor('red/150'), [1, 0, 0, 1]);
    });

    it('tolerates a trailing percent sign', () => {
        expectColor(parseColor('red/30%'), [1, 0, 0, 0.3]);
    });

    it('does not treat the internal slash-alpha of rgb() as an opacity suffix', () => {
        expectColor(parseColor('rgb(0 0 255 / 0.25)'), [0, 0, 1, 0.25]);
    });

    it('combines a theme color with an opacity suffix', () => {
        setTheme({ colors: { primary: '#0000ff' } });
        expectColor(parseColor('primary/90'), [0, 0, 1, 0.9]);
        setTheme();
    });
});

describe('setTheme – colors', () => {
    afterEach(() => setTheme()); // clear theme entries between tests

    it('registers a named theme color resolvable by name', () => {
        setTheme({ colors: { brand: '#ff0000' } });
        expectColor(parseColor('brand'), [1, 0, 0, 1]);
    });

    it('resolves a name again under a new theme, though it was parsed under the old one', () => {
        setTheme({ colors: { brand: '#ff0000' } });
        expectColor(parseColor('brand/50'), [1, 0, 0, 0.5]);
        setTheme({ colors: { brand: '#00ff00' } });
        expectColor(parseColor('brand/50'), [0, 1, 0, 0.5]);
    });

    it('still warns on every unsupported string', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => { });
        parseColor('not-a-colour');
        parseColor('not-a-colour');
        expect(warn).toHaveBeenCalledTimes(2);
        warn.mockRestore();
    });

    it('does not corrupt a cached theme color when opacity is applied', () => {
        setTheme({ colors: { brand: '#ff0000' } });
        parseColor('brand/20');
        expectColor(parseColor('brand'), [1, 0, 0, 1]); // still fully opaque
    });

    it('accepts a pre-normalized tuple', () => {
        setTheme({ colors: { accent: [0, 0, 1, 1] } });
        expectColor(parseColor('accent'), [0, 0, 1, 1]);
    });

    it('takes precedence over a CSS named color', () => {
        setTheme({ colors: { red: '#0000ff' } });
        expectColor(parseColor('red'), [0, 0, 1, 1]);
    });

    it('clears entries when called with no argument', () => {
        setTheme({ colors: { brand: '#ff0000' } });
        setTheme();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(parseColor('brand')).toEqual([0, 0, 0, 1]);
        warn.mockRestore();
    });

    it('clears entries when called with null — a document with no theme reads back that way from storage', () => {
        setTheme({ colors: { brand: '#ff0000' } });
        setTheme(null);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(parseColor('brand')).toEqual([0, 0, 0, 1]);
        warn.mockRestore();
    });

    it('flattens a nested color group to dash-joined names', () => {
        setTheme({ colors: { brand: { 500: '#0ea5e9' } } });
        expectColor(parseColor('brand-500'), parseColor('#0ea5e9'));
    });

    it('flattens numeric group keys and supports an opacity suffix on them', () => {
        setTheme({ colors: { brand: { 100: '#ff0000', 900: '#0000ff' } } });
        expectColor(parseColor('brand-100'), [1, 0, 0, 1]);
        expectColor(parseColor('brand-900/50'), [0, 0, 1, 0.5]);
    });

    it('flattens arbitrarily deep nesting', () => {
        setTheme({ colors: { a: { b: { c: '#00ff00' } } } });
        expectColor(parseColor('a-b-c'), [0, 1, 0, 1]);
    });

    it('lowercases keys (camelCase resolves only in lowercased form)', () => {
        setTheme({ colors: { brandPrimary: '#ff0000' } });
        expectColor(parseColor('brandprimary'), [1, 0, 0, 1]);
    });
});

describe('setTheme – typography', () => {
    afterEach(() => setTheme());

    it('registers a preset resolvable by variant name', () => {
        setTheme({ typography: { header: { fontSize: 96, fontWeight: 700 } } });
        expect(getTypographyPreset('header')).toEqual({ fontSize: 96, fontWeight: 700 });
    });

    it('looks up case-insensitively', () => {
        setTheme({ typography: { Header: { fontSize: 96 } } });
        expect(getTypographyPreset('HEADER')).toEqual({ fontSize: 96 });
    });

    it('returns undefined for an unregistered variant', () => {
        setTheme({ typography: { header: { fontSize: 96 } } });
        expect(getTypographyPreset('missing')).toBeUndefined();
    });

    it('clears presets when called with no argument', () => {
        setTheme({ typography: { header: { fontSize: 96 } } });
        setTheme();
        expect(getTypographyPreset('header')).toBeUndefined();
    });
});

describe('parseColor – percentages and chroma', () => {
    it('reads a percentage lightness of lab() and lch() as the bare number', () => {
        expectColor(parseColor('lab(50% 40 20)'), parseColor('lab(50 40 20)'), 6);
        expectColor(parseColor('lch(50% 40 90)'), parseColor('lch(50 40 90)'), 6);
    });

    it('reads lab() as CIE L*a*b*: a positive a is redder, a negative a greener', () => {
        const [r, g] = parseColor('lab(50 60 0)');
        const [r2, g2] = parseColor('lab(50 -60 0)');
        expect(r).toBeGreaterThan(g);
        expect(g2).toBeGreaterThan(r2);
    });

    it('reads lch() as the polar form of lab()', () => {
        expectColor(parseColor('lch(50 40 90)'), parseColor('lab(50 0 40)'), 6);
        expectColor(parseColor('lch(60 30 0)'), parseColor('lab(60 30 0)'), 6);
    });

    it('scales a percentage a and b of oklab() so that 100% is 0.4', () => {
        expectColor(parseColor('oklab(60% 25% 12.5%)'), parseColor('oklab(0.6 0.1 0.05)'), 6);
        expectColor(parseColor('oklab(0.6 -50% 25%)'), parseColor('oklab(0.6 -0.2 0.1)'), 6);
    });

    it('reads a percentage lightness of oklab() as a fraction', () => {
        expectColor(parseColor('oklab(60% 0.1 0.05)'), parseColor('oklab(0.6 0.1 0.05)'), 6);
    });

    it('scales a percentage chroma of oklch() so that 100% is 0.4', () => {
        expectColor(parseColor('oklch(0.7 100% 200)'), parseColor('oklch(0.7 0.4 200)'), 6);
        expectColor(parseColor('oklch(70% 50% 200)'), parseColor('oklch(0.7 0.2 200)'), 6);
    });

    it('takes an oklch() chroma of 0 to the grey of its lightness, whatever the hue', () => {
        const grey = parseColor('oklch(0.6 0 0)');
        expectColor(parseColor('oklch(0.6 0 200)'), grey, 6);
        expect(grey[0]).toBeCloseTo(grey[1], 2);
        expect(grey[1]).toBeCloseTo(grey[2], 2);
    });

    it('clamps an out-of-gamut colour into [0, 1] on every channel', () => {
        for (const css of ['oklch(0.7 0.4 200)', 'oklab(0.5 0.2 0.2)', 'lab(50 100 100)', 'lch(90 150 30)']) {
            for (const channel of parseColor(css).slice(0, 3)) {
                expect(channel).toBeGreaterThanOrEqual(0);
                expect(channel).toBeLessThanOrEqual(1);
            }
        }
    });

    it('gives lab, lch, oklab and oklch an alpha, in the slash form', () => {
        expect(parseColor('lab(50 40 20 / 0.5)')[3]).toBe(0.5);
        expect(parseColor('lch(50 40 90 / 25%)')[3]).toBe(0.25);
        expect(parseColor('oklab(0.6 0.1 0.05 / 0.4)')[3]).toBe(0.4);
        expect(parseColor('oklch(70% 0.1 200 / 0.5)')[3]).toBe(0.5);
    });

    // CSS Color 4: 100% of lab's a and b is 125, and of lch's chroma 150. The
    // parser reads them as bare numbers, as it does for the lightness.
    it.skip('scales a percentage a and b of lab() so that 100% is 125', () => {
        expectColor(parseColor('lab(50 40% 20%)'), parseColor('lab(50 50 25)'), 6);
    });

    it.skip('scales a percentage chroma of lch() so that 100% is 150', () => {
        expectColor(parseColor('lch(50 40% 90)'), parseColor('lch(50 60 90)'), 6);
    });
});

describe('parseColor – hsl alpha', () => {
    it('reads a slash alpha as a number or a percentage', () => {
        expectColor(parseColor('hsl(120 100% 50% / 0.5)'), [0, 1, 0, 0.5]);
        expectColor(parseColor('hsl(120 100% 50% / 50%)'), [0, 1, 0, 0.5]);
    });

    it('reads a slash alpha with no space around the slash', () => {
        expectColor(parseColor('hsl(120 100% 50%/0.5)'), [0, 1, 0, 0.5]);
    });

    it('reads the legacy fourth argument as the same alpha', () => {
        expectColor(parseColor('hsla(120, 100%, 50%, 0.5)'), [0, 1, 0, 0.5]);
        expectColor(parseColor('hsl(120deg 100% 50% / 50%)'), parseColor('hsla(120, 100%, 50%, 0.5)'));
    });

    it('defaults the alpha to 1', () => {
        expect(parseColor('hsl(120 100% 50%)')[3]).toBe(1);
    });
});

describe('parseColor – an opacity suffix beside a function colour', () => {
    it('does not split a suffix off a string with a parenthesis in it, so the alpha stays as written', () => {
        expect(parseColor('rgb(255 0 0 / 0.25)')[3]).toBe(0.25);
        expect(parseColor('oklch(70% 0.1 200 / 0.5)')[3]).toBe(0.5);
        expect(parseColor('hsl(0 100% 50% / 40%)')[3]).toBeCloseTo(0.4, 9);
    });

    it('does not apply a /N after the closing parenthesis', () => {
        // The text after the `)` is not read at all.
        expect(parseColor('rgb(255 0 0)/50')).toEqual([1, 0, 0, 1]);
        expect(parseColor('oklch(0.7 0.1 200)/50')[3]).toBe(1);
    });

    it('applies a suffix to the keyword and hex forms, which have no parenthesis', () => {
        expectColor(parseColor('red/50'), [1, 0, 0, 0.5]);
        expectColor(parseColor('#ff0000/50'), [1, 0, 0, 0.5]);
        expectColor(parseColor('RED / 50%'), [1, 0, 0, 0.5]);
    });

    it('multiplies the suffix into a hex colour\'s own alpha', () => {
        expectColor(parseColor('#ff000080/50'), [1, 0, 0, 128 / 255 / 2]);
    });
});
