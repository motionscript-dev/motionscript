/**
 * The vocabulary every chart node shares: what a *series* is, how an axis is
 * scaled and formatted, and the theme leaves each chart's own theme is assembled
 * from.
 *
 * This module exists because the three chart types are three ways of drawing the
 * same table. A line chart, a bar chart and a pie chart disagree about almost
 * everything visible — polylines against columns against wedges — and agree
 * about almost everything underneath: a series is a column with a caption and a
 * paint, a marker is a number formatted one way, a legend is a swatch beside a
 * label, and a theme is a tree of paints with one mapper and one tween. Writing
 * that three times would mean three answers to "how does a chart round its axis"
 * within one app.
 *
 * Kept renderer-agnostic (no `Node` imports) so a host's own inspector
 * mappings can build a partial theme without pulling the components in.
 *
 * **Two conventions run through every resolver and lerp below**, inherited from
 * the shape system's `resolveStroke`/`resolveShadow`:
 *
 * - A **mapper** merges the author's loose, partial input onto a `previous`
 *   resolved value and resolves every leaf, so the tween always has resolved
 *   data to interpolate. It is idempotent.
 * - A **tween** interpolates two resolved values leaf by leaf. Categorical
 *   fields (`fontFamily`, `textAlign`) and fields that are `undefined` on either
 *   side **step at the midpoint**, because there is no meaningful in-between and
 *   defaulting the missing side to 0 would animate a font weight down to nothing
 *   on the way to "unset".
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

/**
 * One series of a chart: a column of the table, captioned and painted.
 *
 * `field` names the column carrying this series' values. What that becomes is
 * the chart's business — a traced polyline, a column of bars, a wedge — but the
 * three questions asked of it are the same everywhere: which column, what to
 * call it, what to paint it, and whether it is currently drawn.
 *
 * `fill` is an **override**: omit it and the series takes the theme palette's
 * entry for its own index, which is what makes a chart nobody has themed come
 * out in five distinct colours rather than five identical ones.
 */
export interface ChartSeries {
  /** Key into each data row for this series' value. */
  field: string
  /** Legend caption for this series. */
  label: string
  /**
   * Paint override for this series' mark and its legend swatch. Omit to take
   * the theme palette's entry for this series' index.
   */
  fill?: Fill
  /** Whether the series shows by default. Defaults to `true`. */
  enabled?: boolean
}

/** A `[min, max]` numeric range in data units. */
export type Range = [min: number, max: number]

/**
 * One axis's *data* domain — what it shows — as opposed to {@link AxisConfig},
 * which is how it's *styled*. Every field is optional: `range`/`ticks` derive
 * from the plotted data when omitted, and `label` defaults to `""`.
 */
export interface AxisDomainConfig {
  /** Caption drawn alongside the axis. Pass `""` (the default) to hide it. */
  label?: string
  /** `[min, max]` of the scale. Derived from the data bounds when omitted. */
  range?: Range
  /** Tick values (in data units). Derived (five evenly-spaced) when omitted. */
  ticks?: number[]
  /**
   * How a tick value is written down — a `number-format` pattern such as
   * `#,##0.00` or `$#,##0`.
   *
   * Here rather than in {@link AxisConfig} because it is a statement about the
   * *numbers*, not about the ink they are set in: `$` on a revenue axis says
   * what the column holds, and it has to survive a re-theme. It sits beside
   * `range` and `ticks` for the same reason those do.
   */
  format?: string
}

/**
 * An axis domain entry's resolve: merges the author's partial input onto
 * `previous`, so a later partial `.set({ yAxis: {...} })` patches
 * `label`/`range`/`ticks` independently. `range`/`ticks` staying `undefined`
 * after the merge is the auto-derive signal the scale getters read.
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
 * An axis domain entry's lerp: interpolates `range`/`ticks` numerically
 * (pairwise by index for `ticks`), so a `to` command that restates a range
 * rescales the plot smoothly. `label`, and either field when one side is in
 * auto-derive mode, step at the midpoint.
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
    // Steps at the midpoint with the caption, for the same reason: there is no
    // halfway between `$#,##0` and `0.0%`.
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
 * Where a generic `to()` of an axis domain should land, given the domain as it
 * is *drawn* (`drawn`, with `range` and `ticks` resolved off the data), or
 * `undefined` when the request states neither a `range` nor `ticks` and the
 * plain property tween will do.
 *
 * The stored domain of an auto axis has no `range` and no `ticks`, and
 * {@link lerpAxisDomain} steps an unset side at the midpoint, so tweening the
 * stored value from an auto axis is a cut. The charts therefore tween between
 * resolved domains, as their zoom does; this builds the destination. A `range`
 * given without `ticks` keeps the tick *count* the axis already draws, so each
 * marker slides from its old value to its new one instead of the row popping.
 */
