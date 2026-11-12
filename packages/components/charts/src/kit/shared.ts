/**
 * What every chart shares: series, axis scaling and formatting, and the theme
 * leaves each chart's theme is assembled from. No `Node` imports, so a host's
 * inspector mappings can build a partial theme without the components.
 *
 * A mapper merges partial input onto a `previous` resolved value (idempotent). A
 * tween interpolates two resolved values leaf by leaf, but categorical fields
 * (`fontFamily`, `textAlign`) and any field `undefined` on either side step at
 * the midpoint: defaulting the missing side to 0 would animate a font weight
 * down to nothing on the way to "unset".
 */

import {
  lerpNumber,
  type DataRecord,
  type Fill,
  type Insets,
  type Shadow,
  type Stroke,
  type TextStyle,
} from "@motionscript/sdk"
import { niceStep } from "@motionscript/sdk/component"

/** One series of a chart: a column of the table, captioned and painted. */
export interface ChartSeries {
  /** Key into each data row for this series' value. */
  field: string
  label: string
  /** Overrides the theme palette's entry for this series' index, for its mark and legend swatch. */
  fill?: Fill
  /** Defaults to `true`. */
  enabled?: boolean
}

/** A `[min, max]` numeric range in data units. */
export type Range = [min: number, max: number]

/** One axis's *data* domain, as opposed to {@link AxisConfig}, which is how it is styled. */
export interface AxisDomainConfig {
  /** Caption drawn alongside the axis; `""` hides it. */
  label?: string
  /** Derived from the data bounds when omitted. */
  range?: Range
  /** Derived (five evenly spaced) when omitted. */
  ticks?: number[]
  /**
   * A `number-format` pattern such as `#,##0.00` or `$#,##0`. It lives here, not
   * in {@link AxisConfig}, because it says what the column holds and has to
   * survive a re-theme.
   */
  format?: string
}

/** An {@link AxisDomainConfig} with `range` and `ticks` worked out. */
export type ResolvedAxisDomain = AxisDomainConfig & { readonly range: Range; readonly ticks: number[] }

/**
 * Merges partial input onto `previous`, so a later `.set({ yAxis: {...} })`
 * patches `label`/`range`/`ticks` independently. An unset `range`/`ticks` is the
 * auto-derive signal.
 */
export function resolveAxisDomain(
  domain: AxisDomainConfig | undefined,
  previous?: AxisDomainConfig
): AxisDomainConfig {
  return {
    label: domain?.label ?? previous?.label ?? "",
    range: domain?.range ?? previous?.range,
    ticks: domain?.ticks ?? previous?.ticks,
    format: domain?.format ?? previous?.format,
  }
}

/**
 * Interpolates `range` and `ticks` numerically (ticks pairwise by index).
 * `label`, `format`, and either field when one side is auto, step at the
 * midpoint: there is no halfway between `$#,##0` and `0.0%`.
 */
export function lerpAxisDomain(
  from: AxisDomainConfig,
  to: AxisDomainConfig,
  t: number
): AxisDomainConfig {
  return {
    label: t < 0.5 ? from.label : to.label,
    range: lerpOptionalRange(from.range, to.range, t),
    ticks: lerpOptionalTicks(from.ticks, to.ticks, t),
    format: t < 0.5 ? from.format : to.format,
  }
}

function lerpOptionalRange(
  from: Range | undefined,
  to: Range | undefined,
  t: number
): Range | undefined {
  if (!from || !to) return t < 0.5 ? from : to
  return [lerpNumber(from[0], to[0], t), lerpNumber(from[1], to[1], t)]
}

function lerpOptionalTicks(
  from: number[] | undefined,
  to: number[] | undefined,
  t: number
): number[] | undefined {
  if (!from || !to) return t < 0.5 ? from : to
  const n = Math.max(from.length, to.length)
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    out.push(lerpNumber(from[i] ?? to[i], to[i] ?? from[i], t))
  }
  return out
}

