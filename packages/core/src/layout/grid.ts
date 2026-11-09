import type { Size2D } from "@/attributes/layout/size";
import type { MeasureContext2D } from "@/render/measure-context";
import type { BoxBounds } from "./bounds";
import type { SizeConstraints } from "./constraints";
import type { FlowSpace, LayoutItem } from "./types";
import { measureItem } from "./item";

/**
 * Measures a grid: `columns` equal tracks across the width, and rows sized to
 * their content — or, when the height is bounded, divided equally so a
 * `fill`-height item has a share to fill. Each item's cell comes back from the
 * content box's top-left, y-down.
 */
export function measureGrid(
    items: readonly LayoutItem[],
    columns: number,
    columnGap: number,
    rowGap: number,
    space: FlowSpace,
    measurer: MeasureContext2D | undefined,
): { sizes: Size2D[]; cells: BoxBounds[]; hug: Size2D } {
    const count = Math.max(1, Math.round(columns));
    const track = Math.max(0, (space.width - columnGap * (count - 1)) / count);
    const placements = autoPlace(items, count);
    const rowCount = placements.reduce((max, p) => Math.max(max, p.row + p.rowSpan), 0);

    const bounded = space.hugHeight !== true && rowCount > 0;
    const equalRow = bounded ? Math.max(0, (space.height - rowGap * (rowCount - 1)) / rowCount) : 0;
    const rows = new Array<number>(rowCount).fill(equalRow);

    const sizes = items.map((item, i) => {
        const p = placements[i];
        const width = span(track, p.colSpan, columnGap);
        const constraints: SizeConstraints = bounded
            ? { maxWidth: width, maxHeight: span(equalRow, p.rowSpan, rowGap) }
            : { maxWidth: width };
        const size = measureItem(item, constraints, measurer);
        // Bounded rows are already equal, and content may not grow one past its share.
        if (!bounded) grow(rows, p.row, p.rowSpan, size.height, rowGap);
        return size;
    });

    const tops: number[] = [];
    let top = 0;
    for (const height of rows) {
        tops.push(top);
        top += height + rowGap;
    }
    const cells = placements.map((p) => ({
        x: p.col * (track + columnGap),
        y: tops[p.row] ?? 0,
        width: span(track, p.colSpan, columnGap),
        height: spannedRows(rows, p.row, p.rowSpan, rowGap),
    }));
    const height = rows.reduce((sum, h) => sum + h, 0) + rowGap * Math.max(0, rowCount - 1);
    return { sizes, cells, hug: { width: space.width, height } };
}

/** Each item's cell, clamped to the content box, centre-relative and y-up. */
export function placeGrid(cells: readonly BoxBounds[], inner: Size2D): BoxBounds[] {
    return cells.map((cell) => ({
        x: cell.x + cell.width / 2 - inner.width / 2,
        y: inner.height / 2 - cell.y - cell.height / 2,
        width: Math.min(cell.width, inner.width),
        height: Math.min(cell.height, inner.height),
    }));
}

// Left to right, wrapping when a span would overflow the columns. An item with
// both `column` and `row` is placed there, 1-based, and left out of the flow.
function autoPlace(items: readonly LayoutItem[], columns: number) {
    const placements: { col: number; row: number; colSpan: number; rowSpan: number }[] = [];
    const taken: boolean[][] = [];
    const isFree = (row: number, col: number, colSpan: number, rowSpan: number): boolean => {
        for (let r = 0; r < rowSpan; r++) {
            for (let c = 0; c < colSpan; c++) {
                if (taken[row + r]?.[col + c]) return false;
            }
        }
        return true;
    };
    const take = (row: number, col: number, colSpan: number, rowSpan: number): void => {
        for (let r = 0; r < rowSpan; r++) {
            taken[row + r] ??= [];
            for (let c = 0; c < colSpan; c++) taken[row + r][col + c] = true;
        }
    };

    let row = 0;
    let col = 0;
    for (const item of items) {
        const colSpan = Math.min(item.colSpan ?? 1, columns);
        const rowSpan = item.rowSpan ?? 1;
        if (item.column !== undefined && item.row !== undefined) {
            take(item.row - 1, item.column - 1, colSpan, rowSpan);
            placements.push({ col: item.column - 1, row: item.row - 1, colSpan, rowSpan });
            continue;
        }
        for (;;) {
            if (col + colSpan > columns) {
                row++;
                col = 0;
            }
            if (isFree(row, col, colSpan, rowSpan)) break;
            col++;
        }
        take(row, col, colSpan, rowSpan);
        placements.push({ col, row, colSpan, rowSpan });
        col += colSpan;
    }
    return placements;
}

// Content-sized rows grow to fit an item; a spanning item puts whatever its rows
// are short of into the first of them.
function grow(rows: number[], row: number, rowSpan: number, height: number, gap: number): void {
    if (rowSpan === 1) {
        if (height > rows[row]) rows[row] = height;
        return;
    }
    const short = height - spannedRows(rows, row, rowSpan, gap);
    if (short > 0) rows[row] += short;
}

function span(track: number, count: number, gap: number): number {
    return track * count + gap * (count - 1);
}

function spannedRows(rows: readonly number[], from: number, count: number, gap: number): number {
    let height = gap * (count - 1);
    for (let r = from; r < from + count; r++) height += rows[r] ?? 0;
    return height;
}
