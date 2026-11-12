import { Types, fillOps, type DataRecord, type Fill } from "@motionscript/sdk"

import { niceRange, num, text, type ChartSeries, type Range } from "../kit/shared"

/** One bar per row, beside its siblings in the category slot or stacked on them: {@link ChartSeries} under the name for what it draws here. */
export type BarSeries = ChartSeries

/** How the series share a category: side by side, stacked, or stacked as shares of 100. */
export type BarStack = "none" | "stacked" | "percent"

/** Which way the bars grow: up from a category row, or right from a category column. */
export type BarOrientation = "vertical" | "horizontal"

/**
 * One bar's span in data units. A span rather than a height because every mode
 * fits it, and a negative value just runs the other way with no special case.
 */
export interface BarSpan {
  /** Where the base sits: 0 apart, the running total below (or above, for a negative) when stacked. */
  from: number
  to: number
  /** `to - from`. */
  value: number
  /** Whether it ends its stack on its side of zero, so its far end is rounded. */
  outer: boolean
}

/**
 * One row's spans, in series order. Stacking keeps a running sum on each side
 * of zero, so a negative value stacks downward from the baseline rather than
 * eating into the positives. In `percent` each value is its share of the row's
 * total magnitude. A zero value still yields a degenerate span, keeping the list
 * index-aligned with the series. `weights` scale each series' contribution.
 */
export function barSpans(row: DataRecord, series: readonly BarSeries[], stack: BarStack, weights: readonly number[] = []): BarSpan[] {
  const weight = (i: number) => Math.max(0, weights[i] ?? 1)
  if (stack !== "stacked" && stack !== "percent") {
    return series.map((s) => {
      const value = num(row, s.field)
      return { from: 0, to: value, value, outer: true }
    })
  }
  const values = series.map((s, i) => num(row, s.field) * weight(i))
  const total = values.reduce((sum, v) => sum + Math.abs(v), 0)
  const scaled = stack === "percent" ? values.map((v) => (total > 0 ? (v / total) * 100 : 0)) : values
  let lastUp = -1
  let lastDown = -1
  scaled.forEach((v, i) => {
    if (v > 0) lastUp = i
    else if (v < 0) lastDown = i
  })
  let up = 0
  let down = 0
  return scaled.map((value, i) => {
    if (value < 0) {
      const from = down
      down += value
      return { from, to: down, value, outer: i === lastDown }
    }
    const from = up
    up += value
    return { from, to: up, value, outer: i === lastUp }
  })
}

export function barCategories(data: DataRecord[], field: string): string[] {
  return data.map((row) => text(row, field))
}

/**
 * The `[min, max]` of everything drawn, zero always included: a scale starting
 * at 40 draws a bar three times its neighbour for a 10% difference. A cropped
 * axis takes an explicit range.
 */
export function barValueExtent(data: DataRecord[], series: readonly BarSeries[], stack: BarStack, weights?: readonly number[]): Range {
  let lo = 0
  let hi = 0
  for (const row of data) {
    for (const span of barSpans(row, series, stack, weights)) {
      lo = Math.min(lo, span.from, span.to)
      hi = Math.max(hi, span.from, span.to)
    }
  }
  return lo < hi ? [lo, hi] : [0, 1]
}

/** The explicit `range`, else the data's extent nudged to tidy bounds (a percent stack reads to 100); `divisions` (one fewer than the marker count) makes the drawn ticks land on them. */
export function resolveBarScale(
  data: DataRecord[],
  series: readonly BarSeries[],
  stack: BarStack,
  range: Range | undefined,
  divisions: number,
  weights?: readonly number[]
): Range {
  if (range) return range
  const [lo, hi] = barValueExtent(data, series, stack, weights)
  if (stack === "percent") return [lo < 0 ? -100 : 0, hi > 0 ? 100 : 0]
  return niceRange([lo, hi], divisions)
}

/** Black or white, whichever reads on `fill`: a figure printed inside a bar. */
export function inkOn(fill: Fill): string {
  const layers = fillOps.resolve(fill)
  const top = layers[layers.length - 1]
  if (top?.type !== "solid") return "white"
  const [r, g, b] = top.color
  const lift = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  const luminance = 0.2126 * lift(r) + 0.7152 * lift(g) + 0.0722 * lift(b)
  return luminance > 0.4 ? "#0a0a0a" : "white"
}

/** A bar chart's own look: how round and how wide the bars are. */
export const BAR_MARKS = {
  /** Radius of each bar's far corners; a stacked segment inside the stack stays square. */
  barRadius: Types.number(10, { min: 0, max: 64, step: 1, unit: "px" }),
  /** How much of its category slot a bar group fills, the rest spacing the groups. */
  barWidth: Types.number(0.7, { min: 0.05, max: 1, step: 0.05 }),
  /** Space between the bars of one group, side by side. */
  barGap: Types.number(6, { min: 0, max: 40, step: 1, unit: "px" }),
}

export const BAR_LABELS = {
  /** Read as the chart is built: each bar's value past its end, inside it, or none. */
  values: Types.oneOf(["none", "end", "inside"] as const, { animatable: false }),
}
