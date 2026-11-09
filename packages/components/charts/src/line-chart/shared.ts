/**
 * Types and pure helpers specific to the {@link LineChart} family: the traced
 * polylines, the spotlit region they dim outside of, and the theme those two
 * add to the shared chart vocabulary.
 *
 * Everything a bar or a pie chart would want too — what a series is, how an axis
 * is scaled and formatted, the theme leaf resolvers, the legend and plot-panel
 * branches — lives in `../kit/shared.ts` and is imported here. What's
 * left below is what only a line chart has: points sorted along an x column,
 * a region clipped out of a polyline, and the `region` branch of the theme.
 *
 * Kept renderer-agnostic (no `Node` imports) so every part shares one
 * scale/format/palette/theme vocabulary, and so a host's own inspector
 * mapping can build a partial {@link ChartTheme} without
 * pulling the components in.
 */

import {
  Fills,
  fillOps,
  lerpNumber,
  strokeOps,
  type DataRecord,
  type Fill,
  type FillResolved,
  type Stroke,
  type StrokeResolved,
} from "@motionscript/sdk"

import {
  CHART_PALETTE,
  DEFAULT_LEGEND,
  DEFAULT_PLOT_AREA,
  DEFAULT_SERIES_STROKES,
  DEFAULT_X_AXIS,
  DEFAULT_Y_AXIS,
  SPOTLIGHT_DIM,
  lerpAxisConfig,
  lerpLegendConfig,
  lerpPlotArea,
  lerpSeriesStrokes,
  niceStep,
  num,
  resolveAxisConfig,
  resolveLegendConfig,
  resolvePlotArea,
  resolveSeriesStrokes,
  type AxisConfig,
  type ChartSeries,
  type LegendConfig,
  type LegendTheme,
  type PlotAreaConfig,
  type Range,
} from "../kit/shared"
import type { XScale } from "./x-scale"

/**
 * One series in a {@link LineChart}: a polyline traced through the values in one
 * column of the chart's `data`, drawn in `fill` (or the theme's `seriesStyles`
 * palette when omitted) and captioned by `label` in the legend.
 *
 * The family-wide {@link ChartSeries} under a name that says what it draws here;
 * the chart's own `xField` prop names the column carrying the shared x values,
 * so every series is read off the same rows — one row per sample, one column per
 * series.
 */
export type LineSeries = ChartSeries

// ---- Plot regions -------------------------------------------------------

/**
 * A rectangular slice of the plot, in **data units** — the author-facing input
 * to {@link LineChart.spotlightRegion} / {@link LineChart.zoomTo}.
 *
 * Either axis may be omitted, and that's the point: `{ x: [60, 100] }` is a
 * vertical band spanning the full height, `{ y: [8, 10] }` a horizontal band
 * spanning the full width, and both together a box. A reversed range is read
 * the same as the forward one — a region is a span, not a direction.
 */
export interface PlotRegion {
  /** Horizontal span in x-axis data units. Omit to span the full plot width. */
  x?: Range
  /** Vertical span in y-axis data units. Omit to span the full plot height. */
  y?: Range
}

/**
 * A {@link PlotRegion} resolved into the plot's **centred pixel space** (origin
 * at the plot centre, y-up) — the same local frame the series points live in,
 * so a line can be clipped against it directly.
 *
 * `xBounded`/`yBounded` carry which axes the author actually constrained: an
 * unbounded axis has its edges pinned to the plot's own and draws no rule.
 */
export interface RegionBox {
  left: number
  right: number
  bottom: number
  top: number
  /** The author gave an x range — the left/right edges are real data bounds. */
  xBounded: boolean
  /** The author gave a y range — the bottom/top edges are real data bounds. */
  yBounded: boolean
}

/** The empty box, used as the "no region" resting value. */
export const EMPTY_REGION_BOX: RegionBox = {
  left: 0,
  right: 0,
  bottom: 0,
  top: 0,
  xBounded: false,
  yBounded: false,
}

/** Is `box` a real, non-degenerate region — i.e. is there anything to spotlight? */
export function hasRegion(box: RegionBox): boolean {
  return box.right > box.left && box.top > box.bottom
}

