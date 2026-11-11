import {
  Rect,
  Types,
  clamp,
  component2d,
  easeOut,
  type ChildView,
  type DataRecord,
  type NodeOf,
  // Named so this component's emitted type reaches `Node2D` and its props through the sdk, not core.
  type Node2D,
  type Node2DProps as _Node2DProps,
  type Size2D,
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
  formatMarker,
  lerpAxisDomain,
  lerpAxisEntry,
  markerStep,
  markerValues,
  num,
  resolveAxisDomain,
  settleAxisDomain,
  type AxisDomainConfig,
  type Range,
  type ResolvedAxisDomain,
} from "../kit/shared"
import { CategoryAxis } from "./category-axis"
import { ChartBars, type BarGeometry } from "./chart-bars"
import {
  DEFAULT_BAR_CHART_THEME,
  barCategories,
  barSpans,
  lerpBarChartTheme,
  resolveBarChartTheme,
  resolveBarFill,
  resolveBarScale,
  stackCapIndex,
  type BarChartConfig,
  type BarChartTheme,
  type BarSeries,
} from "./shared"

/** What a bar chart plots, as its entries hold it. */
export interface BarChartValues {
  readonly data: DataRecord[]
  readonly series: BarSeries[]
  readonly stacked: boolean
  readonly valueAxis: AxisDomainConfig
}

/** The value axis's domain with its range and ticks resolved. */
export type BarChartDomain = ResolvedAxisDomain

interface BarState extends BarChartValues {
  readonly theme: BarChartConfig
  readonly weights: number[]
  readonly spotlight: number | null
  readonly spotlightReveal: number
}

function drawnValue(s: BarChartValues, domain: AxisDomainConfig): AxisDomainConfig {
  const divisions = (domain.ticks?.length ?? DEFAULT_MARKERS) - 1
  const range = resolveBarScale(s.data, s.series, s.stacked, domain.range, divisions)
  return { ...domain, range, ticks: domain.ticks ?? markerValues(range, DEFAULT_MARKERS - 1) }
}

/** The last domain worked out from each data array, and what it was read from. */
const domainsDrawn = new WeakMap<DataRecord[], Omit<BarChartValues, "data"> & { readonly domain: BarChartDomain }>()

/** The value axis as drawn now. */
export function barChartDomain(s: BarChartValues): BarChartDomain {
  const { data, series, stacked, valueAxis } = s
  const kept = domainsDrawn.get(data)
  if (kept && kept.series === series && kept.stacked === stacked && kept.valueAxis === valueAxis) return kept.domain
  const domain = settleAxisDomain(valueAxis, (d) => drawnValue(s, d)) as BarChartDomain
  domainsDrawn.set(data, { series, stacked, valueAxis, domain })
  return domain
}

/** Ticks and the figures printed on columns both read through here, so they cannot disagree about how a number looks. */
function valueLabel(s: BarChartValues, domain: BarChartDomain, value: number): string {
  const pattern = s.valueAxis.format
  return pattern === undefined ? formatMarker(value, markerStep(domain.ticks)) : formatNumber(value, pattern)
}

/** A value in the plot's centred pixel space (origin at its centre, y-up). */
function valueToY(domain: BarChartDomain, plot: Size2D, value: number): number {
  const [min, max] = domain.range
  if (max <= min) return -plot.height / 2
  return ((value - min) / (max - min) - 0.5) * plot.height
}

/** Pixel y columns grow from: zero clamped onto the scale, so a cropped axis grows them from the plot floor. */
function baselinePx(domain: BarChartDomain, plot: Size2D): number {
  const [min, max] = domain.range
  return valueToY(domain, plot, Math.min(Math.max(0, min), max))
}

function weightAt(s: BarState, index: number): number {
  return Math.max(0, s.weights[index] ?? 1)
}

/** `row` with each series' value scaled by its live weight, which stacked spans are measured from. */
function weightedRow(s: BarState, row: DataRecord): DataRecord {
  const scaled: DataRecord = { ...row }
  s.series.forEach((series, i) => {
    const value = row[series.field]
    if (typeof value === "number") scaled[series.field] = value * weightAt(s, i)
  })
  return scaled
}

/**
 * Series `index`'s columns in centred pixel space. A grouped series divides the
 * slot with its siblings by live weight, a stacked one takes the whole slot, so
 * hiding a series reflows rather than punching a hole.
 */
