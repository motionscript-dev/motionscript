import {
  Rect,
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
  type TextStyle as _TextStyle,
  type CornerRadiusResolved as _CornerRadiusResolved,
  type CornerStyleResolved as _CornerStyleResolved,
  type RectCornerRadius as _RectCornerRadius,
  type RectCornerStyle as _RectCornerStyle,
  type Fill as _Fill,
  type FillResolved as _FillResolved,
  type Stroke as _Stroke,
  type StrokeResolved as _StrokeResolved,
  type Size2D,
  type StyleInput as _StyleInput,
  type StyleValues as _StyleValues,
} from "@motionscript/sdk"
import { formatNumber } from "@motionscript/sdk/component"

import { cartesianFrame, chartViews, columnGhost, frameGap, headroom, laidOutSize, overhang } from "../kit/cartesian"
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
  niceTicks,
  num,
  resolveAxisDomain,
  settleAxisDomain,
  type AxisDomainConfig,
  type Range,
  type ResolvedAxisDomain,
} from "../kit/shared"
import {
  CARTESIAN_GRID,
  CARTESIAN_TEXT,
  CHART_LEGEND,
  CHART_SERIES,
  CHART_STYLE_FAMILY,
  CHART_STYLE_PRESETS,
  GRID_BACKGROUND,
  axisConfigOf,
  migrateChartStyle,
  legendConfigOf,
  seriesFill,
  valueText,
} from "../kit/style"
import { VerticalAxis, axisPads } from "../kit/vertical-axis"
import { CategoryAxis, slotCentre } from "./category-axis"
import { ChartBars, type BarGeometry } from "./chart-bars"
import {
  BAR_LABELS,
  BAR_MARKS,
  barCategories,
  barSpans,
  resolveBarScale,
  type BarOrientation,
  type BarSeries,
  type BarStack,
} from "./shared"

const BAR_STYLE = Types.style(
  CHART_STYLE_FAMILY,
  { series: CHART_SERIES, background: GRID_BACKGROUND, text: CARTESIAN_TEXT, grid: CARTESIAN_GRID, marks: BAR_MARKS, labels: BAR_LABELS, legend: CHART_LEGEND },
  { presets: CHART_STYLE_PRESETS }
)

/** A bar chart's resolved style. */
export type BarChartStyle = OutOf<typeof BAR_STYLE>

/** What a bar chart plots, as its entries hold it. */
export interface BarChartValues {
  readonly data: DataRecord[]
  readonly series: BarSeries[]
  readonly stack: BarStack
  readonly valueAxis: AxisDomainConfig
}

/** The value axis's domain with its range and ticks resolved. */
export type BarChartDomain = ResolvedAxisDomain

interface BarState extends BarChartValues {
  readonly categoryField: string
  readonly orientation: BarOrientation
  readonly style: BarChartStyle
  readonly weights: number[]
  readonly showing: boolean[]
  readonly spotlight: number | null
  readonly spotlightReveal: number
}

function drawnValue(s: BarChartValues, domain: AxisDomainConfig): AxisDomainConfig {
  const divisions = (domain.ticks?.length ?? DEFAULT_MARKERS) - 1
  const range = resolveBarScale(s.data, s.series, s.stack, domain.range, divisions)
  const even = domain.range !== undefined || s.stack === "percent"
  return { ...domain, range, ticks: domain.ticks ?? (even ? markerValues(range, DEFAULT_MARKERS - 1) : niceTicks(range, DEFAULT_MARKERS - 1)) }
}

/** The last domain worked out from each data array, and what it was read from. */
const domainsDrawn = new WeakMap<DataRecord[], { readonly key: readonly unknown[]; readonly domain: BarChartDomain }>()