/**
 * Resolve a {@link PlotRegion} against the plot's pixel box and the chart's
 * scales. `plot` is the plot rectangle in centred pixel space, and
 * `xScale`/`yScale` the data ranges those edges span.
 *
 * An omitted axis takes the plot's own edges, so the region spans it. A given
 * axis is clamped to the plot, so a range running off the scale still produces
 * a box inside the panel.
 */
export function resolveRegionBox(
  region: PlotRegion | null | undefined,
  plot: { left: number; right: number; bottom: number; top: number },
  xScale: Range,
  yScale: Range
): RegionBox {
  if (!region || (region.x === undefined && region.y === undefined)) {
    return EMPTY_REGION_BOX
  }

  const span = (
    range: Range | undefined,
    [min, max]: Range,
    lo: number,
    hi: number
  ): [number, number, boolean] => {
    if (range === undefined || max <= min) return [lo, hi, false]
    const a = Math.min(range[0], range[1])
    const b = Math.max(range[0], range[1])
    const toPx = (v: number) => lo + ((v - min) / (max - min)) * (hi - lo)
    return [
      Math.max(lo, Math.min(hi, toPx(a))),
      Math.max(lo, Math.min(hi, toPx(b))),
      true,
    ]
  }

  const [left, right, xBounded] = span(region.x, xScale, plot.left, plot.right)
  const [bottom, top, yBounded] = span(region.y, yScale, plot.bottom, plot.top)
  return { left, right, bottom, top, xBounded, yBounded }
}

/** A bare `{x, y}` — declared locally so this module stays free of node imports. */
interface Vector2Like {
  x: number
  y: number
}

/**
 * The parts of `points` that fall **inside** `box`, as a list of contiguous
 * sub-polylines — the geometry behind the region spotlight: a series is drawn
 * dimmed in full, then these runs are re-drawn over it at full strength.
 *
 * Segments are clipped against the box rather than filtered by endpoint, so a
 * line entering the region mid-segment is cut exactly on the boundary.
 */
export function clipPolylineToBox(
  points: Vector2Like[],
  box: RegionBox
): Vector2Like[][] {
  if (points.length < 2 || !hasRegion(box)) return []

  const runs: Vector2Like[][] = []
  let run: Vector2Like[] = []

  for (let i = 1; i < points.length; i++) {
    const seg = clipSegment(points[i - 1], points[i], box)
    if (!seg) {
      // Segment misses the box entirely — close whatever run was open.
      if (run.length >= 2) runs.push(run)
      run = []
      continue
    }
    const [a, b] = seg
    // Continue the open run when this clipped segment starts where the last one
    // ended; otherwise the line left the box and came back, which is a new run.
    if (run.length > 0 && samePoint(run[run.length - 1], a)) run.push(b)
    else {
      if (run.length >= 2) runs.push(run)
      run = [a, b]
    }
  }
  if (run.length >= 2) runs.push(run)
  return runs
}

/** Points within half a pixel are the same point, for run-joining purposes. */
function samePoint(a: Vector2Like, b: Vector2Like): boolean {
  return Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5
}

/**
 * Liang–Barsky clip of one segment against the axis-aligned `box`. Returns the
 * surviving `[start, end]`, or `null` when the segment lies wholly outside.
 */
function clipSegment(
  a: Vector2Like,
  b: Vector2Like,
  box: RegionBox
): [Vector2Like, Vector2Like] | null {
  const dx = b.x - a.x
  const dy = b.y - a.y
  let t0 = 0
  let t1 = 1

  // Each edge as (p, q): the segment survives where p·t <= q.
  const edges: [number, number][] = [
    [-dx, a.x - box.left],
    [dx, box.right - a.x],
    [-dy, a.y - box.bottom],
    [dy, box.top - a.y],
  ]
  for (const [p, q] of edges) {
    if (p === 0) {
      // Parallel to this edge: outside it means the whole segment is out.
      if (q < 0) return null
      continue
    }
    const r = q / p
    if (p < 0) {
      if (r > t1) return null
      if (r > t0) t0 = r
    } else {
      if (r < t0) return null
      if (r < t1) t1 = r
    }
  }
  return [
    { x: a.x + t0 * dx, y: a.y + t0 * dy },
    { x: a.x + t1 * dx, y: a.y + t1 * dy },
  ]
}

