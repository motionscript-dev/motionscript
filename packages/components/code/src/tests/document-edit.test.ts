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

/**
 * Listing commands as a document places them. A document is read at any time in
 * any order, and several of its commands can be in flight at once: two edits
 * that overlap compose, the later one acting on the listing the earlier left.
 */

const STAGE = { width: 800, height: 600 };

beforeAll(async () => {
    await ensureHighlighter(undefined, ['typescript']);
});

const edit = (id: string, type: string, at: number, duration: number, args: Record<string, unknown>): CommandSpec =>
    ({ id, type, targetId: 'listing', at, duration, args } as CommandSpec);

/** Builds and compiles a document with one listing and `commands`, and returns a seek that gives the listing at a time. */
function play(code: string, commands: CommandSpec[]) {
    const registry = new Registry({ nodes: NODES });
    const doc = {
        kind: 'composition',
        nodes: [
            { id: '', type: 'canvas2d', parentId: null, layerOrder: 0, props: {} },
            { id: 'listing', type: 'code', parentId: '', layerOrder: 0, props: { code } },
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
    const text = (lines: readonly { tokens: readonly { content: string }[] }[]) => lines.map((line) => line.tokens.map((t) => t.content).join(''));
    return (time: number): { code: string; rows: string[]; from: string[] | null } => {
        attach(time);
        timeline.syncPresence(time);
        timeline.evaluateAt(time);
        layout();
        const node = timeline.liveNode('listing') as Code;
        const { lines, edit } = listingOf(node);
        return { code: node.code as string, rows: text(lines), from: edit ? text(edit.from) : null };
    };
}

describe('two edits that overlap in a document', () => {
    // `append` runs 0 to 1 s; `prepend` runs 0.5 to 1.5 s, so they are in flight together from 0.5 to 1.
    const COMMANDS = [
        edit('append', 'append', 0, 1, { code: '\nc' }),
        edit('prepend', 'prepend', 0.5, 1, { code: 'z\n' }),
    ];

    it('compose: the second acts on the listing the first leaves', () => {
        const seek = play('a\nb', COMMANDS);
        expect(seek(2).rows).toEqual(['z', 'a', 'b', 'c']);
        expect(seek(2).code).toBe('z\na\nb\nc');
    });

    it('show the old listing before either begins', () => {
        const seek = play('a\nb', COMMANDS);
        expect(seek(0).rows).toEqual(['a', 'b']);
        expect(seek(0).code).toBe('a\nb');
    });

    it('show the first edit alone while only it is in flight', () => {
        const seek = play('a\nb', COMMANDS);
        expect(seek(0.25).rows).toEqual(['a', 'b', 'c']);
        expect(seek(0.49).rows).toEqual(['a', 'b', 'c']);
    });

    // The class still drew the append in flight on this frame. There is one edit entry, and the later
    // command writes it from its first frame: what it starts from is the listing the first lands on.
    it('show, on the later edit\'s first frame, the listing the first lands on, with no edit in flight', () => {
        const seek = play('a\nb', COMMANDS);
        expect(seek(0.5).rows).toEqual(['a', 'b', 'c']);
        expect(seek(0.5).from).toBeNull();
    });

    it('show the later edit, on top of the first, while both are in flight', () => {
        const seek = play('a\nb', COMMANDS);
        expect(seek(0.75).rows).toEqual(['z', 'a', 'b', 'c']);
        expect(seek(0.99).rows).toEqual(['z', 'a', 'b', 'c']);
    });

    it('hold the composed listing after the first has landed and while the second finishes', () => {
        const seek = play('a\nb', COMMANDS);
        expect(seek(1.25).rows).toEqual(['z', 'a', 'b', 'c']);
        expect(seek(1.5).rows).toEqual(['z', 'a', 'b', 'c']);
    });

    it('are the same frame whichever way the playhead came', () => {
        const times = [0, 0.25, 0.75, 1.25, 2];
        const forward = play('a\nb', COMMANDS);
        const expected = new Map(times.map((time) => [time, forward(time).rows]));
        const scrubbed = play('a\nb', COMMANDS);
        for (const time of [2, 0.75, 0, 1.25, 0.25, 0.75, 2, 0]) {
            expect(scrubbed(time).rows, `t = ${time}`).toEqual(expected.get(time));
        }
    });

    it('end on the same listing in either order they are written in the document', () => {
        const reversed = play('a\nb', [...COMMANDS].reverse());
        expect(reversed(2).rows).toEqual(['z', 'a', 'b', 'c']);
    });
});

describe('a later edit that lands before an earlier one has ended', () => {
    it('replaces text another edit appended to: the last edit\'s source is the result', () => {
        const seek = play('one', [
            edit('append', 'append', 0, 2, { code: '\ntwo' }),
            edit('replace', 'replace', 0.5, 0.5, { target: { startLine: 2, startCol: 1, endLine: 2, endCol: Infinity }, replacement: 'TWO' }),
        ]);
        expect(seek(3).rows).toEqual(['one', 'TWO']);
    });

    it('erases text another edit prepended', () => {
        const seek = play('one\ntwo', [
            edit('prepend', 'prepend', 0, 1, { code: 'zero\n' }),
            edit('erase', 'remove', 0.25, 1, { target: { startLine: 1, startCol: 1, endLine: 1, endCol: Infinity } }),
        ]);
        expect(seek(3).rows).toEqual(['one', 'two']);
    });

    it('applies edits placed one after the other in turn', () => {
        const seek = play('a', [
            edit('one', 'append', 0, 1, { code: '\nb' }),
            edit('two', 'append', 1, 1, { code: '\nc' }),
            edit('three', 'append', 2, 1, { code: '\nd' }),
        ]);
        expect(seek(0.5).rows).toEqual(['a', 'b']);
        expect(seek(1.5).rows).toEqual(['a', 'b', 'c']);
        expect(seek(2.5).rows).toEqual(['a', 'b', 'c', 'd']);
        expect(seek(4).rows).toEqual(['a', 'b', 'c', 'd']);
        expect(seek(0.5).rows).toEqual(['a', 'b']);
    });

    it('lands on the later command\'s source when a command with a source of its own overlaps one that built on the first', () => {
        const seek = play('a', [
            edit('append', 'append', 0, 2, { code: '\nb' }),
            { id: 'to', type: 'to', targetId: 'listing', at: 1, duration: 1, args: { code: 'x\ny' } } as CommandSpec,
        ]);
        expect(seek(3).code).toBe('x\ny');
        expect(seek(3).rows).toEqual(['x', 'y']);
    });
});
