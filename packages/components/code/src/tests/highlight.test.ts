import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import {
    DEFAULT_LANGS,
    canHighlight,
    ensureHighlighter,
    highlightToTokens,
    initSyntaxHighlighter,
    loadCodeLanguage,
    normalizeSource,
} from '../highlight';
import { DefaultHighlightStyle } from '../style';

/**
 * The highlighter's table of grammars, which is process-wide state: what one test
 * loads, the next finds loaded. Each test names languages nothing before it has
 * touched, so the order they run in does not matter, and `canHighlight` is read
 * before a load only where the language has not been asked for yet.
 */

let warn: MockInstance<typeof console.warn>;

beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => { });
});
afterEach(() => {
    warn.mockRestore();
    vi.doUnmock('@lezer/rust');
    vi.resetModules();
});

describe('languages and their names', () => {
    it('loads a grammar by its name, case-insensitively', async () => {
        expect(canHighlight('css')).toBe(false);
        await ensureHighlighter(['CSS']);
        expect(canHighlight('css')).toBe(true);
        expect(canHighlight('CSS')).toBe(true);
        expect(canHighlight('Css')).toBe(true);
    });

    it.each([
        ['ts', 'typescript'],
        ['js', 'javascript'],
        ['py', 'python'],
        ['c++', 'cpp'],
        ['md', 'markdown'],
        ['yml', 'yaml'],
        ['shell', 'javascript'],
    ])('resolves the alias %s to %s', async (alias, target) => {
        await ensureHighlighter([alias]);
        expect(canHighlight(alias)).toBe(true);
        expect(canHighlight(target)).toBe(true);
    });

    it('colours an alias exactly as the language it names: shell is JavaScript, there being no shell grammar', async () => {
        await ensureHighlighter(['shell', 'js', 'ts']);
        const source = 'let x = foo("a", 1);';
        expect(highlightToTokens(source, 'shell')).toEqual(highlightToTokens(source, 'javascript'));
        expect(highlightToTokens(source, 'JS')).toEqual(highlightToTokens(source, 'javascript'));
        expect(highlightToTokens('let x: number = 1;', 'ts')).toEqual(highlightToTokens('let x: number = 1;', 'typescript'));
        expect(highlightToTokens(source, 'javascript').flat().some((token) => token.color !== DefaultHighlightStyle.defaultColor)).toBe(true);
    });

    it('says an alias is loaded only once the language behind it is', async () => {
        expect(canHighlight('html')).toBe(false);
        await ensureHighlighter(['HTML']);
        expect(canHighlight('html')).toBe(true);
    });

    it.each(['xml', 'java', 'php', 'jsx', 'json'])('has a grammar for %s', async (language) => {
        await ensureHighlighter([language]);
        expect(canHighlight(language)).toBe(true);
        expect(warn).not.toHaveBeenCalled();
    });

    it('colours a language it has loaded, and leaves one it has not as a single colour', async () => {
        await ensureHighlighter(['typescript']);
        const colours = (language: string) => new Set(highlightToTokens('const a = 1;', language).flat().map((token) => token.color));
        expect(colours('typescript').size).toBeGreaterThan(2);
        expect(colours('perl')).toEqual(new Set([DefaultHighlightStyle.defaultColor]));
    });
});

describe('canHighlight', () => {
    it('is false for a language whose grammar has not loaded, and for one that does not exist', async () => {
        expect(canHighlight('rust')).toBe(false);
        expect(canHighlight('klingon')).toBe(false);
        await ensureHighlighter(['klingon']);
        expect(canHighlight('klingon')).toBe(false);
    });

    it('is true exactly when that language has loaded, and not for its neighbours', async () => {
        expect(canHighlight('go')).toBe(false);
        await loadCodeLanguage('go');
        expect(canHighlight('go')).toBe(true);
        expect(canHighlight('gopher')).toBe(false);
    });
});