function seriesBars(s: BarState, index: number, plot: Size2D, captioned: boolean): BarGeometry[] {
  const series = s.series[index]
  if (!series) return []
  const domain = barChartDomain(s)
  const n = s.data.length
  const slotWidth = n > 0 ? plot.width / n : 0
  const slotCenter = (i: number) => -plot.width / 2 + slotWidth * (i + 0.5)
  const inner = slotWidth * clamp(s.theme.bar.slotFill, 0, 1)
  const gap = s.theme.bar.groupGap
  let total = 0
  for (let i = 0; i < s.series.length; i++) total += weightAt(s, i)
  const unit = inner / (total > 0 ? total : 1)
  const weight = weightAt(s, index)
  let before = 0
  for (let i = 0; i < index; i++) before += weightAt(s, i)

  return s.data.map((row, rowIndex) => {
    // Built from live contributions, so a fading series lowers the segments above it.
    const spans = barSpans(s.stacked ? weightedRow(s, row) : row, s.series, s.stacked)
    const span = spans[index] ?? { from: 0, to: 0, value: 0 }
    const cap = s.stacked ? stackCapIndex(row, s.series) : index
    const slotLeft = slotCenter(rowIndex) - inner / 2
    const x = s.stacked ? slotCenter(rowIndex) : slotLeft + unit * before + (unit * weight) / 2
    const width = s.stacked ? inner : Math.max(0, unit * weight - (s.series.length > 1 ? gap : 0))
    // The printed figure is the row's own value, not the weighted one.
    const value = num(row, series.field)
    return {
      x,
      width,
      from: valueToY(domain, plot, span.from),
      to: valueToY(domain, plot, span.to),
      round: cap === index,
      value,
      ...(captioned && { caption: valueLabel(s, domain, value) }),
    }
  })
}

/** Per-row opacity: 1 while nothing is spotlit, falling to the theme's `dimOpacity` for all but the chosen category. */
function categoryDims(s: BarState): number[] {
  const focus = clamp(s.spotlightReveal, 0, 1)
  const dim = s.theme.spotlight.dimOpacity
  const chosen = s.spotlight
  return s.data.map((_, i) => (focus <= 0 || chosen === i ? 1 : 1 - (1 - dim) * focus))
}

/** The parts a bar chart's commands drive, found through its children. */
function partsOf(children: readonly ChildView[]) {
  const frame = cartesianViews(children)
  if (!frame) return null
  const cAxis = frame.below.find(CategoryAxis.is)
  if (!VerticalAxis.is(frame.axis) || !cAxis) return null
  return {
    vAxis: frame.axis,
    cAxis,
    bars: frame.plot.filter(ChartBars.is),
    legend: frame.below.find(ChartLegend.is) ?? null,
  }
}

/**
 * Move series `index`'s slot share to `target` with its legend entry. Its
 * columns stay drawn for every frame the move covers and switch off only once a
 * hide has landed, so arriving at a time backwards matches arriving forwards.
 */
function toggling(timeline: AnyTimeline, state: BarState & { readonly showing: boolean[] }, children: readonly ChildView[], index: number, target: number) {
  const parts = partsOf(children)
  if (!parts || !parts.bars[index]) return timeline.wait(timeline.duration)
  // Through `weightAt`, so short stored weights still tween from the 1 drawn.
  const from = state.series.map((_, i) => weightAt(state, i))
  const start = from[index] ?? 1
  const showing = state.series.map((s, i) => state.showing[i] ?? (s.enabled ?? true))
  return timeline.together([
    timeline.animate((t) => {
      const weights = [...from]
      weights[index] = start + (target - start) * timeline.ease(t)
      const shown = [...showing]
      shown[index] = target > 0 || t < 1
      return { weights, showing: shown }
    }, { eased: false }),
    ...(parts.legend ? [parts.legend.run(target > 0 ? "showSeries" : "hideSeries", { index })] : []),
  ])
}

/**
 * A grouped or stacked bar chart, built like the line chart from `ChartCanvas`,
 * `VerticalAxis`, {@link CategoryAxis}, one {@link ChartBars} per series and
 * `ChartLegend`. Zero is always on the scale and columns grow about it, so a
 * negative value draws downward from the same `growth` signal.
 *
 * Resting state is the finished chart; `enter` arms every part on its first
 * frame. A `to` of the value axis's `range` or `ticks` tweens from the domain as
 * drawn, so an auto axis rescales the columns continuously.
 */
