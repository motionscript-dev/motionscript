import { describe, it, expect } from 'vitest';
import { Rect } from "@/components/builtins/geometry/geometry";
import { Node2D } from '@/components/trees/2d/node2d';
import { FakeMeasureContext } from '@/runtime/runtime.fixtures';
import { BoxBounds } from '@/layout/bounds';
import { SizeInput } from '@/attributes/layout/size';

const scope = new FakeMeasureContext();

/**
 * A fixed-size leaf that also exposes the box its parent laid it into — the
 * `layoutBounds` is protected on Node2D, so a test subclass is the supported
 * seam for reading a child's resolved position. Same one `rect-node.test.ts`
 * uses.
 */
class Tile extends Node2D {
    constructor(width: SizeInput, height: SizeInput) {
        super({ width, height });
    }
    get rect(): BoxBounds {
        return this.layoutBounds;
    }
}

/** A hugging container of `flow`, built the way an author's call arrives. */
function container(props: Record<string, unknown>, children: Node2D[]): Rect {
    return new Rect({ width: 'hug', height: 'hug', ...props, children } as never);
}

// These four suites are what `Row`, `Column` and `Grid` used to assert about
// themselves. They are the same claims, made of the one class that can now be
// asked — which is the whole point of retiring those three.
describe('Rect flow="horizontal"', () => {
    it('hugs its children along both axes', () => {
        const row = container({ flow: 'horizontal', gap: 10 }, [
            new Tile(100, 50), new Tile(100, 80), new Tile(100, 50),
        ]);

        const size = row.measure({ maxWidth: 1000, maxHeight: 1000 }, scope);
        // 3 x 100 + 2 x 10 gap = 320 wide; tallest child = 80.
        expect(size.width).toBe(320);
        expect(size.height).toBe(80);
    });

    it('places children left-to-right with the gap between them', () => {
        const a = new Tile(100, 50);
        const b = new Tile(100, 50);
        const row = container({ flow: 'horizontal', gap: 10 }, [a, b]);
        row.measure({ maxWidth: 1000, maxHeight: 1000 }, scope);
        row.layout({ x: 0, y: 0, width: 210, height: 50 }, scope);

        // Centred coordinates: total main = 210, first centre at -105 + 50 = -55.
        expect(a.rect.x).toBe(-55);
        expect(b.rect.x).toBe(55);
        expect(a.rect.y).toBe(0);
    });
});

describe('Rect flow="vertical"', () => {
    it('hugs its children: width = widest child, height = sum + gaps', () => {
        const col = container({ flow: 'vertical', gap: 20 }, [
            new Tile(60, 100), new Tile(90, 100), new Tile(60, 100),
        ]);

        const size = col.measure({ maxWidth: 1000, maxHeight: 1000 }, scope);
        expect(size.width).toBe(90);
        // 3 x 100 + 2 x 20 = 340.
        expect(size.height).toBe(340);
    });

    it('stacks children top-to-bottom in the box-local y-down space', () => {
        const a = new Tile(50, 100);
        const b = new Tile(50, 100);
        const col = container({ flow: 'vertical', gap: 0 }, [a, b]);
        col.measure({ maxWidth: 1000, maxHeight: 1000 }, scope);
        col.layout({ x: 0, y: 0, width: 50, height: 200 }, scope);

        expect(b.rect.y - a.rect.y).toBe(100);
    });

    it('respects an explicit fixed size instead of hugging', () => {
        const col = new Rect({ flow: 'vertical', width: 400, height: 600, children: [new Tile(50, 50)] });

        const size = col.measure({ maxWidth: 1000, maxHeight: 1000 }, scope);
        expect(size.width).toBe(400);
        expect(size.height).toBe(600);
    });
});

