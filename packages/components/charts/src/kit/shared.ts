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
  fillOps,
  lerpNumber,
  shadowOps,
  strokeOps,
  insetsOps,
  textOps,
  type DataRecord,
  type Fill,
  type FillResolved,
  type Insets,
  type InsetsResolved,
  type Shadow,
  type ShadowResolved,
  type Stroke,
  type StrokeResolved,
  type TextStyle,
} from "@motionscript/sdk"

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
export const CHART_PALETTE = {
  plotFill: "#15130e",
  borderColor: "#4a4036",
  gridColor: "#2c2820",
  /** Axis markers, axis captions and legend labels. */
  markerColor: "#8a7f70",
  /** A spotlit region's dashed rules and wash. */
  regionColor: "#d99a3a",
} as const

/** The out-of-the-box series palette, cycled by series index. */
export const DEFAULT_SERIES_COLORS = [
  "#d9603b",
  "#8194ad",
  "#e0a93b",
  "#5e9d6b",
  "#9ec85a",
] as const

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

/** The plot panel a cartesian chart draws its marks over. */
export interface PlotAreaConfig {
  stroke: Stroke
  fill: Fill
  shadow: Shadow
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

/** Unpainted but framed: a chart reads against the stage rather than punching a panel into it. */
export const DEFAULT_PLOT_AREA: PlotAreaConfig = {
  fill: [],
  stroke: { weight: 6, fill: CHART_PALETTE.borderColor },
  shadow: [],
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

/** {@link DEFAULT_SERIES_COLORS} as 4px strokes. */
export const DEFAULT_SERIES_STROKES: Stroke[] = DEFAULT_SERIES_COLORS.map(
  (fill) => ({ weight: 4, fill })
)

/** {@link DEFAULT_SERIES_COLORS} as solid fills. */
export const DEFAULT_SERIES_FILLS: Fill[] = DEFAULT_SERIES_COLORS.map(
  (fill) => fill
)

export function resolveAxisConfig(
  axis: Partial<AxisConfig> | undefined,
  previous: AxisConfig
): AxisConfig {
  return {
    labelStyle: textOps.resolveStyle(axis?.labelStyle, previous.labelStyle),
    titleStyle: textOps.resolveStyle(axis?.titleStyle, previous.titleStyle),
    lineStyle: strokeOps.resolve(axis?.lineStyle ?? previous.lineStyle),
    tickPadding: insetsOps.resolve(
      axis?.tickPadding ?? previous.tickPadding,
      previous.tickPadding as InsetsResolved
    ),
    titlePadding: insetsOps.resolve(
      axis?.titlePadding ?? previous.titlePadding,
      previous.titlePadding as InsetsResolved
    ),
  }
}

export function lerpAxisConfig(
  from: AxisConfig,
  to: AxisConfig,
  t: number
): AxisConfig {
  return {
    labelStyle: textOps.lerpStyle(from.labelStyle, to.labelStyle, t),
    titleStyle: textOps.lerpStyle(from.titleStyle, to.titleStyle, t),
    lineStyle: strokeOps.lerp(
      from.lineStyle as StrokeResolved[],
      to.lineStyle as StrokeResolved[],
      t
    ),
    tickPadding: insetsOps.lerp(
      from.tickPadding as InsetsResolved,
      to.tickPadding as InsetsResolved,
      t
    ),
    titlePadding: insetsOps.lerp(
      from.titlePadding as InsetsResolved,
      to.titlePadding as InsetsResolved,
      t
    ),
  }
}

export function resolvePlotArea(
  plotArea: Partial<PlotAreaConfig> | undefined,
  previous: PlotAreaConfig
): PlotAreaConfig {
  return {
    fill: fillOps.resolve(plotArea?.fill ?? previous.fill),
    stroke: strokeOps.resolve(plotArea?.stroke ?? previous.stroke),
    shadow: shadowOps.resolve(plotArea?.shadow ?? previous.shadow),
  }
}

export function lerpPlotArea(
  from: PlotAreaConfig,
  to: PlotAreaConfig,
  t: number
): PlotAreaConfig {
  return {
    fill: fillOps.lerp(
      from.fill as FillResolved[],
      to.fill as FillResolved[],
      t
    ),
    stroke: strokeOps.lerp(
      from.stroke as StrokeResolved[],
      to.stroke as StrokeResolved[],
      t
    ),
    shadow: shadowOps.lerp(
      from.shadow as ShadowResolved[],
      to.shadow as ShadowResolved[],
      t
    ),
  }
}

function resolveLegendMarkerConfig(
  marker: Partial<LegendMarkerConfig> | undefined,
  previous: LegendMarkerConfig
): LegendMarkerConfig {
  return {
    width: marker?.width ?? previous.width,
    height: marker?.height ?? previous.height,
    borderRadius: marker?.borderRadius ?? previous.borderRadius,
    stroke: strokeOps.resolve(marker?.stroke ?? previous.stroke),
    shadow: shadowOps.resolve(marker?.shadow ?? previous.shadow),
  }
}

function lerpLegendMarkerConfig(
  from: LegendMarkerConfig,
  to: LegendMarkerConfig,
  t: number
): LegendMarkerConfig {
  return {
    width: lerpNumber(from.width, to.width, t),
    height: lerpNumber(from.height, to.height, t),
    borderRadius: lerpNumber(from.borderRadius, to.borderRadius, t),
    stroke: strokeOps.lerp(
      from.stroke as StrokeResolved[],
      to.stroke as StrokeResolved[],
      t
    ),
    shadow: shadowOps.lerp(
      from.shadow as ShadowResolved[],
      to.shadow as ShadowResolved[],
      t
    ),
  }
}

/** A legend theme as the author may state it: every branch optional. */
export type LegendTheme = Partial<Omit<LegendConfig, "markerStyle">> & {
  markerStyle?: Partial<LegendMarkerConfig>
}

export function resolveLegendConfig(
  legend: LegendTheme | undefined,
  previous: LegendConfig
): LegendConfig {
  return {
    padding: insetsOps.resolve(
      legend?.padding ?? previous.padding,
      previous.padding as InsetsResolved
    ),
    textStyle: textOps.resolveStyle(legend?.textStyle, previous.textStyle),
    itemGap: legend?.itemGap ?? previous.itemGap,
    markerStyle: resolveLegendMarkerConfig(
      legend?.markerStyle,
      previous.markerStyle
    ),
  }
}

export function lerpLegendConfig(
  from: LegendConfig,
  to: LegendConfig,
  t: number
): LegendConfig {
  return {
    padding: insetsOps.lerp(
      from.padding as InsetsResolved,
      to.padding as InsetsResolved,
      t
    ),
    textStyle: textOps.lerpStyle(from.textStyle, to.textStyle, t),
    itemGap: lerpNumber(from.itemGap, to.itemGap, t),
    markerStyle: lerpLegendMarkerConfig(from.markerStyle, to.markerStyle, t),
  }
}

/** A palette override replaces the previous palette outright. */
export function resolveSeriesStrokes(
  styles: Stroke[] | undefined,
  previous: Stroke[]
): Stroke[] {
  return (styles ?? previous).map((s) => strokeOps.resolve(s))
}

/** Pairwise by index; a palette that grows/shrinks holds the longer side's tail. */
export function lerpSeriesStrokes(
  from: Stroke[],
  to: Stroke[],
  t: number
): Stroke[] {
  const n = Math.max(from.length, to.length)
  const out: Stroke[] = []
  for (let i = 0; i < n; i++) {
    const a = (from[i] ?? to[i]) as StrokeResolved[]
    const b = (to[i] ?? from[i]) as StrokeResolved[]
    out.push(strokeOps.lerp(a, b, t))
  }
  return out
}

/** The fill-palette twin of {@link resolveSeriesStrokes}, for filled marks. */
export function resolveSeriesFills(
  fills: Fill[] | undefined,
  previous: Fill[]
): Fill[] {
  return (fills ?? previous).map((f) => fillOps.resolve(f))
}

/** The fill-palette twin of {@link lerpSeriesStrokes}. */
export function lerpSeriesFills(from: Fill[], to: Fill[], t: number): Fill[] {
  const n = Math.max(from.length, to.length)
  const out: Fill[] = []
  for (let i = 0; i < n; i++) {
    const a = (from[i] ?? to[i]) as FillResolved[]
    const b = (to[i] ?? from[i]) as FillResolved[]
    out.push(fillOps.lerp(a, b, t))
  }
  return out
}

/**
 * The stroke for series `index`: the palette's entry at `index % palette.length`,
 * with the series' own `fill`, if set, replacing just the topmost layer's colour.
 */
export function resolveSeriesStroke(
  palette: Stroke[],
  series: ChartSeries,
  index: number
): Stroke {
  const entry: Stroke =
    palette.length > 0
      ? palette[index % palette.length]
      : { weight: 4, fill: "white" }
  if (series.fill == null) return entry
  const layers = strokeOps.resolve(entry)
  if (layers.length === 0) return { weight: 4, fill: series.fill }
  const next = [...layers]
  next[next.length - 1] = {
    ...next[next.length - 1],
    fill: fillOps.resolve(series.fill),
  }
  return next
}

/** The colour {@link resolveSeriesStroke} draws series `index` in, for a legend swatch. */
export function resolveSeriesFill(
  palette: Stroke[],
  series: ChartSeries,
  index: number
): Fill {
  const layers = strokeOps.resolve(resolveSeriesStroke(palette, series, index))
  return layers[layers.length - 1]?.fill ?? "white"
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
