/**
 * Types and pure helpers specific to the {@link BarChart} family: how a row's
 * values become the spans its columns cover, how the value axis is scaled around
 * them, and the theme the bars add to the shared chart vocabulary.
 *
 * Everything a line or a pie chart would want too — what a series is, the axis
 * domain model, the theme leaf resolvers, the legend and plot-panel branches —
 * lives in `../kit/shared.ts` and is imported here.
 *
 * Kept renderer-agnostic (no `Node` imports) so a host's inspector mapping
 * can build a partial {@link BarChartTheme} without
 * pulling the components in.
 */

import {
  fillOps,
  lerpNumber,
  shadowOps,
  strokeOps,
  textOps,
  type DataRecord,
  type Fill,
  type Shadow,
  type ShadowResolved,
  type Stroke,
  type StrokeResolved,
  type TextStyle,
} from "@motionscript/sdk"

import {
  CHART_PALETTE,
  DEFAULT_LEGEND,
  DEFAULT_PLOT_AREA,
  DEFAULT_SERIES_FILLS,
  DEFAULT_X_AXIS,
  DEFAULT_Y_AXIS,
  SPOTLIGHT_DIM,
  lerpAxisConfig,
  lerpLegendConfig,
  lerpPlotArea,
  lerpSeriesFills,
  niceStep,
  num,
  resolveAxisConfig,
  resolveLegendConfig,
  resolvePlotArea,
  resolveSeriesFills,
  text,
  type AxisConfig,
  type ChartSeries,
  type LegendConfig,
  type LegendTheme,
  type PlotAreaConfig,
  type Range,
} from "../kit/shared"

/**
 * One series in a {@link BarChart}: a column of the table drawn as one bar per
 * row — side by side with its siblings within each category's slot, or stacked
 * on top of them.
 *
 * The family-wide {@link ChartSeries} under a name that says what it draws here.
 */
export type BarSeries = ChartSeries

/**
 * One drawn bar's span in **data units**: the value its base sits at and the
 * value its far end reaches.
 *
 * A span rather than a height because that is the one shape both modes fit. A
 * grouped bar runs from zero to its value; a stacked segment runs from the
 * running total below it to that total plus its own value. Negative values fall
 * out of the same arithmetic — the span simply runs the other way — so a chart
 * with a loss in it needs no special case, only a baseline that isn't the floor.
 */
export interface BarSpan {
  /** Value the bar's base sits at — 0 when grouped, the running total when stacked. */
  from: number
  /** Value its far end reaches. */
  to: number
  /** The value this bar plots — `to - from`, kept for the figure printed on it. */
  value: number
}

/**
 * The spans one row's bars cover, one per series, in series order.
 *
 * Stacking is a running sum in the order the series are listed, which is also
 * the order they're drawn: series 0 sits on the baseline and each later one
 * rides on what's below it. A zero-valued series still yields a (degenerate)
 * span so the returned list stays index-aligned with the series list.
 */
export function barSpans(
  row: DataRecord,
  series: BarSeries[],
  stacked: boolean
): BarSpan[] {
  let running = 0
  return series.map((s) => {
    const value = num(row, s.field)
    if (!stacked) return { from: 0, to: value, value }
    const from = running
    running += value
    return { from, to: running, value }
  })
}

/**
 * The index of the series whose segment ends a row's stack — the one that gets
 * the rounded cap, so a stack reads as one capped column rather than a pile of
 * separate boxes. `-1` when every value in the row is zero.
 *
 * Read off the *last non-zero* series rather than the last one listed, so a
 * series that happens to be 0 in this row doesn't take the cap and leave the
 * segment below it square.
 */
export function stackCapIndex(row: DataRecord, series: BarSeries[]): number {
  let last = -1
  for (let i = 0; i < series.length; i++) {
    if (num(row, series[i].field) !== 0) last = i
  }
  return last
}

/** The captions beneath the baseline: one per row, read off the category column. */
export function barCategories(data: DataRecord[], field: string): string[] {
  return data.map((row) => text(row, field))
}

