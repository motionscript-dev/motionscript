import { beforeAll, describe, expect, it } from 'vitest';
import { ContextMap, type Command, type Node } from '@motionscript/sdk';
import { ManifestAssetCatalog } from '@motionscript/core';
import { Code, listingOf } from '../node';
import { erase } from './harness.fixtures';
import { lines } from '../code-range';
import { ensureHighlighter } from '../highlight';
import { GithubDarkStyle, GithubLightStyle } from '../style';

beforeAll(async () => {
    await ensureHighlighter(['typescript']);
});

function attach<T extends Node>(node: T): T {
    node.attach({
        assets: new ManifestAssetCatalog({ image: {}, video: {}, audio: {}, font: {} }),
        context: ContextMap.EMPTY,
        time: 0,
    });
    return node;
}

/** What the listing shows, read when asked: nothing has to bring it up to date with its props first. */
const internals = (node: Code) => {
    const { lines, source } = listingOf(node);
    return { tokenLines: lines, highlightedIds: node.focus.ids, joinedSource: () => source };
};

/** The colours the first listing line is drawn in. */
function colours(node: Code): (string | undefined)[] {
    const inner = internals(node);
    return inner.tokenLines[0].tokens.map(t => t.color);
}

const keywordColour = (node: Code) => {
    const inner = internals(node);
    return inner.tokenLines[0].tokens.find(t => t.content === 'const')?.color;
};

const SOURCE = 'const a = 1;';

function step(command: Command<unknown>, at: number): void {
    const stepper = command._stepper();
    stepper.seek(0);
    stepper.seek(at);
}

/**
 * Run one listing command so the node is past its pre-start state, where it
 * derives everything from the props anyway. What is under test is the node after
 * a command has applied.
 */
function started<T extends Code>(node: T): T {
    step(node.highlight({ data: { target: lines(1) }, duration: 1 }) as Command<unknown>, 1);
    return node;
}

describe('a listing follows the props it was tokenized from', () => {
    it('recolours when the theme is assigned', () => {
        const node = started(attach(new Code({ code: SOURCE, language: 'typescript', theme: GithubDarkStyle })));
        const dark = keywordColour(node);
        node.set({ theme: GithubLightStyle });
        expect(keywordColour(node)).not.toBe(dark);
    });

    it('recolours when the theme is tweened', () => {
        const node = started(attach(new Code({ code: SOURCE, language: 'typescript', theme: 'github-dark' })));
        const dark = keywordColour(node);
        step(node.to({ data: { theme: 'github-light' }, duration: 1 }) as Command<unknown>, 1);
        expect(node.theme).toBe('github-light');
        expect(keywordColour(node)).not.toBe(dark);
        expect(keywordColour(node)).toBe(compileKeyword(GithubLightStyle));
    });

    it('recolours when the theme is bound', () => {
        let theme: 'github-dark' | 'github-light' = 'github-dark';
        const node = started(attach(new Code({ code: SOURCE, language: 'typescript', theme: () => theme })));
        const dark = keywordColour(node);
        theme = 'github-light';
        expect(keywordColour(node)).not.toBe(dark);
    });

    it('re-reads a bound code', () => {
        let code = 'const a = 1;';
        const node = started(attach(new Code({ code: () => code, language: 'typescript' })));
        expect(internals(node).joinedSource()).toBe('const a = 1;');
        code = 'const b = 22;';
        expect(internals(node).joinedSource()).toBe('const b = 22;');
    });

    it('re-tokenizes when the language changes', () => {
        const node = started(attach(new Code({ code: SOURCE, language: 'typescript' })));
        expect(colours(node).some(c => c !== undefined)).toBe(true);
        const before = internals(node).tokenLines[0].tokens.length;
        node.set({ language: 'nonexistent-language' });
        expect(internals(node).tokenLines[0].tokens).toHaveLength(1);
        expect(before).toBeGreaterThan(1);
    });

    it('keeps a highlight on the same tokens across a theme change', () => {
        const node = attach(new Code({ code: 'const a = 1;\nconst b = 2;', language: 'typescript', theme: 'github-dark' }));
        step(node.highlight({ data: { target: lines(2) }, duration: 1 }) as Command<unknown>, 1);
        const picked = [...internals(node).highlightedIds];
        expect(picked.length).toBeGreaterThan(0);

        node.set({ theme: 'github-light' });

        const ids = new Set(internals(node).tokenLines.flatMap(line => line.tokens.map(t => t.id)));
        for (const id of picked) expect(ids.has(id)).toBe(true);
    });
});

describe('a Windows line ending is a line break, not a character', () => {
    const CRLF = 'a = 1;\r\nb = 2;';

    it('draws no carriage return at the end of a line', () => {
        const node = attach(new Code({ code: CRLF, language: 'typescript' }));
        const rows = internals(node).tokenLines.map(line => line.tokens.map(t => t.content).join(''));
        expect(rows).toEqual(['a = 1;', 'b = 2;']);
        expect(internals(node).joinedSource()).toBe('a = 1;\nb = 2;');
    });

    it('treats a lone carriage return the same way', () => {
        const node = attach(new Code({ code: 'a\rb', language: 'typescript' }));
        expect(internals(node).tokenLines).toHaveLength(2);
    });

    it('normalises text a command brings in', () => {
        const node = attach(new Code({ code: 'a = 1;', language: 'typescript' }));
        const command = node.append({ data: { code: '\r\nb = 2;' }, duration: 1 }) as Command<unknown>;
        step(command, 1);
        expect(internals(node).joinedSource()).toBe('a = 1;\nb = 2;');
        expect(node.code).toBe('a = 1;\nb = 2;');
    });

    it('addresses lines the way the displayed rows count them', () => {
        const node = attach(new Code({ code: CRLF, language: 'typescript' }));
        step(erase(node, { data: { target: lines(1) }, duration: 1 }) as Command<unknown>, 1);
        expect(internals(node).joinedSource()).toBe('b = 2;');
    });
});

describe('a command on a node that is not in the tree', () => {
    function loose(): Code {
        return new Code({ code: 'a = 1;', language: 'typescript' });
    }

    it('keeps its duration and writes nothing', () => {
        const node = loose();
        const commands: Command<unknown>[] = [
            node.append({ data: { code: '\nb' }, duration: 2 }),
            node.prepend({ data: { code: 'b\n' }, duration: 2 }),
            node.insert({ data: { position: [1, 1], code: 'z' }, duration: 2 }),
            erase(node, { data: { target: lines(1) }, duration: 2 }),
            node.replace({ data: { target: lines(1), replacement: 'q' }, duration: 2 }),
            node.highlight({ data: { target: lines(1) }, duration: 2 }),
            node.resetHighlight({ data: {}, duration: 2 }),
            node.to({ data: { code: 'y = 3;' }, duration: 2 }),
        ] as Command<unknown>[];
        for (const command of commands) {
            expect(command.duration).toBe(2);
            step(command, 2);
        }
        expect(node.code).toBe('a = 1;');
        expect(internals(node).joinedSource()).toBe('a = 1;');
        expect(internals(node).highlightedIds.size).toBe(0);
    });

    it('still edits once the node is attached', () => {
        const node = attach(loose());
        step(node.append({ data: { code: '\nb' }, duration: 1 }) as Command<unknown>, 1);
        expect(node.code).toBe('a = 1;\nb');
    });
});

function compileKeyword(style: typeof GithubLightStyle): string | undefined {
    const probe = attach(new Code({ code: SOURCE, language: 'typescript', theme: style }));
    return keywordColour(probe);
}