/**
 * An axis domain part-way through a tween that leaves or reaches a `range` or
 * `ticks` left to the data: both ends as stored, and how far along. Only the
 * chart knows what an auto side draws as, so {@link settleAxisDomain} resolves
 * it there. Its own fields are the plain {@link lerpAxisDomain} of its ends, so
 * a mapper merging onto one still reads a domain.
 */
export interface AxisDomainBlend extends AxisDomainConfig {
  readonly blend: { readonly from: AxisDomainConfig; readonly to: AxisDomainConfig; readonly t: number }
}

function blendOf(domain: AxisDomainConfig): AxisDomainBlend["blend"] | undefined {
  return (domain as Partial<AxisDomainBlend>).blend
}

/**
 * The axis entry tween behind `to({ yAxis: { range } })`. Between explicit
 * domains it is {@link lerpAxisDomain}, and a restated `range` without `ticks`
 * spreads ticks across it, keeping their count. When either end leaves `range`
 * or `ticks` to the data, the value between is an {@link AxisDomainBlend}, so a
 * rescale from an auto axis is continuous rather than a cut at the midpoint.
 */
export function lerpAxisEntry(from: AxisDomainConfig, to: AxisDomainConfig, t: number): AxisDomainConfig {
  // The mapper merged the request onto `from`, so a field it left unstated is `from`'s own, by identity.
  const rangeMoved = to.range !== from.range
  const target = rangeMoved && to.range && to.ticks && to.ticks === from.ticks
    ? { ...to, ticks: markerValues(to.range, Math.max(2, to.ticks.length) - 1) }
    : to
  const blended = blendOf(from) !== undefined
  const moved = blended || rangeMoved || target.ticks !== from.ticks
  const auto = blended || from.range === undefined || from.ticks === undefined || target.range === undefined || target.ticks === undefined
  if (!moved || !auto) return lerpAxisDomain(from, target, t)
  if (t === 0) return from
  if (t === 1) return target
  const blend: AxisDomainBlend = { ...lerpAxisDomain(from, target, t), blend: { from, to: target, t } }
  return blend
}

/** `domain` as drawn: `drawn` resolves a plain domain's auto `range` and `ticks`; a blend is the lerp of what its ends draw. */
export function settleAxisDomain(domain: AxisDomainConfig, drawn: (domain: AxisDomainConfig) => AxisDomainConfig): AxisDomainConfig {
  const blend = blendOf(domain)
  if (!blend) return drawn(domain)
  return lerpAxisDomain(settleAxisDomain(blend.from, drawn), settleAxisDomain(blend.to, drawn), blend.t)
}

/** The colour tokens the default themes are built from: a dark plot panel with warm-grey axis furniture. */
const CHART_PALETTE = {
  plotFill: "#15130e",
  borderColor: "#4a4036",
  gridColor: "#2c2820",
  /** Axis markers, axis captions and legend labels. */
  markerColor: "#8a7f70",
  /** A spotlit region's dashed rules and wash. */
  regionColor: "#d99a3a",
} as const

/** Opacity an un-spotlighted series fades to, mark and legend entry alike. */
export const SPOTLIGHT_DIM = 0.2

/**
 * Reads a numeric field off a row. A string column plots as 0, so a quoted or
 * unit-suffixed column needs the CSV parser's numeric coercion first.
 */
export function num(row: DataRecord, field: string | undefined): number {
  if (field === undefined) return 0
  const v = row[field]
  // A `NaN` or infinite cell is no more a measurement than a missing one: read
  // as 0, it cannot poison the scale and turn every point into `NaN`.
  return typeof v === "number" && Number.isFinite(v) ? v : 0
}

/** The counterpart to {@link num} for the columns a chart names things by; a missing cell reads as empty, not `"undefined"`. */
export function text(row: DataRecord, field: string | undefined): string {
  if (field === undefined || field === "") return ""
  const v = row[field]
  return v === undefined || v === null ? "" : String(v)
}

