import { describe, it, expect } from 'vitest';
import { RotatedBox } from "@/components/builtins/layout/layout";
import { Node2D } from '@/components/trees/2d/node2d';
import { Rect } from "@/components/builtins/geometry/geometry";
import { FakeMeasureContext } from '@/runtime/runtime.fixtures';
import { attached } from '@/components/trees/node/node.fixtures';
import { laidOut, recorded } from '@/components/trees/tests/recording-context.fixtures';
import type { BoxBounds } from '@/layout/bounds';
import type { SizeInput } from '@/attributes/layout/size';

const scope = new FakeMeasureContext();

/** A leaf that exposes the box its parent laid it into. */
class Tile extends Node2D {
    constructor(width: SizeInput, height: SizeInput) {
        super({ width, height });
    }
    get rect(): BoxBounds {
        return this.layoutBounds;
    }
}

const FREE = { maxWidth: 1000, maxHeight: 800 };

function measureOf(angle: number | undefined, child: Node2D, props: Record<string, unknown> = {}, constraints = FREE) {
    const box = new RotatedBox({ ...(angle === undefined ? {} : { angle }), ...props, children: [child] } as never);
    return box.measure(constraints, scope);
}

describe('RotatedBox – measure', () => {
    it('swaps the extents of its content at 90 degrees', () => {
        const size = measureOf(90, new Tile(100, 40));
        expect(size.width).toBeCloseTo(40, 9);
        expect(size.height).toBeCloseTo(100, 9);
    });

    it('swaps them at -90 degrees too, which is its default angle', () => {
        const size = measureOf(undefined, new Tile(100, 40));
        expect(size.width).toBeCloseTo(40, 9);
        expect(size.height).toBeCloseTo(100, 9);
        expect(new RotatedBox({} as never).angle).toBe(-90);
    });

    it('keeps the extents at 0 and 180 degrees', () => {
        for (const angle of [0, 180, 360]) {
            const size = measureOf(angle, new Tile(100, 40));
            expect(size.width).toBeCloseTo(100, 9);
            expect(size.height).toBeCloseTo(40, 9);
        }
    });

    it('projects the content onto the axes at an arbitrary angle: the bounding box of the turned rectangle', () => {
        const size = measureOf(45, new Tile(100, 40));
        const side = (100 + 40) * Math.SQRT1_2;
        expect(size.width).toBeCloseTo(side, 9);
        expect(size.height).toBeCloseTo(side, 9);
    });

    it('projects at 30 degrees with the cosine on the matching axis and the sine on the other', () => {
        const size = measureOf(30, new Tile(100, 40));
        const cos = Math.cos(Math.PI / 6), sin = Math.sin(Math.PI / 6);
        expect(size.width).toBeCloseTo(100 * cos + 40 * sin, 9);
        expect(size.height).toBeCloseTo(100 * sin + 40 * cos, 9);
    });

    it('measures the same at an angle and at its negative: the box is symmetric', () => {
        const forward = measureOf(30, new Tile(100, 40));
        const backward = measureOf(-30, new Tile(100, 40));
        expect(backward.width).toBeCloseTo(forward.width as number, 9);
        expect(backward.height).toBeCloseTo(forward.height as number, 9);
    });

    it('takes the largest child on each axis, as a stack does', () => {
        const box = new RotatedBox({ angle: 90, children: [new Tile(100, 20), new Tile(60, 80)] } as never);
        const size = box.measure(FREE, scope);
        expect(size.width).toBeCloseTo(80, 9);
        expect(size.height).toBeCloseTo(100, 9);
    });

    it('lets an explicit size win over the projected one', () => {
        const size = measureOf(90, new Tile(100, 40), { width: 300, height: 250 });
        expect(size).toEqual({ width: 300, height: 250 });
    });

    it('resolves each axis on its own: a fixed width and a hugging height', () => {
        const size = measureOf(90, new Tile(100, 40), { width: 300 });
        expect(size.width).toBe(300);
        expect(size.height).toBeCloseTo(100, 9);
    });

    it('fills the constraint on a fill axis', () => {
        const size = measureOf(90, new Tile(100, 40), { width: 'fill', height: 'fill' });
        expect(size).toEqual({ width: 1000, height: 800 });
    });

    it('measures its content in the un-rotated space: the parent\'s constraints are swapped at 90 degrees', () => {
        const fills = new Rect({ width: 'fill', height: 40 });
        const size = measureOf(90, fills, {}, { maxWidth: 1000, maxHeight: 500 });
        // The fill child is offered the box's height as its width: 500, which turns into the box's height.
        expect(size.width).toBeCloseTo(40, 6);
        expect(size.height).toBeCloseTo(500, 6);
    });

    it('swaps a single constraint at 90 degrees', () => {
        const fills = new Rect({ width: 'fill', height: 40 });
        const size = measureOf(90, fills, {}, { maxWidth: 800 } as never);
        // Offered no height to turn into its width, the child gets no width to fill.
        expect(size.height).toBeCloseTo(0, 9);
    });

    it('records the pass for animated edits to measure against', () => {
        const box = new RotatedBox({ angle: 90, children: [new Tile(100, 40)] } as never);
        box.measure(FREE, scope);
        expect(box.lastMeasure?.constraints).toEqual(FREE);
        expect(box.lastMeasure?.measurer).toBe(scope);
    });

    it('measures an empty box as nothing', () => {
        const size = new RotatedBox({ angle: 90, width: 'hug', height: 'hug' } as never).measure(FREE, scope);
        expect(size.width).toBeCloseTo(0, 9);
        expect(size.height).toBeCloseTo(0, 9);
    });
});

