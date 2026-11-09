/**
 * What a line chart's x column *means* — the one question that has to be
 * answered before a row can be given a position along the bottom of the plot.
 *
 * A y column is always a magnitude. An x column is one of three things, and
 * which one is a property of the data rather than something the author states:
 *
 * - **numeric** — `0, 5, 10` — plot the number.
 * - **time** — `Jan`, `2026-03`, `2026-W12`, `2026-03-14` — plot the instant,
 *   so samples a month apart sit a month apart and a gap in the data reads as a
 *   gap.
 * - **ordinal** — anything else — plot the row's position, evenly spaced.
 *
 * Before this, every x column went through `num()`, which reads a non-numeric
 * cell as `0`. A `Month` column of `Jan…Dec` therefore stacked all twelve
 * points on one x and drew a vertical line — no error, no empty chart, just a
 * wrong picture. That is the failure this module exists to remove: every column
 * now plots as *something*, and the something is the reading a person would
 * give it.
 *
 * The captions come back off the rows rather than out of a formatter. A tick on
 * a time or ordinal scale is chosen *from the data* (see {@link XScale.ticks}),
 * so the label it wants is the cell the author wrote — `Jan`, not `1970-01-01`,
 * and `2026-W12`, not the Monday it resolves to. Only a tick that is not a
 * sample — an author-set range, or a `zoomTo` mid-flight — needs formatting,
 * and that is the one case {@link formatInstant} covers.
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

/**
 * An x column resolved into positions, captions and ticks.
 *
 * The three kinds differ in all three answers, so they are three closures built
 * once per (data, column) rather than a kind tag every caller switches on.
 */
export interface XScale {
  kind: XScaleKind
  /** Position of row `index` along the axis, in this scale's own units. */
  at(index: number): number
  /** `[min, max]` across the rows — the scale when no range is set. */
  extent: Range
  /** The caption for a tick at `value`. */
  label(value: number): string
  /** `divisions + 1` tick values spanning `range`, ends included. */
  ticks(range: Range, divisions: number): number[]
}

// ---- Time parsing --------------------------------------------------------

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

/**
 * The year a cell that names no year is dated into.
 *
 * Any year would place `Jan…Dec` in the right order at the right spacing; a
 * leap year is the one that also spaces February correctly against a column
 * that *does* carry years, so the two read alike.
 */
const NOMINAL_YEAR = 2024

/**
 * Month index for any unambiguous abbreviation of a month name — `jan`, `sept`,
 * `january` — or -1.
 *
 * Three letters minimum, and then a prefix match, which is what lets `sept`
 * through without letting `janitor` through: a longer word has to still *be*
 * the month.
 */
function monthIndex(word: string): number {
  if (word.length < 3) return -1
  return MONTHS.findIndex((month) => month.startsWith(word))
}

/** The Monday of ISO week `week` in `year`, as an epoch timestamp. */
function isoWeekStart(year: number, week: number): number {
  // ISO week 1 is the week containing 4 January, and weeks start on Monday.
  const jan4 = Date.UTC(year, 0, 4)
  const weekday = (new Date(jan4).getUTCDay() + 6) % 7 // Monday = 0
  return jan4 - weekday * DAY + (week - 1) * 7 * DAY
}

/**
 * One cell read as an instant, or `null` when it isn't one.
 *
 * Deliberately **not** `Date.parse`. That accepts `"5"`, `"Q3"` and a good deal
 * else besides, differs between engines on anything non-ISO, and reads a bare
 * `2026-03-14` as UTC but `2026/03/14` as local — three ways for a column to be
 * silently misread as time. Every form below is matched explicitly, and an
 * ambiguous all-numeric date (`03/04/2026` — March or April, depending on where
 * the author lives) is deliberately not one of them.
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

/**
 * An instant captioned at the coarsest granularity the axis's own span can tell
 * apart — a decade of samples reads as years, a year of them as months.
 *
 * Only reached for a tick that is *not* one of the rows (an author-set range, a
 * `zoomTo` part-way through). A tick that is a sample is captioned with the
 * cell the author wrote; see the note at the top of this file.
 */