/**
 * The `[min, max]` of everything the chart draws, **zero always included**.
 *
 * Zero is in the range whatever the data says, because a bar chart's baseline is
 * zero: a scale starting at 40 draws a column three times its neighbour for a
 * 10% difference, which is the classic way to lie with one. A chart that really
 * does want a cropped axis says so with an explicit range.
 */
export function barValueExtent(
  data: DataRecord[],
  series: BarSeries[],
  stacked: boolean
): Range {
  let lo = 0
  let hi = 0
  for (const row of data) {
    for (const span of barSpans(row, series, stacked)) {
      lo = Math.min(lo, span.from, span.to)
      hi = Math.max(hi, span.from, span.to)
    }
  }
  return lo < hi ? [lo, hi] : [0, 1]
}

/**
 * Effective value scale: the explicit `range`, else the data's extent nudged out
 * to tidy step bounds so the markers read as round numbers.
 *
 * `divisions` is how many segments the auto-range is stepped into (one fewer
 * than the marker count), so the ticks the axis draws land on the bounds this
 * picks.
 */
export function resolveBarScale(
  data: DataRecord[],
  series: BarSeries[],
  stacked: boolean,
  range: Range | undefined,
  divisions: number
): Range {
  if (range) return range
  const [lo, hi] = barValueExtent(data, series, stacked)
  const segments = Math.max(1, Math.round(divisions))
  const step = niceStep((hi - lo) / segments || 1)
  return [Math.floor(lo / step) * step, Math.ceil(hi / step) * step]
}

// ---- Theme ---------------------------------------------------------------

/** How the columns themselves are drawn and how the slot is divided up. */
export interface BarStyleConfig {
  /**
   * Radius of a column's far-end corners, in px. Only the outer end rounds — an
   * interior stacked segment stays square, so the stack reads as one column.
   */
  cornerRadius: number
  /**
   * Fraction of its category's slot the bars fill, `[0, 1]`. The remainder is
   * the channel between one category and the next, which is what makes a bar
   * chart read as groups rather than as a solid block.
   */
  slotFill: number
  /** Gap between the grouped bars *within* one slot, in px. Ignored when stacked. */
  groupGap: number
  /** Optional outline on every column. */
  stroke: Stroke
  /** Optional drop shadow on every column. */
  shadow: Shadow
}

/** A {@link BarChart}'s full, resolved visual theme. */
export interface BarChartConfig {
  /**
   * Default per-series bar paint, cycled by series index (`i % length`). A
   * series' own `fill`, when set, replaces its entry outright.
   */
  seriesFills: Fill[]
  bar: BarStyleConfig
  /** The category axis beneath the baseline. */
  xAxis: AxisConfig
  /** The numeric value axis up the left. */
  yAxis: AxisConfig
  plotArea: PlotAreaConfig
  legend: LegendConfig
  /** The figure printed on each column, when the chart prints them. */
  valueStyle: TextStyle
  /** How far everything *outside* a spotlit series or category fades. */
  spotlight: { dimOpacity: number }
}

/** Author-facing partial theme — every branch optional and deep-merged. */
export type BarChartTheme = {
  seriesFills?: Fill[]
  bar?: Partial<BarStyleConfig>
  xAxis?: Partial<AxisConfig>
  yAxis?: Partial<AxisConfig>
  plotArea?: Partial<PlotAreaConfig>
  legend?: LegendTheme
  valueStyle?: TextStyle
  spotlight?: Partial<BarChartConfig["spotlight"]>
}

