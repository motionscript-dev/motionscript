import { describe, it, expect } from 'vitest';
import { Ellipse, Polygon } from "@/components/builtins/geometry/geometry";
import { Node2D } from '@/components/trees/2d/node2d';
import { FakeMeasureContext } from '@/runtime/runtime.fixtures';
import { BoxBounds } from '@/layout/bounds';
import { SizeInput } from '@/attributes/layout/size';

const scope = new FakeMeasureContext();

/** A fixed-size leaf that exposes the box its parent laid it into. */
class Tile extends Node2D {
    constructor(width: SizeInput, height: SizeInput) {
        super({ width, height });
    }
    get rect(): BoxBounds {
        return this.layoutBounds;
    }
}

// `flow` used to be Rect's alone, so arranging anything inside a circle meant
// wrapping it in a rectangle and losing the silhouette. These are the same
// claims `rect-flow.test.ts` makes, asked of the shapes that could not answer
// them before.
describe('a shape lays its children out', () => {
    it('stacks them in a column, the caption-under-icon case', () => {
        const icon = new Tile(40, 40);
        const label = new Tile(80, 20);
        const badge = new Ellipse({
            width: 'hug', height: 'hug', flow: 'vertical', gap: 10,
            children: [icon, label],
        } as never);

        const size = badge.measure({ maxWidth: 1000, maxHeight: 1000 }, scope);
        // Widest child, and 40 + 10 + 20 down the main axis.
        expect(size.width).toBe(80);
        expect(size.height).toBe(70);

        badge.layout({ x: 0, y: 0, width: 80, height: 70 }, scope);
        // Centre to centre: half the icon, the gap, half the label.
        expect(label.rect.y - icon.rect.y).toBe(40);
    });

    it('runs them left-to-right with the gap between', () => {
        const a = new Tile(100, 50);
        const b = new Tile(100, 50);
        const row = new Ellipse({
            width: 'hug', height: 'hug', flow: 'horizontal', gap: 10,
            children: [a, b],
        } as never);

        row.measure({ maxWidth: 1000, maxHeight: 1000 }, scope);
        row.layout({ x: 0, y: 0, width: 210, height: 50 }, scope);

        expect(a.rect.x).toBe(-55);
        expect(b.rect.x).toBe(55);
    });

    it('cuts grid tracks out of its width, on a polygon as much as a rect', () => {
        const tiles = [new Tile(50, 40), new Tile(50, 40), new Tile(50, 40)];
        const grid = new Polygon({
            flow: 'grid', columns: 2, gap: 20, crossGap: 10, children: tiles,
        } as never);

        grid.measure({ maxWidth: 420, maxHeight: 1000 }, scope);
        grid.layout({ x: 0, y: 0, width: 420, height: 90 }, scope);

        expect(tiles[1].rect.x - tiles[0].rect.x).toBe(220);
        expect(tiles[2].rect.x).toBe(tiles[0].rect.x);
    });

    it('still overlaps them in the centre by default', () => {
        const a = new Tile(40, 40);
        const b = new Tile(60, 60);
        const stack = new Ellipse({ width: 200, height: 200, children: [a, b] } as never);

        stack.measure({ maxWidth: 1000, maxHeight: 1000 }, scope);
        stack.layout({ x: 0, y: 0, width: 200, height: 200 }, scope);

        // freeform is the default, so nothing is sequenced: both sit on centre.
        expect(a.rect.x).toBe(0);
        expect(b.rect.x).toBe(0);
        expect(a.rect.y).toBe(0);
        expect(b.rect.y).toBe(0);
    });

    it('hugs its children through the stroke it has to clear', () => {
        const shape = new Ellipse({
            width: 'hug', height: 'hug', flow: 'vertical', gap: 0,
            stroke: { fill: 'black', weight: 8, align: -1 },
            children: [new Tile(100, 100)],
        } as never);

        // An inside stroke intrudes its full weight on each side, so the hug
        // has to grow by it or the stroke would paint over the child.
        const size = shape.measure({ maxWidth: 1000, maxHeight: 1000 }, scope);
        expect(size.width).toBe(116);
        expect(size.height).toBe(116);
    });
});
