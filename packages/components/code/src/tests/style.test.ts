import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { tags } from '@lezer/highlight';
import { ensureHighlighter, highlightToTokens, registerCodeTheme, resolveTheme } from '../highlight';
import {
    BUILTIN_THEMES,
    DefaultHighlightStyle,
    GithubDarkStyle,
    GithubLightStyle,
    VscodeDarkStyle,
    VscodeLightStyle,
    compileStyle,
    type CodeHighlightStyle,
} from '../style';
import { tokenizeCodeToIdLines } from '../tokens';

/**
 * The themes the kit ships, how a theme is looked up, and how one registered by
 * a host takes effect.
 */

beforeAll(async () => {
    await ensureHighlighter(undefined, ['typescript']);
});

let warn: MockInstance<typeof console.warn>;
beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => { });
});
afterEach(() => {
    warn.mockRestore();
});

function styled(name: string, keyword: string, defaultColor = '#000000'): CodeHighlightStyle {
    return { name, defaultColor, rules: [{ tag: tags.keyword, color: keyword }] };
}

const colours = (theme: Parameters<typeof highlightToTokens>[2]) => highlightToTokens('const a = 1;', 'typescript', theme)[0].map((token) => token.color);

describe('the built-in themes', () => {
    it('ships five, keyed by their names', () => {
        expect(Object.keys(BUILTIN_THEMES)).toEqual(['motion-canvas-default', 'github-dark', 'github-light', 'vscode-dark', 'vscode-light']);
        for (const [key, style] of Object.entries(BUILTIN_THEMES)) expect(style.name, key).toBe(key);
    });

    it.each([
        [DefaultHighlightStyle, 'motion-canvas-default', '#d8dee9'],
        [GithubDarkStyle, 'github-dark', '#c9d1d9'],
        [GithubLightStyle, 'github-light', '#24292e'],
        [VscodeDarkStyle, 'vscode-dark', '#9cdcfe'],
        [VscodeLightStyle, 'vscode-light', '#383a42'],
    ])('%# carries its name and its default colour', (style, name, defaultColor) => {
        expect(style.name).toBe(name);
        expect(style.defaultColor).toBe(defaultColor);
        expect(style.rules.length).toBeGreaterThan(5);
        expect(BUILTIN_THEMES[name as keyof typeof BUILTIN_THEMES]).toBe(style);
    });

    it('gives every rule a tag and a colour', () => {
        for (const style of Object.values(BUILTIN_THEMES)) {
            for (const rule of style.rules) {
                expect(rule.color, style.name).toMatch(/^#[0-9a-fA-F]{6}$/);
                expect(rule.tag).toBeDefined();
            }
        }
    });

    it('colours differently from one theme to the next', () => {
        const all = Object.keys(BUILTIN_THEMES).map((name) => colours(name).join(','));
        expect(new Set(all).size).toBe(all.length);
    });

    it('resolves every name to its own style', () => {
        for (const [name, style] of Object.entries(BUILTIN_THEMES)) expect(resolveTheme(name), name).toBe(style);
        expect(warn).not.toHaveBeenCalled();
    });
});

describe('resolveTheme', () => {
    it('returns a style object as it is, without registering it', () => {
        const inline = styled('inline-only', '#123456');
        expect(resolveTheme(inline)).toBe(inline);
        expect(resolveTheme('inline-only')).toBe(DefaultHighlightStyle);
    });

    it('falls back to the default style for a name it does not know, warning once', () => {
        expect(resolveTheme('never-registered')).toBe(DefaultHighlightStyle);
        expect(resolveTheme('never-registered')).toBe(DefaultHighlightStyle);
        const about = warn.mock.calls.filter((call: unknown[]) => String(call[0]).includes('"never-registered"'));
        expect(about).toHaveLength(1);
        expect(String(about[0][0])).toContain('motion-canvas-default');
        expect(String(about[0][0])).toContain('registerCodeTheme');
    });

    it('warns separately for each unknown name', () => {
        resolveTheme('unknown-one');
        resolveTheme('unknown-two');
        expect(warn).toHaveBeenCalledTimes(2);
    });

    it('colours an unknown name like the default', () => {
        expect(colours('still-not-registered')).toEqual(colours(DefaultHighlightStyle));
    });
});

describe('registerCodeTheme', () => {
    it('makes a style reachable by its name, for every node of the process', () => {
        const style = styled('registered-red', '#ff0000');
        expect(resolveTheme('registered-red')).toBe(DefaultHighlightStyle);
        registerCodeTheme(style);
        expect(resolveTheme('registered-red')).toBe(style);
    });

    it('colours a listing with the registered rules and the registered default', () => {
        registerCodeTheme(styled('registered-green', '#00ff00', '#111111'));
        const lines = tokenizeCodeToIdLines('const a = 1;', 'typescript', 'registered-green');
        expect(lines[0].tokens[0]).toMatchObject({ content: 'const', color: '#00ff00' });
        // No rule for the gaps: they take the style's own default.
        expect(lines[0].tokens[1]).toMatchObject({ content: ' ', color: '#111111' });
    });

    it('replaces a style registered earlier under the same name', () => {
        registerCodeTheme(styled('replaced', '#aa0000'));
        registerCodeTheme(styled('replaced', '#0000bb'));
        expect(colours('replaced')[0]).toBe('#0000bb');
    });

    it('can replace a built-in by its name', () => {
        const original = BUILTIN_THEMES['vscode-light'];
        try {
            registerCodeTheme(styled('vscode-light', '#fedcba'));
            expect(colours('vscode-light')[0]).toBe('#fedcba');
        } finally {
            registerCodeTheme(original);
        }
        expect(resolveTheme('vscode-light')).toBe(original);
    });

    it('does not warn for a name that has been registered', () => {
        registerCodeTheme(styled('quiet', '#abcdef'));
        resolveTheme('quiet');
        expect(warn).not.toHaveBeenCalled();
    });
});

describe('two styles that share a name', () => {
    it('colour with their own rules, in a listing as well as in the compiled highlighter', () => {
        const first = styled('twins', '#ff0000');
        const second = styled('twins', '#0000ff');
        expect(highlightToTokens('const a = 1;', 'typescript', first)[0][0].color).toBe('#ff0000');
        expect(highlightToTokens('const a = 1;', 'typescript', second)[0][0].color).toBe('#0000ff');
        expect(compileStyle(first)).not.toBe(compileStyle(second));
    });

    it('keep their colouring after a registration of the same name', () => {
        const inline = styled('twins-registered', '#ff0000');
        registerCodeTheme(styled('twins-registered', '#00ff00'));
        expect(highlightToTokens('const a = 1;', 'typescript', inline)[0][0].color).toBe('#ff0000');
        expect(highlightToTokens('const a = 1;', 'typescript', 'twins-registered')[0][0].color).toBe('#00ff00');
    });
});

describe('compileStyle', () => {
    it('emits the colour string as the class of each tag', () => {
        const style = styled('compiled', '#c0ffee');
        expect(compileStyle(style).style([tags.keyword])).toBe('#c0ffee');
        expect(compileStyle(style).style([tags.string])).toBeNull();
    });

    it('lets a later rule win for a tag it shares with an earlier one', () => {
        const style: CodeHighlightStyle = {
            name: 'later-wins',
            defaultColor: '#000',
            rules: [
                { tag: tags.keyword, color: '#111111' },
                { tag: [tags.keyword, tags.string], color: '#222222' },
            ],
        };
        expect(compileStyle(style).style([tags.keyword])).toBe('#222222');
        expect(compileStyle(style).style([tags.string])).toBe('#222222');
    });
});
