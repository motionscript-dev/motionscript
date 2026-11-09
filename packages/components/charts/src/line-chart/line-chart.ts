import {
  Rect,
  Types,
  component2d,
  easeOut,
  type ChildView,
  type DataRecord,
  type EntryOptions,
  type NodeOf,
  // Named so this component's emitted type reaches `Node2D` through the sdk, not core.
  type Node2D,
  type Node2DProps,
  type Size2D,
  type Timeline,
  type Vector2,
} from "@motionscript/sdk"
import { formatNumber } from "@motionscript/sdk/component"

import { cartesianFrame, cartesianViews, laidOutSize } from "../kit/cartesian"
import { ChartBorder } from "../kit/chart-border"
import { ChartCanvas } from "../kit/chart-canvas"
import { ChartLegend } from "../kit/chart-legend"
import { asParts, fresh } from "../kit/entries"
import { beats, type Beat } from "../kit/motion"
import { VerticalAxis } from "../kit/vertical-axis"
import {
  SPOTLIGHT_DIM,
  formatMarker,
  lerpAxisDomain,
  lerpAxisEntry,
  markerStep,
  markerValues,
  resolveAxisDomain,
  resolveSeriesFill,
  resolveSeriesStroke,
  settleAxisDomain,
  type AxisDomainConfig,
  type Range,
} from "../kit/shared"
import { ChartLine } from "./chart-line"
import { ChartRegion } from "./chart-region"
import { HorizontalAxis } from "./horizontal-axis"
import {
  DEFAULT_CHART_THEME,
  lerpChartTheme,
  resolveChartTheme,
  resolveRegionBox,
  resolveYScale,
  seriesPoints,
  type ChartConfig,
  type ChartTheme,
  type LineSeries,
  type PlotRegion,
  type RegionBox,
} from "./shared"
import { resolveXScale, type XScale } from "./x-scale"

export interface LineChartProps extends Node2DProps {
  /** One row per sample — a plain record of field name to value. */
  data: DataRecord[]
  /**
   * Key into each row for its x value, shared by every series. Named `xField`
   * rather than `x` because every node already has an `x` — its position.
   */
  xField: string
  /** One polyline per entry: which field it plots, its legend `label`, its `fill`. */
  series: LineSeries[]
  /** X-axis data domain: caption, scale range, and tick placement. */
  xAxis?: AxisDomainConfig
  /** Y-axis data domain: caption, scale range, and tick placement. */
  yAxis?: AxisDomainConfig
  /**
   * A slice of the plot to spotlight, in **data units**. Dashed rules mark the
   * bounded edges and every series fades outside the box — see
   * `spotlightRegion`, which animates the same thing. `null` (the default) is no
   * region.
   */
  region?: PlotRegion | null
  /**
   * The chart's visual theme — series palette, axis text/grid/gutters, plot
   * panel paint, and legend styling. Every branch is optional and deep-merged
   * onto {@link DEFAULT_CHART_THEME}, so pass only what you want to override.
   */
  theme?: ChartTheme
  /** Whether the legend row below the plot is drawn at all. */
  showLegend?: boolean
}

/** Both axes' domains with their ranges and ticks resolved. */
export interface LineChartDomains {
  readonly x: AxisDomainConfig & { readonly range: Range; readonly ticks: number[] }
  readonly y: AxisDomainConfig & { readonly range: Range; readonly ticks: number[] }
}

/** What a line chart plots, as its entries hold it. */
export interface LineChartValues {
  readonly data: DataRecord[]
  readonly xField: string
  readonly series: LineSeries[]
  readonly xAxis: AxisDomainConfig
  readonly yAxis: AxisDomainConfig
}

/**
 * The argument every per-series command takes: an index into `series`. Its own
 * kind rather than `number` so a host can offer the series by name.
 */
const SERIES_ARG = Types.custom<number, number, EntryOptions & { readonly min: number; readonly step: number }>(0, { kind: "series", min: 0, step: 1 })

/** One argument, two controls: the commands take a `PlotRegion`, so the x and y spans a host draws are declared inside it. */
const REGION_ARG = Types.custom<PlotRegion | undefined>(undefined, {
  kind: "region",
  properties: {
    x: { kind: "range", default: true, defaultMin: 0, defaultMax: 100 },
    y: { kind: "range", default: false, defaultMin: 0, defaultMax: 100 },
  },
})

