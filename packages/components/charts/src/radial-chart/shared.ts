import { Types, clamp, type DataRecord, type TextStyle, type Fill as _Fill, type FillResolved as _FillResolved } from "@motionscript/sdk"

import { CHART_COLORS, CHART_LEGEND, CHART_TEXT, legendConfigOf, type ChartStyleBase, paletteFill } from "../kit/style"
import type { LegendConfig } from "../kit/shared"
import { num, text } from "../kit/shared"
import type { CenterConfig, PieSlice } from "../kit/polar"

/** One ring: a row's caption, magnitude and paint. The same shape as a pie's slice, so the legend is shared. */
export type RadialRow = PieSlice

export function resolveRadialRows(data: readonly DataRecord[], category: string, value: string, style: Pick<ChartStyleBase, "palette">): RadialRow[] {
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
  readonly track: boolean
  readonly roundCaps: boolean
  readonly ringLabels: boolean
}

export const RADIAL_STYLE_GROUPS = {
  colors: CHART_COLORS,
  text: CHART_TEXT,
  marks: {
    /** Where the innermost ring starts, as a fraction of the outer radius. */
    innerRadius: Types.number(0.3, { min: 0, max: 0.9, step: 0.05 }),
    /** Space between neighbouring rings, px. */
    ringGap: Types.number(8, { min: 0, max: 60, step: 1, unit: "px" }),
    /** Degrees a full ring spans: 360 a circle, 270 a gauge-like open ring. */
    sweep: Types.number(360, { min: 30, max: 360, step: 5, unit: "deg" }),
    /** Degrees clockwise from 12 o'clock where every ring begins. */
    startAngle: Types.number(0, { min: -360, max: 360, step: 5, unit: "deg" }),
    /** Draw the full ring under each arc, in the grid colour. */
    track: Types.boolean(true),
    /** Round the ends of the arcs and tracks. */
    roundCaps: Types.boolean(true),
  },
  labels: {
    /** The category written at each ring's start, in the muted colour. */
    ringLabels: Types.boolean(false),
  },
  legend: CHART_LEGEND,
}

export function marksOf(style: RadialStyle): RadialMarks {
  return {
    innerRadius: style.innerRadius,
    ringGap: style.ringGap,
    sweep: style.sweep,
    startAngle: style.startAngle,
    track: style.track,
    roundCaps: style.roundCaps,
  }
}

export function legendOf(style: RadialStyle): LegendConfig {
  return legendConfigOf(style)
}

function face(style: RadialStyle): Pick<TextStyle, "fontFamily"> {
  return style.fontFamily ? { fontFamily: style.fontFamily } : {}
}

export function ringLabelOf(style: RadialStyle): TextStyle {
  return { ...face(style), fontSize: style.fontSize, fontWeight: style.fontWeight, textAlign: "center", fill: style.muted }
}

export function centerOf(style: RadialStyle): CenterConfig {
  return {
    labelStyle: {
      ...face(style),
      fontSize: Math.round(style.fontSize * 1.8),
      fontWeight: Math.min(900, style.fontWeight + 300),
      textAlign: "center",
      fill: style.foreground,
    },
    captionStyle: { ...face(style), fontSize: Math.round(style.fontSize * 0.8), fontWeight: style.fontWeight, textAlign: "center", fill: style.muted },
  }
}