/** The value axis as drawn now. A series being hidden keeps its room, so the ticks hold still while it goes. */
export function barChartDomain(s: BarChartValues): BarChartDomain {
  const key = [s.series, s.stack, s.valueAxis]
  const kept = domainsDrawn.get(s.data)
  if (kept && kept.key.every((value, i) => value === key[i])) return kept.domain
  const domain = settleAxisDomain(s.valueAxis, (d) => drawnValue(s, d)) as BarChartDomain
  domainsDrawn.set(s.data, { key, domain })
  return domain
}

/** Ticks and the figures printed by bars both read through here, so they cannot disagree about how a number looks. */
function valueLabel(s: BarChartValues, domain: BarChartDomain, value: number): string {
  const pattern = s.valueAxis.format
  if (pattern !== undefined) return formatNumber(value, pattern)
  const text = formatMarker(value, markerStep(domain.ticks))
  return s.stack === "percent" ? `${text}%` : text
}

/** A value along the value axis, a run of `length` px centred on 0. */
function valueToPx(domain: BarChartDomain, length: number, value: number): number {
  const [min, max] = domain.range
  if (max === min) return -length / 2
  return ((value - min) / (max - min) - 0.5) * length
}

/** Where bars grow from: zero held on the scale, so a cropped axis grows them from the plot's edge. */
function baselineValue(domain: BarChartDomain): number {
  const [lo, hi] = domain.range
  return clamp(0, Math.min(lo, hi), Math.max(lo, hi))
}

function weightAt(s: { readonly weights: readonly number[] }, index: number): number {
  return Math.max(0, s.weights[index] ?? 1)
}

/** The plot's run along the value axis and across the categories. */
function runs(s: BarState, plot: Size2D): { along: number; across: number } {
  return s.orientation === "horizontal" ? { along: plot.width, across: plot.height } : { along: plot.height, across: plot.width }
}

/** Category `row`'s slot centre across the plot: left to right, or top to bottom. */
function slotAt(s: BarState, row: number, across: number): number {
  const centre = slotCentre(row, s.data.length, across)
  return s.orientation === "horizontal" ? -centre : centre
}

/**
 * Series `index`'s bars in centred pixel space. Side by side, a series divides
 * the slot with its siblings by live weight; stacked, it takes the whole slot
 * and its weight scales its length, so hiding a series reflows rather than
 * punching a hole.
 */
function seriesBars(s: BarState, index: number, plot: Size2D): BarGeometry[] {
  const series = s.series[index]
  if (!series) return []
  const domain = barChartDomain(s)
  const { along, across } = runs(s, plot)
  const n = s.data.length
  const slot = n > 0 ? across / n : 0
  const inner = slot * clamp(s.style.barWidth, 0, 1)
  const stacked = s.stack !== "none"
  let total = 0
  for (let i = 0; i < s.series.length; i++) total += weightAt(s, i)
  const unit = inner / (total > 0 ? total : 1)
  const weight = weightAt(s, index)
  let before = 0
  for (let i = 0; i < index; i++) before += weightAt(s, i)
  const gap = s.series.length > 1 ? s.style.barGap : 0
  const values = s.style.values

  return s.data.map((row, rowIndex) => {
    // Built from live contributions, so a fading series lowers the segments beyond it.
    const spans = barSpans(row, s.series, s.stack, s.weights)
    const span = spans[index] ?? { from: 0, to: 0, value: 0, outer: false }
    const centre = slotAt(s, rowIndex, across)
    const offset = -inner / 2 + unit * before + (unit * weight) / 2
    let caption = ""
    if (values !== "none" && span.value !== 0) {
      if (!stacked || values === "inside" || s.stack === "percent") caption = valueLabel(s, domain, stacked ? span.value : num(row, series.field))
      else if (span.outer) caption = valueLabel(s, domain, span.to)
    }
    return {
      center: stacked ? centre : centre + (s.orientation === "horizontal" ? -offset : offset),
      thickness: stacked ? inner : Math.max(0, unit * weight - gap),
      from: valueToPx(domain, along, span.from),
      to: valueToPx(domain, along, span.to),
      round: span.outer,
      grounded: !stacked || span.from === 0,
      caption,
    }
  })
}

