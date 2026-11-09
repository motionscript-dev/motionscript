import { describe, it, expect } from 'vitest';
import { flowOps } from '@/layout/ops';
import type { FlowMeasure, FlowSettings, FlowSpace, LayoutItem } from '@/layout/types';

/** A cell that fills whatever size it's offered. */
function fillCell(): LayoutItem {
    return { width: 'fill', height: 'fill' };
}

/** A cell with a fixed intrinsic height, ignoring the height it's offered. */
function fixedHeightCell(h: number): LayoutItem {
    return { width: 'fill', height: h };
}

function grid(rowGap = 0): FlowSettings {
    return { flow: 'grid', columns: 3, gap: 0, crossGap: rowGap };
}

function measureGrid(cells: LayoutItem[], settings: FlowSettings, space: FlowSpace) {
    return flowOps.measure(settings, cells, space);
}

/** Each row's height, top to bottom — a 1-row-span cell's height is its row's. */
function rowHeights(m: FlowMeasure): number[] {
    return [...new Map((m.cells ?? []).map((c) => [c.y, c.height])).values()];
}

describe('grid row tracks', () => {
    it('divides a bounded height into equal row tracks for fill cells', () => {
        // 6 fill cells, 3 columns => 2 rows. Inner area 900x600, no gaps.
        const m = measureGrid(Array.from({ length: 6 }, fillCell), grid(), { width: 900, height: 600 });

        // Each row is half the available height regardless of content.
        expect(rowHeights(m)).toEqual([300, 300]);
        expect(m.cells?.[0].width).toBe(300);
    });

    it('accounts for row gaps when distributing bounded height', () => {
        const m = measureGrid(Array.from({ length: 6 }, fillCell), grid(40), { width: 900, height: 640 });

        // (640 - 40 gap) / 2 rows = 300 each.
        expect(rowHeights(m)).toEqual([300, 300]);
    });

    it('does not let tall content grow a bounded row past its equal share', () => {
        const cells = [
            fixedHeightCell(50),
            fixedHeightCell(50),
            fixedHeightCell(50),
            fixedHeightCell(500), // would blow out row 1 if content-sized
            fixedHeightCell(50),
            fixedHeightCell(50),
        ];
        const m = measureGrid(cells, grid(), { width: 900, height: 600 });
        expect(rowHeights(m)).toEqual([300, 300]);
    });

    it('falls back to content-sized rows when height is unbounded (hug)', () => {
        const cells = [
            fixedHeightCell(120),
            fixedHeightCell(80),
            fixedHeightCell(200),
            fixedHeightCell(60),
            fixedHeightCell(60),
            fixedHeightCell(60),
        ];
        const m = measureGrid(cells, grid(), { width: 900, height: 1000, hugHeight: true });
        // Row tracks hug the tallest cell in each row.
        expect(rowHeights(m)).toEqual([200, 60]);
        expect(m.hug.height).toBe(260);
    });
});

describe('grid placement', () => {
    it('produces six equal, non-overlapping cells in a 2x3 grid', () => {
        const inner = { width: 900, height: 600 };
        const m = measureGrid(Array.from({ length: 6 }, fillCell), grid(), inner);
        const bounds = flowOps.place(m, grid(), inner);

        expect(bounds).toHaveLength(6);
        for (const b of bounds) {
            expect(b.width).toBe(300);
            expect(b.height).toBe(300);
        }

        // y-up: the top row centres at +150 (upper half), the bottom row at -150.
        expect(bounds.slice(0, 3).map((b) => b.y)).toEqual([150, 150, 150]);
        expect(bounds.slice(3, 6).map((b) => b.y)).toEqual([-150, -150, -150]);

        // Columns centered left/middle/right.
        expect(bounds.slice(0, 3).map((b) => b.x)).toEqual([-300, 0, 300]);
    });

    it('places an item with both `column` and `row` where it asked, out of the flow', () => {
        const pinned: LayoutItem = { width: 'fill', height: 'fill', column: 3, row: 1 };
        const inner = { width: 900, height: 300 };
        const settings = grid();
        const bounds = flowOps.place(measureGrid([fillCell(), pinned, fillCell()], settings, inner), settings, inner);

        // The pinned item takes column 3; the flow fills columns 1 and 2 around it.
        expect(bounds.map((b) => b.x)).toEqual([-300, 300, 0]);
    });
});

