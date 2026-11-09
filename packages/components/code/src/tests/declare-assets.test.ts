import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    ContextMap,
    type Graphics2D,
    type RenderContext2D,
    type Size2D,
} from '@motionscript/sdk';
import { AssetDeclaration, CanvasRenderContext2D, ManifestAssetCatalog } from '@motionscript/core';
import { Code, listingOf } from '../node';
import { canHighlight } from '../highlight';

const catalog = new ManifestAssetCatalog({
    image: {},
    video: {},
    audio: {},
    font: {},
});

class NullContext extends CanvasRenderContext2D {
    protected drawGraphics(_graphics: Graphics2D): void { }
    measureText(text: string, fontSize: number): Size2D {
        return { width: text.length * fontSize * 0.6, height: fontSize };
    }
    unmount(): void { }
    execute(callback: () => void): void { callback(); }
    screenshot(): undefined { return undefined; }
    transform(): RenderContext2D { return this; }
    beginBoolean(): void { }
    endBoolean(): void { }
    beginMask(): void { }
    applyMask(): void { }
    endMask(): void { }
    beginClip(): void { }
    endClip(): void { }
    beginCamera(): void { }
    endCamera(): void { }
}

function tokensOnFirstLine(node: Code): number {
    return listingOf(node).lines[0].tokens.length;
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('Code declares its assets', () => {
    // Both of them, and nothing else: the block has no paint slots to declare.
    it('the face and the grammar', () => {
        const scope = new AssetDeclaration(catalog);
        new Code({ code: 'const a = 1;', language: 'typescript' }).declareAssets(scope);
        const declared = Object.fromEntries([...scope.declarations].map(([key, decl]) => [key, decl.type]));

        expect(declared).toEqual({ 'Fira Mono': 'font', 'shiki:lang:typescript': 'loader' });
        expect(scope.declarations.get('shiki:lang:typescript')).toMatchObject({ gate: 'layout' });
    });

    it('hands every block of one language the same load function', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => { });
        const scope = new AssetDeclaration(catalog);
        new Code({ code: 'a', language: 'json' }).declareAssets(scope);
        new Code({ code: 'b', language: 'json' }).declareAssets(scope);
        expect(scope.declarations.size).toBe(2);
        expect(warn).not.toHaveBeenCalled();
    });

    it('re-tokenizes on render once the declared grammar lands, without the loader touching the node', async () => {
        const node = new Code({ code: 'fn main() { let x = 1; }', language: 'rust' });
        expect(canHighlight('rust')).toBe(false);
        expect(tokensOnFirstLine(node)).toBe(1);

        const scope = new AssetDeclaration(catalog);
        node.declareAssets(scope);
        const grammar = scope.declarations.get('shiki:lang:rust');
        if (grammar?.type !== 'loader') throw new Error('grammar loader not declared');
        await grammar.load();
        expect(canHighlight('rust')).toBe(true);
        // The loader wrote nothing to the node: the listing is derived from its props and the grammar each frame.
        expect(node.listing).toBeNull();

        node.attach({ assets: catalog, context: ContextMap.EMPTY, time: 0 });
        const ctx = new NullContext();
        node.measure({}, ctx);
        node.layout({ x: 0, y: 0, width: 600, height: 200 }, ctx);
        ctx.execute(() => node.render(ctx));
        expect(tokensOnFirstLine(node)).toBeGreaterThan(1);
    });
});
