import {
  Rect,
  Text,
  Types,
  clamp,
  component2d,
  easeOut,
  type ChildView,
  type DataRecord,
  type NodeOf,
  type OutOf,
  // Named so this component's emitted type reaches `Node2D` and its props through the sdk, not core.
  type Node2D,
  type Node2DProps as _Node2DProps,
  type Fill as _Fill,
  type FillResolved as _FillResolved,
  type Stroke as _Stroke,
  type StrokeResolved as _StrokeResolved,
  type Size2D,
  type StyleInput as _StyleInput,
  type StyleValues as _StyleValues,
  type Vector2,
} from "@motionscript/sdk"
import { formatNumber } from "@motionscript/sdk/component"

import { boundText, cartesianFrame, chartViews, columnGhost, fade, frameGap, headroom, laidOutSize, overhang } from "../kit/cartesian"
import { ChartCanvas } from "../kit/chart-canvas"
import { ChartLegend } from "../kit/chart-legend"
import { SERIES_ARG, asParts, fresh } from "../kit/entries"
import { HorizontalAxis } from "../kit/horizontal-axis"
import { DEFAULT_MARKERS, ENTER_SHARE, beats, legendAway, type AnyTimeline, type Beat } from "../kit/motion"
import {
  SPOTLIGHT_DIM,
  formatMarker,
  lerpAxisDomain,
  lerpAxisEntry,
  markerStep,
  markerValues,
  niceRange,
  niceTicks,
  resolveAxisDomain,
  settleAxisDomain,
  type AxisDomainConfig,
  type Range,
  type ResolvedAxisDomain,
} from "../kit/shared"
import {
  CARTESIAN_GRID,
  CHART_COLORS,
  CHART_LEGEND,
  CHART_STYLE_FAMILY,
  CHART_STYLE_PRESETS,
  CHART_TEXT,
  axisConfigOf,
  legendConfigOf,
  seriesFill,
  valueText,
} from "../kit/style"
import { VerticalAxis, axisPads } from "../kit/vertical-axis"
import { ChartArea, ChartLine, traceX } from "./chart-line"
import { ChartRegion } from "./chart-region"
import {
  LINE_LABELS,
  LINE_MARKS,
  resolveRegionBox,
  stackExtent,
  stackSeries,
  type LineSeries,
  type LineStack,
  type PlotRegion,
  type RegionBox,
  type StackedSeries,
} from "./shared"
import { resolveXScale, type XScale } from "./x-scale"

const LINE_STYLE = Types.style(
  CHART_STYLE_FAMILY,
  { colors: CHART_COLORS, text: CHART_TEXT, grid: CARTESIAN_GRID, marks: LINE_MARKS, labels: LINE_LABELS, legend: CHART_LEGEND },
  { presets: CHART_STYLE_PRESETS }
)

/** A line chart's resolved style. */
export type LineChartStyle = OutOf<typeof LINE_STYLE>

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
  readonly stack: LineStack
  readonly xAxis: AxisDomainConfig
  readonly yAxis: AxisDomainConfig
  /** Each series' share of a stack, `1` when missing. */
  readonly weights?: readonly number[]
  /** An area must reach its baseline, so a chart with areas keeps zero on the scale. */
  readonly style?: { readonly area: string }
}

/** One argument, two controls: the commands take a `PlotRegion`, so the x and y spans a host draws are declared inside it. */
const REGION_ARG = Types.custom<PlotRegion | undefined>(undefined, {
  kind: "region",
  properties: {
    x: { kind: "range", default: true, defaultMin: 0, defaultMax: 100 },
    y: { kind: "range", default: false, defaultMin: 0, defaultMax: 100 },
  },
})

/** What the chart's own commands read: its entries, and the private state they write. */
interface LineState extends LineChartValues {
  readonly style: LineChartStyle
  readonly region: PlotRegion | null
  readonly regionReveal: number
  readonly home: LineChartDomains | null
  readonly weights: number[]
}