export function formatInstant(value: number, span: number): string {
  const date = new Date(value)
  const year = date.getUTCFullYear()
  const month = MONTHS[date.getUTCMonth()].slice(0, 3)
  const label = month.charAt(0).toUpperCase() + month.slice(1)
  if (span > 4 * 365 * DAY) return String(year)
  if (span > 60 * DAY) return `${label} ${year}`
  return `${label} ${date.getUTCDate()}`
}

// ---- Column reading ------------------------------------------------------

/**
 * Whether every non-empty cell of `field` holds a number.
 *
 * The same rule `numericFields` applies, asked of one column: a single text
 * cell in an otherwise numeric column takes the whole column off the numeric
 * scale, because plotting that row at 0 is the failure this module is here to
 * stop.
 */
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
 * Every non-empty cell of `field` parsed as an instant, or `null` if any one of
 * them isn't one — in which case the column isn't a time column at all.
 *
 * A blank cell keeps its slot, so the returned list stays index-aligned with
 * the rows, and takes the nearest known instant: a hole in an x column is a row
 * whose date the file didn't say, and stacking it on the epoch would drag the
 * whole scale back fifty years to make room for it.
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

/**
 * Ticks spanning `range`, each one **a sample** — a row the author can point at
 * in their file — placed as near as it can be to where an evenly spaced tick
 * would have gone.
 *
 * Two things have to hold at once, and picking either alone gets it wrong.
 * Ticks must be *samples*, because a caption between two of them has nothing to
 * say (two-thirds of the way through March is not a month, and on a category
 * column it is not anything at all). And they must be *spread*, because the
 * labels sit side by side in a row: taking every nth sample instead puts five
 * dates in the two weeks a burst of rows happens to cover and prints them on
 * top of each other, which is what a column with a gap in it does.
 *
 * Walking the targets rather than the samples is what satisfies both. A run of
 * rows too close together to caption collapses to one tick — consecutive
 * targets pick the same sample and the duplicate is dropped — so a chart asked
 * for five ticks across a gappy column draws four honest ones instead of five
 * overlapping.
 */
function sampledTicks(
  positions: number[],
  [min, max]: Range,
  divisions: number
): number[] {
  const inside = positions.filter((v) => v >= min && v <= max)
  const unique = [...new Set(inside)].sort((a, b) => a - b)
  if (unique.length === 0) return markerValues([min, max], divisions)

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

/**
 * The caption a tick carries on a sample-based scale: the cell of the row it
 * came from, or `fallback` when the tick isn't a sample after all.
 */
function labelBySample(
  positions: number[],
  captions: string[],
  value: number,
  fallback: (value: number) => string
): string {
  const i = positions.indexOf(value)
  return i >= 0 ? captions[i] : fallback(value)
}

/** Scales already resolved, by data array, then by field and pattern. */
const scales = new WeakMap<DataRecord[], Map<string, XScale>>()

/**
 * How `field` positions the rows: the number it holds, the instant it names, or
 * failing both, the row's own place in the file.
 *
 * Kept per `data` array: a chart's bound props ask a dozen times a frame, and
 * parsing every row's instant each time was most of a frame.
 */
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
  /**
   * The number-format pattern for a *numeric* column. Ignored by the other two
   * kinds, and correctly so: a tick on those is captioned with the cell the
   * author wrote, and `Jan` has no decimal places.
   */
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
      // Round numbers, evenly spaced — a continuous axis is read by its scale
      // rather than by which samples happen to be on it.
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
    // `[0, n-1]` rather than the tidy `[0, n]`: the first and last rows sit on
    // the plot's edges, which is where a reader looks for them.
    extent: positions.length > 0 ? [0, positions.length - 1] : [0, 1],
    label: (value) => captions[Math.round(value)] ?? "",
    ticks: (range, divisions) => sampledTicks(positions, range, divisions),
  }
}
