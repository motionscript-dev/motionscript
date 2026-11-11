import {
  Rect,
  Types,
  component2d,
  easeOut,
  type ChildView,
  type DataRecord,
  type NodeOf,
  // Named so this component's emitted type reaches `Node2D` and its props through the sdk, not core.
  type Node2D,
  type Node2DProps as _Node2DProps,
  type Size2D,
  type Vector2,
} from "@motionscript/sdk"
import { formatNumber } from "@motionscript/sdk/component"

import { cartesianFrame, cartesianViews, laidOutSize } from "../kit/cartesian"
import { ChartBorder } from "../kit/chart-border"
import { ChartCanvas } from "../kit/chart-canvas"
import { ChartLegend } from "../kit/chart-legend"
import { SERIES_ARG, asParts, fresh } from "../kit/entries"
import { DEFAULT_MARKERS, ENTER_SHARE, LEGEND_SLIDE, beats, type AnyTimeline, type Beat } from "../kit/motion"
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
  type ResolvedAxisDomain,
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

/** Both axes' domains with their ranges and ticks resolved. */
export interface LineChartDomains {
  readonly x: ResolvedAxisDomain
  readonly y: ResolvedAxisDomain
}

/** What a line chart plots, as its entries hold it. */
export interface LineChartValues {
  readonly data: DataRecord[]
  readonly xField: string
  readonly series: LineSeries[]
  readonly xAxis: AxisDomainConfig
  readonly yAxis: AxisDomainConfig
}

/** One argument, two controls: the commands take a `PlotRegion`, so the x and y spans a host draws are declared inside it. */
const REGION_ARG = Types.custom<PlotRegion | undefined>(undefined, {
  kind: "region",
  properties: {
    x: { kind: "range", default: true, defaultMin: 0, defaultMax: 100 },
    y: { kind: "range", default: false, defaultMin: 0, defaultMax: 100 },
  },
})

/** What the chart's own commands read: its entries, and the private `home` a zoom remembers. */
interface LineState extends LineChartValues {
  readonly theme: ChartConfig
  readonly region: PlotRegion | null
  readonly regionReveal: number
  readonly home: LineChartDomains | null
}

/** What the x column is (a number, an instant, or a place in the file), and so how rows are positioned, ticked and captioned. */
function columnOf(s: LineChartValues, format = s.xAxis.format): XScale {
  return resolveXScale(s.data, s.xField, format)
}

/** The explicit range and ticks, else the column's extent and ticks: only a numeric column has round numbers between its samples. */
function drawnX(s: LineChartValues, domain: AxisDomainConfig): AxisDomainConfig {
  const column = columnOf(s, domain.format)
  const range = domain.range ?? column.extent
  return { ...domain, range, ticks: domain.ticks ?? column.ticks(range, DEFAULT_MARKERS - 1) }
}

/** Auto-ranging steps into one fewer segment than the marker count, so the tidy bounds frame the ticks drawn. */
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

/** Both axes as drawn now. */
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

/** One series' points in the plot's centred pixel space (origin at its centre, y-up). */
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
  return points.map(([x, y]) => ({ x: xToPx(x), y: yToPx(y) }))
}

/** `region` in centred pixel space against the live scales, so it travels with a zoom. */
function regionBox(s: LineChartValues & { readonly region: PlotRegion | null }, domains: LineChartDomains, plot: Size2D): RegionBox {
  const { width: w, height: h } = plot
  return resolveRegionBox(s.region, { left: -w / 2, right: w / 2, bottom: -h / 2, top: h / 2 }, domains.x.range, domains.y.range)
}

/** Whether a call-out is authored, not whether it resolves to pixels: a command is built before the first layout. A region bounding neither axis is none. */
function hasCallout(s: { readonly region: PlotRegion | null }): boolean {
  const region = s.region
  return region != null && (region.x !== undefined || region.y !== undefined)
}

/** The `region` argument, or `{}`: a command is added before its arguments are filled in. */
function regionArg(region: PlotRegion | null | undefined): PlotRegion {
  return region != null && typeof region === "object" ? region : {}
}

/** A range ordered low to high. */
function span([a, b]: Range): Range {
  return a <= b ? [a, b] : [b, a]
}

/** Rescale to `range` keeping the tick count, so each marker slides rather than the row popping. */
function rescale(range: Range, ticks: readonly number[]): AxisDomainConfig {
  const to = span(range)
  return { range: to, ticks: markerValues(to, Math.max(2, ticks.length) - 1) }
}

function axesAt(from: LineChartDomains, to: Partial<Record<"x" | "y", AxisDomainConfig>>, t: number) {
  return {
    ...(to.x && { xAxis: lerpAxisDomain(from.x, to.x, t) }),
    ...(to.y && { yAxis: lerpAxisDomain(from.y, to.y, t) }),
  }
}

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

