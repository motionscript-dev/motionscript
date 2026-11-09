import { describe, it, expect } from 'vitest';
import { Node2D } from '@/components/trees/2d/node2d';
import { Rect } from "@/components/builtins/geometry/geometry";
import { FakeMeasureContext } from '@/runtime/runtime.fixtures';
import type { BoxBounds } from '@/layout/bounds';
import type { FlowSettings } from '@/layout/types';
import type { SizeInput } from '@/attributes/layout/size';

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

const ROW: FlowSettings = { flow: 'horizontal', gap: 10 };

/** A plain node that lays its children out as a row, with no `Rect` around them. */
class Toolbar extends Node2D {
    protected override flowArrangement(): FlowSettings {
        return ROW;
    }
}

describe('Node2D.flowArrangement', () => {
    it('lays a plain node\'s children out as a row when it returns one', () => {
        const a = new Tile(100, 50);
        const b = new Tile(100, 50);
        const bar = new Toolbar({ width: 'hug', height: 'hug', children: [a, b] } as never);

        const size = bar.measure({ maxWidth: 1000, maxHeight: 1000 }, scope);
        expect(size).toEqual({ width: 210, height: 50 });

        bar.layout({ x: 0, y: 0, width: 210, height: 50 }, scope);
        expect(a.rect.x).toBe(-55);
        expect(b.rect.x).toBe(55);
    });

    it('still centres a plain node\'s children by default', () => {
        const a = new Tile(40, 40);
        const b = new Tile(60, 60);
        const group = new Node2D({ width: 200, height: 200, children: [a, b] } as never);

        group.measure({ maxWidth: 1000, maxHeight: 1000 }, scope);
        group.layout({ x: 0, y: 0, width: 200, height: 200 }, scope);
        expect([a.rect.x, a.rect.y, b.rect.x, b.rect.y]).toEqual([0, 0, 0, 0]);
    });
});

describe('a node laid out at a size it was not measured for', () => {
    it('arranges its children for the box it was given', () => {
        // The column fills the cross axis of a row that hugs it, so the row
        // measures it against its whole inner height (1000) and then lays it out
        // at the row's own thickness (80). Its children must share 80, not 1000.
        const top = new Tile(100, 'fill');
        const bottom = new Tile(100, 'fill');
        const column = new Rect({ flow: 'vertical', width: 100, height: 'fill', children: [top, bottom] });
        const row = new Rect({
            flow: 'horizontal', width: 400, height: 'hug', children: [new Tile(100, 80), column],
        });

        const size = row.measure({ maxWidth: 1000, maxHeight: 1000 }, scope);
        expect(size.height).toBe(80);

        row.layout({ x: 0, y: 0, width: 400, height: 80 }, scope);
        expect(column.layoutBounds.height).toBe(80);
        expect(top.rect.height).toBe(40);
        expect(bottom.rect.height).toBe(40);
    });
});
