import { describe, expect, it } from 'vitest';
import { Registry } from '@motionscript/sdk';
import * as barrel from '..';
import * as kit from '../unstable';
import * as engine from '../engine';
import { Code } from '../node';
import { NODES } from '../nodes';

/**
 * What `@motionscript/code` publishes. The root is the promised surface, named one by one: a name leaving it
 * breaks a host, a name arriving widens what the package keeps. `./kit` (`unstable.ts`) is the node file and the
 * engine whole, for a copied node and code built on the internals.
 */
const STABLE = ['Code', 'CodeRanges', 'NODES', 'defineCode', 'initSyntaxHighlighter', 'lines', 'registerCodeTheme', 'word'];

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
    it('exports the stable surface and nothing else', () => {
        expect(Object.keys(barrel).sort()).toEqual([...STABLE].sort());
    });

    it('hands out the same values as the kit', () => {
        for (const name of STABLE.filter((n) => n !== 'NODES')) {
            expect((barrel as Record<string, unknown>)[name], name).toBe((kit as Record<string, unknown>)[name]);
        }
    });
});

describe('the kit barrel', () => {
    it('exports the node file and the engine, and nothing else', () => {
        expect(Object.keys(kit).sort()).toEqual([...ENGINE, ...NODE].sort());
    });

    it('exports every name of the engine barrel', () => {
        expect(Object.keys(engine).sort()).toEqual(ENGINE);
        for (const name of ENGINE) expect((kit as Record<string, unknown>)[name], name).toBe((engine as Record<string, unknown>)[name]);
    });

    it('exports the node component itself', () => {
        expect(kit.Code).toBe(Code);
    });

    it('does not export the internals a node keeps to itself', () => {
        for (const internal of ['highlightToTokens', 'diffCode', 'makeIdToken', 'makeIdLine']) {
            expect(kit, internal).not.toHaveProperty(internal);
        }
    });

    it('exports the pieces of the highlighter that are functions as functions', () => {
        for (const name of ['canHighlight', 'ensureHighlighter', 'initSyntaxHighlighter', 'loadCodeLanguage', 'registerCodeTheme', 'resolveTheme', 'compileStyle', 'tokenizeCodeToIdLines']) {
            expect(typeof (kit as Record<string, unknown>)[name], name).toBe('function');
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