export const BarChart = component2d({
  key: "barChart",
  state: {
    data: fresh<DataRecord[]>(() => []),
    // Names a column, not a value, like the line chart's `xField`.
    categoryField: "",
    series: fresh<BarSeries[]>(() => []),
    stacked: false,
    valueAxis: Types.custom<AxisDomainConfig>({}, { resolve: resolveAxisDomain, lerp: lerpAxisEntry }),
    categoryAxis: Types.custom<AxisDomainConfig>({}, { resolve: resolveAxisDomain, lerp: lerpAxisDomain }),
    theme: Types.custom<BarChartTheme, BarChartConfig>(DEFAULT_BAR_CHART_THEME, { resolve: resolveBarChartTheme, lerp: lerpBarChartTheme }),
    /** Rise of every column about the baseline, `[0, 1]`: 0 collapses them onto it. */
    growth: 1,
    /** Each series' share of the slot, seeded from `enabled`: a weight rather than a switch, so hiding one widens the others. */
    weights: fresh<number[]>(() => []),
    /** The category spotlit, or `null`. The choice snaps; `spotlightReveal` animates it. */
    spotlight: Types.custom<number | null>(null),
    spotlightReveal: 0,
    /** Read as the chart is built: the legend is a part the chart builds or doesn't. */
    showLegend: Types.boolean(true, { animatable: false }),
    /** Read as the chart is built: whether each column prints the figure it plots. */
    showValues: Types.boolean(false, { animatable: false }),
    /** Whether each series' columns are drawn: on for every frame a show or hide covers, off once a hide lands. */
    showing: Types.custom<boolean[]>([], { private: true }),
  },
  defaults: {
    // A node made of parts that fill would otherwise hug them.
    width: "fill",
    height: "fill",
    weights: (state) => state.series.map((s) => ((s.enabled ?? true) ? 1 : 0)),
    showing: (state) => state.series.map((s) => s.enabled ?? true),
  },
  allowedChildren: [],
  children: (state) => {
    const theme = () => state.theme
    const domain = () => barChartDomain(state)
    let plot: Node2D | undefined
    const plotSize = () => laidOutSize(plot)
    const captioned = state.showValues === true

    const vAxis = new VerticalAxis({
      range: () => domain().range,
      markers: () => domain().ticks,
      captions: () => {
        const d = domain()
        return d.ticks.map((value) => valueLabel(state, d, value))
      },
      axis: () => theme().yAxis,
      label: state.valueAxis.label ?? "",
      width: "hug",
      height: "fill",
    })

    const cAxis = new CategoryAxis({
      categories: barCategories(state.data, state.categoryField),
      axis: () => theme().xAxis,
      label: state.categoryAxis.label ?? "",
      dims: () => categoryDims(state),
      width: "fill",
      height: "hug",
    }) as unknown as Node2D

    const barSets = state.series.map(
      (s, i) =>
        new ChartBars({
          bars: () => seriesBars(state, i, plotSize(), captioned),
          baseline: () => baselinePx(domain(), plotSize()),
          fill: () => resolveBarFill(theme().seriesFills, s, i),
          barStroke: () => theme().bar.stroke,
          barShadow: () => theme().bar.shadow,
          cornerRadius: () => theme().bar.cornerRadius,
          growth: () => state.growth,
          dims: () => categoryDims(state),
          showValues: captioned,
          valueStyle: state.theme.valueStyle,
          enabled: () => state.showing[i] ?? (s.enabled ?? true),
        }) as unknown as Node2D
    )

    const below: Node2D[] = [cAxis]
    if (state.showLegend !== false) {
      below.push(
        new ChartLegend({
          series: state.series,
          swatches: () => state.series.map((s, i) => resolveBarFill(theme().seriesFills, s, i)),
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
          // Categorical x axis: no numeric position for a vertical rule to mark.
          xMarkers: [],
          yMarkers: () => domain().ticks,
          xExtent: () => [0, 1] as Range,
          yExtent: () => domain().range,
        }),
        ...barSets,
        new ChartBorder({ stroke: () => theme().plotArea.stroke }),
      ],
    }) as unknown as Node2D

    const gutter = new VerticalAxis({
      opacity: 0,
      range: () => domain().range,
      markers: () => domain().ticks,
      axis: () => theme().yAxis,
      label: state.valueAxis.label ?? "",
      width: "hug",
      height: 0,
    }) as unknown as Node2D

    return asParts([cartesianFrame({ axis: vAxis as unknown as Node2D, plot, gutter, below })])
  },
  commands: {
    /** Axes stagger in, columns rise from the baseline, the legend fades up last. `duration` is the whole entrance. */
    enter: {
      args: {},
      // Held from arrival, so it never shows finished ahead of its draw.
      entrance: true,
      easing: easeOut(),
      run: (timeline, _state, children) => {
        const parts = partsOf(children)
        if (!parts) return timeline.wait(timeline.duration)
        const duration = timeline.duration
        const axes = duration * ENTER_SHARE.axes
        const rise = duration * ENTER_SHARE.marks
        const { legend } = parts
        const at0 = (piece: Beat["piece"]): Beat => ({ at: 0, duration: 0, piece })
        return beats(timeline, [
          at0(timeline.animate(() => ({ growth: 0 }))),
          ...(legend ? [at0(legend.to({ opacity: 0, y: -LEGEND_SLIDE }))] : []),
          { at: 0, duration: axes, piece: parts.vAxis.run("enter", { slide: 24 }) },
          { at: 0, duration: axes, piece: parts.cAxis.run("enter", { slide: 24 }) },
          // No priming to 0 first: the value at `t` is a function of `t`.
          { at: axes, duration: rise, piece: timeline.animate((t) => ({ growth: t })) },
          ...(legend ? [{ at: axes + rise, duration: duration * ENTER_SHARE.legend, piece: legend.to({ opacity: 1, y: 0 }) }] : []),
        ])
      },
    },
    /** Bring series `index` back, the group reflowing to make room, with its legend entry. */
    showSeries: {
      args: { seriesIndex: SERIES_ARG },
      easing: easeOut(),
      run: (timeline, state, children) => toggling(timeline, state, children, timeline.args.seriesIndex, 1),
    },
    /** The mirror of `showSeries`: columns narrow away (stacked, sink out) while the rest widen into the space. */
    hideSeries: {
      args: { seriesIndex: SERIES_ARG },
      easing: easeOut(),
      run: (timeline, state, children) => toggling(timeline, state, children, timeline.args.seriesIndex, 0),
    },
    /** Fade every other series, columns and legend entry, to focus on `index`. Nothing moves, so the group does not reflow. */
    spotlightSeries: {
      args: { seriesIndex: SERIES_ARG },
      easing: easeOut(),
      run: (timeline, state, children) => {
        const parts = partsOf(children)
        if (!parts) return timeline.wait(timeline.duration)
        const index = timeline.args.seriesIndex
        const dim = state.theme.spotlight.dimOpacity
        return timeline.together([
          ...parts.bars.map((bars, i) => bars.to({ opacity: i === index ? 1 : dim })),
          ...(parts.legend ? [parts.legend.run("spotlightSeries", { index })] : []),
        ])
      },
    },
    /**
     * Fade every other category's columns and caption to `dimOpacity`. While
     * another is lit the focus moves directly. A missing category takes its slot
     * and changes nothing.
     */
    spotlightCategory: {
      args: { categoryIndex: Types.number(0, { min: 0, step: 1 }) },
      easing: easeOut(),
      run: (timeline, state) => {
        const index = timeline.args.categoryIndex
        if (index < 0 || index >= state.data.length) return timeline.wait(timeline.duration)
        const from = state.spotlightReveal
        return timeline.animate((t) => ({ spotlight: index, spotlightReveal: from + (1 - from) * t }))
      },
    },
    /** Every category back to full; the lit one is held until the fade lands. A no-op when nothing is lit, which still takes its slot. */
    clearCategory: {
      args: {},
      easing: easeOut(),
      run: (timeline, state) => {
        const from = state.spotlightReveal
        if (from === 0) return timeline.wait(timeline.duration)
        const lit = state.spotlight
        return timeline.animate((t) => (t >= 1 ? { spotlight: null, spotlightReveal: 0 } : { spotlight: lit, spotlightReveal: from * (1 - t) }))
      },
    },
  },
})

export type BarChart = NodeOf<typeof BarChart>
