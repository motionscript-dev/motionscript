import { describe, expect, it } from 'vitest';
import {
    Canvas2D,
    ContextMap,
    Registry,
    validateDocument,
    type CompositionDocument,
} from '@motionscript/sdk';
import { ManifestAssetCatalog, NullRenderContext, ClipTimeline, sampleTree } from '@motionscript/core';
import type { Code } from '../node';
import { NODES } from '../nodes';

const STAGE = { width: 800, height: 600 };

/** Builds and compiles `doc` the way a clip does, and seeks it. */
function play(doc: CompositionDocument, registry: Registry) {
    const canvas = new Canvas2D({ id: '', ...STAGE, flow: 'freeform' } as never);
    const timeline = new ClipTimeline(doc, registry, canvas);
    const assets = new ManifestAssetCatalog({ image: {}, video: {}, audio: {}, font: {} });
    const measurer = new NullRenderContext();
    const attach = (time: number) => canvas.attach({ assets, context: ContextMap.EMPTY, time });
    const layout = () => canvas.layout({ x: 0, y: 0, ...STAGE }, measurer);
    attach(0);
    timeline.build();
    layout();
    timeline.compile(() => {
        sampleTree(canvas);
        layout();
    });
    return (time: number) => {
        attach(time);
        timeline.syncPresence(time);
        timeline.evaluateAt(time);
        return timeline.liveNode('listing') as Code;
    };
}

/**
 * `Code` publishes its erase under the key `remove`. A structural `remove` used to
 * be registered globally and consulted first, so `{ type: 'remove', targetId:
 * 'listing' }` took the whole listing out instead. A node's departure is its
 * `endAt` now, and the key belongs to the node type again.
 */
describe('a `remove` command in a document', () => {
    it('resolves to Code\'s own erase rather than a global command', () => {
        const registry = new Registry({ nodes: NODES });
        expect(registry.command('remove')).toBeUndefined();
        // Through a method of its own: the node's `remove` takes a child out of the tree.
        expect(registry.node('code')?.commands.get('remove')?.method).toBe('_command_remove');
    });

    it('erases the range as the document plays, leaving the node in the tree', () => {
        const seek = play({
            kind: 'composition',
            nodes: [
                { id: '', type: 'canvas2d', parentId: null, layerOrder: 0, props: {} },
                { id: 'listing', type: 'code', parentId: '', layerOrder: 0, props: { code: 'a\nb' } },
            ],
            commands: [{
                id: 'erase', type: 'remove', targetId: 'listing', at: 0, duration: 1,
                args: { target: { startLine: 1, startCol: 1, endLine: 1, endCol: 2 } },
            }],
        }, new Registry({ nodes: NODES }));
        expect(seek(0).code).toBe('a\nb');
        const done = seek(1);
        expect(done.code).toBe('b');
        expect(done.parent).not.toBeNull();
    });

    it('validates on a code node', () => {
        expect(validateDocument({
            kind: 'composition',
            nodes: [{ id: 'listing', type: 'code', parentId: null, layerOrder: 0, props: { code: 'a\nb' } }],
            commands: [{ id: 'erase', type: 'remove', targetId: 'listing', at: 0, duration: 1, args: {} }],
        }).valid).toBe(true);
    });
});