/** How far the legend starts below its slot when it enters, in px. */
const LEGEND_SLIDE = 20

/** Fallback marker count when neither axis's ticks are given. */
const DEFAULT_MARKERS = 5

/**
 * How `enter` divides its duration between its three beats: the axes arriving,
 * the lines tracing, and the legend coming up. Shares of the whole, so they must
 * sum to 1 — the entrance takes exactly the time it was given.
 */
const AXES_SHARE = 0.35
const LINES_SHARE = 0.5
const LEGEND_SHARE = 0.15

/** What the chart's own commands read: its entries, and the private `home` a zoom remembers. */
interface LineState extends LineChartValues {
  readonly theme: ChartConfig
  readonly region: PlotRegion | null
  readonly regionReveal: number
  readonly home: LineChartDomains | null
}

/**
 * What the x column *is* — a number, an instant, or a place in the file — and
 * with it how each row is positioned, ticked and captioned. See `x-scale.ts`.
 */
function columnOf(s: LineChartValues, format = s.xAxis.format): XScale {
  return resolveXScale(s.data, s.xField, format)
}

/**
 * The horizontal axis with its range and ticks resolved: the explicit ones, else
 * the column's extent and five ticks across it, asked of the column because only
 * a numeric one has round numbers between its samples.
 */
function drawnX(s: LineChartValues, domain: AxisDomainConfig): AxisDomainConfig {
  const column = columnOf(s, domain.format)
  const range = domain.range ?? column.extent
  return { ...domain, range, ticks: domain.ticks ?? column.ticks(range, DEFAULT_MARKERS - 1) }
}

/**
 * The vertical axis with its range and ticks resolved. Auto-ranging steps into
 * one fewer segment than the intended marker count, so the tidy bounds frame the
 * ticks the axis draws.
 */
function drawnY(s: LineChartValues, domain: AxisDomainConfig): AxisDomainConfig {
  const divisions = (domain.ticks?.length ?? DEFAULT_MARKERS) - 1
  const range = resolveYScale(s.data, s.series, domain.range, divisions)
  return { ...domain, range, ticks: domain.ticks ?? markerValues(range, DEFAULT_MARKERS - 1) }
}

/** The last domains worked out from each data array, and what else they were read from. */
const domainsDrawn = new WeakMap<
  DataRecord[],
  Pick<LineChartValues, "xField" | "xAxis" | "yAxis" | "series"> & { readonly domains: LineChartDomains }
>()

/** Both axes as a line chart draws them now, an auto range or tick row read back as itself. */
export function lineChartDomains(s: LineChartValues): LineChartDomains {
  const { data, xField, xAxis, yAxis, series } = s
  const kept = domainsDrawn.get(data)
  if (kept && kept.xField === xField && kept.xAxis === xAxis && kept.yAxis === yAxis && kept.series === series) {
    return kept.domains
  }
  const domains = {
    x: settleAxisDomain(xAxis, (d) => drawnX(s, d)) as LineChartDomains["x"],
    y: settleAxisDomain(yAxis, (d) => drawnY(s, d)) as LineChartDomains["y"],
  }
  domainsDrawn.set(data, { xField, xAxis, yAxis, series, domains })
  return domains
}

/**
 * Map one series' data points into the plot's **centred** pixel space (origin at
 * the plot centre, y-up): x runs `[-w/2, +w/2]`, y runs `[-h/2, +h/2]`.
 */
function seriesPixels(s: LineChartValues, domains: LineChartDomains, index: number, plot: Size2D): Vector2[] {
  const series = s.series[index]
  if (!series) return []
  const points = seriesPoints(s.data, columnOf(s), series)
  if (points.length === 0) return []
  const { width: w, height: h } = plot
  const [xMin, xMax] = domains.x.range
  const [yMin, yMax] = domains.y.range
  const xToPx = (x: number) => (xMax <= xMin ? 0 : ((x - xMin) / (xMax - xMin) - 0.5) * w)
  const yToPx = (y: number) => (yMax <= yMin ? 0 : ((y - yMin) / (yMax - yMin) - 0.5) * h)
  // `seriesPoints` already sorted them along x.
  return points.map(([x, y]) => ({ x: xToPx(x), y: yToPx(y) }))
}