describe('grid rowSpan', () => {
    const spanning = (height: LayoutItem['height'] = 'fill'): LayoutItem => ({ width: 'fill', height, rowSpan: 2 });

    it('gives a spanning cell the height of every row it covers in a bounded grid', () => {
        const settings: FlowSettings = { flow: 'grid', columns: 2, gap: 0, crossGap: 20 };
        const m = measureGrid([spanning(), fillCell(), fillCell()], settings, { width: 400, height: 400 });
        // (400 - 20) / 2 = 190 per row; the spanning cell takes both rows and the gap between them.
        expect(m.cells?.map((c) => [c.x, c.y, c.width, c.height])).toEqual([
            [0, 0, 200, 400],
            [200, 0, 200, 190],
            [200, 210, 200, 190],
        ]);
    });

    it('measures a spanning item against the span, not against one row', () => {
        const seen: unknown[] = [];
        const probe: LayoutItem = {
            width: 'fill', height: 'fill', rowSpan: 2,
            measure: (constraints) => { seen.push(constraints); return { width: 0, height: 0 }; },
        };
        const settings: FlowSettings = { flow: 'grid', columns: 2, gap: 0, crossGap: 20 };
        measureGrid([probe, fillCell(), fillCell()], settings, { width: 400, height: 400 });
        expect(seen).toEqual([{ maxWidth: 200, maxHeight: 400 }]);
    });

    it('puts the shortfall of a spanning item into the first of its rows in a hugging grid', () => {
        const settings: FlowSettings = { flow: 'grid', columns: 2, gap: 0, crossGap: 10 };
        const m = measureGrid(
            [fixedHeightCell(30), fixedHeightCell(30), spanning(100)],
            { ...settings, columns: 2 },
            { width: 400, height: 1000, hugHeight: true },
        );
        // Items 0 and 1 share row 0; item 2 is auto-flowed onto rows 1 and 2, which are both empty,
        // so the whole shortfall (100 less the 10 gap between them) lands in row 1.
        expect(m.cells?.map((c) => c.height)).toEqual([30, 30, 100]);
        expect(rowHeights(m)).toEqual([30, 100]);
        expect(m.hug.height).toBe(30 + 10 + 100);
    });

    it('adds nothing when the rows it spans already hold the item', () => {
        const settings: FlowSettings = { flow: 'grid', columns: 2, gap: 0, crossGap: 10 };
        const m = measureGrid(
            [{ ...fixedHeightCell(40), column: 2, row: 1 }, { ...fixedHeightCell(40), column: 2, row: 2 }, spanning(50)],
            settings,
            { width: 400, height: 1000, hugHeight: true },
        );
        // The pinned items set both rows (40 + 10 + 40); the 50-tall span fits and grows nothing.
        expect(m.cells?.map((c) => [c.x, c.y, c.height])).toEqual([[200, 0, 40], [200, 50, 40], [0, 0, 90]]);
        expect(m.hug.height).toBe(90);
    });

    it('lets a later item grow the first row after a spanning item put its shortfall there', () => {
        const settings: FlowSettings = { flow: 'grid', columns: 2, gap: 0, crossGap: 10 };
        const m = measureGrid(
            [spanning(100), fixedHeightCell(30), fixedHeightCell(20)],
            settings,
            { width: 400, height: 1000, hugHeight: true },
        );
        // The span goes first and finds both rows empty: 100 less the 10 gap goes to row 0 (90),
        // then the 30 fits in it and the 20 sets row 1, so the span ends up 120 tall.
        expect(m.cells?.map((c) => [c.y, c.height])).toEqual([[0, 120], [0, 90], [100, 20]]);
        expect(m.hug.height).toBe(120);
    });

    it('keeps the cells of a spanning column clear of what is auto-flowed beside it', () => {
        const settings: FlowSettings = { flow: 'grid', columns: 2, gap: 0, crossGap: 0 };
        const m = measureGrid(
            [spanning(), fillCell(), fillCell(), fillCell()],
            settings,
            { width: 400, height: 600 },
        );
        // The span owns column 0 of rows 0 and 1, so the next three fill column 1 then row 2.
        expect(m.cells?.map((c) => [c.x, c.y])).toEqual([[0, 0], [200, 0], [200, 200], [0, 400]]);
    });
});