/**
 * Every numeric column of `data` in header order, skipping `exclude`. A column
 * is numeric only if every non-empty cell is a number, so a stray text cell
 * drops the column rather than plotting zeros.
 */
export function numericFields(
  data: DataRecord[],
  exclude: string[] = []
): string[] {
  if (data.length === 0) return []
  const skip = new Set(exclude)
  const seen = new Set<string>()
  const order: string[] = []
  for (const row of data)
    for (const key of Object.keys(row))
      if (!skip.has(key) && !seen.has(key)) {
        seen.add(key)
        order.push(key)
      }

  return order.filter((key) => {
    let sawValue = false
    for (const row of data) {
      const v = row[key]
      if (v === undefined || v === "") continue
      if (typeof v !== "number") return false
      sawValue = true
    }
    return sawValue
  })
}

/** One axis's (x or y) style vocabulary. */
export interface AxisConfig {
  /** Style of each marker along the axis. */
  labelStyle: TextStyle
  titleStyle: TextStyle
  /** This axis's grid lines: weight and fill honoured, dash/cap/join ignored (they are filled rects). */
  lineStyle: Stroke
  /** Gap between the plot and the marker row; only the side facing the plot is read (`.top` horizontal, `.right` vertical). */
  tickPadding: Insets
  /** Gap between the marker row and the caption, read the same side. */
  titlePadding: Insets
}

/** A legend's per-series colour swatch. */
export interface LegendMarkerConfig {
  width: number
  height: number
  borderRadius: number
  stroke: Stroke
  shadow: Shadow
}

export interface LegendConfig {
  padding: Insets
  /** Only the swatch carries the series colour. */
  textStyle: TextStyle
  itemGap: number
  markerStyle: LegendMarkerConfig
}

const AXIS_LABEL_STYLE: TextStyle = {
  fontSize: 24,
  fontWeight: 700,
  textAlign: "center",
  fill: CHART_PALETTE.markerColor,
}
const AXIS_TITLE_STYLE: TextStyle = {
  fontSize: 30,
  fontWeight: 600,
  textAlign: "center",
  fill: CHART_PALETTE.markerColor,
}
const AXIS_LINE_STYLE: Stroke = { weight: 2, fill: CHART_PALETTE.gridColor }

export const DEFAULT_X_AXIS: AxisConfig = {
  labelStyle: AXIS_LABEL_STYLE,
  titleStyle: AXIS_TITLE_STYLE,
  lineStyle: AXIS_LINE_STYLE,
  tickPadding: 20,
  titlePadding: 4,
}

export const DEFAULT_Y_AXIS: AxisConfig = {
  labelStyle: { ...AXIS_LABEL_STYLE, fontWeight: 500, textAlign: "right" },
  titleStyle: AXIS_TITLE_STYLE,
  lineStyle: AXIS_LINE_STYLE,
  tickPadding: 40,
  titlePadding: 24,
}

export const DEFAULT_LEGEND: LegendConfig = {
  padding: 0,
  textStyle: {
    fontSize: 30,
    fontWeight: 600,
    textAlign: "left",
    fill: CHART_PALETTE.markerColor,
  },
  itemGap: 44,
  markerStyle: {
    width: 60,
    height: 24,
    borderRadius: 6,
    stroke: [],
    shadow: [],
  },
}

/**
 * Format a marker value: integers plain, otherwise one decimal, or as many as
 * the tick `step` needs to tell neighbours apart (a unit axis ticked every 0.05
 * gets two, not `0.1 0.1 0.2 0.2 0.3`). Trailing zeros are dropped.
 */
export function formatMarker(value: number, step?: number): string {
  if (Number.isInteger(value)) return String(value)
  const decimals = Math.max(1, step === undefined ? 1 : decimalsFor(step))
  return value.toFixed(decimals).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "")
}