function clearing(timeline: AnyTimeline, state: LineState) {
  const from = state.regionReveal
  const region = state.region
  // Nothing to retract, but the call still takes its slot.
  if (from === 0) return timeline.animate(() => ({ region: null, regionReveal: 0 }), { eased: false })
  // `region` is held until the retraction lands, or there would be nothing left to retract.
  return timeline.animate((t) => (t >= 1 ? { region: null, regionReveal: 0 } : { region, regionReveal: from * (1 - t) }))
}

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
 * A multi-series line chart composed of {@link ChartCanvas}, {@link VerticalAxis} /
 * {@link HorizontalAxis}, {@link ChartRegion}, one {@link ChartLine} per series and
 * {@link ChartLegend}. Every part reads the chart's entries through bindings and
 * maps against the plot panel's own laid-out box.
 *
 * Resting state is the finished chart; `enter` arms every part on its first
 * frame. A `to` of an axis `range` or `ticks` tweens from the domain as drawn
 * (see {@link lerpAxisEntry}), so an auto axis rescales continuously.
 */
export const LineChart = component2d({
  key: "lineChart",
  state: {
    data: fresh<DataRecord[]>(() => [], { kind: "dataset" }),
    // Not `x`: every node already has an `x`, its position.
    xField: "",
    series: fresh<LineSeries[]>(() => [], { kind: "series" }),
    xAxis: Types.custom<AxisDomainConfig>({}, { resolve: resolveAxisDomain, lerp: lerpAxisEntry }),
    yAxis: Types.custom<AxisDomainConfig>({}, { resolve: resolveAxisDomain, lerp: lerpAxisEntry }),
    theme: Types.custom<ChartTheme, ChartConfig>(DEFAULT_CHART_THEME, { resolve: resolveChartTheme, lerp: lerpChartTheme }),
    /** The spotlit slice in data units, or `null`. The box snaps; {@link regionReveal} animates it. */
    region: Types.custom<PlotRegion | null>(null),
    /** How far the `region` call-out is drawn in, `[0, 1]`: rules grow, wash fades up, out-of-region stretches fade to `region.dimOpacity`. */
    regionReveal: 0,
    /** Read as the chart is built: the legend is a part the chart builds or doesn't. */
    showLegend: Types.boolean(true, { animatable: false }),
    /** The domain `zoomTo` first left, so `resetZoom` restores it, auto-derived ticks included. */
    home: Types.custom<LineChartDomains | null>(null, { private: true }),
  },
  // A node made of parts that fill would otherwise hug them.
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
      // A month or category tick is captioned with its cell (`Jan`), not the instant it parsed to.
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
          // The box the rules are drawn from, so the dim boundary cannot drift from the dashes.
          spotlight: () => regionBox(state, domains(), plotSize()),
          dimOpacity: () => 1 - (1 - theme().region.dimOpacity) * state.regionReveal,
        }) as unknown as Node2D
    )

    const below: Node2D[] = [hAxis as unknown as Node2D]
    if (state.showLegend !== false) {
      below.push(
        new ChartLegend({
          series: state.series,
          swatches: () => state.series.map((s, i) => resolveSeriesFill(theme().seriesStyles, s, i)),
          legend: () => theme().legend,
          // Spacing is fixed as built; a theme tween re-paints the swatches only.
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
          xMarkers: () => domains().x.ticks,
          yMarkers: () => domains().y.ticks,
          xExtent: () => domains().x.range,
          yExtent: () => domains().y.range,
        }),
        // Under the lines, so the highlight does not tint the stretch it picks out.
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
     * Axes stagger in, lines trace left to right, the legend fades up last.
     * `duration` is the whole entrance; a chart with a `region` lands its
     * call-out in the final quarter.
     */
    enter: {
      args: {},
      // Held from arrival, so it never shows finished ahead of its draw.
      entrance: true,
      easing: easeOut(),
      run: (timeline, state, children) => {
        const parts = partsOf(children)
        if (!parts) return timeline.wait(timeline.duration)
        const duration = timeline.duration
        const revealing = hasCallout(state) && state.regionReveal === 0
        const body = revealing ? duration * 0.75 : duration
        const axes = body * ENTER_SHARE.axes
        const traced = body * ENTER_SHARE.marks
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
          ...(legend ? [{ at: axes + traced, duration: body * ENTER_SHARE.legend, piece: legend.to({ opacity: 1, y: 0 }) }] : []),
          ...(revealing ? [{ at: body, duration: duration * 0.25, piece: timeline.animate((t) => ({ regionReveal: t })) }] : []),
        ])
      },
    },
    /**
     * Spotlight a slice of the plot in data units; either axis alone is a band.
     * Over a region already up, the old one retracts in the first half and the
     * new one draws in over the second, each half eased on its own.
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
    /** Drop the call-out. A no-op when nothing is spotlit, which still takes its slot. */
    clearRegion: {
      args: {},
      easing: easeOut(),
      run: (timeline, state) => clearing(timeline, state),
    },
    /** Rescale the named axes so a slice (data units) fills the plot; an omitted axis is left. The first zoom remembers the domain for `resetZoom`. */
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
    /** Back to the domain the first zoom left; a hold if it never zoomed. */
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
    /** Trace series `index` in, with its legend entry growing in. */
    showSeries: {
      args: { seriesIndex: SERIES_ARG },
      easing: easeOut(),
      run: (timeline, _state, children) => toggling(timeline, children, timeline.args.seriesIndex, true),
    },
    /** Retrace series `index` out as its legend entry shrinks away. */
    hideSeries: {
      args: { seriesIndex: SERIES_ARG },
      easing: easeOut(),
      run: (timeline, _state, children) => toggling(timeline, children, timeline.args.seriesIndex, false),
    },
    /** Fade every other series, line and legend entry, to focus on `index`. The legend dims in place, so the row does not reflow. */
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