// ---- Theme ---------------------------------------------------------------

/**
 * How a spotlit {@link PlotRegion} is drawn — the dashed rules on its bounded
 * edges, the wash filling it, and how far the series fade outside it.
 */
export interface RegionConfig {
  /** The dashed rule marking each bounded edge. */
  stroke: Stroke
  /** Wash filling the region, drawn under the series lines. */
  fill: Fill
  /** Opacity the stretch of every series *outside* the region fades to. */
  dimOpacity: number
}

/** A {@link LineChart}'s full, resolved visual theme. */
export interface ChartConfig {
  /**
   * Default per-series line stroke, cycled by series index (`i % length`). A
   * series' own `fill`, when set, overrides just the colour.
   */
  seriesStyles: Stroke[]
  xAxis: AxisConfig
  yAxis: AxisConfig
  /** The plot panel: border, fill, and drop shadow. */
  plotArea: PlotAreaConfig
  legend: LegendConfig
  /** The spotlit-region annotation — see {@link RegionConfig}. */
  region: RegionConfig
}

/**
 * Author-facing partial theme, passed as {@link LineChart}'s `theme` prop —
 * every branch optional and deep-merged onto {@link DEFAULT_CHART_THEME}.
 */
export type ChartTheme = {
  seriesStyles?: Stroke[]
  xAxis?: Partial<AxisConfig>
  yAxis?: Partial<AxisConfig>
  plotArea?: Partial<PlotAreaConfig>
  legend?: LegendTheme
  region?: Partial<RegionConfig>
}

/**
 * The legend of a line chart: the shared one, with a small rounded-square
 * swatch in place of the wide chip. A bar's or a wedge's swatch stands in for
 * an area of paint and is drawn like one; a line's stands in for a colour, and
 * a square reads as the sample it is.
 */
const LINE_CHART_LEGEND: LegendConfig = {
  ...DEFAULT_LEGEND,
  markerStyle: {
    ...DEFAULT_LEGEND.markerStyle,
    width: 20,
    height: 20,
    borderRadius: 6,
  },
}

/** The chart's out-of-the-box look. */
export const DEFAULT_CHART_THEME: ChartConfig = {
  seriesStyles: DEFAULT_SERIES_STROKES,
  xAxis: DEFAULT_X_AXIS,
  yAxis: DEFAULT_Y_AXIS,
  plotArea: DEFAULT_PLOT_AREA,
  legend: LINE_CHART_LEGEND,
  region: {
    // Brighter than the grid and dashed, so the boundary reads as a call-out
    // rather than another axis line; `butt` caps keep the dash lengths exact.
    stroke: {
      weight: 3,
      fill: CHART_PALETTE.regionColor,
      dash: [14, 12],
      cap: "butt",
    },
    // A wash barely above the panel — enough to tint the band, not enough to
    // mute the series drawn over it.
    fill: Fills.color(CHART_PALETTE.regionColor, { opacity: 0.08 }),
    dimOpacity: SPOTLIGHT_DIM,
  },
}

function resolveRegionConfig(
  region: Partial<RegionConfig> | undefined,
  previous: RegionConfig
): RegionConfig {
  return {
    stroke: strokeOps.resolve(region?.stroke ?? previous.stroke),
    fill: fillOps.resolve(region?.fill ?? previous.fill),
    dimOpacity: region?.dimOpacity ?? previous.dimOpacity,
  }
}

function lerpRegionConfig(
  from: RegionConfig,
  to: RegionConfig,
  t: number
): RegionConfig {
  return {
    stroke: strokeOps.lerp(
      from.stroke as StrokeResolved[],
      to.stroke as StrokeResolved[],
      t
    ),
    fill: fillOps.lerp(
      from.fill as FillResolved[],
      to.fill as FillResolved[],
      t
    ),
    dimOpacity: lerpNumber(from.dimOpacity, to.dimOpacity, t),
  }
}