/** Per-row opacity: 1 while nothing is spotlit, falling to {@link SPOTLIGHT_DIM} for all but the chosen category. */
function categoryDims(s: BarState): number[] {
  const focus = clamp(s.spotlightReveal, 0, 1)
  const chosen = s.spotlight
  return s.data.map((_, i) => (focus <= 0 || chosen === i ? 1 : 1 - (1 - SPOTLIGHT_DIM) * focus))
}

/** The parts a bar chart's commands drive, found through its children. */
function partsOf(children: readonly ChildView[]) {
  const views = chartViews(children)
  return {
    valueAxis: views.find((view) => VerticalAxis.is(view) || HorizontalAxis.is(view)) ?? null,
    categoryAxis: views.find(CategoryAxis.is) ?? null,
    bars: views.filter(ChartBars.is),
    legend: views.find(ChartLegend.is) ?? null,
  }
}

/**
 * Move series `index`'s share to `target` with its legend entry. Its bars stay
 * drawn for every frame the move covers and switch off only once a hide has
 * landed, so arriving at a time backwards matches arriving forwards.
 */
function toggling(timeline: AnyTimeline, state: BarState, children: readonly ChildView[], index: number, target: number) {
  const parts = partsOf(children)
  if (!parts.bars[index]) return timeline.wait(timeline.duration)
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
 * A bar chart, vertical or horizontal, its series side by side, stacked, or
 * stacked as shares of 100. Built like the line chart from `ChartCanvas`, a
 * value axis, a {@link CategoryAxis}, one {@link ChartBars} per series and
 * `ChartLegend`. Zero is always on the scale and bars grow about it, so a
 * negative value draws the other way from the same `growth` signal.
 *
 * Resting state is the finished chart; `enter` arms every part on its first
 * frame. A `to` of the value axis's `range` or `ticks` tweens from the domain as
 * drawn, so an auto axis rescales the bars continuously.
 */
export const BarChart = component2d({
  key: "barChart",
  state: {
    data: fresh<DataRecord[]>(() => [], { kind: "dataset" }),
    // Names a column, not a value, like the line chart's `xField`.
    categoryField: "",
    series: fresh<BarSeries[]>(() => [], { kind: "series" }),
    /** `vertical`: columns rise from a row of categories; `horizontal`: bars grow right from a column of them. */
    orientation: Types.oneOf(["vertical", "horizontal"] as const, { animatable: false }),
    /** `stacked`: each series sits on the sum of those before it; `percent`: every category reads as shares of 100. */
    stack: Types.oneOf(["none", "stacked", "percent"] as const),
    valueAxis: Types.custom<AxisDomainConfig>({}, { resolve: resolveAxisDomain, lerp: lerpAxisEntry }),
    categoryAxis: Types.custom<AxisDomainConfig>({}, { resolve: resolveAxisDomain, lerp: lerpAxisDomain }),
    style: BAR_STYLE,
    /** Rise of every bar about the baseline, `[0, 1]`: 0 collapses them onto it. */
    growth: 1,
    /** The category spotlit, or `null`. The choice snaps; `spotlightReveal` animates it. */
    spotlight: Types.custom<number | null>(null),
    spotlightReveal: 0,
    /** Each series' share of the slot, seeded from `enabled`: a weight rather than a switch, so hiding one widens the others. */
    weights: Types.custom<number[]>([], { private: true }),
    /** Whether each series' bars are drawn: on for every frame a show or hide covers, off once a hide lands. */
    showing: Types.custom<boolean[]>([], { private: true }),
  },
  defaults: {
    // A node made of parts that fill would otherwise hug them.
    width: "fill",
    height: "fill",
    weights: (state) => state.series.map((s) => ((s.enabled ?? true) ? 1 : 0)),
    showing: (state) => state.series.map((s) => s.enabled ?? true),
  },
  migrate: { style: migrateChartStyle("cartesian") },
  allowedChildren: [],
  children: (state) => {
    const style = () => state.style
    const domain = () => barChartDomain(state)
    let plot: Node2D | undefined
    const plotSize = () => laidOutSize(plot)
    const built = state.style
    const horizontal = state.orientation === "horizontal"
    const categories = barCategories(state.data, state.categoryField)
    const valueConfig = () => axisConfigOf(style(), horizontal ? "x" : "y")
    const categoryConfig = () => axisConfigOf(style(), horizontal ? "y" : "x")
    const valueCaptions = () => {
      const d = domain()
      return d.ticks.map((value) => valueLabel(state, d, value))
    }
    const showValue = horizontal ? built.showXAxis : built.showYAxis
    const showCategory = horizontal ? built.showYAxis : built.showXAxis

    const valueAxis = showValue
      ? (horizontal
        ? new HorizontalAxis({
          range: () => domain().range,
          markers: () => domain().ticks,
          captions: valueCaptions,
          axis: valueConfig,
          label: state.valueAxis.label ?? "",
          overhang: () => ({ left: overhang(style()), right: overhang(style()) }),
          width: "fill",
          height: "hug",
        })
        : new VerticalAxis({
          range: () => domain().range,
          markers: () => domain().ticks,
          captions: valueCaptions,
          axis: valueConfig,
          label: state.valueAxis.label ?? "",
          width: "hug",
          height: "fill",
        })) as unknown as Node2D
      : undefined

    const categoryAxis = showCategory
      ? (new CategoryAxis({
        categories,
        axis: categoryConfig,
        label: state.categoryAxis.label ?? "",
        orientation: horizontal ? "vertical" : "horizontal",
        dims: () => categoryDims(state),
        width: horizontal ? "hug" : "fill",
        height: horizontal ? "fill" : "hug",
      }) as unknown as Node2D)
      : undefined

    const left = horizontal ? categoryAxis : valueAxis
    const bottom = horizontal ? valueAxis : categoryAxis
    const leftConfig = horizontal ? categoryConfig : valueConfig
    const ghost = left && bottom
      ? columnGhost({
        captions: horizontal ? () => categories : valueCaptions,
        count: horizontal ? categories.length : barChartDomain(state).ticks.length,
        text: () => leftConfig().labelStyle,
        title: (horizontal ? state.categoryAxis.label : state.valueAxis.label) ?? "",
        titleText: () => leftConfig().titleStyle,
        tickPad: () => axisPads(leftConfig(), "right").tick,
        titlePad: () => axisPads(leftConfig(), "right").title,
      })
      : undefined

    const barSets = state.series.map(
      (s, i) =>
        new ChartBars({
          bars: () => seriesBars(state, i, plotSize()),
          baseline: () => valueToPx(domain(), runs(state, plotSize()).along, baselineValue(domain())),
          horizontal,
          fill: () => seriesFill(style(), s, i),
          cornerRadius: () => style().barCornerRadius,
          cornerStyle: () => style().barCornerStyle,
          growth: () => state.growth,
          dims: () => categoryDims(state),
          // A figure past a stack's end prints the stack's total; a percent stack has none worth printing, so prints its shares inside.
          values: () => (built.values === "end" && state.stack === "percent" ? "inside" : built.values),
          valueStyle: () => valueText(style()),
          enabled: () => state.showing[i] ?? (s.enabled ?? true),
        }) as unknown as Node2D
    )

    const legendAt = built.legend
    const legend = legendAt !== "none"
      ? (new ChartLegend({
        series: state.series,
        swatches: () => state.series.map((s, i) => seriesFill(style(), s, i)),
        legend: () => legendConfigOf(style()),
        flow: legendAt === "right" ? "vertical" : "horizontal",
      }) as unknown as Node2D)
      : undefined

    const n = state.data.length
    // Category lines fall between the slots, never through a bar.
    const boundaries = () => Array.from({ length: Math.max(0, n - 1) }, (_, i) => i + 1)
    const slots = (): Range => [0, Math.max(1, n)]
    plot = new Rect({
      children: [
        new ChartCanvas({
          fill: () => style().gridBackground,
          xGridStroke: () => style().verticalGrid,
          yGridStroke: () => style().horizontalGrid,
          xMarkers: horizontal ? () => domain().ticks : boundaries,
          yMarkers: horizontal ? boundaries : () => domain().ticks,
          xExtent: horizontal ? () => domain().range : slots,
          yExtent: horizontal ? slots : () => domain().range,
          axisStroke: () => style().axisStroke,
          xAxisAt: () => (horizontal ? 0 : baselineValue(domain())),
          yAxisAt: () => (horizontal ? baselineValue(domain()) : 0),
        }),
        ...barSets,
      ],
    }) as unknown as Node2D

    return asParts([
      cartesianFrame({
        background: () => style().background,
        left,
        ghost,
        plot,
        bottom,
        legend,
        legendAt,
        gap: () => frameGap(style()),
        padding: () => ({
          top: headroom(style()),
          right: horizontal && bottom ? overhang(style()) : 0,
          left: horizontal && bottom && !left ? overhang(style()) : 0,
          bottom: 0,
        }),
      }),
    ])
  },
  commands: {
    /** Axes stagger in, bars rise from the baseline, the legend fades up last. `duration` is the whole entrance. */
    enter: {
      args: {},
      // Held from arrival, so it never shows finished ahead of its draw.
      entrance: true,
      easing: easeOut(),
      run: (timeline, state, children) => {
        const parts = partsOf(children)
        const duration = timeline.duration
        const axes = duration * ENTER_SHARE.axes
        const rise = duration * ENTER_SHARE.marks
        const { legend } = parts
        const at0 = (piece: Beat["piece"]): Beat => ({ at: 0, duration: 0, piece })
        return beats(timeline, [
          at0(timeline.animate(() => ({ growth: 0 }))),
          ...(legend ? [at0(legend.to({ opacity: 0, ...legendAway(state.style.legend) }))] : []),
          ...(parts.valueAxis ? [{ at: 0, duration: axes, piece: parts.valueAxis.run("enter", { slide: 24 }) }] : []),
          ...(parts.categoryAxis ? [{ at: 0, duration: axes, piece: parts.categoryAxis.run("enter", { slide: 24 }) }] : []),
          // No priming to 0 first: the value at `t` is a function of `t`.
          { at: axes, duration: rise, piece: timeline.animate((t) => ({ growth: t })) },
          ...(legend ? [{ at: axes + rise, duration: duration * ENTER_SHARE.legend, piece: legend.to({ opacity: 1, x: 0, y: 0 }) }] : []),
        ])
      },
    },
    /** Bring series `index` back, the group reflowing to make room, with its legend entry. */
    showSeries: {
      args: { seriesIndex: SERIES_ARG },
      easing: easeOut(),
      run: (timeline, state, children) => toggling(timeline, state, children, timeline.args.seriesIndex, 1),
    },
    /** The mirror of `showSeries`: bars narrow away (stacked, sink out) while the rest widen into the space. */
    hideSeries: {
      args: { seriesIndex: SERIES_ARG },
      easing: easeOut(),
      run: (timeline, state, children) => toggling(timeline, state, children, timeline.args.seriesIndex, 0),
    },
    /** Fade every other series, bars and legend entry, to focus on `index`. Nothing moves, so the group does not reflow. */
    spotlightSeries: {
      args: { seriesIndex: SERIES_ARG },
      easing: easeOut(),
      run: (timeline, _state, children) => {
        const parts = partsOf(children)
        const index = timeline.args.seriesIndex
        return timeline.together([
          ...parts.bars.map((bars, i) => bars.to({ opacity: i === index ? 1 : SPOTLIGHT_DIM })),
          ...(parts.legend ? [parts.legend.run("spotlightSeries", { index })] : []),
          timeline.wait(timeline.duration),
        ])
      },
    },
    /**
     * Fade every other category's bars and caption to {@link SPOTLIGHT_DIM}. While
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
