import { Types, type Fill, type TextStyle, type Stroke, type FillResolved as _FillResolved } from "@motionscript/sdk"

import {
  CHART_BACKGROUND,
  CHART_FOREGROUND,
  CHART_LEGEND,
  CHART_MUTED,
  CHART_SERIES,
  LEGEND_TEXT,
  legendConfigOf,
  placedText,
  sizeOf,
  type ChartStyleBase,
} from "../kit/style"
import { num, text, type LegendConfig } from "../kit/shared"
import { DEG, PIE_SPOTLIGHT_DIM, ringPoint, selectionFade, type CenterConfig, type PieSlice } from "../kit/polar"

export { DEG, PIE_SPOTLIGHT_DIM, ringPoint, selectionFade, type CenterConfig, type PieSlice }

/**
 * One slice per row, painted from `seriesFills` by row order (cycling). Paint comes
 * from the palette, not the rows, because a pie's mark is a row where a line's
 * colour belongs to a column; that lets a pie be fed a CSV of plain numbers.
 */
export function resolvePieSlices(data: readonly Record<string, unknown>[], category: string, value: string, palette: readonly Fill[]): PieSlice[] {
  return data.map((row, i) => ({
    category: text(row as never, category),
    value: num(row as never, value),
    fill: palette.length > 0 ? palette[i % palette.length] : ("white" as Fill),
  }))
}

/** What a {@link PieChart}'s labels say. */
export type PieLabelMode =
  /** Two lines, whose order flips with placement: an outside label reads category over percentage, an inside label reads the percentage big over a small category. */
  | "both"
  | "category"
  | "percent"
  /** No labels and no leader lines. */
  | "none"

/** `"inside"` centres the label in the wedge's band with no leader or gutter, so the ring draws bigger; `"outside"` sets it on a leader, which a sliver too narrow for text needs. */
export type PieLabelPlacement = "inside" | "outside" | "none"


/** A slice's plotted value: negatives and non-finite values count as 0. */
export function sliceValue(slice: PieSlice): number {
  return slice.value > 0 && Number.isFinite(slice.value) ? slice.value : 0
}

/** Sum of every slice's plotted value, the denominator of every share. */
export function sliceTotal(slices: PieSlice[]): number {
  let sum = 0
  for (const slice of slices) sum += sliceValue(slice)
  return sum
}

/** One slice's resolved angular span on the ring. */
export interface PieArc {
  /** Index of the slice in the source list. */
  index: number
  /** Radians clockwise from 12 o'clock. */
  a0: number
  a1: number
  /** Where the slice's label and pop-out point. */
  mid: number
  /** Share of the total, `[0, 1]`. */
  fraction: number
}

/**
 * One arc per positive slice, walking clockwise from `startDegrees` and abutting.
 * Arcs are the undivided shares: a fixed angular gap would pinch shut at the
 * hole, so the gap is applied when the wedge is drawn, as a constant-width inset
 * off both ends.
 */
export function pieArcs(slices: PieSlice[], startDegrees: number): PieArc[] {
  const total = sliceTotal(slices)
  if (total <= 0) return []

  const arcs: PieArc[] = []
  let cursor = startDegrees * DEG
  slices.forEach((slice, index) => {
    const value = sliceValue(slice)
    if (value <= 0) return
    const fraction = value / total
    const a0 = cursor
    const a1 = a0 + fraction * Math.PI * 2
    cursor = a1
    arcs.push({ index, a0, a1, mid: (a0 + a1) / 2, fraction })
  })
  return arcs
}

interface LabelSlot {
  /** Where the label would sit if nothing else were in the way. */
  ideal: number
  /** Written by {@link relaxLabels}. */
  y: number
}

/**
 * Spread one column of labels so none overlap, each near its `ideal` y and all
 * inside `[bottom, top]`. A top-down pass clears each label from the one above
 * by `minGap`; a reverse pass lifts a tail pushed past `bottom`. When the column
 * cannot hold them all, the reverse pass wins and the crowding is shared evenly.
 * Mutates each `y` and returns `slots` ordered top to bottom.
 */
export function relaxLabels<T extends LabelSlot>(slots: T[], minGap: number, top: number, bottom: number): T[] {
  slots.sort((a, b) => b.ideal - a.ideal)

  let ceiling = top
  for (const slot of slots) {
    slot.y = Math.min(slot.ideal, ceiling)
    ceiling = slot.y - minGap
  }

  let floor = bottom
  for (let i = slots.length - 1; i >= 0; i--) {
    slots[i].y = Math.max(slots[i].y, floor)
    floor = slots[i].y + minGap
  }

  return slots
}

