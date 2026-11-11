import { beforeAll, describe, expect, it } from 'vitest';
import {
    Canvas2D,
    ContextMap,
    Graphics2D,
    Registry,
    type CompositionDocument,
    type RenderContext2D,
    type Size2D,
} from '@motionscript/sdk';
import {
    CanvasRenderContext2D,
    ManifestAssetCatalog,
    ClipTimeline,
    sampleTree,
    type TextState,
} from '@motionscript/core';
import type { Code } from '../node';
import { NODES } from '../nodes';
import { lines, word } from '../code-range';
import { ensureHighlighter } from '../highlight';

const STAGE = { width: 1200, height: 800 };

beforeAll(async () => {
    await ensureHighlighter(['typescript']);
});

/** Every token one frame draws, in draw order, with the opacity it was painted at. */
class FrameRecorder extends CanvasRenderContext2D {
    readonly tokens: Array<{ text: string; opacity: number }> = [];

    protected drawGraphics(graphics: Graphics2D): void {
        let pending: { text: string; opacity: number } | null = null;
        for (const op of graphics.ops()) {
            if (op.kind === 'text') {
                pending = { text: String((op.state as Partial<TextState>).text ?? ''), opacity: 1 };
                this.tokens.push(pending);
            } else if (op.kind === 'fill' && pending) {
                pending.opacity = Number((op.fills as Array<{ opacity?: number }>)[0]?.opacity ?? 1);
                pending = null;
            }
        }
    }

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

/** Builds and compiles `doc` the way a clip does, and returns what a seek to `t` draws. */
function play(doc: CompositionDocument) {
    const registry = new Registry({ nodes: NODES });
    const canvas = new Canvas2D({ id: '', ...STAGE, flow: 'freeform' } as never);
    const timeline = new ClipTimeline(doc, registry, canvas);
    const assets = new ManifestAssetCatalog({ image: {}, video: {}, audio: {}, font: {} });
    const measurer = new FrameRecorder();
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
        layout();
        const listing = timeline.liveNode('listing') as Code;
        const frame = new FrameRecorder();
        frame.execute(() => listing.render(frame));
        return {
            listing,
            text: frame.tokens.filter(t => t.opacity > 0).map(t => t.text).join(''),
            opacities: frame.tokens.map(t => t.opacity),
            signature: frame.tokens.map(t => `${t.text}@${t.opacity.toFixed(4)}`).join('|'),
        };
    };
}

const listingRow = (code: string) =>
    ({ id: 'listing', type: 'code', parentId: '', layerOrder: 0, props: { code, language: 'typescript' } });
const root = { id: '', type: 'canvas2d', parentId: null, layerOrder: 0, props: {} };

/** The package README's own example: an append at 0 s, then a highlight at 0.8 s. */
const README: CompositionDocument = {
    kind: 'composition',
    nodes: [
        root,
        { id: 'listing', type: 'code', parentId: '', layerOrder: 0,
          props: { code: 'function greet(name) {\n  return "hi";\n}', language: 'typescript',
                   theme: 'github-dark', fontSize: 28 } },
    ],
    commands: [
        { id: 'call', type: 'append', targetId: 'listing', at: 0, duration: 0.6,
          args: { code: '\ngreet("world");' } },
        { id: 'focus', type: 'highlight', targetId: 'listing', at: 0.8, duration: 0.4,
          args: { target: lines(2) } },
    ],
};

describe('a code node before its commands start', () => {
    it('draws the listing its props describe until an edit starts', () => {
        const seek = play({
            kind: 'composition',
            nodes: [root, listingRow('const a = 1;')],
            commands: [{ id: 'more', type: 'append', targetId: 'listing', at: 1, duration: 1,
                         args: { code: '\nconst b = 2;' } }],
        });
        expect(seek(0).text).toBe('const a = 1;');
        expect(seek(0.5).text).toBe('const a = 1;');
        expect(seek(3).text).toBe('const a = 1;const b = 2;');
        expect(seek(0.5).text).toBe('const a = 1;');
        expect(seek(0).listing.code).toBe('const a = 1;');
    });

    it('draws no edit in flight after a seek back past its start', () => {
        const seek = play({
            kind: 'composition',
            nodes: [root, listingRow('const a = 1;')],
            commands: [{ id: 'swap', type: 'to', targetId: 'listing', at: 1, duration: 1,
                         args: { code: 'let a = 2;' } }],
        });
        const before = seek(0.5).signature;
        seek(1.5);
        expect(seek(0.5).signature).toBe(before);
        expect(seek(0.5).opacities.every(o => o === 1)).toBe(true);
    });

    it('is not dimmed before a highlight starts', () => {
        const seek = play(README);
        expect(seek(0).opacities.every(o => o === 1 || o === 0)).toBe(true);
        expect(seek(0.7).opacities.every(o => o === 1)).toBe(true);
        expect(seek(2).opacities.some(o => Math.abs(o - 0.4) < 1e-6)).toBe(true);
        expect(seek(0.7).opacities.every(o => o === 1)).toBe(true);
    });

    it('keeps the tokens a highlight selected when a later edit comes back to the same source', () => {
        const seek = play({
            kind: 'composition',
            nodes: [root, listingRow('let a = 1;')],
            commands: [
                { id: 'focus', type: 'highlight', targetId: 'listing', at: 0.2, duration: 0.2,
                  args: { target: word(1, 5, 1) } },
                { id: 'away', type: 'to', targetId: 'listing', at: 1, duration: 0.5, args: { code: 'let b = 2;' } },
                { id: 'back', type: 'to', targetId: 'listing', at: 2, duration: 0.5, args: { code: 'let a = 1;' } },
            ],
        });
        const focused = (frame: ReturnType<typeof seek>) =>
            frame.signature.split('|').filter(t => t.endsWith('@1.0000')).map(t => t.split('@')[0]);
        expect(focused(seek(0.5))).toEqual(['a']);
        seek(3);
        expect(focused(seek(0.5))).toEqual(['a']);
    });

    it('draws the same frame at a time however the playhead reached it', () => {
        const times = [0, 0.3, 0.6, 0.7, 0.9, 1.1, 1.5, 3];
        const forward = play(README);
        const expected = new Map(times.map(t => [t, forward(t).signature]));
        const scrubbed = play(README);
        for (const t of [3, 0.7, 1.1, 0, 0.9, 0.3, 1.5, 0.6, 0.7, 0]) {
            expect(scrubbed(t).signature, `t = ${t}`).toBe(expected.get(t));
        }
    });
});
