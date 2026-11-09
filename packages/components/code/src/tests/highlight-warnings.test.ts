import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { canHighlight, ensureHighlighter, highlightToTokens, resolveTheme } from '../highlight';
import { DefaultHighlightStyle } from '../style';
import { tokenizeCodeToIdLines } from '../tokens';

// A grammar whose import is rejected, to see a failed load surface. Nothing else
// in this file touches `go`.
vi.mock('@lezer/go', () => {
    throw new Error('cannot resolve @lezer/go');
});

let warn: MockInstance<typeof console.warn>;

beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => { });
});
afterEach(() => {
    warn.mockRestore();
});

const messages = (): string[] => warn.mock.calls.map((call: unknown[]) => String(call[0]));

describe('an unknown language', () => {
    it('warns once, naming the language, and draws plain text', async () => {
        await ensureHighlighter(undefined, ['bash']);
        await ensureHighlighter(undefined, ['bash']);
        tokenizeCodeToIdLines('ls -la', 'bash', DefaultHighlightStyle);
        const about = messages().filter((m: string) => m.includes('"bash"'));
        expect(about).toHaveLength(1);
        expect(about[0]).toContain('[Code]');
        expect(canHighlight('bash')).toBe(false);
    });

    it('warns once for each different language', async () => {
        await ensureHighlighter(undefined, ['c', 'sh']);
        await ensureHighlighter(undefined, ['c']);
        expect(messages().filter((m: string) => m.includes('"c"'))).toHaveLength(1);
        expect(messages().filter((m: string) => m.includes('"sh"'))).toHaveLength(1);
    });

    it('says nothing for a language it highlights, an alias of one, or deliberate plain text', async () => {
        await ensureHighlighter(undefined, ['typescript', 'ts', 'JSON', '', 'text', 'plaintext']);
        expect(warn).not.toHaveBeenCalled();
    });
});

describe('a grammar that fails to load', () => {
    it('is reported once, with the reason, and stays unhighlighted', async () => {
        await ensureHighlighter(undefined, ['go']);
        await ensureHighlighter(undefined, ['go']);
        const about = messages().filter((m: string) => m.includes('"go"'));
        expect(about).toHaveLength(1);
        // The reason the import gave rides along.
        expect(about[0]).toMatch(/could not load the "go" grammar; drawing it as plain text: .+/);
        expect(canHighlight('go')).toBe(false);
    });
});

describe('an unknown theme', () => {
    it('warns once, naming the theme, and falls back to the default', () => {
        expect(resolveTheme('no-such-theme')).toBe(DefaultHighlightStyle);
        expect(resolveTheme('no-such-theme')).toBe(DefaultHighlightStyle);
        highlightToTokens('a', 'typescript', 'no-such-theme');
        const about = messages().filter((m: string) => m.includes('"no-such-theme"'));
        expect(about).toHaveLength(1);
        expect(about[0]).toContain('[Code]');
    });

    it('is reported even while the language is still loading', () => {
        tokenizeCodeToIdLines('a', 'rust', 'another-missing-theme');
        expect(messages().filter((m: string) => m.includes('"another-missing-theme"'))).toHaveLength(1);
    });

    it('says nothing for a built-in theme or a style object', () => {
        resolveTheme('github-dark');
        resolveTheme(DefaultHighlightStyle);
        expect(warn).not.toHaveBeenCalled();
    });
});