describe('grid columns and gaps', () => {
    const count = (columns: number, n = 6) => {
        const settings: FlowSettings = { flow: 'grid', columns, gap: 0, crossGap: 0 };
        const m = measureGrid(Array.from({ length: n }, fillCell), settings, { width: 600, height: 1200 });
        return new Set((m.cells ?? []).map((c) => c.x)).size;
    };

    it('rounds a fractional column count to the nearest whole column', () => {
        expect(count(2.4)).toBe(2);
        expect(count(2.6)).toBe(3);
    });

    it('rounds half up', () => {
        expect(count(2.5)).toBe(3);
    });

    it('never goes below one column', () => {
        expect(count(0)).toBe(1);
        expect(count(0.4)).toBe(1);
        expect(count(-3)).toBe(1);
    });

    it('defaults to one column with no columns set', () => {
        const m = measureGrid(Array.from({ length: 3 }, fillCell), { flow: 'grid' }, { width: 600, height: 900 });
        expect(m.cells?.map((c) => [c.x, c.width])).toEqual([[0, 600], [0, 600], [0, 600]]);
    });

    it('sizes the tracks from the content width less the column gaps', () => {
        const settings: FlowSettings = { flow: 'grid', columns: 3, gap: 30, crossGap: 0 };
        const m = measureGrid(Array.from({ length: 3 }, fillCell), settings, { width: 600, height: 100 });
        expect(m.cells?.map((c) => [c.x, c.width])).toEqual([[0, 180], [210, 180], [420, 180]]);
    });

    it('lets the cross gap follow the gap when it is not set', () => {
        const settings: FlowSettings = { flow: 'grid', columns: 2, gap: 20 };
        const m = measureGrid(Array.from({ length: 4 }, fillCell), settings, { width: 420, height: 420 });
        // Rows: (420 - 20) / 2 = 200 each, 20 apart; columns: (420 - 20) / 2 = 200, 20 apart.
        expect(m.cells?.map((c) => [c.x, c.y])).toEqual([[0, 0], [220, 0], [0, 220], [220, 220]]);
    });

    it('lets an explicit cross gap differ from the gap', () => {
        const settings: FlowSettings = { flow: 'grid', columns: 2, gap: 20, crossGap: 0 };
        const m = measureGrid(Array.from({ length: 4 }, fillCell), settings, { width: 420, height: 400 });
        expect(m.cells?.map((c) => [c.x, c.y])).toEqual([[0, 0], [220, 0], [0, 200], [220, 200]]);
    });

    it('counts an "auto" gap as no gap in either direction', () => {
        const settings: FlowSettings = { flow: 'grid', columns: 2, gap: 'auto' };
        const m = measureGrid(Array.from({ length: 4 }, fillCell), settings, { width: 400, height: 400 });
        expect(m.cells?.map((c) => [c.x, c.y])).toEqual([[0, 0], [200, 0], [0, 200], [200, 200]]);
    });

    it('clamps a colSpan to the number of columns', () => {
        const wide: LayoutItem = { width: 'fill', height: 'fill', colSpan: 5 };
        const settings: FlowSettings = { flow: 'grid', columns: 2, gap: 0, crossGap: 0 };
        const m = measureGrid([wide, fillCell()], settings, { width: 400, height: 400 });
        expect(m.cells?.map((c) => [c.x, c.width])).toEqual([[0, 400], [0, 200]]);
    });
});

describe('grid hug', () => {
    const settings: FlowSettings = { flow: 'grid', columns: 3, gap: 0, crossGap: 0 };

    it('reports the content width as its hug width, whatever the items measure', () => {
        const m = measureGrid([fixedHeightCell(10)], settings, { width: 900, height: 100 });
        expect(m.hug.width).toBe(900);
    });

    it('does so on a hugging width axis too, so a grid takes the room it is offered', () => {
        const m = measureGrid([{ width: 20, height: 10 }], settings, { width: 900, height: 100, hugWidth: true });
        expect(m.hug.width).toBe(900);
    });

    it('hugs its height to the rows it needs', () => {
        const m = measureGrid(
            [fixedHeightCell(10), fixedHeightCell(40), fixedHeightCell(5), fixedHeightCell(7)],
            { ...settings, crossGap: 4 },
            { width: 900, height: 1000, hugHeight: true },
        );
        expect(m.hug.height).toBe(40 + 4 + 7);
    });

    it('is empty with no items', () => {
        const m = measureGrid([], settings, { width: 900, height: 100, hugHeight: true });
        expect(m.hug).toEqual({ width: 900, height: 0 });
        expect(m.cells).toEqual([]);
    });
});