export function axisTweenTarget(
  drawn: AxisDomainConfig,
  requested: AxisDomainConfig | undefined
): AxisDomainConfig | undefined {
  if (requested?.range === undefined && requested?.ticks === undefined) return undefined
  const target = resolveAxisDomain(requested, drawn)
  if (requested.ticks === undefined && requested.range !== undefined) {
    const count = Math.max(2, drawn.ticks?.length ?? 2)
    target.ticks = markerValues(requested.range, count - 1)
  }
  return target
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
 * A chart's axis entry tween: what `to({ yAxis: { range } })` moves through.
 * Between two explicit domains it is {@link lerpAxisDomain}, and a restated
 * `range` without `ticks` spreads explicit ticks across it, keeping their count.
 * When either end leaves `range` or `ticks` to the data, the value between is an
 * {@link AxisDomainBlend}, which the chart draws as the blend of what each end
 * draws: a rescale from an auto axis is continuous, not a cut at the midpoint.
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

/**
 * `domain` as the chart draws it: `drawn` resolves a plain domain's auto `range`
 * and `ticks` off the data, and a blend is the lerp of what its two ends draw.
 */
export function settleAxisDomain(domain: AxisDomainConfig, drawn: (domain: AxisDomainConfig) => AxisDomainConfig): AxisDomainConfig {
  const blend = blendOf(domain)
  if (!blend) return drawn(domain)
  return lerpAxisDomain(settleAxisDomain(blend.from, drawn), settleAxisDomain(blend.to, drawn), blend.t)
}

/**
 * The low-level colour tokens the default themes are built from — a dark plot
 * panel with warm-grey axis furniture.
 */
export const CHART_PALETTE = {
  /** Fill of the plot panel behind the marks. */
  plotFill: "#15130e",
  /** Colour of the plot's thick border. */
  borderColor: "#4a4036",
  /** Colour of the faint grid lines spanning the plot. */
  gridColor: "#2c2820",
  /** Colour of the numeric axis markers, axis captions, and legend labels. */
  markerColor: "#8a7f70",
  /** Colour of a spotlit region's dashed rules and its wash. */
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

/**
 * Opacity an *un*-spotlighted series fades to — its mark and its legend entry
 * alike, so the two dim together.
 */
export const SPOTLIGHT_DIM = 0.2

/** Clamp a number into `[0, 1]` — the range every reveal signal here runs in. */
export function clampUnit(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value
}

// ---- Row readers ---------------------------------------------------------

/**
 * Read a numeric field off a row, defaulting missing, non-numeric and non-finite
 * values to 0.
 *
 * A column left as strings silently plots as 0, which is why the CSV parser's
 * numeric auto-coercion matters — a quoted or unit-suffixed column won't plot
 * until it's coerced.
 */
export function num(row: DataRecord, field: string | undefined): number {
  if (field === undefined) return 0
  const v = row[field]
  // A `NaN` or infinite cell is no more a measurement than a missing one: read
  // as 0, it cannot poison the scale and turn every point into `NaN`.
  return typeof v === "number" && Number.isFinite(v) ? v : 0
}

/**
 * Read a field off a row as its caption — the counterpart to {@link num} for
 * the columns a chart *names* things by rather than measures them by (a bar's
 * category, a wedge's slice). A missing cell reads as empty rather than as the
 * string `"undefined"`.
 */
export function text(row: DataRecord, field: string | undefined): string {
  if (field === undefined || field === "") return ""
  const v = row[field]
  return v === undefined || v === null ? "" : String(v)
}

/**
 * Every column that holds numbers across `data`, in header order, skipping the
 * names in `exclude` (typically the category column).
 *
 * A column counts as numeric only if every non-empty cell in it is a number, so
 * a stray text cell leaves the column out rather than plotting zeros. This is
 * what lets a chart plot "every other column" without the author naming twenty
 * fields.
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

// ---- Theme branches ------------------------------------------------------

/** One axis's (x or y) style vocabulary. */
export interface AxisConfig {
  /** Style of each marker along the axis. */
  labelStyle: TextStyle
  /** Style of the axis caption. */
  titleStyle: TextStyle
  /**
   * This axis's direction of the plot's internal grid — weight+fill honoured,
   * dash/cap/join ignored (grid lines are drawn as filled rects).
   */
  lineStyle: Stroke
  /**
   * Gap between the plot and the marker row. Only the side facing the plot is
   * read — `.top` for a horizontal axis, `.right` for a vertical one.
   */
  tickPadding: Insets
  /** Gap between the marker row and the caption, read the same side. */
  titlePadding: Insets
}

/** A legend's per-series colour swatch — a rounded chip, not the caption. */
export interface LegendMarkerConfig {
  width: number
  height: number
  borderRadius: number
  stroke: Stroke
  shadow: Shadow
}

/** A legend's visual theme. */
export interface LegendConfig {
  padding: Insets
  /** Caption style — only the swatch carries the series colour. */
  textStyle: TextStyle
  /** Gap between legend entries. */
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

/** The default styling of a horizontal (marker row beneath the plot) axis. */
export const DEFAULT_X_AXIS: AxisConfig = {
  labelStyle: AXIS_LABEL_STYLE,
  titleStyle: AXIS_TITLE_STYLE,
  lineStyle: AXIS_LINE_STYLE,
  tickPadding: 20,
  titlePadding: 4,
}

/** The default styling of a vertical (marker column beside the plot) axis. */
export const DEFAULT_Y_AXIS: AxisConfig = {
  labelStyle: { ...AXIS_LABEL_STYLE, fontWeight: 500, textAlign: "right" },
  titleStyle: AXIS_TITLE_STYLE,
  lineStyle: AXIS_LINE_STYLE,
  tickPadding: 40,
  titlePadding: 24,
}

/**
 * The default plot panel: **unpainted**, framed. A chart reads against the
 * stage rather than punching a panel into it, which is the look the family was
 * designed at.
 */
export const DEFAULT_PLOT_AREA: PlotAreaConfig = {
  fill: [],
  stroke: { weight: 6, fill: CHART_PALETTE.borderColor },
  shadow: [],
}

/** The default legend styling, shared by every chart that draws one. */
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

/** The default per-series stroke palette — {@link DEFAULT_SERIES_COLORS}, drawn 4px. */
export const DEFAULT_SERIES_STROKES: Stroke[] = DEFAULT_SERIES_COLORS.map(
  (fill) => ({ weight: 4, fill })
)

/** The default per-series fill palette — the same colours, as solid paint. */
export const DEFAULT_SERIES_FILLS: Fill[] = DEFAULT_SERIES_COLORS.map(
  (fill) => fill
)

// ---- Theme branch resolvers ----------------------------------------------
// Each chart type assembles its own theme out of these, so "the axis furniture"
// means one thing across the family and each chart still declares only the
// branches it actually draws.

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

/** A legend theme as the author may state it — every branch optional. */
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

/** A whole-palette override replaces the previous palette outright. */
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

// ---- Per-series paint ----------------------------------------------------

/**
 * The effective stroke for series `index`: the palette's entry at
 * `index % palette.length`, with the series' own `fill`, if set, overriding just
 * the last (topmost) layer's colour.
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

/**
 * The effective *colour* for series `index` — the same colour
 * {@link resolveSeriesStroke} draws its line in — for contexts (a legend
 * swatch) that only need the fill.
 */
export function resolveSeriesFill(
  palette: Stroke[],
  series: ChartSeries,
  index: number
): Fill {
  const layers = strokeOps.resolve(resolveSeriesStroke(palette, series, index))
  return layers[layers.length - 1]?.fill ?? "white"
}

/**
 * The effective paint for mark `index` of a **filled** chart (a bar, a wedge):
 * the series' own `fill` when it carries one, else the palette's entry for its
 * index, cycled.
 *
 * The stroke twin above has to reach inside a stroke to swap one layer's colour;
 * a filled mark has no such geometry wrapped around its paint, so an override is
 * simply the whole answer.
 */
export function resolvePalettePaint(
  palette: Fill[],
  override: Fill | undefined,
  index: number
): Fill {
  if (override != null) return override
  if (palette.length === 0) return "white"
  return palette[index % palette.length]
}

// ---- Scales and formatting -----------------------------------------------


/**
 * Format a marker value: integers plain, otherwise trimmed to one decimal, or to
 * as many as the axis's tick `step` needs to tell neighbouring ticks apart.
 *
 * One decimal is the floor, so a step of 0.1 or more reads exactly as it always
 * has; a finer step (a unit axis ticked every 0.05) gets two, instead of five
 * ticks captioned `0.1 0.1 0.2 0.2 0.3`. Trailing zeros are dropped either way.
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

// Lifted into the engine, because a graph and a diagram want them too — see
// `@motionscript/sdk/component`. Re-exported so a chart, and anything that
// copied one, still reaches them where it always did.
export { niceStep, enterBudget } from "@motionscript/sdk/component"
