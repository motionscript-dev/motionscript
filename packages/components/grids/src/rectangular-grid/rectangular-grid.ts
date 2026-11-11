import {
  component2d,
  easeInOut,
  Types,
  type NodeOf,
  type Values,
  // Named so the emitted declaration reaches these through the sdk, not core.
  type Node2D as _Node2D,
  type Node2DProps as _Node2DProps,
} from "@motionscript/sdk"

import {
  CELL_MODES,
  FILL_DIRECTIONS,
  ItemGrid,
  LINE_ALIGNS,
  rectangularCell,
  staggerArgs,
  TRANSITION_STAGGER,
  type RectangularArrangement,
} from "../kit"

const own = {
  columns: Types.number(3, { min: 1, step: 1 }),
  fillDirection: Types.oneOf(FILL_DIRECTIONS, { default: "row" }),
  cellMode: Types.oneOf(CELL_MODES, { default: "fit" }),
  cellWidth: Types.number(120, { min: 0, step: 1 }),
  cellHeight: Types.number(120, { min: 0, step: 1 }),
  columnGap: Types.number(24, { step: 1 }),
  rowGap: Types.number(24, { step: 1 }),
  lastLineAlign: Types.oneOf(LINE_ALIGNS, { default: "start" }),
  rowOffset: Types.number(0, { min: -1, max: 1, step: 0.05 }),
  columnOffset: Types.number(0, { min: -1, max: 1, step: 0.05 }),
}

type Own = Values<typeof own>

function arrangement(s: Own): RectangularArrangement {
  return {
    kind: "rectangular",
    columns: s.columns,
    fillDirection: s.fillDirection,
    cellMode: s.cellMode,
    cellWidth: s.cellWidth,
    cellHeight: s.cellHeight,
    columnGap: s.columnGap,
    rowGap: s.rowGap,
    lastLineAlign: s.lastLineAlign,
    rowOffset: s.rowOffset,
    columnOffset: s.columnOffset,
  }
}

const arranger: ItemGrid.Arranger<Own> = {
  arrangement,
  // A child set to fill takes its cell, where the cell is not simply the largest child.
  itemSpace: (s, count, space) => (s.cellMode === "fit" ? space : rectangularCell(arrangement(s), count, [], space)),
}

/** The focus args of a row or a column: the grow a row leaves out is the shared focus's. */
const lineFocus = {
  dim: Types.number(0.7, { min: 0, max: 1, step: 0.05 }),
  grow: ItemGrid.hinted(0.1, { min: 0, max: 1, step: 0.05 }),
}

/**
 * Children in rows and columns — the grid the other three are variations on.
 *
 * Cells are as big as the largest child (`fit`), a size of their own
 * (`fixed`), or an equal share of the node's box (`fill`), which is also the
 * room a child set to fill grows into. Shift every other row by half a cell
 * for a brick bond or a hex pack.
 */
export const RectangularGrid = ItemGrid.define(component2d({
  key: "rectangularGrid",
  state: { ...ItemGrid.state, ...own },
  defaults: ItemGrid.defaults,
  commands: {
    ...ItemGrid.commands,
    /** Re-flow the items into `columns` columns, each moving to its new cell. */
    columnsTo: {
      args: { columns: ItemGrid.hinted(4, { min: 1, step: 1 }), ...staggerArgs(TRANSITION_STAGGER) },
      run: (timeline, s, children) => {
        const columns = Math.max(1, Math.round(timeline.args.columns ?? s.columns))
        return ItemGrid.transitionTo(timeline as never, s, children, { columns })
      },
    },
    /** Animate the spacing between columns and rows. */
    gapTo: {
      args: { columnGap: ItemGrid.hinted(48), rowGap: ItemGrid.hinted(48) },
      run: (timeline) => {
        const data: { columnGap?: number; rowGap?: number } = {}
        if (timeline.args.columnGap !== undefined) data.columnGap = timeline.args.columnGap
        if (timeline.args.rowGap !== undefined) data.rowGap = timeline.args.rowGap
        return timeline.tween(data)
      },
    },
    /**
     * Animate the cell size, from whatever the cells measure now. The grid
     * switches to `fixed` cells as it starts, since a size of its own is what
     * `fixed` means.
     */
    cellSizeTo: {
      args: { cellWidth: ItemGrid.hinted(160, { min: 0 }), cellHeight: ItemGrid.hinted(160, { min: 0 }) },
      easing: easeInOut("cubic"),
      run: (timeline, s, children) => {
        const sizes = children.map((child) => child.size)
        const box = ItemGrid.contentBox(timeline.node.size, s.padding)
        const from = rectangularCell(arrangement(s), sizes.length, sizes, box)
        const width = timeline.args.cellWidth ?? from.width
        const height = timeline.args.cellHeight ?? from.height
        return timeline.animate((t) => ({
          cellMode: "fixed",
          cellWidth: from.width + (width - from.width) * t,
          cellHeight: from.height + (height - from.height) * t,
        }))
      },
    },
    /** Bring one row (from 0 at the top) forward and push the rest back. */
    focusRow: {
      args: { row: Types.number(0, { min: 0, step: 1 }), ...lineFocus },
      run: (timeline, s, children) => {
        const slots = ItemGrid.itemSlots(timeline as never, s, children)
        const row = Math.round(timeline.args.row ?? 0)
        const inRow = (i: number) => slots[i]?.meta.kind === "rectangular" && slots[i].meta.row === row
        return ItemGrid.focusOn(timeline as never, s, inRow, slots.length, timeline.args.dim ?? 0.7, timeline.args.grow ?? 0.15)
      },
    },
    /** Bring one column (from 0 at the left) forward and push the rest back. */
    focusColumn: {
      args: { column: Types.number(0, { min: 0, step: 1 }), ...lineFocus },
      run: (timeline, s, children) => {
        const slots = ItemGrid.itemSlots(timeline as never, s, children)
        const column = Math.round(timeline.args.column ?? 0)
        const inColumn = (i: number) => slots[i]?.meta.kind === "rectangular" && slots[i].meta.column === column
        return ItemGrid.focusOn(timeline as never, s, inColumn, slots.length, timeline.args.dim ?? 0.7, timeline.args.grow ?? 0.15)
      },
    },
  },
  ...ItemGrid.fields(arranger),
}), arranger)

export type RectangularGrid = NodeOf<typeof RectangularGrid>