/** The share of the y axis a percent stack reads to. */
const PERCENT: Range = [0, 100]

/** What the x column is (a number, an instant, or a place in the file), and so how rows are positioned, ticked and captioned. */
function columnOf(s: LineChartValues, format = s.xAxis.format): XScale {
  return resolveXScale(s.data, s.xField, format)
}

/** Every series as drawn; `weighted` false reads each at full share, as the scale does so the ticks hold still while a series sinks out. */
function stacksOf(s: LineChartValues, weighted = true): StackedSeries[] {
  return stackSeries(s.data, columnOf(s), s.series, s.stack, weighted ? s.weights : undefined)
}

/** The explicit range and ticks, else the column's extent and ticks: only a numeric column has round numbers between its samples. */
function drawnX(s: LineChartValues, domain: AxisDomainConfig): AxisDomainConfig {
  const column = columnOf(s, domain.format)
  const range = domain.range ?? column.extent
  return { ...domain, range, ticks: domain.ticks ?? column.ticks(range, DEFAULT_MARKERS - 1) }
}

/** The y range the data asks for: a percent stack reads to 100; areas and stacks keep zero on the scale. */
function autoY(s: LineChartValues, divisions: number): Range {
  const [lo, hi] = stackExtent(stacksOf(s, false))
  if (s.stack === "percent" && lo >= 0) return PERCENT
  const zero = s.stack !== "none" || (s.style?.area ?? "none") !== "none"
  return niceRange(zero ? [Math.min(0, lo), Math.max(0, hi)] : [lo, hi], divisions)
}

/** Auto-ranging steps into one fewer segment than the marker count, so the tidy bounds frame the ticks drawn. */
function drawnY(s: LineChartValues, domain: AxisDomainConfig): AxisDomainConfig {
  const divisions = (domain.ticks?.length ?? DEFAULT_MARKERS) - 1
  const range = domain.range ?? autoY(s, divisions)
  const even = domain.range !== undefined || (s.stack === "percent" && range === PERCENT)
  return { ...domain, range, ticks: domain.ticks ?? (even ? markerValues(range, DEFAULT_MARKERS - 1) : niceTicks(range, DEFAULT_MARKERS - 1)) }
}

/** The last domains worked out from each data array, and what else they were read from. */
const domainsDrawn = new WeakMap<DataRecord[], { readonly key: readonly unknown[]; readonly domains: LineChartDomains }>()

/** Both axes as drawn now. */
export function lineChartDomains(s: LineChartValues): LineChartDomains {
  const key = [s.xField, s.xAxis, s.yAxis, s.series, s.stack, s.style?.area]
  const kept = domainsDrawn.get(s.data)
  if (kept && kept.key.every((value, i) => value === key[i])) return kept.domains
  const domains = {
    x: settleAxisDomain(s.xAxis, (d) => drawnX(s, d)) as LineChartDomains["x"],
    y: settleAxisDomain(s.yAxis, (d) => drawnY(s, d)) as LineChartDomains["y"],
  }
  domainsDrawn.set(s.data, { key, domains })
  return domains
}

/** Data to the plot's centred pixel space (origin at its centre, y-up). */
function mapper(domains: LineChartDomains, plot: Size2D) {
  const [xMin, xMax] = domains.x.range
  const [yMin, yMax] = domains.y.range
  return {
    x: (x: number) => (xMax <= xMin ? 0 : ((x - xMin) / (xMax - xMin) - 0.5) * plot.width),
    y: (y: number) => (yMax === yMin ? 0 : ((y - yMin) / (yMax - yMin) - 0.5) * plot.height),
  }
}

interface SeriesPixels {
  readonly points: Vector2[]
  /** The line under the series in a stack; empty when it fills to the baseline. */
  readonly base: Vector2[]
  /** What each point reads: its own value, or its share in a percent stack. */
  readonly values: number[]
}

const NO_PIXELS: SeriesPixels = { points: [], base: [], values: [] }