describe('RotatedBox – layout', () => {
    it('lays its children out in the un-rotated box: width and height swapped at 90 degrees', () => {
        const child = new Tile('fill', 'fill');
        const box = new RotatedBox({ angle: 90, children: [child] } as never);
        box.layout({ x: 0, y: 0, width: 40, height: 100 }, scope);
        expect(child.rect.width).toBeCloseTo(100, 9);
        expect(child.rect.height).toBeCloseTo(40, 9);
    });

    it('lays them out in the box as it is at 0 degrees', () => {
        const child = new Tile('fill', 'fill');
        const box = new RotatedBox({ angle: 0, children: [child] } as never);
        box.layout({ x: 0, y: 0, width: 40, height: 100 }, scope);
        expect(child.rect.width).toBeCloseTo(40, 9);
        expect(child.rect.height).toBeCloseTo(100, 9);
    });

    it('projects the box onto the child\'s axes at an arbitrary angle', () => {
        const child = new Tile('fill', 'fill');
        const box = new RotatedBox({ angle: 45, children: [child] } as never);
        box.layout({ x: 0, y: 0, width: 100, height: 100 }, scope);
        const projected = 100 * Math.SQRT1_2 * 2;
        expect(child.rect.width).toBeCloseTo(projected, 9);
        expect(child.rect.height).toBeCloseTo(projected, 9);
    });

    it('centres a fixed child in the un-rotated box, as a stack does', () => {
        const child = new Tile(100, 40);
        const box = new RotatedBox({ angle: 90, children: [child] } as never);
        box.layout({ x: 0, y: 0, width: 40, height: 100 }, scope);
        // The un-rotated cell is 100 x 40, which the child fills exactly, at the origin.
        expect(child.rect).toMatchObject({ x: 0, y: 0, width: 100, height: 40 });
    });

    it('keeps its own layout bounds as it was given them, not the un-rotated ones', () => {
        const box = new RotatedBox({ angle: 90, children: [new Tile(100, 40)] } as never);
        box.layout({ x: 5, y: 6, width: 40, height: 100 }, scope);
        expect(box.layoutBounds).toEqual({ x: 5, y: 6, width: 40, height: 100 });
    });

    it('measures then lays out to the same result a measured box would get', () => {
        const child = new Tile('fill', 40);
        const box = new RotatedBox({ angle: 90, children: [child] } as never);
        const size = box.measure({ maxWidth: 1000, maxHeight: 500 }, scope);
        box.layout({ x: 0, y: 0, width: size.width ?? 0, height: size.height ?? 0 }, scope);
        expect(child.rect.width).toBeCloseTo(500, 6);
        expect(child.rect.height).toBeCloseTo(40, 6);
    });
});

describe('RotatedBox – the angle', () => {
    it('is the rotation the box is drawn at', () => {
        const box = new RotatedBox({ angle: 90, children: [new Tile(100, 40)] } as never);
        expect(box.rotation).toBe(90);
        box.set({ angle: 30 } as never);
        expect(box.rotation).toBe(30);
    });

    it('is pushed to the renderer as the transform\'s rotation', () => {
        const box = laidOut(new RotatedBox({ id: 'rb', angle: 90, children: [new Tile(100, 40)] } as never), {
            x: 0, y: 0, width: 40, height: 100,
        });
        const ctx = recorded(box);
        expect(ctx.transforms[0].rotation).toBe(90);
    });

    it('changes what it measures when it is tweened, which is how it reflows its parent', () => {
        const box = attached(new RotatedBox({ angle: 0, children: [new Tile(100, 40)] } as never));
        expect(box.measure(FREE, scope).width).toBeCloseTo(100, 9);
        box.to({ data: { angle: 90 }, duration: 1 }).at(1);
        expect(box.angle).toBe(90);
        expect(box.measure(FREE, scope).width).toBeCloseTo(40, 9);
    });

    it('lays out in a row by its turned size, not its un-turned one', () => {
        const turned = new RotatedBox({ angle: 90, children: [new Tile(100, 40)] } as never);
        const row = new Rect({ flow: 'horizontal', width: 'hug', height: 'hug', children: [turned, new Tile(10, 10)] });
        const size = row.measure(FREE, scope);
        expect(size.width).toBeCloseTo(40 + 10, 9);
        expect(size.height).toBeCloseTo(100, 9);
    });
});