describe('Rect flow="grid"', () => {
    it('cuts equal column tracks out of its width and auto-flows into them', () => {
        const tiles = [new Tile(50, 40), new Tile(50, 40), new Tile(50, 40), new Tile(50, 40)];
        const grid = new Rect({ flow: 'grid', columns: 2, gap: 20, crossGap: 10, children: tiles });

        grid.measure({ maxWidth: 420, maxHeight: 1000 }, scope);
        grid.layout({ x: 0, y: 0, width: 420, height: 90 }, scope);

        // 420 wide, one 20px column gap: each track is 200.
        expect(tiles[1].rect.x - tiles[0].rect.x).toBe(220);
        // Two rows, and the row gap is `crossGap`, not `gap`.
        expect(tiles[2].rect.y - tiles[0].rect.y).toBe(50);
        // Third child wraps back to the first column.
        expect(tiles[2].rect.x).toBe(tiles[0].rect.x);
    });

    it('honours colSpan, so a wide cell eats its neighbour', () => {
        const wide = new Tile(50, 40);
        wide.colSpan = 2;
        const grid = new Rect({ flow: 'grid', columns: 2, gap: 0, children: [wide, new Tile(50, 40)] });

        grid.measure({ maxWidth: 400, maxHeight: 1000 }, scope);
        grid.layout({ x: 0, y: 0, width: 400, height: 80 }, scope);

        expect(wide.rect.width).toBe(400);
    });

    it('hugs its height to the rows it produced', () => {
        const grid = new Rect({
            flow: 'grid', columns: 2, gap: 0, crossGap: 10, height: 'hug',
            children: [new Tile(50, 40), new Tile(50, 40), new Tile(50, 40)],
        });

        // Two rows of 40 plus one 10px row gap.
        const size = grid.measure({ maxWidth: 400, maxHeight: 1000 }, scope);
        expect(size.height).toBe(90);
    });
});

describe('Rect wrap', () => {
    it('breaks a horizontal run onto a new line at the container width', () => {
        const tiles = [new Tile(100, 40), new Tile(100, 40), new Tile(100, 40)];
        const row = new Rect({
            flow: 'horizontal', wrap: true, gap: 20, crossGap: 10,
            width: 250, height: 'hug', align: 'topLeft', children: tiles,
        });

        // 100 + 20 + 100 = 220 fits in 250; the third would make it 340.
        const size = row.measure({ maxWidth: 1000, maxHeight: 1000 }, scope);
        expect(size.height).toBe(90);   // two 40px lines + a 10px crossGap

        row.layout({ x: 0, y: 0, width: 250, height: 90 }, scope);
        expect(tiles[1].rect.y).toBe(tiles[0].rect.y);
        expect(tiles[2].rect.y - tiles[0].rect.y).toBe(50);
        expect(tiles[2].rect.x).toBe(tiles[0].rect.x);
    });

    it('follows `gap` when no crossGap is given', () => {
        const row = new Rect({
            flow: 'horizontal', wrap: true, gap: 30, width: 250, height: 'hug',
            children: [new Tile(200, 40), new Tile(200, 40)],
        });

        // One line each, stacked by the 30px `gap` standing in for crossGap.
        const size = row.measure({ maxWidth: 1000, maxHeight: 1000 }, scope);
        expect(size.height).toBe(110);
    });

    it('does not break while the main axis hugs — there is nothing to break against', () => {
        const tiles = [new Tile(100, 40), new Tile(100, 40), new Tile(100, 40)];
        const row = container({ flow: 'horizontal', wrap: true, gap: 20 }, tiles);

        const size = row.measure({ maxWidth: 250, maxHeight: 1000 }, scope);
        expect(size.width).toBe(340);
        expect(size.height).toBe(40);
    });

    it('places a single unbroken line exactly where the unwrapped pass would', () => {
        const wrapped = [new Tile(100, 50), new Tile(100, 50)];
        const plain = [new Tile(100, 50), new Tile(100, 50)];
        const box: BoxBounds = { x: 0, y: 0, width: 400, height: 50 };

        for (const [children, wrap] of [[wrapped, true], [plain, false]] as const) {
            const row = new Rect({
                flow: 'horizontal', wrap, gap: 10, width: 400, height: 50, children: [...children],
            });
            row.measure({ maxWidth: 400, maxHeight: 50 }, scope);
            row.layout(box, scope);
        }

        expect(wrapped.map((t) => t.rect.x)).toEqual(plain.map((t) => t.rect.x));
        expect(wrapped.map((t) => t.rect.y)).toEqual(plain.map((t) => t.rect.y));
    });
});