/** `region` mapped into the plot's centred pixel space, against the live scales, so it travels with a zoom. */
function regionBox(s: LineChartValues & { readonly region: PlotRegion | null }, domains: LineChartDomains, plot: Size2D): RegionBox {
  const { width: w, height: h } = plot
  return resolveRegionBox(s.region, { left: -w / 2, right: w / 2, bottom: -h / 2, top: h / 2 }, domains.x.range, domains.y.range)
}

/**
 * Whether a call-out is authored at all. Not whether it resolves to pixels: a
 * command is built before the first layout, and a region on a chart not yet
 * measured is a real one. A region bounding neither axis is none, as `null` is.
 */
function hasCallout(s: { readonly region: PlotRegion | null }): boolean {
  const region = s.region
  return region != null && (region.x !== undefined || region.y !== undefined)
}

/** The `region` a document handed a command, or `{}`: a command is added before its arguments are filled in. */
function regionArg(region: PlotRegion | null | undefined): PlotRegion {
  return region != null && typeof region === "object" ? region : {}
}

/** A range read as a span, whichever way round the author wrote it. */
function span([a, b]: Range): Range {
  return a <= b ? [a, b] : [b, a]
}

/**
 * Rescale an axis to `range`, keeping the tick *count* it already has, so each
 * marker slides from its old value to its new one instead of the row popping.
 */
function rescale(range: Range, ticks: readonly number[]): AxisDomainConfig {
  const to = span(range)
  return { range: to, ticks: markerValues(to, Math.max(2, ticks.length) - 1) }
}

/** The axis writes of a move from `from` toward `to` at `t`. */
function axesAt(from: LineChartDomains, to: Partial<Record<"x" | "y", AxisDomainConfig>>, t: number) {
  return {
    ...(to.x && { xAxis: lerpAxisDomain(from.x, to.x, t) }),
    ...(to.y && { yAxis: lerpAxisDomain(from.y, to.y, t) }),
  }
}

type AnyTimeline = Timeline<any, any>

/** The parts a line chart's commands drive, found through its children. */
function partsOf(children: readonly ChildView[]) {
  const frame = cartesianViews(children)
  if (!frame) return null
  const hAxis = frame.below.find(HorizontalAxis.is)
  if (!VerticalAxis.is(frame.axis) || !hAxis) return null
  return {
    vAxis: frame.axis,
    hAxis,
    lines: frame.plot.filter(ChartLine.is),
    legend: frame.below.find(ChartLegend.is) ?? null,
  }
}

/** Drop the call-out: the rules retract, the wash fades, and every series comes back to full. */
function clearing(timeline: AnyTimeline, state: LineState) {
  const from = state.regionReveal
  const region = state.region
  // Nothing to retract, but the call still takes its slot on the timeline.
  if (from === 0) return timeline.animate(() => ({ region: null, regionReveal: 0 }), { eased: false })
  // `region` is held until the retraction lands, or there would be nothing left to retract.
  return timeline.animate((t) => (t >= 1 ? { region: null, regionReveal: 0 } : { region, regionReveal: from * (1 - t) }))
}

/** Trace series `index`'s line in (`show`) or back out, in lockstep with its legend entry. */
function toggling(timeline: AnyTimeline, children: readonly ChildView[], index: number, show: boolean) {
  const parts = partsOf(children)
  const line = parts?.lines[index]
  if (!parts || !line) return timeline.wait(timeline.duration)
  return timeline.together([
    line.run("enter", show ? { from: 0, to: 1 } : { from: 1, to: 0 }),
    ...(parts.legend ? [parts.legend.run(show ? "showSeries" : "hideSeries", { index })] : []),
  ])
}