/** Decimal places needed to write `step` exactly, capped at six. */
function decimalsFor(step: number): number {
  if (!(step > 0) || !Number.isFinite(step)) return 1
  for (let d = 0; d <= 6; d++) {
    const scaled = step * 10 ** d
    if (Math.abs(scaled - Math.round(scaled)) < 1e-6 * Math.max(1, scaled)) return d
  }
  // An irrational-looking step (a third): as many places as separate the ticks.
  return Math.min(6, Math.max(1, Math.ceil(-Math.log10(step)) + 1))
}

/** The gap between neighbouring tick values, or `undefined` for fewer than two distinct ones. */
export function markerStep(markers: readonly number[]): number | undefined {
  const sorted = [...markers].filter(Number.isFinite).sort((a, b) => a - b)
  let step: number | undefined
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i] - sorted[i - 1]
    if (gap > 1e-12 && (step === undefined || gap < step)) step = gap
  }
  return step
}

/** Format a fraction in `[0, 1]` as a percentage: integers plain, else one decimal. */
export function formatPercent(fraction: number): string {
  const pct = fraction * 100
  if (Number.isInteger(pct)) return `${pct}%`
  return `${pct.toFixed(1).replace(/\.0$/, "")}%`
}

/** `markerCount` evenly-spaced tick values across `[min, max]`, ends inclusive. */
export function markerValues([min, max]: Range, markerCount: number): number[] {
  const n = Math.max(2, Math.round(markerCount))
  return Array.from({ length: n + 1 }, (_, i) => min + ((max - min) / n) * i)
}

/** `[lo, hi]` nudged out to bounds a whole number of tidy steps apart, about `divisions` of them. */
export function niceRange([lo, hi]: Range, divisions: number): Range {
  const segments = Math.max(1, Math.round(divisions))
  if (hi === lo) return constantScale(lo, segments)
  const step = niceStep((hi - lo) / segments)
  return [Math.floor(lo / step) * step, Math.ceil(hi / step) * step]
}

/**
 * The scale for constant data. A zero-width scale would put every tick on one
 * value and the line on the floor, so it widens by a step sized to the
 * magnitude (`5` gets `[3, 7]`), or `[0, 1]` for zero.
 */
function constantScale(value: number, segments: number): Range {
  if (value === 0) return [0, 1]
  const step = niceStep(Math.abs(value) / segments)
  return [value - step, value + step]
}

/**
 * Ticks for a range worked out from the data: every multiple of the tidiest
 * step (1, 2 or 5 times a power of ten) that divides it into about `divisions`
 * parts, so zero is a tick whenever the range spans it. A range no such step
 * divides (an author's) is split evenly instead.
 */
export function niceTicks([lo, hi]: Range, divisions: number): number[] {
  const span = hi - lo
  const target = Math.max(1, Math.round(divisions))
  if (!(span > 0)) return markerValues([lo, hi], target)
  const whole = (v: number) => Math.abs(v - Math.round(v)) < 1e-6
  const base = niceStep(span / target)
  let best: number | undefined
  for (const step of ladder(base)) {
    const parts = span / step
    if (!whole(parts) || !whole(lo / step) || parts < 2 || parts > 8) continue
    if (best === undefined || Math.abs(parts - target) < Math.abs(span / best - target)) best = step
  }
  if (best === undefined) return markerValues([lo, hi], target)
  const first = Math.round(lo / best)
  return Array.from({ length: Math.round(span / best) + 1 }, (_, k) => Number(((first + k) * best).toPrecision(12)))
}

/** `step` and its neighbours on the 1-2-5 ladder, two either side. */
function ladder(step: number): number[] {
  const mag = 10 ** Math.floor(Math.log10(step))
  const rungs: number[] = []
  for (const m of [mag / 10, mag, mag * 10]) for (const k of [1, 2, 5]) rungs.push(k * m)
  const at = rungs.findIndex((r) => Math.abs(r - step) < step * 1e-9)
  return rungs.slice(Math.max(0, at - 2), at + 3)
}
