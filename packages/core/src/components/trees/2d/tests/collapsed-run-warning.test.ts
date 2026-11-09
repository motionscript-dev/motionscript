import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Rect } from "@/components/builtins/geometry/geometry";
import type { Node2D } from '@/components/trees/2d/node2d';
import { Canvas2D } from '@/components/trees/root/canvas2d-node';
import { FakeMeasureContext } from '@/runtime/runtime.fixtures';
import type { BoxBounds } from '@/layout/bounds';

const scope = new FakeMeasureContext();

/**
 * A run laid out in a box of length 0 on its main axis, with children that have a
 * size, positions them from the box's centre rather than its leading edge. The
 * container says so once, with the exact words `flowOps.collapsedRun` gives it.
 *
 * The warning is `Node2D`'s own flow layout's, which the engine's root lays
 * its children out with; a component's `Flow.layout` does not give it.
 */
let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => { });
});
afterEach(() => warn.mockRestore());

const tile = (width: number, height: number) => new Rect({ width, height });
const lay = (node: Node2D, rect: BoxBounds) => node.layout(rect, scope);
const messages = () => warn.mock.calls.map((call: unknown[]) => String(call[0]));

describe('the collapsed-run warning', () => {
    it('names the container, the sized children, the box and the mode, in exactly these words', () => {
        const row = new Canvas2D({ flow: 'horizontal', width: 100, height: 50, children: [tile(30, 30), tile(40, 30)] });
        lay(row, { x: 0, y: 0, width: 0, height: 50 });
        expect(messages()).toEqual([
            '[motionscript] "Canvas2D" is laying out 2 sized children in a run of length 0 (0×50, horizontal). '
            + 'They will be positioned from its centre rather than its leading edge.',
        ]);
    });

    it('says "child" for one', () => {
        const row = new Canvas2D({ flow: 'horizontal', width: 100, height: 50, children: [tile(30, 30)] });
        lay(row, { x: 0, y: 0, width: 0, height: 50 });
        expect(messages()[0]).toContain('is laying out 1 sized child in a run');
    });

    it('names a vertical run by its height', () => {
        const column = new Canvas2D({ flow: 'vertical', width: 50, height: 100, children: [tile(30, 30)] });
        lay(column, { x: 0, y: 0, width: 50, height: 0 });
        expect(messages()).toEqual([
            '[motionscript] "Canvas2D" is laying out 1 sized child in a run of length 0 (50×0, vertical). '
            + 'They will be positioned from its centre rather than its leading edge.',
        ]);
    });

    it('names the class of the container', () => {
        class Stage extends Canvas2D { }
        const row = new Stage({ flow: 'horizontal', width: 100, height: 50, children: [tile(30, 30)] });
        lay(row, { x: 0, y: 0, width: 0, height: 50 });
        expect(messages()[0]).toMatch(/^\[motionscript\] "Stage" is laying out/);
    });

    it('counts only the children that have a size', () => {
        const row = new Canvas2D({ flow: 'horizontal', width: 100, height: 50, children: [tile(30, 30), tile(0, 0), tile(0, 20)] });
        lay(row, { x: 0, y: 0, width: 0, height: 50 });
        expect(messages()[0]).toContain('is laying out 2 sized children');
    });

    it('fires once per node, however often it is laid out', () => {
        const row = new Canvas2D({ flow: 'horizontal', width: 100, height: 50, children: [tile(30, 30)] });
        for (let i = 0; i < 5; i++) lay(row, { x: 0, y: 0, width: 0, height: 50 });
        expect(warn).toHaveBeenCalledTimes(1);
    });

    it('stays quiet afterwards even for a different box that is still collapsed', () => {
        const row = new Canvas2D({ flow: 'horizontal', width: 100, height: 50, children: [tile(30, 30)] });
        lay(row, { x: 0, y: 0, width: 0, height: 50 });
        lay(row, { x: 0, y: 0, width: 0, height: 80 });
        expect(warn).toHaveBeenCalledTimes(1);
    });

    it('does not fire for a box that has length, and fires later if the box collapses', () => {
        const row = new Canvas2D({ flow: 'horizontal', width: 100, height: 50, children: [tile(30, 30)] });
        lay(row, { x: 0, y: 0, width: 100, height: 50 });
        expect(warn).not.toHaveBeenCalled();
        lay(row, { x: 0, y: 0, width: 0, height: 50 });
        expect(warn).toHaveBeenCalledTimes(1);
    });

    it('fires once for each node that has the problem', () => {
        const rows = [0, 1, 2].map(() => new Canvas2D({ flow: 'horizontal', width: 100, height: 50, children: [tile(30, 30)] }));
        for (const row of rows) lay(row, { x: 0, y: 0, width: 0, height: 50 });
        for (const row of rows) lay(row, { x: 0, y: 0, width: 0, height: 50 });
        expect(warn).toHaveBeenCalledTimes(3);
    });

    it('does not fire for an empty run', () => {
        const row = new Canvas2D({ flow: 'horizontal', width: 100, height: 50 });
        lay(row, { x: 0, y: 0, width: 0, height: 50 });
        expect(warn).not.toHaveBeenCalled();
    });

    it('does not fire for a run that is fully collapsed: every child has no size', () => {
        const row = new Canvas2D({ flow: 'horizontal', width: 100, height: 50, children: [tile(0, 0), tile(0, 0)] });
        lay(row, { x: 0, y: 0, width: 0, height: 50 });
        expect(warn).not.toHaveBeenCalled();
    });

    it('does not fire for a freeform or grid container, whose boxes are not runs', () => {
        for (const flow of ['freeform', 'grid'] as const) {
            const box = new Canvas2D({ flow, width: 100, height: 50, children: [tile(30, 30)] });
            lay(box, { x: 0, y: 0, width: 0, height: 0 });
        }
        expect(warn).not.toHaveBeenCalled();
    });

    it('does not fire for the cross axis alone being collapsed', () => {
        const row = new Canvas2D({ flow: 'horizontal', width: 100, height: 50, children: [tile(30, 30)] });
        lay(row, { x: 0, y: 0, width: 100, height: 0 });
        expect(warn).not.toHaveBeenCalled();
    });

    it('does not fire for a hidden child, which is out of the run altogether', () => {
        const row = new Canvas2D({ flow: 'horizontal', width: 100, height: 50, children: [tile(30, 30)] });
        row.children[0]._setEditorState(true, false);
        lay(row, { x: 0, y: 0, width: 0, height: 50 });
        expect(warn).not.toHaveBeenCalled();
    });

    it('still lays the children out, warning or not', () => {
        const child = tile(30, 30);
        const row = new Canvas2D({ flow: 'horizontal', width: 100, height: 50, children: [child] });
        lay(row, { x: 0, y: 0, width: 0, height: 50 });
        expect(child.measuredWidth).toBe(30);
    });

    it('warns through console.warn and nothing else', () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => { });
        const log = vi.spyOn(console, 'log').mockImplementation(() => { });
        try {
            const row = new Canvas2D({ flow: 'horizontal', width: 100, height: 50, children: [tile(30, 30)] });
            lay(row, { x: 0, y: 0, width: 0, height: 50 });
            expect(error).not.toHaveBeenCalled();
            expect(log).not.toHaveBeenCalled();
        } finally {
            error.mockRestore();
            log.mockRestore();
        }
    });
});