/**
 * A multi-series line chart, composed from five independent parts rather than
 * one monolithic draw:
 *
 * - {@link ChartCanvas} — the plot panel with a two-way grid, under everything.
 * - {@link VerticalAxis} / {@link HorizontalAxis} — columns/rows of real text
 *   markers that stagger in, each carrying its own axis caption.
 * - {@link ChartRegion} — the optional call-out marking a spotlit slice of the
 *   plot: dashed rules on its bounded edges, and every series faded outside it.
 * - {@link ChartLine} (one per series) — the traced polylines over the canvas.
 * - {@link ChartLegend} — a row of entries below the chart, one per series.
 *
 * Every part reads the chart's entries through bindings, and the lines, the
 * region and the grid all map against the plot panel's own laid-out box, so
 * points land exactly on their markers and the chart re-flows if its box
 * changes.
 *
 * **Resting state is the finished chart**: an editor paints a node's Initial
 * state on a paused canvas. `enter` arms every part on its first frame.
 *
 * Past the entrance, `showSeries`/`hideSeries`/`spotlightSeries` pick out a
 * *series*, `spotlightRegion` marks a *slice of the plot* without changing the
 * scale, and `zoomTo` rescales the axes so a slice fills the plot. A spotlit
 * region resolves against the live scales, so it travels with a zoom. A `to` of
 * an axis `range` or `ticks` tweens from the domain as drawn (see
 * {@link lerpAxisEntry}), so an auto axis rescales continuously.
 */