/** The ring's geometry: everything about the wedges but their colour. */
export interface RingConfig {
  /** Channel between adjacent slices in px, constant across the band (an angular gap would splay open toward the rim). */
  gap: number
  /** Below 1 a fraction of the outer radius (`0.6` leaves a band 40% thick); 1 and up a pixel radius; `0` draws solid wedges. */
  holeRadius: number
  /** Degrees clockwise from 12 o'clock where the first slice begins. */
  startAngle: number
  /** How far a selected slice's rim reaches, as a multiple of the outer radius so the emphasis scales with the chart. Clamped to `[1, 1.6]`. */
  selectedGrow: number
  /** Rounding of each wedge corner, px. */
  cornerRadius: number
}

/** How the ring's labels are set, and the leader lines that point at them. */
export interface LabelConfig {
  /** The category caption outside the ring. */
  textStyle: TextStyle
  /** The percentage outside the ring. */
  percentStyle: TextStyle
  /** Both lines of a label inside its wedge; its fill is set per wedge, for contrast against the paint. */
  insideStyle: TextStyle
  /** Runs from a wedge out to its label. */
  leaderStroke: Stroke
}

/** What a pie's `style` resolves to. */
export interface PieStyle extends ChartStyleBase {
  readonly labelText: TextStyle
  readonly valueText: TextStyle
  readonly centerText: TextStyle
  readonly innerRadius: number
  readonly sliceGap: number
  readonly sliceRadius: number
  readonly labelPlacement: PieLabelPlacement
}

/** The groups of a pie's `style`: no grid, as nothing is ruled. */
export const PIE_STYLE_GROUPS = {
  series: CHART_SERIES,
  background: CHART_BACKGROUND,
  text: {
    /** Each slice's name. */
    labelText: Types.typography({ fontSize: 28, fontWeight: 500, fill: CHART_MUTED }),
    /** Each slice's share or value, beside its name; inside a wedge both are set larger, inked for contrast. */
    valueText: Types.typography({ fontSize: 28, fontWeight: 700, fill: CHART_FOREGROUND }),
    /** The summary in the hole; its caption is set smaller, in the slice names' ink. */
    centerText: Types.typography({ fontSize: 50, fontWeight: 800, fill: CHART_FOREGROUND }),
    ...LEGEND_TEXT,
  },
  marks: {
    /** Hole radius as a fraction of the outer radius: 0 is a pie, about 0.6 a donut. */
    innerRadius: Types.number(0, { min: 0, max: 0.9, step: 0.05 }),
    /** Channel between neighbouring wedges, px. */
    sliceGap: Types.number(3, { min: 0, max: 40, step: 1, unit: "px" }),
    /** Rounding of each wedge corner, px. */
    sliceRadius: Types.number(4, { min: 0, max: 60, step: 1, unit: "px" }),
  },
  labels: {
    /** Read as the chart is built: inside the wedge, outside on a leader, or none. */
    labelPlacement: Types.oneOf(["inside", "outside", "none"] as const, { animatable: false }),
  },
  legend: CHART_LEGEND,
}

export function legendOf(style: PieStyle): LegendConfig {
  return legendConfigOf(style)
}

export function ringConfigOf(style: PieStyle): RingConfig {
  return { gap: style.sliceGap, holeRadius: style.innerRadius, startAngle: 0, selectedGrow: 1.08, cornerRadius: style.sliceRadius }
}

export function labelConfigOf(style: PieStyle): LabelConfig {
  const base = placedText(style.labelText)
  const value = placedText(style.valueText)
  return {
    textStyle: base,
    percentStyle: value,
    insideStyle: { ...value, fontSize: Math.round(sizeOf(style.valueText) * 1.9), fill: "#111113" },
    leaderStroke: { weight: 2, fill: style.labelText.fill ?? "white" },
  }
}

export function centerConfigOf(style: PieStyle): CenterConfig {
  const size = sizeOf(style.centerText, 50)
  return {
    labelStyle: placedText(style.centerText),
    captionStyle: placedText(style.labelText, "center", { fontSize: Math.round(size * 0.45) }),
  }
}
