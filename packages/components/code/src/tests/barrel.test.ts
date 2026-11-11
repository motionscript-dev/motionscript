import { describe, expect, it } from 'vitest';
import { Registry } from '@motionscript/sdk';
import * as barrel from '..';
import * as engine from '../engine';
import { Code } from '../node';
import { NODES } from '../nodes';

/**
 * What `@motionscript/code` publishes. The root barrel is `export *` from `node.ts`
 * and `engine.ts` and `NODES`, so this list is the package's runtime surface: a
 * name leaving it breaks a host or a copied node, and a name arriving widens what
 * the package has promised to keep.
 */

/** The node file's own: the component, the factory a custom strategy builds one with, and what were its methods. */
const NODE = ['Code', 'defineCode', 'findAllRanges', 'findFirstRange', 'findRangeAt', 'listingOf'];

/** The engine: what a copied node's import of `./engine` is rewritten to. */
const ENGINE = [
    'BUILTIN_THEMES',
    'CodeRangeChain',
    'CodeRanges',
    'DefaultHighlightStyle',
    'GithubDarkStyle',
    'GithubLightStyle',
    'TokenAdvanceCache',
    'VscodeDarkStyle',
    'VscodeLightStyle',
    'canHighlight',
    'charOffsetsToRange',
    'compileStyle',
    'defaultCodeDiff',
    'defaultCodePhases',
    'drawCode',
    'ensureHighlighter',
    'initSyntaxHighlighter',
    'layoutCode',
    'lines',
    'loadCodeLanguage',
    'makeAnim',
    'metricsSignature',
    'moveProgress',
    'normalizeSource',
    'rangeToCharOffsets',
    'registerCodeTheme',
    'resolveTheme',
    'resolveTokenStates',
    'sampleCurve',
    'smoothstep',
    'tokenizeCodeToIdLines',
    'windowProgress',
    'word',
];

describe('the root barrel', () => {
    it('exports the node, NODES and the engine, and nothing else', () => {
        expect(Object.keys(barrel).sort()).toEqual([...ENGINE, ...NODE, 'NODES'].sort());
    });

    it('exports every name of the engine barrel', () => {
        expect(Object.keys(engine).sort()).toEqual(ENGINE);
        for (const name of ENGINE) expect((barrel as Record<string, unknown>)[name], name).toBe((engine as Record<string, unknown>)[name]);
    });

    it('exports the node component itself', () => {
        expect(barrel.Code).toBe(Code);
    });

    it('does not export the internals a node keeps to itself', () => {
        for (const internal of ['highlightToTokens', 'diffCode', 'makeIdToken', 'makeIdLine']) {
            expect(barrel, internal).not.toHaveProperty(internal);
        }
    });

    it('exports the pieces of the highlighter that are functions as functions', () => {
        for (const name of ['canHighlight', 'ensureHighlighter', 'initSyntaxHighlighter', 'loadCodeLanguage', 'registerCodeTheme', 'resolveTheme', 'compileStyle', 'tokenizeCodeToIdLines']) {
            expect(typeof (barrel as Record<string, unknown>)[name], name).toBe('function');
        }
    });
});

describe('NODES', () => {
    it('lists the one node component the kit publishes', () => {
        expect(NODES).toEqual([Code]);
        expect(barrel.NODES).toBe(NODES);
    });

    it('registers nothing by being imported: a registry knows `code` only when it is handed NODES', () => {
        expect(new Registry({ nodes: [] }).hasNode('code')).toBe(false);
        const registry = new Registry({ nodes: NODES });
        expect(registry.hasNode('code')).toBe(true);
        // A component registers as the node class it generated.
        expect(registry.node('code')?.ctor).toBe(Code.node);
    });

    // Where a host shelves it and how it lays out are the host's to keep.
    it('describes the node under its key, as a 2D node', () => {
        const described = new Registry({ nodes: NODES }).describe('code');
        expect(described).toMatchObject({ key: 'code', dimension: '2d' });
    });
});
