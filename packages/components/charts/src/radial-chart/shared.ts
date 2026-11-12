import { Types, clamp, type DataRecord, type TextStyle, type Fill as _Fill, type FillResolved as _FillResolved } from "@motionscript/sdk"

import {
  CHART_BACKGROUND,
  CHART_FOREGROUND,
  CHART_LEGEND,
  CHART_MUTED,
  CHART_SERIES,
  legendConfigOf,
  paletteFill,
  placedText,
  sizeOf,
  type ChartStyleBase,
} from "../kit/style"
import type { LegendConfig } from "../kit/shared"
import { num, text } from "../kit/shared"
import type { CenterConfig, PieSlice } from "../kit/polar"

/** One ring: a row's caption, magnitude and paint. The same shape as a pie's slice, so the legend is shared. */
export type RadialRow = PieSlice

export function resolveRadialRows(data: readonly DataRecord[], category: string, value: string, style: Pick<ChartStyleBase, "seriesFills">): RadialRow[] {
  return data.map((row, i) => ({ category: text(row, category), value: num(row, value), fill: paletteFill(style, i) }))
}

/** A row's plotted value: negatives and non-finite values count as 0. */
export function rowValue(row: RadialRow): number {
  return row.value > 0 && Number.isFinite(row.value) ? row.value : 0
}

/** What a full sweep stands for: `max` when it is positive, else the largest value (1 when every value is 0). */
export function radialMax(rows: readonly RadialRow[], max: number): number {
  if (max > 0 && Number.isFinite(max)) return max
  let largest = 0
  for (const row of rows) largest = Math.max(largest, rowValue(row))
  return largest > 0 ? largest : 1
}

/** The share of a full sweep each row fills, `[0, 1]`. */
export function radialFractions(rows: readonly RadialRow[], max: number): number[] {
  const top = radialMax(rows, max)
  return rows.map((row) => clamp(rowValue(row) / top, 0, 1))
}

/** The ring geometry and look, from `style`. */
export interface RadialMarks {
  innerRadius: number
  ringGap: number
  /** Degrees of a full ring. */
  sweep: number
  /** Degrees clockwise from 12 o'clock. */
  startAngle: number
  track: boolean
  roundCaps: boolean
}

export interface RadialStyle extends ChartStyleBase {
  readonly innerRadius: number
  readonly ringGap: number
  readonly sweep: number
  readonly startAngle: number
  readonly track: _FillResolved[]
  readonly roundCaps: boolean
  readonly ringLabels: boolean
  readonly labelText: TextStyle
  readonly centerText: TextStyle
}

export const RADIAL_STYLE_GROUPS = {
  series: CHART_SERIES,
  background: CHART_BACKGROUND,
  marks: {
    /** Where the innermost ring starts, as a fraction of the outer radius. */
    innerRadius: Types.number(0.3, { min: 0, max: 0.9, step: 0.05 }),
    /** Space between neighbouring rings, px. */
    ringGap: Types.number(8, { min: 0, max: 60, step: 1, unit: "px" }),
    /** Degrees a full ring spans: 360 a circle, 270 a gauge-like open ring. */
    sweep: Types.number(360, { min: 30, max: 360, step: 5, unit: "deg" }),
    /** Degrees clockwise from 12 o'clock where every ring begins. */
    startAngle: Types.number(0, { min: -360, max: 360, step: 5, unit: "deg" }),
    /** The full ring under each arc; empty draws none. */
    track: Types.fill("white/10"),
    /** Round the ends of the arcs and tracks. */
    roundCaps: Types.boolean(true),
  },
  labels: {
    /** The category written at each ring's start, set in the label text. */
    ringLabels: Types.boolean(false),
    /** The category at each ring's start, and the caption under the centre. */
    labelText: Types.typography({ fontSize: 28, fontWeight: 500, fill: CHART_MUTED }),
    /** The summary in the middle. */
    centerText: Types.typography({ fontSize: 50, fontWeight: 800, fill: CHART_FOREGROUND }),
  },
  legend: CHART_LEGEND,
}

export function marksOf(style: RadialStyle): RadialMarks {
  return {
    innerRadius: style.innerRadius,
    ringGap: style.ringGap,
    sweep: style.sweep,
    startAngle: style.startAngle,
    track: style.track.length > 0,
    roundCaps: style.roundCaps,
  }
}

export function legendOf(style: RadialStyle): LegendConfig {
  return legendConfigOf(style)
}

export function ringLabelOf(style: RadialStyle): TextStyle {
  return placedText(style.labelText)
}

export function centerOf(style: RadialStyle): CenterConfig {
  const size = sizeOf(style.centerText, 50)
  return {
    labelStyle: placedText(style.centerText),
    captionStyle: placedText(style.labelText, "center", { fontSize: Math.round(size * 0.45) }),
  }
}