describe('what it preloads', () => {
    it('names four languages by default', () => {
        expect([...DEFAULT_LANGS]).toEqual(['typescript', 'javascript', 'json', 'python']);
    });

    it('loads the default languages when it is given none', async () => {
        await ensureHighlighter();
        for (const language of DEFAULT_LANGS) expect(canHighlight(language), language).toBe(true);
        expect(warn).not.toHaveBeenCalled();
    });

    it('is the same call as initSyntaxHighlighter', async () => {
        await initSyntaxHighlighter();
        for (const language of DEFAULT_LANGS) expect(canHighlight(language), language).toBe(true);
    });

    it('loads one language at a time with loadCodeLanguage, leaving the others alone', async () => {
        expect(canHighlight('rust')).toBe(false);
        await loadCodeLanguage('rust');
        expect(canHighlight('rust')).toBe(true);
        // Not yet asked for by anything in this file.
        expect(canHighlight('tsx')).toBe(false);
    });

    it('resolves at once for a language it has no grammar for, without loading anything', async () => {
        await expect(loadCodeLanguage('cobol')).resolves.toBeUndefined();
        expect(canHighlight('cobol')).toBe(false);
    });
});

describe('concurrent requests for one language', () => {
    it('share one import: the grammar is built once', async () => {
        const { parser } = await import('@lezer/javascript');
        const configure = vi.spyOn(Object.getPrototypeOf(parser), 'configure');
        try {
            expect(canHighlight('tsx')).toBe(false);
            await Promise.all([
                ensureHighlighter(['tsx']),
                ensureHighlighter(['TSX']),
                loadCodeLanguage('tsx'),
                initSyntaxHighlighter(['tsx']),
            ]);
            expect(canHighlight('tsx')).toBe(true);
            expect(configure).toHaveBeenCalledTimes(1);
            expect(configure).toHaveBeenCalledWith({ dialect: 'ts jsx' });

            // And a request made after it has loaded builds nothing at all.
            await ensureHighlighter(['tsx']);
            expect(configure).toHaveBeenCalledTimes(1);
        } finally {
            configure.mockRestore();
        }
    });

    it('resolve together when they ask for different languages', async () => {
        await Promise.all([ensureHighlighter(['xml', 'css']), ensureHighlighter(['css', 'php'])]);
        expect(canHighlight('xml') && canHighlight('css') && canHighlight('php')).toBe(true);
    });
});

describe('a grammar whose import is rejected', () => {
    it('is swallowed, leaves the language unloaded and is tried again by the next call', async () => {
        vi.doMock('@lezer/rust', () => {
            throw new Error('cannot resolve @lezer/rust');
        });
        const failing = await import('../highlight');
        await expect(failing.ensureHighlighter(['rust'])).resolves.toBeUndefined();
        expect(failing.canHighlight('rust')).toBe(false);
        expect(warn.mock.calls.map((call: unknown[]) => String(call[0])).filter((m: string) => m.includes('"rust"'))).toHaveLength(1);

        // The import works the next time it is asked for.
        vi.doUnmock('@lezer/rust');
        vi.resetModules();
        const working = await import('../highlight');
        await working.ensureHighlighter(['rust']);
        expect(working.canHighlight('rust')).toBe(true);
    });
});

describe('normalizeSource', () => {
    it('turns CRLF and a lone CR into a line feed', () => {
        expect(normalizeSource('a\r\nb')).toBe('a\nb');
        expect(normalizeSource('a\rb')).toBe('a\nb');
        expect(normalizeSource('a\r\n\r\nb\rc\r\n')).toBe('a\n\nb\nc\n');
    });

    it('hands back a source without a CR as it is', () => {
        expect(normalizeSource('a\nb')).toBe('a\nb');
        expect(normalizeSource('')).toBe('');
    });

    it('keeps a CR line break out of the highlighter as a token', async () => {
        await ensureHighlighter(['typescript']);
        const lines = highlightToTokens('a = 1;\r\nb = 2;', 'typescript');
        expect(lines).toHaveLength(2);
        expect(lines.flat().some((token) => token.content.includes('\r'))).toBe(false);
    });
});
