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
import { niceStep } from "@motionscript/sdk/component"

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

/** One bar per row, beside its siblings in the category slot or stacked on them: {@link ChartSeries} under the name for what it draws here. */
export type BarSeries = ChartSeries

/**
 * One bar's span in data units. A span rather than a height because both modes
 * fit it, and a negative value just runs the other way with no special case.
 */
export interface BarSpan {
  /** Where the base sits: 0 when grouped, the running total below when stacked. */
  from: number
  to: number
  /** `to - from`, kept for the figure printed on the bar. */
  value: number
}

/**
 * One row's spans, in series order. Stacking is a running sum in listed order,
 * so series 0 sits on the baseline. A zero value still yields a degenerate span,
 * keeping the list index-aligned with the series.
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
 * The series ending a row's stack, which gets the rounded cap; `-1` when the row
 * is all zero. It is the last non-zero series, so a zero one does not take the
 * cap and leave the segment below square.
 */
export function stackCapIndex(row: DataRecord, series: BarSeries[]): number {
  let last = -1
  for (let i = 0; i < series.length; i++) {
    if (num(row, series[i].field) !== 0) last = i
  }
  return last
}

export function barCategories(data: DataRecord[], field: string): string[] {
  return data.map((row) => text(row, field))
}

/**
 * The `[min, max]` of everything drawn, zero always included: a scale starting
 * at 40 draws a column three times its neighbour for a 10% difference. A cropped
 * axis takes an explicit range.
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

/** The explicit `range`, else the data's extent nudged to tidy bounds; `divisions` (one fewer than the marker count) makes the drawn ticks land on them. */
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

/** How the columns are drawn and the slot divided. */
export interface BarStyleConfig {
  /** Radius in px of a column's far-end corners; an interior stacked segment stays square. */
  cornerRadius: number
  /** Fraction of the category slot the bars fill, `[0, 1]`; the rest separates groups. */
  slotFill: number
  /** Gap in px between grouped bars within a slot; ignored when stacked. */
  groupGap: number
  stroke: Stroke
  shadow: Shadow
}

/** A {@link BarChart}'s full, resolved visual theme. */
export interface BarChartConfig {
  /** Cycled by series index; a series' own `fill` replaces its entry outright. */
  seriesFills: Fill[]
  bar: BarStyleConfig
  /** The category axis. */
  xAxis: AxisConfig
  /** The value axis. */
  yAxis: AxisConfig
  plotArea: PlotAreaConfig
  legend: LegendConfig
  /** The figure printed on each column. */
  valueStyle: TextStyle
  /** How far everything outside a spotlit series or category fades. */
  spotlight: { dimOpacity: number }
}

/** The author's partial theme, deep-merged onto {@link DEFAULT_BAR_CHART_THEME}. */
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

export const DEFAULT_BAR_CHART_THEME: BarChartConfig = {
  seriesFills: DEFAULT_SERIES_FILLS,
  bar: {
    cornerRadius: 6,
    slotFill: 0.72,
    groupGap: 6,
    stroke: [],
    shadow: [],
  },
  // Captions rather than numeric markers: less weight than the line chart's ticks.
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

/** The `theme` entry's resolve: merges a partial {@link BarChartTheme} onto `previous` (first resolution: the default). */
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

/** Series `index`'s own `fill`, else the palette's entry. */
export function resolveBarFill(
  palette: Fill[],
  series: BarSeries,
  index: number
): Fill {
  if (series.fill != null) return fillOps.resolve(series.fill)
  if (palette.length === 0) return "white"
  return palette[index % palette.length]
}