/** The bar chart's out-of-the-box look. */
export const DEFAULT_BAR_CHART_THEME: BarChartConfig = {
  seriesFills: DEFAULT_SERIES_FILLS,
  bar: {
    cornerRadius: 6,
    slotFill: 0.72,
    groupGap: 6,
    stroke: [],
    shadow: [],
  },
  // A category axis names its slots, so its captions are set like a caption
  // rather than like a numeric marker: same size, less weight than the line
  // chart's ticks, and centred on the slot.
  xAxis: {
    ...DEFAULT_X_AXIS,
    labelStyle: { ...DEFAULT_X_AXIS.labelStyle, fontWeight: 600 },
    tickPadding: 16,
  },
  yAxis: DEFAULT_Y_AXIS,
  plotArea: DEFAULT_PLOT_AREA,
  legend: DEFAULT_LEGEND,
  valueStyle: {
    fontSize: 24,
    fontWeight: 700,
    textAlign: "center",
    fill: CHART_PALETTE.markerColor,
  },
  spotlight: { dimOpacity: SPOTLIGHT_DIM },
}

function resolveBarStyle(
  bar: Partial<BarStyleConfig> | undefined,
  previous: BarStyleConfig
): BarStyleConfig {
  return {
    cornerRadius: bar?.cornerRadius ?? previous.cornerRadius,
    slotFill: bar?.slotFill ?? previous.slotFill,
    groupGap: bar?.groupGap ?? previous.groupGap,
    stroke: strokeOps.resolve(bar?.stroke ?? previous.stroke),
    shadow: shadowOps.resolve(bar?.shadow ?? previous.shadow),
  }
}

function lerpBarStyle(
  from: BarStyleConfig,
  to: BarStyleConfig,
  t: number
): BarStyleConfig {
  return {
    cornerRadius: lerpNumber(from.cornerRadius, to.cornerRadius, t),
    slotFill: lerpNumber(from.slotFill, to.slotFill, t),
    groupGap: lerpNumber(from.groupGap, to.groupGap, t),
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

/**
 * {@link BarChart}'s `theme` entry's resolve: merges the author's partial
 * {@link BarChartTheme} onto `previous` (falling back to
 * {@link DEFAULT_BAR_CHART_THEME} on first resolution), fully resolving every
 * leaf so the tween below always has resolved data to interpolate.
 */
export function resolveBarChartTheme(
  theme: BarChartTheme | undefined,
  previous?: BarChartConfig
): BarChartConfig {
  const base = previous ?? DEFAULT_BAR_CHART_THEME
  return {
    seriesFills: resolveSeriesFills(theme?.seriesFills, base.seriesFills),
    bar: resolveBarStyle(theme?.bar, base.bar),
    xAxis: resolveAxisConfig(theme?.xAxis, base.xAxis),
    yAxis: resolveAxisConfig(theme?.yAxis, base.yAxis),
    plotArea: resolvePlotArea(theme?.plotArea, base.plotArea),
    legend: resolveLegendConfig(theme?.legend, base.legend),
    valueStyle: textOps.resolveStyle(theme?.valueStyle, base.valueStyle),
    spotlight: {
      dimOpacity: theme?.spotlight?.dimOpacity ?? base.spotlight.dimOpacity,
    },
  }
}

/** {@link BarChart}'s `theme` entry's lerp — leaf by leaf. */
export function lerpBarChartTheme(
  from: BarChartConfig,
  to: BarChartConfig,
  t: number
): BarChartConfig {
  return {
    seriesFills: lerpSeriesFills(from.seriesFills, to.seriesFills, t),
    bar: lerpBarStyle(from.bar, to.bar, t),
    xAxis: lerpAxisConfig(from.xAxis, to.xAxis, t),
    yAxis: lerpAxisConfig(from.yAxis, to.yAxis, t),
    plotArea: lerpPlotArea(from.plotArea, to.plotArea, t),
    legend: lerpLegendConfig(from.legend, to.legend, t),
    valueStyle: textOps.lerpStyle(from.valueStyle, to.valueStyle, t),
    spotlight: {
      dimOpacity: lerpNumber(
        from.spotlight.dimOpacity,
        to.spotlight.dimOpacity,
        t
      ),
    },
  }
}

/** The paint series `index` is drawn in: its own override, else the palette's entry. */
export function resolveBarFill(
  palette: Fill[],
  series: BarSeries,
  index: number
): Fill {
  if (series.fill != null) return fillOps.resolve(series.fill)
  if (palette.length === 0) return "white"
  return palette[index % palette.length]
}
