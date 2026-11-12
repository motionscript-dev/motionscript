/**
 * What a line chart's x column means: a number (plotted as is), an instant
 * (`Jan`, `2026-W12`; plotted by time, so a gap in the data reads as a gap), or
 * anything else (the row's position, evenly spaced).
 *
 * A tick on a time or ordinal scale is a sample, so its caption is the cell the
 * author wrote; only a tick that is not (an author-set range, a `zoomTo`
 * mid-flight) is formatted, by {@link formatInstant}.
 */

import type { DataRecord } from "@motionscript/sdk"

import {
  formatMarker,
  markerValues,
  num,
  text,
  type Range,
} from "../kit/shared"
import { formatNumber } from "@motionscript/sdk/component"

/** How an x column's cells become positions along the axis. */
export type XScaleKind = "numeric" | "time" | "ordinal"

/** An x column resolved into positions, captions and ticks: three closures built once per (data, column), not a tag callers switch on. */
export interface XScale {
  kind: XScaleKind
  /** Position of row `index` along the axis, in this scale's own units. */
  at(index: number): number
  /** `[min, max]` across the rows: the scale when no range is set. */
  extent: Range
  label(value: number): string
  /** `divisions + 1` tick values spanning `range`, ends included. */
  ticks(range: Range, divisions: number): number[]
}

const DAY = 86_400_000

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
]

/** The year a cell naming none is dated into; a leap year, so February spaces the same as in a column that carries years. */
const NOMINAL_YEAR = 2024

/** Month index for `jan`, `sept` or `january`, else -1: three letters minimum, then a prefix match, so `sept` passes and `janitor` does not. */
function monthIndex(word: string): number {
  if (word.length < 3) return -1
  return MONTHS.findIndex((month) => month.startsWith(word))
}

function isoWeekStart(year: number, week: number): number {
  // ISO week 1 is the week containing 4 January, and weeks start on Monday.
  const jan4 = Date.UTC(year, 0, 4)
  const weekday = (new Date(jan4).getUTCDay() + 6) % 7 // Monday = 0
  return jan4 - weekday * DAY + (week - 1) * 7 * DAY
}

/**
 * One cell read as an instant, or `null`. Not `Date.parse`, which accepts `"5"`
 * and `"Q3"`, differs between engines off ISO, and reads `2026-03-14` as UTC but
 * `2026/03/14` as local. Every form is matched explicitly, and an ambiguous
 * all-numeric date (`03/04/2026`) is not one of them.
 */
export function parseInstant(raw: unknown): number | null {
  if (typeof raw !== "string") return null
  const s = raw.trim().toLowerCase()
  if (s === "") return null

  // 2026-03-14 · 2026/03/14 · 2026-03 · 2026/03
  const ymd = /^(\d{4})[-/](\d{1,2})(?:[-/](\d{1,2}))?$/.exec(s)
  if (ymd) {
    const month = Number(ymd[2])
    const day = ymd[3] === undefined ? 1 : Number(ymd[3])
    if (month < 1 || month > 12 || day < 1 || day > 31) return null
    return Date.UTC(Number(ymd[1]), month - 1, day)
  }

  // 2026-W12 · 2026W12 · w12 · week 12
  const week = /^(?:(\d{4})[-\s]?)?w(?:ee)?k?[-\s]?(\d{1,2})$/.exec(s)
  if (week) {
    const n = Number(week[2])
    if (n < 1 || n > 53) return null
    return isoWeekStart(
      week[1] === undefined ? NOMINAL_YEAR : Number(week[1]),
      n
    )
  }

  // jan · january · jan 2026 · january-2026 · 2026 jan
  const named = /^(?:(\d{4})[-\s]+)?([a-z]+)(?:[-\s]+(\d{4}))?$/.exec(s)
  if (named) {
    const month = monthIndex(named[2])
    if (month >= 0) {
      const year = named[1] ?? named[3]
      const y = year === undefined ? NOMINAL_YEAR : Number(year)
      return Date.UTC(y, month, 1)
    }
  }

  // 14 mar 2026 · mar 14 2026 · mar 14, 2026
  const dayNamed =
    /^(?:(\d{1,2})[-\s]+([a-z]+)|([a-z]+)[-\s]+(\d{1,2}),?)[-\s]+(\d{4})$/.exec(
      s
    )
  if (dayNamed) {
    const month = monthIndex(dayNamed[2] ?? dayNamed[3])
    const day = Number(dayNamed[1] ?? dayNamed[4])
    if (month >= 0 && day >= 1 && day <= 31) {
      return Date.UTC(Number(dayNamed[5]), month, day)
    }
  }

  return null
}

/** An instant captioned at the coarsest granularity the span tells apart: a decade reads as years, a year as months. */
export function formatInstant(value: number, span: number): string {
  const date = new Date(value)
  const year = date.getUTCFullYear()
  const month = MONTHS[date.getUTCMonth()].slice(0, 3)
  const label = month.charAt(0).toUpperCase() + month.slice(1)
  if (span > 4 * 365 * DAY) return String(year)
  if (span > 60 * DAY) return `${label} ${year}`
  return `${label} ${date.getUTCDate()}`
}

/** `numericFields`' rule for one column: a single text cell takes it off the numeric scale rather than plot that row at 0. */
function isNumericColumn(data: DataRecord[], field: string): boolean {
  let sawValue = false
  for (const row of data) {
    const v = row[field]
    if (v === undefined || v === null || v === "") continue
    if (typeof v !== "number") return false
    sawValue = true
  }
  return sawValue
}

