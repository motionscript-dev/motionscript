import { beforeAll, describe, expect, it } from 'vitest';
import {
    Canvas2D,
    ContextMap,
    Registry,
    type CommandSpec,
    type CompositionDocument,
} from '@motionscript/sdk';
import { ClipTimeline, ManifestAssetCatalog, NullRenderContext, sampleTree } from '@motionscript/core';
import { listingOf, type Code } from '../node';
import { NODES } from '../nodes';
import { ensureHighlighter } from '../highlight';
import { lines } from '../code-range';

/**
 * Row bands as a document places them: read at any time, in any order, the
 * bands on screen are the ones the commands up to that time left.
 */

const STAGE = { width: 800, height: 600 };

beforeAll(async () => {
    await ensureHighlighter(['typescript']);
});

const band = (id: string, type: string, at: number, args: Record<string, unknown>): CommandSpec =>
    ({ id, type, targetId: 'listing', at, duration: 1, args } as CommandSpec);

/** The settled bands at a time, as the 1-based rows each one covers. */
function play(commands: CommandSpec[]) {
    const registry = new Registry({ nodes: NODES });
    const doc = {
        kind: 'composition',
        nodes: [
            { id: '', type: 'canvas2d', parentId: null, layerOrder: 0, props: {} },
            { id: 'listing', type: 'code', parentId: '', layerOrder: 0, props: { code: 'a\nb\nc\nd' } },
        ],
        commands,
    } as CompositionDocument;
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
    return (time: number): [number, number][] => {
        attach(time);
        timeline.syncPresence(time);
        timeline.evaluateAt(time);
        layout();
        const node = timeline.liveNode('listing') as Code;
        const { lines } = listingOf(node);
        const row = (id: number) => lines.findIndex((line) => line.id === id) + 1;
        return node.banding.bands.map((each) => [row(each.startId), row(each.endId)]);
    };
}

describe('row bands in a document', () => {
    const COMMANDS = [
        band('first', 'highlightRows', 1, { target: lines(1) }),
        band('second', 'highlightRows', 3, { target: lines(2, 3) }),
        band('clear', 'resetRowHighlight', 5, {}),
    ];

    it('holds what each command left, at any time', () => {
        const at = play(COMMANDS);
        expect(at(0.5)).toEqual([]);
        expect(at(2.5)).toEqual([[1, 1]]);
        expect(at(4.5)).toEqual([[2, 3]]);
        expect(at(6.5)).toEqual([]);
    });

    it('reads the same going backwards', () => {
        const at = play(COMMANDS);
        expect(at(6.5)).toEqual([]);
        expect(at(4.5)).toEqual([[2, 3]]);
        expect(at(2.5)).toEqual([[1, 1]]);
        expect(at(0.5)).toEqual([]);
    });

    it('accepts a range that went through JSON', () => {
        const stored = JSON.parse(JSON.stringify(lines(2, 4)));
        const at = play([band('first', 'highlightRows', 0, { target: stored })]);
        expect(at(2)).toEqual([[2, 4]]);
    });
});