export const LineChart = component2d({
  key: "lineChart",
  state: {
    data: fresh<DataRecord[]>(() => [], { kind: "dataset" }),
    xField: "",
    series: fresh<LineSeries[]>(() => [], { kind: "series" }),
    xAxis: Types.custom<AxisDomainConfig>({}, { resolve: resolveAxisDomain, lerp: lerpAxisEntry }),
    yAxis: Types.custom<AxisDomainConfig>({}, { resolve: resolveAxisDomain, lerp: lerpAxisEntry }),
    theme: Types.custom<ChartTheme, ChartConfig>(DEFAULT_CHART_THEME, { resolve: resolveChartTheme, lerp: lerpChartTheme }),
    /**
     * The spotlit slice of the plot in data units, or `null` for none. The box
     * snaps; the animation is {@link regionReveal} drawing the rules on.
     */
    region: Types.custom<PlotRegion | null>(null),
    /**
     * How far the `region` call-out is drawn in, `[0, 1]`: the rules grow out and
     * the wash fades up as it climbs, while every line's out-of-region stretch
     * fades to the theme's `region.dimOpacity`.
     */
    regionReveal: 0,
    /** Read as the chart is built: the legend is a part the chart builds or doesn't. */
    showLegend: Types.boolean(true, { animatable: false }),
    /**
     * The domain `zoomTo` first left, so `resetZoom` restores the chart as it
     * stood, auto-derived ticks included. Cleared by `resetZoom`, so the next zoom
     * remembers wherever the chart rests then.
     */
    home: Types.custom<LineChartDomains | null>(null, { private: true }),
  },
  // Its parts fill it; a node made of them would hug them.
  defaults: { width: "fill", height: "fill" },
  allowedChildren: [],
  children: (state) => {
    const theme = () => state.theme
    const domains = () => lineChartDomains(state)
    let plot: Node2D | undefined
    const plotSize = () => laidOutSize(plot)
    const enabled = state.series.map((s) => s.enabled ?? true)

    // Bound, not snapshotted, so a rescale re-labels and re-places the row as it
    // tweens. The marker *count* is read once, which is why `zoomTo` keeps it.
    const vAxis = new VerticalAxis({
      range: () => domains().y.range,
      markers: () => domains().y.ticks,
      // The y axis is always numbers, so its format is simply the pattern.
      captions: () => {
        const markers = domains().y.ticks
        const format = state.yAxis.format
        return markers.map((value) => (format === undefined ? formatMarker(value, markerStep(markers)) : formatNumber(value, format)))
      },
      axis: () => theme().yAxis,
      label: state.yAxis.label ?? "",
      width: "hug",
      height: "fill",
    })

    const hAxis = new HorizontalAxis({
      range: () => domains().x.range,
      markers: () => domains().x.ticks,
      // A tick on a month or category column is captioned with the cell it came
      // out of — `Jan`, not the instant it parsed to.
      captions: () => {
        const column = columnOf(state)
        return domains().x.ticks.map((value) => column.label(value))
      },
      axis: () => theme().xAxis,
      label: state.xAxis.label ?? "",
      width: "fill",
      height: "hug",
    })

    const lines = state.series.map(
      (s, i) =>
        new ChartLine({
          points: () => seriesPixels(state, domains(), i, plotSize()),
          stroke: () => resolveSeriesStroke(theme().seriesStyles, s, i),
          enabled: enabled[i],
          // Each line clips itself against the box the rules are drawn from, so
          // the dim/bright boundary can't drift from the dashes.
          spotlight: () => regionBox(state, domains(), plotSize()),
          // Ramped by the reveal that draws the rules: one signal, both halves.
          dimOpacity: () => 1 - (1 - theme().region.dimOpacity) * state.regionReveal,
        }) as unknown as Node2D
    )

    const below: Node2D[] = [hAxis as unknown as Node2D]
    if (state.showLegend !== false) {
      below.push(
        new ChartLegend({
          series: state.series,
          // The legend paints a swatch, not a line, so it is handed the colour each
          // stroke resolves to rather than the stroke itself.
          swatches: () => state.series.map((s, i) => resolveSeriesFill(theme().seriesStyles, s, i)),
          legend: () => theme().legend,
          // The row's spacing is the theme's as the chart was built, like the
          // entries' type and chips: a theme tween re-paints the swatches only.
          gap: state.theme.legend.itemGap,
          padding: state.theme.legend.padding,
        }) as unknown as Node2D
      )
    }

    plot = new Rect({
      clip: true,
      children: [
        new ChartCanvas({
          fill: () => theme().plotArea.fill,
          shadow: () => theme().plotArea.shadow,
          xGridStroke: () => theme().xAxis.lineStyle,
          yGridStroke: () => theme().yAxis.lineStyle,
          // A grid line under every axis marker; the canvas skips the edges.
          xMarkers: () => domains().x.ticks,
          yMarkers: () => domains().y.ticks,
          xExtent: () => domains().x.range,
          yExtent: () => domains().y.range,
        }),
        // Over the grid, under the lines, so a spotlit stretch of a series isn't
        // tinted by the highlight meant to pick it out.
        new ChartRegion({
          box: () => regionBox(state, domains(), plotSize()),
          stroke: () => theme().region.stroke,
          fill: () => theme().region.fill,
          reveal: () => state.regionReveal,
        }),
        ...lines,
        new ChartBorder({ stroke: () => theme().plotArea.stroke }),
      ],
    }) as unknown as Node2D

    const gutter = new VerticalAxis({
      opacity: 0,
      range: () => domains().y.range,
      markers: () => domains().y.ticks,
      axis: () => theme().yAxis,
      label: state.yAxis.label ?? "",
      width: "hug",
      height: 0,
    }) as unknown as Node2D

    return asParts([cartesianFrame({ axis: vAxis as unknown as Node2D, plot, gutter, below })])
  },
  commands: {
    /**
     * Animate the whole chart in: the two axes stagger their markers in, the
     * series lines trace left to right, and the legend fades up last. Its first
     * frame arms every part: markers shifted and transparent, lines untraced,
     * the legend dropped and transparent.
     *
     * `duration` is the **whole** entrance; the beats are shares of it. A chart
     * authored with a `region` lands its call-out last, in the final quarter.
     */
    enter: {
      args: {},
      // Held from the chart's arrival, so it never shows finished ahead of its draw.
      entrance: true,
      easing: easeOut(),
      run: (timeline, state, children) => {
        const parts = partsOf(children)
        if (!parts) return timeline.wait(timeline.duration)
        const duration = timeline.duration
        const revealing = hasCallout(state) && state.regionReveal === 0
        const body = revealing ? duration * 0.75 : duration
        const axes = body * AXES_SHARE
        const traced = body * LINES_SHARE
        const { legend } = parts
        const at0 = (piece: Beat["piece"]): Beat => ({ at: 0, duration: 0, piece })
        // The first frame arms what every later beat moves: a beat ahead of the
        // playhead writes nothing. A beat with nothing to do still takes its share.
        return beats(timeline, [
          ...(revealing ? [at0(timeline.animate(() => ({ regionReveal: 0 })))] : []),
          ...parts.lines.map((line) => at0(line.to({ progress: 0 }))),
          ...(legend ? [at0(legend.to({ opacity: 0, y: -LEGEND_SLIDE }))] : []),
          { at: 0, duration: axes, piece: parts.vAxis.run("enter", { slide: 24 }) },
          { at: 0, duration: axes, piece: parts.hAxis.run("enter", { slide: 24 }) },
          ...parts.lines.map((line) => ({ at: axes, duration: traced, piece: line.run("enter") })),
          ...(legend ? [{ at: axes + traced, duration: body * LEGEND_SHARE, piece: legend.to({ opacity: 1, y: 0 }) }] : []),
          ...(revealing ? [{ at: body, duration: duration * 0.25, piece: timeline.animate((t) => ({ regionReveal: t })) }] : []),
        ])
      },
    },
    /**
     * Spotlight a rectangular slice of the plot given in **data units**: dashed
     * rules draw onto each bounded edge while every series fades outside the box.
     * Either axis alone is a band; both are a box. Called while another region is
     * up, the old call-out retracts over the first half and the new one draws in
     * over the second, each half eased on its own.
     */
    spotlightRegion: {
      args: { region: REGION_ARG },
      easing: easeOut(),
      run: (timeline, state) => {
        const region = regionArg(timeline.args.region)
        const from = state.regionReveal
        const previous = state.region
        // A region bounding neither axis is no call-out: spotlighting it is a clear.
        if (region.x === undefined && region.y === undefined) return clearing(timeline, state)
        // Nothing up yet: the region is set from the first frame and just draws on.
        if (from <= 0 || !hasCallout(state)) return timeline.animate((t) => ({ region, regionReveal: from + (1 - from) * t }))
        return timeline.animate(
          (t) => (t < 0.5
            ? { region: previous, regionReveal: from * (1 - timeline.ease(t * 2)) }
            : { region, regionReveal: timeline.ease(t * 2 - 1) }),
          { eased: false }
        )
      },
    },
    /** Drop the region call-out. A no-op when nothing is spotlit, which still takes its slot. */
    clearRegion: {
      args: {},
      easing: easeOut(),
      run: (timeline, state) => clearing(timeline, state),
    },
    /**
     * Zoom the plot to a slice of itself, given in **data units**: the named axes
     * rescale so that slice fills the plot, the grid, both marker rows and every
     * series following. An omitted axis is left as it is. The first zoom
     * remembers the domain it left, for `resetZoom`.
     */
    zoomTo: {
      args: { region: REGION_ARG },
      easing: easeOut(),
      run: (timeline, state) => {
        const region = regionArg(timeline.args.region)
        if (!region.x && !region.y) return timeline.wait(timeline.duration)
        const from = lineChartDomains(state)
        const home = state.home ?? from
        const to = {
          ...(region.x && { x: { ...from.x, ...rescale(region.x, from.x.ticks) } }),
          ...(region.y && { y: { ...from.y, ...rescale(region.y, from.y.ticks) } }),
        }
        return timeline.animate((t) => ({ home, ...axesAt(from, to, t) }))
      },
    },
    /** Pull back out to the domain the first zoom left — the mirror of `zoomTo`, and a hold if it never zoomed. */
    resetZoom: {
      args: {},
      easing: easeOut(),
      run: (timeline, state) => {
        const home = state.home
        if (!home) return timeline.wait(timeline.duration)
        const from = lineChartDomains(state)
        return timeline.animate((t) => ({ home: null, ...axesAt(from, home, t) }))
      },
    },
    /**
     * Show series `index`: **trace** its line in left to right, in lockstep with
     * its legend entry growing in.
     */
    showSeries: {
      args: { seriesIndex: SERIES_ARG },
      easing: easeOut(),
      run: (timeline, _state, children) => toggling(timeline, children, timeline.args.seriesIndex, true),
    },
    /** Hide series `index`: **retrace** its line back out as its legend entry shrinks away. */
    hideSeries: {
      args: { seriesIndex: SERIES_ARG },
      easing: easeOut(),
      run: (timeline, _state, children) => toggling(timeline, children, timeline.args.seriesIndex, false),
    },
    /**
     * Fade every other series — each line **and its legend entry** — to focus on
     * `index`, which comes back to full. The legend dims in place, so the row
     * doesn't reflow.
     */
    spotlightSeries: {
      args: { seriesIndex: SERIES_ARG },
      easing: easeOut(),
      run: (timeline, _state, children) => {
        const parts = partsOf(children)
        if (!parts) return timeline.wait(timeline.duration)
        const index = timeline.args.seriesIndex
        return timeline.together([
          ...parts.lines.map((line, i) => line.to({ opacity: i === index ? 1 : SPOTLIGHT_DIM })),
          ...(parts.legend ? [parts.legend.run("spotlightSeries", { index })] : []),
        ])
      },
    },
  },
})

export type LineChart = NodeOf<typeof LineChart>