/**
 * Every non-empty cell as an instant, or `null` if any is not one. A blank cell
 * keeps its slot and takes the nearest known instant: stacking it on the epoch
 * would drag the whole scale back fifty years.
 */
function instantColumn(data: DataRecord[], field: string): number[] | null {
  const parsed: (number | null)[] = []
  let sawValue = false
  for (const row of data) {
    const raw = row[field]
    if (raw === undefined || raw === null || raw === "") {
      parsed.push(null)
      continue
    }
    const t = parseInstant(raw)
    if (t === null) return null
    parsed.push(t)
    sawValue = true
  }
  if (!sawValue) return null

  const first = parsed.find((t): t is number => t !== null) as number
  let last = first
  return parsed.map((t) => (t === null ? last : (last = t)))
}

/** `[min, max]` of `values`, or `[0, 1]` when there is nothing to span. */
function extentOf(values: number[]): Range {
  let lo = Infinity
  let hi = -Infinity
  for (const v of values) {
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  return lo <= hi ? [lo, hi] : [0, 1]
}

/** Up to this many samples in view, every one is a tick. */
export const EVERY_SAMPLE = 12

/**
 * Ticks spanning `range`, each a sample, nearest to where an evenly spaced tick
 * would go. They must be samples (a caption between two has nothing to say) and
 * spread (every nth sample would print five dates on top of each other across a
 * burst of rows), so this walks the evenly spaced targets, not the samples.
 * Targets that pick the same sample collapse to one tick, so a gappy column
 * draws fewer honest ticks rather than overlapping ones.
 */
function sampledTicks(
  positions: number[],
  [min, max]: Range,
  divisions: number
): number[] {
  const inside = positions.filter((v) => v >= min && v <= max)
  const unique = [...new Set(inside)].sort((a, b) => a - b)
  if (unique.length === 0) return markerValues([min, max], divisions)
  // Few and even enough to caption every one: a month left out reads as missing data.
  if (unique.length <= EVERY_SAMPLE && evenlySpaced(unique)) return unique

  const nearest = (target: number) =>
    unique.reduce((best, v) =>
      Math.abs(v - target) < Math.abs(best - target) ? v : best
    )

  const out: number[] = []
  for (const target of markerValues([min, max], divisions)) {
    const tick = nearest(target)
    if (out[out.length - 1] !== tick) out.push(tick)
  }
  return out
}

/** Whether no two neighbouring samples sit much closer than the average gap: months do, a burst of days between weeks of nothing does not. */
function evenlySpaced(sorted: readonly number[]): boolean {
  if (sorted.length < 3) return true
  const mean = (sorted[sorted.length - 1] - sorted[0]) / (sorted.length - 1)
  for (let i = 1; i < sorted.length; i++) if (sorted[i] - sorted[i - 1] < mean * 0.75) return false
  return true
}

/** The cell of the row a tick came from, or `fallback` when it is not a sample. */
function labelBySample(
  positions: number[],
  captions: string[],
  value: number,
  fallback: (value: number) => string
): string {
  const i = positions.indexOf(value)
  return i >= 0 ? captions[i] : fallback(value)
}

/** Resolved scales by data array, then by field and pattern. */
const scales = new WeakMap<DataRecord[], Map<string, XScale>>()

/** Kept per `data` array: bound props ask a dozen times a frame, and parsing every row's instant each time was most of a frame. */
export function resolveXScale(
  data: DataRecord[],
  field: string,
  pattern?: string
): XScale {
  let byKey = scales.get(data)
  if (!byKey) scales.set(data, (byKey = new Map()))
  const key = JSON.stringify([field, pattern ?? null])
  let scale = byKey.get(key)
  if (!scale) byKey.set(key, (scale = xScaleOf(data, field, pattern)))
  return scale
}

function xScaleOf(
  data: DataRecord[],
  field: string,
  /** Number-format pattern for a numeric column only; ticks on the other kinds are the author's cells. */
  pattern?: string
): XScale {
  if (field !== "" && isNumericColumn(data, field)) {
    const positions = data.map((row) => num(row, field))
    return {
      kind: "numeric",
      at: (i) => positions[i] ?? 0,
      extent: extentOf(positions),
      label: (value) =>
        pattern === undefined ? formatMarker(value) : formatNumber(value, pattern),
      // A continuous axis is read by its scale, not by which samples are on it.
      ticks: markerValues,
    }
  }

  const captions = data.map((row) => text(row, field))
  const instants = field === "" ? null : instantColumn(data, field)

  if (instants) {
    const extent = extentOf(instants)
    const span = extent[1] - extent[0]
    return {
      kind: "time",
      at: (i) => instants[i] ?? 0,
      extent,
      label: (value) =>
        labelBySample(instants, captions, value, (v) =>
          formatInstant(v, span)
        ),
      ticks: (range, divisions) => sampledTicks(instants, range, divisions),
    }
  }

  const positions = data.map((_, i) => i)
  return {
    kind: "ordinal",
    at: (i) => i,
    // `[0, n-1]`, not `[0, n]`: the first and last rows sit on the plot's edges.
    extent: positions.length > 0 ? [0, positions.length - 1] : [0, 1],
    label: (value) => captions[Math.round(value)] ?? "",
    ticks: (range, divisions) => sampledTicks(positions, range, divisions),
  }
}