/** Series `index` in the plot's centred pixel space. */
function seriesPixels(s: LineChartValues, domains: LineChartDomains, index: number, plot: Size2D): SeriesPixels {
  const stack = stacksOf(s)[index]
  if (!stack) return NO_PIXELS
  const map = mapper(domains, plot)
  const toPx = ([x, y]: [number, number]): Vector2 => ({ x: map.x(x), y: map.y(y) })
  return {
    points: stack.points.map(toPx),
    base: stack.base ? stack.base.map(toPx) : [],
    values: stack.points.map(([, y], k) => y - (stack.base?.[k]?.[1] ?? 0)),
  }
}

/** Where the areas fill down to: zero, held inside the scale. */
function baselineValue(domains: LineChartDomains): number {
  const [lo, hi] = domains.y.range
  return clamp(0, Math.min(lo, hi), Math.max(lo, hi))
}

/** Whether anything plotted runs past the scale, so the plot clips it: a zoom, or an author's range narrower than the data. */
function overflows(s: LineChartValues, domains: LineChartDomains): boolean {
  const [ylo, yhi] = stackExtent(stacksOf(s, false))
  const [xlo, xhi] = columnOf(s).extent
  const within = (v: number, [a, b]: Range) => v >= Math.min(a, b) - 1e-9 && v <= Math.max(a, b) + 1e-9
  return !(within(ylo, domains.y.range) && within(yhi, domains.y.range) && within(xlo, domains.x.range) && within(xhi, domains.x.range))
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

/** A value as the y axis writes it: the author's pattern, a share in a percent stack, else the bare reading at the ticks' precision. */
function yLabel(s: LineChartValues, value: number, ticks: readonly number[]): string {
  const format = s.yAxis.format
  if (format !== undefined) return formatNumber(value, format)
  const text = formatMarker(value, markerStep(ticks))
  return s.stack === "percent" ? `${text}%` : text
}

function weightOf(s: { readonly weights: readonly number[] }, index: number): number {
  return Math.max(0, s.weights[index] ?? 1)
}

/** The parts a line chart's commands drive, found through its children. */
function partsOf(children: readonly ChildView[]) {
  const views = chartViews(children)
  return {
    vAxis: views.find(VerticalAxis.is) ?? null,
    hAxis: views.find(HorizontalAxis.is) ?? null,
    lines: views.filter(ChartLine.is),
    legend: views.find(ChartLegend.is) ?? null,
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

/**
 * Show or hide series `index` with its legend entry. Apart, the line retraces;
 * in a stack it sinks into the series below as its share falls to nothing, so
 * the ones above settle rather than leaving a gap.
 */
function toggling(timeline: AnyTimeline, state: LineState, children: readonly ChildView[], index: number, show: boolean) {
  const parts = partsOf(children)
  const line = parts.lines[index]
  if (!line) return timeline.wait(timeline.duration)
  const legend = parts.legend ? [parts.legend.run(show ? "showSeries" : "hideSeries", { index })] : []
  if (state.stack === "none") {
    return timeline.together([line.run("enter", show ? { from: 0, to: 1 } : { from: 1, to: 0 }), ...legend])
  }
  const from = state.series.map((_, i) => weightOf(state, i))
  const start = from[index] ?? 1
  const target = show ? 1 : 0
  return timeline.together([
    timeline.animate((t) => {
      const weights = [...from]
      weights[index] = start + (target - start) * timeline.ease(t)
      return { weights }
    }, { eased: false }),
    line.run("hold", { shown: show }),
    ...legend,
  ])
}

/**
 * A multi-series line or area chart composed of {@link ChartCanvas}, the value
 * and x axes, {@link ChartRegion}, a {@link ChartArea} and a {@link ChartLine}
 * per series, and {@link ChartLegend}. Every part reads the chart's entries
 * through bindings and maps against the plot panel's own laid-out box.
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
    /** `stacked`: each series sits on the sum of those before it; `percent`: every row reads as shares of 100. */
    stack: Types.oneOf(["none", "stacked", "percent"] as const),
    xAxis: Types.custom<AxisDomainConfig>({}, { resolve: resolveAxisDomain, lerp: lerpAxisEntry }),
    yAxis: Types.custom<AxisDomainConfig>({}, { resolve: resolveAxisDomain, lerp: lerpAxisEntry }),
    style: LINE_STYLE,
    /** The spotlit slice in data units, or `null`. The box snaps; {@link regionReveal} animates it. */
    region: Types.custom<PlotRegion | null>(null),
    /** How far the `region` call-out is drawn in, `[0, 1]`: rules grow, wash fades up, out-of-region stretches fade. */
    regionReveal: 0,
    /** The domain `zoomTo` first left, so `resetZoom` restores it, auto-derived ticks included. */
    home: Types.custom<LineChartDomains | null>(null, { private: true }),
    /** Each series' share of a stack, seeded from `enabled`: a weight rather than a switch, so a hidden series sinks out. */
    weights: Types.custom<number[]>([], { private: true }),
    /** Whether the plot clips its marks, from a zoom's first frame until a reset lands. */
    clipped: Types.boolean(false, { private: true }),
  },
  // A node made of parts that fill would otherwise hug them.
  defaults: {
    width: "fill",
    height: "fill",
    weights: (state) => state.series.map((s) => ((s.enabled ?? true) ? 1 : 0)),
  },
  allowedChildren: [],
  children: (state) => {
    const style = () => state.style
    const domains = () => lineChartDomains(state)
    let plot: Node2D | undefined
    const plotSize = () => laidOutSize(plot)
    const pixels = (i: number) => seriesPixels(state, domains(), i, plotSize())
    const enabled = state.series.map((s) => s.enabled ?? true)
    const built = state.style
    const yConfig = () => axisConfigOf(style(), "y")
    const xConfig = () => axisConfigOf(style(), "x")
    const yCaptions = () => {
      const ticks = domains().y.ticks
      return ticks.map((value) => yLabel(state, value, ticks))
    }

    // Bound, not snapshotted, so a rescale re-labels and re-places the row as it
    // tweens. The marker *count* is read once, which is why `zoomTo` keeps it.
    const vAxis = built.showYAxis
      ? (new VerticalAxis({
        range: () => domains().y.range,
        markers: () => domains().y.ticks,
        captions: yCaptions,
        axis: yConfig,
        label: state.yAxis.label ?? "",
        width: "hug",
        height: "fill",
      }) as unknown as Node2D)
      : undefined

    const hAxis = built.showXAxis
      ? (new HorizontalAxis({
        range: () => domains().x.range,
        markers: () => domains().x.ticks,
        // A month or category tick is captioned with its cell (`Jan`), not the instant it parsed to.
        captions: () => {
          const column = columnOf(state)
          return domains().x.ticks.map((value) => column.label(value))
        },
        axis: xConfig,
        label: state.xAxis.label ?? "",
        overhang: () => ({ left: overhang(style()), right: overhang(style()) }),
        width: "fill",
        height: "hug",
      }) as unknown as Node2D)
      : undefined

    const ghost = vAxis && hAxis
      ? columnGhost({
        captions: yCaptions,
        count: lineChartDomains(state).y.ticks.length,
        text: () => yConfig().labelStyle,
        title: state.yAxis.label ?? "",
        titleText: () => yConfig().titleStyle,
        tickPad: () => axisPads(yConfig(), "right").tick,
        titlePad: () => axisPads(yConfig(), "right").title,
      })
      : undefined

    const spotlight = () => regionBox(state, domains(), plotSize())
    const dimOpacity = () => 1 - (1 - SPOTLIGHT_DIM) * state.regionReveal
    const lines = state.series.map((s, i) =>
      new ChartLine({
        points: () => pixels(i).points,
        curve: () => style().curve,
        stroke: () => ({ weight: style().strokeWidth, fill: seriesFill(style(), s, i), align: "center", cap: "round", join: "round" }),
        dotSize: () => (style().dots ? style().dotSize : 0),
        dotFill: () => seriesFill(style(), s, i),
        enabled: enabled[i],
        spotlight,
        dimOpacity,
      })
    )
    const areas = state.series.map((s, i) =>
      new ChartArea({
        points: () => pixels(i).points,
        base: () => pixels(i).base,
        baseline: () => mapper(domains(), plotSize()).y(baselineValue(domains())),
        curve: () => style().curve,
        area: () => style().area,
        fill: () => seriesFill(style(), s, i),
        areaOpacity: () => style().areaOpacity,
        // The line's own trace, switch and fade, so the two arrive, leave and dim as one.
        progress: () => lines[i].progress,
        enabled: () => lines[i].enabled,
        opacity: () => lines[i].opacity,
        spotlight,
        dimOpacity,
      })
    )

    const labels: Node2D[] = []
    if (built.values !== "none") {
      const below = built.values === "below"
      state.series.forEach((_, i) => {
        state.data.forEach((_row, k) => {
          const line = lines[i]
          const label: Node2D = new Text({
            ...boundText(() => ({ ...valueText(style()), fontSize: Math.round(style().fontSize * 0.8) })),
            text: () => {
              const value = pixels(i).values[k]
              return value === undefined ? "" : yLabel(state, value, domains().y.ticks)
            },
            // Held inside the plot, so a figure on an end point does not run into the axis beside it.
            x: () => {
              const half = (plotSize().width - label.layoutBounds.width) / 2
              return clamp(pixels(i).points[k]?.x ?? 0, -Math.max(0, half), Math.max(0, half))
            },
            y: () => {
              const point = pixels(i).points[k]
              const clear = label.layoutBounds.height / 2 + (style().dots ? style().dotSize / 2 : style().strokeWidth / 2) + Math.round(style().fontSize * 0.25)
              return (point?.y ?? 0) + (below ? -clear : clear)
            },
            // In once the trace has passed its point.
            opacity: () => {
              const point = pixels(i).points[k]
              if (!line.enabled || !point) return 0
              const reach = traceX(pixels(i).points, line.progress)
              return line.opacity * (reach === Infinity ? 1 : clamp((reach - point.x) / 24, 0, 1))
            },
          }) as unknown as Node2D
          labels.push(label)
        })
      })
    }

    const legendAt = built.legend
    const legend = legendAt !== "none"
      ? (new ChartLegend({
        series: state.series,
        swatches: () => state.series.map((s, i) => seriesFill(style(), s, i)),
        legend: () => legendConfigOf(style()),
        flow: legendAt === "right" ? "vertical" : "horizontal",
      }) as unknown as Node2D)
      : undefined

    plot = new Rect({
      clip: () => state.clipped || overflows(state, domains()),
      children: [
        new ChartCanvas({
          fill: () => style().background,
          xGridStroke: () => style().verticalGrid,
          yGridStroke: () => style().horizontalGrid,
          xMarkers: () => domains().x.ticks,
          yMarkers: () => domains().y.ticks,
          xExtent: () => domains().x.range,
          yExtent: () => domains().y.range,
          axisStroke: () => style().axisStroke,
          xAxisAt: () => baselineValue(domains()),
          yAxisAt: () => domains().x.range[0],
        }),
        // Under the marks, so the highlight does not tint the stretch it picks out.
        new ChartRegion({
          box: spotlight,
          stroke: () => ({ weight: 2, fill: fade(style().foreground, 0.7), dash: [14, 12], cap: "butt", align: "center" }),
          fill: () => fade(style().foreground, 0.06),
          reveal: () => state.regionReveal,
        }),
        ...areas,
        ...lines,
        ...labels,
      ],
    }) as unknown as Node2D

    return asParts([
      cartesianFrame({
        left: vAxis,
        ghost,
        plot,
        bottom: hAxis,
        legend,
        legendAt,
        gap: () => frameGap(style()),
        padding: () => ({
          top: headroom(style()),
          right: hAxis ? overhang(style()) : 0,
          left: hAxis && !vAxis ? overhang(style()) : 0,
          bottom: 0,
        }),
      }),
    ])
  },
  commands: {
    /**
     * Axes stagger in, lines (and their areas) trace left to right, the legend
     * fades up last. `duration` is the whole entrance; a chart with a `region`
     * lands its call-out in the final quarter.
     */
    enter: {
      args: {},
      // Held from arrival, so it never shows finished ahead of its draw.
      entrance: true,
      easing: easeOut(),
      run: (timeline, state, children) => {
        const parts = partsOf(children)
        const duration = timeline.duration
        const revealing = hasCallout(state) && state.regionReveal === 0
        const body = revealing ? duration * 0.75 : duration
        const axes = body * ENTER_SHARE.axes
        const traced = body * ENTER_SHARE.marks
        const { legend } = parts
        const at0 = (piece: Beat["piece"]): Beat => ({ at: 0, duration: 0, piece })
        const away = legendAway(state.style.legend)
        // The first frame arms what every later beat moves: a beat ahead of the
        // playhead writes nothing. A beat with nothing to do still takes its share.
        return beats(timeline, [
          ...(revealing ? [at0(timeline.animate(() => ({ regionReveal: 0 })))] : []),
          ...parts.lines.map((line) => at0(line.to({ progress: 0 }))),
          ...(legend ? [at0(legend.to({ opacity: 0, ...away }))] : []),
          ...(parts.vAxis ? [{ at: 0, duration: axes, piece: parts.vAxis.run("enter", { slide: 24 }) }] : []),
          ...(parts.hAxis ? [{ at: 0, duration: axes, piece: parts.hAxis.run("enter", { slide: 24 }) }] : []),
          ...parts.lines.map((line) => ({ at: axes, duration: traced, piece: line.run("enter") })),
          ...(legend ? [{ at: axes + traced, duration: body * ENTER_SHARE.legend, piece: legend.to({ opacity: 1, x: 0, y: 0 }) }] : []),
          ...(revealing ? [{ at: body, duration: duration * 0.25, piece: timeline.animate((t) => ({ regionReveal: t })) }] : []),
          // Takes the whole slot even with no parts to move.
          { at: 0, duration, piece: timeline.wait(duration) },
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
        return timeline.animate((t) => ({ home, clipped: true, ...axesAt(from, to, t) }))
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
        return timeline.animate((t) => ({ home: null, clipped: t < 1, ...axesAt(from, home, t) }))
      },
    },
    /** Bring series `index` in, with its legend entry growing in: traced, or in a stack risen out of the series below. */
    showSeries: {
      args: { seriesIndex: SERIES_ARG },
      easing: easeOut(),
      run: (timeline, state, children) => toggling(timeline, state, children, timeline.args.seriesIndex, true),
    },
    /** The mirror of `showSeries`. */
    hideSeries: {
      args: { seriesIndex: SERIES_ARG },
      easing: easeOut(),
      run: (timeline, state, children) => toggling(timeline, state, children, timeline.args.seriesIndex, false),
    },
    /** Fade every other series, line, area and legend entry, to focus on `index`. The legend dims in place, so the row does not reflow. */
    spotlightSeries: {
      args: { seriesIndex: SERIES_ARG },
      easing: easeOut(),
      run: (timeline, _state, children) => {
        const parts = partsOf(children)
        const index = timeline.args.seriesIndex
        return timeline.together([
          ...parts.lines.map((line, i) => line.to({ opacity: i === index ? 1 : SPOTLIGHT_DIM })),
          ...(parts.legend ? [parts.legend.run("spotlightSeries", { index })] : []),
          timeline.wait(timeline.duration),
        ])
      },
    },
  },
})

export type LineChart = NodeOf<typeof LineChart>
