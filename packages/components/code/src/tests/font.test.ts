import { describe, expect, it } from 'vitest';
import { AssetDeclaration, ManifestAssetCatalog } from '@motionscript/core';
import { Code } from '../node';

/**
 * The face a `Code` needs, from the node's side of the seam.
 *
 * The kit ships no font, names no URL and has no fallback: it declares the family
 * its `fontFamily` names, and the host's loader finds that family in
 * `engine.manifest.font` or does not. When it does not, the loader reports the
 * family once and shapes against its fallback (in the browser's
 * storage adapter, which this package cannot reach). What the node owes that
 * report is the declaration it is made from, and what the catalog answers is
 * the only thing that tells a listed family from an unlisted one.
 */

const FIRA = {
    key: 'Fira Mono@400',
    meta: { src: 'fonts/FiraMono-Regular.ttf', fontFamily: 'Fira Mono', weight: 400, sizeBytes: 0 },
};

function catalog(fonts: Record<string, unknown> = {}) {
    return new ManifestAssetCatalog({ image: {}, video: {}, audio: {}, font: fonts } as never);
}

function declared(nodes: Code[], assets = catalog()) {
    const scope = new AssetDeclaration(assets);
    for (const node of nodes) node.declareAssets(scope);
    return [...scope.declarations].filter(([, decl]) => decl.type === 'font').map(([key]) => key);
}

describe('the face a Code declares', () => {
    it('is the family its fontFamily names, the default Fira Mono', () => {
        expect(declared([new Code({ code: 'a' })])).toEqual(['Fira Mono']);
    });

    it('is another family when fontFamily is another', () => {
        expect(declared([new Code({ code: 'a', fontFamily: 'JetBrains Mono' })])).toEqual(['JetBrains Mono']);
    });

    it('is the family at the default weight: the kit never sets one', () => {
        const scope = new AssetDeclaration(catalog());
        new Code({ code: 'a' }).declareAssets(scope);
        expect(scope.declarations.get('Fira Mono')).toMatchObject({ type: 'font', family: 'Fira Mono', weight: 400 });
    });

    it('is declared once for any number of listings of one family, so the loader is asked once', () => {
        expect(declared([new Code({ code: 'a' }), new Code({ code: 'b' }), new Code({ code: 'c' })])).toEqual(['Fira Mono']);
    });

    it('is one declaration for each family when listings differ', () => {
        expect(declared([new Code({ code: 'a' }), new Code({ code: 'b', fontFamily: 'Other Mono' })]).sort()).toEqual(['Fira Mono', 'Other Mono']);
    });

    it('is declared even when the manifest does not list it: declaring is not the report', () => {
        expect(declared([new Code({ code: 'a' })], catalog())).toEqual(['Fira Mono']);
    });

    it('is nothing for an empty family, which names no face', () => {
        expect(declared([new Code({ code: 'a', fontFamily: '' })])).toEqual([]);
    });
});

describe('what the catalog says of a family the manifest does not list', () => {
    it('has no description of Fira Mono when the manifest has no font entries', () => {
        expect(catalog().getFontFamilyMetas('Fira Mono')).toEqual([]);
    });

    it('has none when the manifest lists only other families', () => {
        const only = catalog({ 'Inter@400': { src: 'fonts/Inter.ttf', fontFamily: 'Inter', weight: 400, sizeBytes: 0 } });
        expect(only.getFontFamilyMetas('Fira Mono')).toEqual([]);
        expect(only.getFontFamilyMetas('Inter')).toHaveLength(1);
    });

    it('describes the family once the host lists it under the name the node uses', () => {
        const listed = catalog({ [FIRA.key]: FIRA.meta });
        expect(listed.getFontFamilyMetas('Fira Mono')).toEqual([FIRA.meta]);
    });

    it('is an exact match on the family name, so a differently spelled family is not the one the node asked for', () => {
        const listed = catalog({ [FIRA.key]: FIRA.meta });
        expect(listed.getFontFamilyMetas('fira mono')).toEqual([]);
        expect(listed.getFontFamilyMetas('Fira Code')).toEqual([]);
    });

    it('takes the family a node declares to be the same string it looks up', () => {
        const node = new Code({ code: 'a', fontFamily: 'Fira Mono' });
        const scope = new AssetDeclaration(catalog({ [FIRA.key]: FIRA.meta }));
        node.declareAssets(scope);
        const decl = [...scope.declarations.values()].find((d) => d.type === 'font');
        if (decl?.type !== 'font') throw new Error('no font declared');
        expect(scope.catalog.getFontFamilyMetas(decl.family)).toHaveLength(1);
    });
});
