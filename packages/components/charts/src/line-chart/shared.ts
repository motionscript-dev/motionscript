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
  type Vector2,
} from "@motionscript/sdk"
import { niceStep } from "@motionscript/sdk/component"

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

/** One polyline of a {@link LineChart}: {@link ChartSeries} under the name for what it draws here. */
export type LineSeries = ChartSeries

/**
 * A rectangular slice of the plot in data units, the input to `spotlightRegion`
 * and `zoomTo`. Either axis may be omitted: `{ x: [60, 100] }` is a full-height
 * band. A reversed range reads the same as a forward one.
 */
export interface PlotRegion {
  /** Omit to span the full plot width. */
  x?: Range
  /** Omit to span the full plot height. */
  y?: Range
}

/**
 * A {@link PlotRegion} in the plot's centred pixel space (origin at the centre,
 * y-up), the frame the series points live in. An axis the author left unbounded
 * has its edges pinned to the plot's own and draws no rule.
 */
export interface RegionBox {
  left: number
  right: number
  bottom: number
  top: number
  xBounded: boolean
  yBounded: boolean
}

/** The "no region" resting value. */
export const EMPTY_REGION_BOX: RegionBox = {
  left: 0,
  right: 0,
  bottom: 0,
  top: 0,
  xBounded: false,
  yBounded: false,
}

/** Whether `box` is non-degenerate, so there is something to spotlight. */
export function hasRegion(box: RegionBox): boolean {
  return box.right > box.left && box.top > box.bottom
}

/**
 * Resolve a {@link PlotRegion} against the plot rectangle (centred pixel space)
 * and the data ranges its edges span. An omitted axis takes the plot's own
 * edges; a given one is clamped to the plot.
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

/**
 * The parts of `points` inside `box`, as contiguous sub-polylines: a series is
 * drawn dimmed in full, then these runs are re-drawn at full strength. Segments
 * are clipped, not filtered by endpoint, so a line entering mid-segment is cut
 * exactly on the boundary.
 */
export function clipPolylineToBox(
  points: Vector2[],
  box: RegionBox
): Vector2[][] {
  if (points.length < 2 || !hasRegion(box)) return []

  const runs: Vector2[][] = []
  let run: Vector2[] = []

  for (let i = 1; i < points.length; i++) {
    const seg = clipSegment(points[i - 1], points[i], box)
    if (!seg) {
      // Misses the box: close the open run.
      if (run.length >= 2) runs.push(run)
      run = []
      continue
    }
    const [a, b] = seg
    // Continues the open run if it starts where the last ended; otherwise the line left and came back.
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
function samePoint(a: Vector2, b: Vector2): boolean {
  return Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5
}

/** Liang-Barsky clip of one segment against `box`: the surviving `[start, end]`, or `null` when wholly outside. */
function clipSegment(
  a: Vector2,
  b: Vector2,
  box: RegionBox
): [Vector2, Vector2] | null {
  const dx = b.x - a.x
  const dy = b.y - a.y
  let t0 = 0
  let t1 = 1

  // Each edge as (p, q): the segment survives where p*t <= q.
  const edges: [number, number][] = [
    [-dx, a.x - box.left],
    [dx, box.right - a.x],
    [-dy, a.y - box.bottom],
    [dy, box.top - a.y],
  ]
  for (const [p, q] of edges) {
    if (p === 0) {
      // Parallel to this edge: outside it, the whole segment is out.
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

/** How a spotlit {@link PlotRegion} is drawn: rules on its bounded edges, a wash, and how far series fade outside it. */
export interface RegionConfig {
  /** Marks each bounded edge. */
  stroke: Stroke
  /** Drawn under the series lines. */
  fill: Fill
  /** Opacity the stretch of every series outside the region fades to. */
  dimOpacity: number
}

/** A {@link LineChart}'s full, resolved visual theme. */
export interface ChartConfig {
  /** Cycled by series index; a series' own `fill` overrides just the colour. */
  seriesStyles: Stroke[]
  xAxis: AxisConfig
  yAxis: AxisConfig
  plotArea: PlotAreaConfig
  legend: LegendConfig
  region: RegionConfig
}

/** The author's partial theme, deep-merged onto {@link DEFAULT_CHART_THEME}. */
export type ChartTheme = {
  seriesStyles?: Stroke[]
  xAxis?: Partial<AxisConfig>
  yAxis?: Partial<AxisConfig>
  plotArea?: Partial<PlotAreaConfig>
  legend?: LegendTheme
  region?: Partial<RegionConfig>
}

/** The shared legend with a small square swatch: a line's swatch stands for a colour, where a bar's or wedge's stands for an area of paint. */
const LINE_CHART_LEGEND: LegendConfig = {
  ...DEFAULT_LEGEND,
  markerStyle: {
    ...DEFAULT_LEGEND.markerStyle,
    width: 20,
    height: 20,
    borderRadius: 6,
  },
}

export const DEFAULT_CHART_THEME: ChartConfig = {
  seriesStyles: DEFAULT_SERIES_STROKES,
  xAxis: DEFAULT_X_AXIS,
  yAxis: DEFAULT_Y_AXIS,
  plotArea: DEFAULT_PLOT_AREA,
  legend: LINE_CHART_LEGEND,
  region: {
    // Brighter and dashed so it reads as a call-out, not an axis line; `butt` caps keep dash lengths exact.
    stroke: {
      weight: 3,
      fill: CHART_PALETTE.regionColor,
      dash: [14, 12],
      cap: "butt",
    },
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

/** The `theme` entry's resolve: merges a partial {@link ChartTheme} onto `previous` (first resolution: the default). */
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

/**
 * One series' `[x, y]` points, sorted along x so the polyline traces left to
 * right. A row missing its y contributes 0 rather than a gap, since dropping it
 * would silently bridge the hole.
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
 * The explicit `range`, else the data's y extent nudged out to tidy step bounds.
 * `divisions` (one fewer than the marker count) only shapes the step when
 * `range` is omitted.
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
 * The scale for constant data. A zero-width scale would put every tick on one
 * value and the line on the floor, so it widens by a step sized to the
 * magnitude (`5` gets `[3, 7]`), or `[0, 1]` for zero.
 */
function constantScale(value: number, segments: number): Range {
  if (value === 0) return [0, 1]
  const step = niceStep(Math.abs(value) / segments)
  return [value - step, value + step]
}