/**
 * {@link LineChart}'s `theme` entry's resolve: merges the author's partial
 * {@link ChartTheme} onto `previous` (falling back to
 * {@link DEFAULT_CHART_THEME} on first resolution), fully resolving every leaf.
 */
export function resolveChartTheme(
  theme: ChartTheme | undefined,
  previous?: ChartConfig
): ChartConfig {
  const base = previous ?? DEFAULT_CHART_THEME
  return {
    seriesStyles: resolveSeriesStrokes(theme?.seriesStyles, base.seriesStyles),
    xAxis: resolveAxisConfig(theme?.xAxis, base.xAxis),
    yAxis: resolveAxisConfig(theme?.yAxis, base.yAxis),
    plotArea: resolvePlotArea(theme?.plotArea, base.plotArea),
    legend: resolveLegendConfig(theme?.legend, base.legend),
    region: resolveRegionConfig(theme?.region, base.region),
  }
}

/** {@link LineChart}'s `theme` entry's lerp — leaf by leaf. */
export function lerpChartTheme(
  from: ChartConfig,
  to: ChartConfig,
  t: number
): ChartConfig {
  return {
    seriesStyles: lerpSeriesStrokes(from.seriesStyles, to.seriesStyles, t),
    xAxis: lerpAxisConfig(from.xAxis, to.xAxis, t),
    yAxis: lerpAxisConfig(from.yAxis, to.yAxis, t),
    plotArea: lerpPlotArea(from.plotArea, to.plotArea, t),
    legend: lerpLegendConfig(from.legend, to.legend, t),
    region: lerpRegionConfig(from.region, to.region, t),
  }
}

// ---- Scales --------------------------------------------------------------

/**
 * Resolve one series' `[x, y]` points out of the chart's rows: each row's
 * position on the {@link XScale} paired with its own `field` column, sorted
 * along x so the polyline traces left-to-right whatever order the rows arrived
 * in.
 *
 * A row missing its y column contributes a 0 rather than a gap — these charts
 * draw continuous lines, so dropping the point would silently bridge the hole.
 *
 * Takes the resolved scale rather than the column *name*, because what a row's x
 * is depends on what kind of column it came out of: a number, an instant, or a
 * place in the file. See `x-scale.ts`.
 */
export function seriesPoints(
  data: DataRecord[],
  x: XScale,
  series: LineSeries
): [x: number, y: number][] {
  return data
    .map((row, i): [number, number] => [x.at(i), num(row, series.field)])
    .sort((a, b) => a[0] - b[0])
}

/** Min/max across every series' column, the fallback when unset. */
export function yExtent(data: DataRecord[], series: LineSeries[]): Range {
  let lo = Infinity
  let hi = -Infinity
  for (const row of data)
    for (const s of series) {
      const v = num(row, s.field)
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
  return lo <= hi ? [lo, hi] : [0, 1]
}

/**
 * Effective vertical scale: the explicit `range`, else the data's y extent
 * nudged out to tidy step bounds so markers read as round numbers.
 *
 * `divisions` is how many segments the auto-range is stepped into (one fewer
 * than a marker count) — it only shapes the tidy step when `range` is omitted.
 */
export function resolveYScale(
  data: DataRecord[],
  series: LineSeries[],
  range: Range | undefined,
  divisions: number
): Range {
  if (range) return range
  const [lo, hi] = yExtent(data, series)
  const segments = Math.max(1, Math.round(divisions))
  if (hi === lo) return constantScale(lo, segments)
  const step = niceStep((hi - lo) / segments)
  return [Math.floor(lo / step) * step, Math.ceil(hi / step) * step]
}

/**
 * The scale for data that never moves. A zero-width scale puts every tick on the
 * same value and the line on the plot's floor, so it is widened to a few steps
 * either side of the value (the step sized to its magnitude, so `5` gets
 * `[3, 7]` and `5000` gets `[3000, 7000]`), or to `[0, 1]` for all zeros, as for
 * no data at all.
 */
function constantScale(value: number, segments: number): Range {
  if (value === 0) return [0, 1]
  const step = niceStep(Math.abs(value) / segments)
  return [value - step, value + step]
}
