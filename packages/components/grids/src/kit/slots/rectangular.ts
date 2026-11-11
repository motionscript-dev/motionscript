import type { Size2D } from "@motionscript/sdk"

import { largest, slot, type Slot, type SlotInput } from "./slot"

export const FILL_DIRECTIONS = ["row", "column"] as const
export type FillDirection = (typeof FILL_DIRECTIONS)[number]

/** The largest child (`fit`), a size of its own (`fixed`), or an equal share of the box (`fill`). */
export const CELL_MODES = ["fit", "fixed", "fill"] as const
export type CellMode = (typeof CELL_MODES)[number]

/** Where a short last row (or column, filling by column) sits. */
export const LINE_ALIGNS = ["start", "center", "end"] as const
export type LineAlign = (typeof LINE_ALIGNS)[number]

export interface RectangularArrangement {
  kind: "rectangular"
  columns: number
  fillDirection: FillDirection
  cellMode: CellMode
  cellWidth: number
  cellHeight: number
  columnGap: number
  rowGap: number
  lastLineAlign: LineAlign
  /** Share of a column's pitch every other row shifts right — `0.5` is a brick bond. */
  rowOffset: number
  /** Share of a row's pitch every other column shifts down. */
  columnOffset: number
}

/** Rows and columns `count` items make, `columns` wide. */
export function rectangularShape(arrangement: RectangularArrangement, count: number): { rows: number; columns: number } {
  const columns = Math.max(1, Math.round(arrangement.columns))
  const rows = Math.max(1, Math.ceil(count / columns))
  // Filling by column, the rows are set by the count, and a column the items
  // never reach would pull the block off centre.
  if (arrangement.fillDirection === "column") return { rows, columns: Math.max(1, Math.ceil(count / rows)) }
  return { rows, columns }
}

/** The cell every item is laid out in — what a `fill` child is measured against. */
export function rectangularCell(
  arrangement: RectangularArrangement,
  count: number,
  sizes: readonly Size2D[],
  box: Size2D,
): Size2D {
  const { rows, columns } = rectangularShape(arrangement, count)
  switch (arrangement.cellMode) {
    case "fixed":
      return { width: Math.max(0, arrangement.cellWidth), height: Math.max(0, arrangement.cellHeight) }
    case "fill":
      return {
        width: Math.max(0, (box.width - arrangement.columnGap * (columns - 1)) / columns),
        height: Math.max(0, (box.height - arrangement.rowGap * (rows - 1)) / rows),
      }
    default:
      return largest(sizes)
  }
}

/**
 * Items fill rows left to right, top to bottom (or columns top to bottom, left to
 * right), and the whole block is centred on the grid.
 */
export function rectangularSlots(arrangement: RectangularArrangement, input: SlotInput): Slot[] {
  const { count } = input
  if (count === 0) return []
  const { rows, columns } = rectangularShape(arrangement, count)
  const byColumn = arrangement.fillDirection === "column"
  // Filling by column keeps the column count and lets the rows follow from it.
  const lines = byColumn ? columns : rows
  const perLine = byColumn ? rows : columns
  const cell = rectangularCell(arrangement, count, input.sizes, input.box)
  const pitchX = cell.width + arrangement.columnGap
  const pitchY = cell.height + arrangement.rowGap
  const lastLine = lines - 1
  const lastCount = count - lastLine * perLine
  const shortBy = perLine - lastCount
  const lead = arrangement.lastLineAlign === "center" ? shortBy / 2 : arrangement.lastLineAlign === "end" ? shortBy : 0
  // Shifting every other row by a share of a pitch moves the block's centre by
  // half that share; taking it back keeps the block centred on the grid.
  const shiftX = arrangement.rowOffset * pitchX
  const shiftY = arrangement.columnOffset * pitchY

  const slots: Slot[] = []
  for (let i = 0; i < count; i++) {
    const line = Math.floor(i / perLine)
    let along = i % perLine
    if (line === lastLine) along += lead
    const row = byColumn ? along : line
    const column = byColumn ? line : along
    // A centred short line sits between whole cells; its parity is the cell it covers most.
    const rowIndex = Math.round(row)
    const columnIndex = Math.round(column)
    const x = (column - (columns - 1) / 2) * pitchX
      + (rowIndex % 2 === 1 ? shiftX : 0) - (rows > 1 ? shiftX / 2 : 0)
    const y = ((rows - 1) / 2 - row) * pitchY
      - (columnIndex % 2 === 1 ? shiftY : 0) + (columns > 1 ? shiftY / 2 : 0)
    slots.push(slot(x, y, { kind: "rectangular", row: rowIndex, column: columnIndex }))
  }
  return slots
}
