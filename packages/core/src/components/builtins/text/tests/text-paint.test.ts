import { describe, it, expect } from 'vitest';
import { Text, RichText } from "@/components/builtins/text/text";
import { Rect } from "@/components/builtins/geometry/geometry";
import { getCommandMeta } from '@/tween/command-decorator';
import { getPropertyMeta } from '@/attributes/properties/decorator';

/**
 * The text nodes take `Paint` without its overlay, where a shape takes all of
 * it — so they have the fill, the stroke and the shadow, and no **overlay**.
 *
 * An overlay is a wash over a node's fill *and its subtree*, clipped to the
 * node's silhouette. Text has neither, so the prop could only ever have been a
 * second fill of the same glyphs — and a control the panel showed, the document
 * stored and the renderer half-honoured. The rule is checked from both ends
 * (the prop and the tween) because they are spread separately and a component can
 * lose one while keeping the other.
 */
const propKeys = (node: object) => getPropertyMeta(node).map(m => m.key);
const commandKeys = (node: object) => getCommandMeta(node).map(m => m.key);

describe.each([
    ['Text', () => new Text({ text: 'hello' })],
    ['RichText', () => new RichText({ spans: { text: 'hello' } })],
])('%s paints without an overlay', (_name, make) => {
    it('keeps the three paint stacks it can render', () => {
        const keys = propKeys(make());

        expect(keys).toContain('fill');
        expect(keys).toContain('stroke');
        expect(keys).toContain('shadow');
    });

    it('declares no overlay prop', () => {
        expect(propKeys(make())).not.toContain('overlay');
    });

    it('offers no overlay tween', () => {
        const keys = commandKeys(make());

        expect(keys).toContain('fillTo');
        expect(keys).toEqual(expect.not.arrayContaining(['overlayTo']));
    });
});

describe('a shape still has all four', () => {
    // The other half of the split: nothing was taken away from the nodes that
    // have a silhouette to clip a wash to.
    it('keeps the overlay prop and its tween', () => {
        const rect = new Rect({ width: 10, height: 10 });

        expect(propKeys(rect)).toContain('overlay');
        expect(commandKeys(rect)).toContain('overlayTo');
    });
});
