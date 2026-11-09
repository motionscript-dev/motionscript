import { describe, it, expect } from 'vitest';
import { ContextMap, Graphics2D, DefaultTextStyle, component2d, type Node, type Node2D, type RenderContext2D, type Size2D } from '@motionscript/sdk';
import { CanvasRenderContext2D, ManifestAssetCatalog, type TextState } from '@motionscript/core';
import { Code } from '../node';

/** Records the op lists reaching the backend seam, so a test can assert what a
 *  draw resolved to without a GPU surface. */
class RecorderContext extends CanvasRenderContext2D {
    readonly drawn: Graphics2D[] = [];

    protected drawGraphics(graphics: Graphics2D): void {
        this.drawn.push(graphics);
    }

    /** Every `text` op state across every recorded draw, in draw order. */
    textStates(): Partial<TextState>[] {
        const states: Partial<TextState>[] = [];
        for (const graphics of this.drawn) {
            for (const op of graphics.ops()) {
                if (op.kind === 'text') states.push(op.state);
            }
        }
        return states;
    }

    measureText(): Size2D { return { width: 0, height: 0 }; }
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

/**
 * A minimal `MeasureContext2D`. `Code` reads `{ width }` from `measureText`, so
 * the answer is a size like the shaper's — a bare number would sum `undefined`
 * and leave every advance and every position `NaN`.
 */
const scope = {
    measureText: (text: string, fontSize: number): Size2D => ({ width: text.length * fontSize * 0.6, height: fontSize }),
};


/**
 * Put `node` in a live tree.
 *
 * Measuring, drawing and animating are all gated on a node being attached, so a
 * unit test has to say so explicitly — the runtime does this once per frame for
 * the whole scene.
 */
function attach<T extends Node>(node: T): T {
    node.attach({
        assets: new ManifestAssetCatalog({ image: {}, video: {}, audio: {}, font: {} }),
        context: ContextMap.EMPTY,
        time: 0,
    });
    return node;
}

function render(root: Node2D): RecorderContext {
    attach(root);
    root.layout({ x: 0, y: 0, width: 600, height: 300 }, scope as never);
    const ctx = new RecorderContext();
    ctx.execute(() => root.render(ctx));
    return ctx;
}

describe('Code refuses the ambient text-style defaults', () => {
    it('keeps its own font when drawn under a <DefaultTextStyle>', () => {
        const code = new Code({ code: 'const a = 1;', language: 'typescript', fontSize: 16 });
        const root = new DefaultTextStyle({
            fontFamily: 'Playfair Display',
            fontWeight: 700,
            fontSize: 96,
            letterSpacing: 8,
            children: [code],
        });

        const states = render(root).textStates();
        expect(states.length).toBeGreaterThan(0);
        // Measured from the listing's own 16 px face, not the document's 96 px one: twelve glyphs of 9.6 px
        // in one row of 25.6. A scope that answered with a bare number would leave this 0 wide.
        expect(code.layoutBounds.width).toBeCloseTo(12 * 9.6);
        expect(code.layoutBounds.height).toBeCloseTo(25.6);
        for (const state of states) {
            // Laid out: the positions are numbers, so a layout that broke would show here.
            expect(Number.isFinite(state.x) && Number.isFinite(state.y)).toBe(true);
            // Its own props, not the document's.
            expect(state.fontFamily).toBe('Fira Mono');
            expect(state.fontSize).toBe(16);
            // A weight it never set stays unset rather than inheriting 700 —
            // token x positions were measured at the default weight.
            expect(state.fontWeight).toBeUndefined();
        }
    });

    it('closes its scope, so a sibling still inherits', () => {
        const RawLabel = component2d({
            key: 'rawLabel',
            render: (ctx) => ctx.draw(new Graphics2D().text({ text: 'Hi' }).fill('white')),
        });

        const root = new DefaultTextStyle({
            fontFamily: 'Playfair Display',
            children: [
                new Code({ code: 'x', language: 'typescript' }),
                new RawLabel({ width: 100, height: 40 }),
            ],
        });

        const states = render(root).textStates();
        expect(states[states.length - 1].fontFamily).toBe('Playfair Display');
    });
});
