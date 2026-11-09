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
  clampUnit,
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

export interface BarChartProps extends Node2DProps {
  /** One row per category — a plain record of field name to value. */
  data: DataRecord[]
  /**
   * Key into each row for its category caption, drawn beneath the baseline.
   * Named `categoryField` rather than `category` for the same reason the line
   * chart's is `xField`: it names a *column*, not a value.
   */
  categoryField: string
  /** One entry per bar series: which column it plots, its `label`, its `fill`. */
  series: BarSeries[]
  /**
   * When `true` every category's series stack into one column; when `false`
   * (the default) each series gets its own bar, grouped side by side within the
   * category's slot.
   */
  stacked?: boolean
  /** The value axis's domain: caption, scale range, and tick placement. */
  valueAxis?: AxisDomainConfig
  /** The category axis's domain. Only its `label` is read — the slots are the rows. */
  categoryAxis?: AxisDomainConfig
  /**
   * The chart's visual theme — bar palette and geometry, axis furniture, plot
   * panel paint, legend, value figures. Every branch is optional and deep-merged
   * onto {@link DEFAULT_BAR_CHART_THEME}.
   */
  theme?: BarChartTheme
  /** Whether the legend row below the plot is drawn at all. */
  showLegend?: boolean
  /** Whether each column prints the figure it plots. */
  showValues?: boolean
}

/** What a bar chart plots, as its entries hold it. */
export interface BarChartValues {
  readonly data: DataRecord[]
  readonly series: BarSeries[]
  readonly stacked: boolean
  readonly valueAxis: AxisDomainConfig
}

/** The value axis's domain with its range and ticks resolved. */
export type BarChartDomain = AxisDomainConfig & { readonly range: Range; readonly ticks: number[] }

/** The argument every per-series command takes: an index into `series`, offered by name. */
const SERIES_ARG = Types.custom<number, number, EntryOptions & { readonly min: number; readonly step: number }>(0, { kind: "series", min: 0, step: 1 })

/** How far the legend starts below its slot when it enters, in px. */
const LEGEND_SLIDE = 20

/** Fallback marker count when the value axis states no ticks. */
const DEFAULT_MARKERS = 5

/**
 * How `enter` divides its duration between its three beats: the axes arriving,
 * the columns rising, and the legend coming up. Shares of the whole, so they
 * must sum to 1.
 */
const AXES_SHARE = 0.35
const BARS_SHARE = 0.5
const LEGEND_SHARE = 0.15

/** What the geometry reads: what the chart plots, its theme and the signals its commands move. */
interface BarState extends BarChartValues {
  readonly theme: BarChartConfig
  readonly weights: number[]
  readonly spotlight: number | null
  readonly spotlightReveal: number
}

/** The value axis with its range and ticks resolved: the explicit ones, else five across the scale. */
function drawnValue(s: BarChartValues, domain: AxisDomainConfig): AxisDomainConfig {
  const divisions = (domain.ticks?.length ?? DEFAULT_MARKERS) - 1
  const range = resolveBarScale(s.data, s.series, s.stacked, domain.range, divisions)
  return { ...domain, range, ticks: domain.ticks ?? markerValues(range, DEFAULT_MARKERS - 1) }
}

/** The last domain worked out from each data array, and what else it was read from. */
const domainsDrawn = new WeakMap<DataRecord[], Omit<BarChartValues, "data"> & { readonly domain: BarChartDomain }>()

/** The value axis as a bar chart draws it now, an auto range or tick row read back as itself. */
export function barChartDomain(s: BarChartValues): BarChartDomain {
  const { data, series, stacked, valueAxis } = s
  const kept = domainsDrawn.get(data)
  if (kept && kept.series === series && kept.stacked === stacked && kept.valueAxis === valueAxis) return kept.domain
  const domain = settleAxisDomain(valueAxis, (d) => drawnValue(s, d)) as BarChartDomain
  domainsDrawn.set(data, { series, stacked, valueAxis, domain })
  return domain
}

/**
 * A value written down as this chart's value axis says: the ticks and the
 * figures printed on the columns both read through here, so the two cannot
 * disagree about what a number looks like.
 */
function valueLabel(s: BarChartValues, domain: BarChartDomain, value: number): string {
  const pattern = s.valueAxis.format
  return pattern === undefined ? formatMarker(value, markerStep(domain.ticks)) : formatNumber(value, pattern)
}

/** A value on the plot's **centred** pixel space (origin at its centre, y-up). */
function valueToY(domain: BarChartDomain, plot: Size2D, value: number): number {
  const [min, max] = domain.range
  if (max <= min) return -plot.height / 2
  return ((value - min) / (max - min) - 0.5) * plot.height
}

/**
 * Pixel y of the line every column grows from: zero clamped onto the scale, so
 * a cropped axis grows its columns from the plot floor.
 */
function baselinePx(domain: BarChartDomain, plot: Size2D): number {
  const [min, max] = domain.range
  return valueToY(domain, plot, Math.min(Math.max(0, min), max))
}

/** Series `i`'s live share of the slot; 0 once it has been hidden. */
function weightAt(s: BarState, index: number): number {
  return Math.max(0, s.weights[index] ?? 1)
}

/** `row` with each series' value scaled by its live weight: what the stacked spans are measured from. */
function weightedRow(s: BarState, row: DataRecord): DataRecord {
  const scaled: DataRecord = { ...row }
  s.series.forEach((series, i) => {
    const value = row[series.field]
    if (typeof value === "number") scaled[series.field] = value * weightAt(s, i)
  })
  return scaled
}

/**
 * Series `index`'s columns, mapped into the plot's centred pixel space. A
 * grouped series divides the slot with its siblings by their live weights, a
 * stacked one takes the whole slot and runs from the running total below it,
 * so hiding a series reflows rather than punching a hole.
 */
function seriesBars(s: BarState, index: number, plot: Size2D, captioned: boolean): BarGeometry[] {
  const series = s.series[index]
  if (!series) return []
  const domain = barChartDomain(s)
  const n = s.data.length
  const slotWidth = n > 0 ? plot.width / n : 0
  const slotCenter = (i: number) => -plot.width / 2 + slotWidth * (i + 0.5)
  const inner = slotWidth * clampUnit(s.theme.bar.slotFill)
  const gap = s.theme.bar.groupGap
  let total = 0
  for (let i = 0; i < s.series.length; i++) total += weightAt(s, i)
  const unit = inner / (total > 0 ? total : 1)
  const weight = weightAt(s, index)
  let before = 0
  for (let i = 0; i < index; i++) before += weightAt(s, i)

  return s.data.map((row, rowIndex) => {
    // The stack is built from the *live* contributions, so a series fading out
    // lowers the segments above it as it goes.
    const spans = barSpans(s.stacked ? weightedRow(s, row) : row, s.series, s.stacked)
    const span = spans[index] ?? { from: 0, to: 0, value: 0 }
    const cap = s.stacked ? stackCapIndex(row, s.series) : index
    const slotLeft = slotCenter(rowIndex) - inner / 2
    const x = s.stacked ? slotCenter(rowIndex) : slotLeft + unit * before + (unit * weight) / 2
    const width = s.stacked ? inner : Math.max(0, unit * weight - (s.series.length > 1 ? gap : 0))
    // The figure printed is the row's own value, not the weighted one.
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

/**
 * How far each category is dimmed by the spotlight, one entry per row: 1 while
 * nothing is spotlit, falling to the theme's `dimOpacity` for every category but
 * the chosen one as the reveal climbs.
 */
function categoryDims(s: BarState): number[] {
  const focus = clampUnit(s.spotlightReveal)
  const dim = s.theme.spotlight.dimOpacity
  const chosen = s.spotlight
  return s.data.map((_, i) => (focus <= 0 || chosen === i ? 1 : 1 - (1 - dim) * focus))
}

type AnyTimeline = Timeline<any, any>

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
 * Move series `index`'s slot share to `target` with its legend entry, the group
 * reflowing. Its columns are drawn for every frame the move covers, and switch
 * off only once a hide has landed, so arriving at a time backwards shows what
 * arriving forwards does.
 */
function toggling(timeline: AnyTimeline, state: BarState & { readonly showing: boolean[] }, children: readonly ChildView[], index: number, target: number) {
  const parts = partsOf(children)
  if (!parts || !parts.bars[index]) return timeline.wait(timeline.duration)
  // Read through `weightAt`, so a chart whose stored weights are short still
  // tweens from the 1 it is drawing at.
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
 * A grouped or stacked bar chart, the sibling of the line chart and built the
 * same way, out of several of the same pieces:
 *
 * - `ChartCanvas` — the plot panel with a horizontal grid, under everything.
 * - `VerticalAxis` — the numeric value markers, staggering in bottom-to-top.
 * - {@link CategoryAxis} — the row of names beneath the baseline, one per row.
 * - {@link ChartBars} (one per series) — that series' column in every category,
 *   plus the figures printed on them.
 * - `ChartLegend` — a row of entries below the chart, one per series.
 *
 * Every part reads the chart's entries through bindings, and the columns map
 * across the plot panel's own laid-out box, so a column's end lands exactly on
 * its marker. **Zero is always on the scale**, and the columns grow about it, so
 * a negative value draws downward out of the same `growth` signal.
 *
 * **Resting state is the finished chart**; `enter` arms every part on its first
 * frame. `showSeries`/`hideSeries`/`spotlightSeries` pick out a *series* (hiding
 * one reflows the group), `spotlightCategory`/`clearCategory` a *column of the
 * table*. A `to` of the value axis's `range` or `ticks` tweens from the domain
 * as drawn, so an auto axis rescales the columns continuously.
 */
export const BarChart = component2d({
  key: "barChart",
  state: {
    data: fresh<DataRecord[]>(() => []),
    categoryField: "",
    series: fresh<BarSeries[]>(() => []),
    stacked: false,
    valueAxis: Types.custom<AxisDomainConfig>({}, { resolve: resolveAxisDomain, lerp: lerpAxisEntry }),
    categoryAxis: Types.custom<AxisDomainConfig>({}, { resolve: resolveAxisDomain, lerp: lerpAxisDomain }),
    theme: Types.custom<BarChartTheme, BarChartConfig>(DEFAULT_BAR_CHART_THEME, { resolve: resolveBarChartTheme, lerp: lerpBarChartTheme }),
    /**
     * Global rise of every column in `[0, 1]`, measured about the baseline: 0
     * collapses them all onto it, 1 draws them at full length.
     */
    growth: 1,
    /**
     * How much of the slot each series claims, one entry per series: a weight
     * rather than a switch, so hiding one is the others widening into the space.
     * Seeded from each series' `enabled`.
     */
    weights: fresh<number[]>(() => []),
    /** The category spotlit, or `null` for none. The choice snaps; `spotlightReveal` is the animation. */
    spotlight: Types.custom<number | null>(null),
    /** How far the category spotlight is drawn in, `[0, 1]`. */
    spotlightReveal: 0,
    /** Read as the chart is built: the legend is a part the chart builds or doesn't. */
    showLegend: Types.boolean(true, { animatable: false }),
    /** Read as the chart is built: whether each column prints the figure it plots. */
    showValues: Types.boolean(false, { animatable: false }),
    /** Whether each series' columns are drawn: on for every frame a show or hide covers, off once a hide lands. */
    showing: Types.custom<boolean[]>([], { private: true }),
  },
  defaults: {
    // Its parts fill it; a node made of them would hug them.
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
    // Before the panel is built or laid out it has no size, and the columns map onto nothing.
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
          // No vertical rules: the horizontal axis is categorical, so there is no
          // numeric position along it for a grid line to mark.
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
    /**
     * Animate the whole chart in: the two axes stagger their markers and
     * captions in, the columns rise from the baseline, and the legend fades up
     * last. Its first frame arms every part: markers and captions shifted and
     * transparent, columns collapsed, the legend dropped and transparent.
     * `duration` is the **whole** entrance; the beats are shares of it.
     */
    enter: {
      args: {},
      // Held from the chart's arrival, so it never shows finished ahead of its draw.
      entrance: true,
      easing: easeOut(),
      run: (timeline, _state, children) => {
        const parts = partsOf(children)
        if (!parts) return timeline.wait(timeline.duration)
        const duration = timeline.duration
        const axes = duration * AXES_SHARE
        const rise = duration * BARS_SHARE
        const { legend } = parts
        const at0 = (piece: Beat["piece"]): Beat => ({ at: 0, duration: 0, piece })
        // Without a legend the beat is still its share of the whole.
        return beats(timeline, [
          at0(timeline.animate(() => ({ growth: 0 }))),
          ...(legend ? [at0(legend.to({ opacity: 0, y: -LEGEND_SLIDE }))] : []),
          { at: 0, duration: axes, piece: parts.vAxis.run("enter", { slide: 24 }) },
          { at: 0, duration: axes, piece: parts.cAxis.run("enter", { slide: 24 }) },
          // No priming to 0 first: the value at `t` is a function of `t`.
          { at: axes, duration: rise, piece: timeline.animate((t) => ({ growth: t })) },
          ...(legend ? [{ at: axes + rise, duration: duration * LEGEND_SHARE, piece: legend.to({ opacity: 1, y: 0 }) }] : []),
        ])
      },
    },
    /** Show series `index`: its columns come back, the group reflowing to make room, with its legend entry. */
    showSeries: {
      args: { seriesIndex: SERIES_ARG },
      easing: easeOut(),
      run: (timeline, state, children) => toggling(timeline, state, children, timeline.args.seriesIndex, 1),
    },
    /**
     * Hide series `index`: its columns narrow away (or, stacked, sink out of the
     * stack) while the rest of the group widens into the space — the mirror of
     * `showSeries`.
     */
    hideSeries: {
      args: { seriesIndex: SERIES_ARG },
      easing: easeOut(),
      run: (timeline, state, children) => toggling(timeline, state, children, timeline.args.seriesIndex, 0),
    },
    /**
     * Fade every other series — its columns **and its legend entry** — to focus
     * on `index`, which comes back to full. Nothing moves, so the group doesn't
     * reflow.
     */
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
     * Spotlight one **category**: every other category's columns and caption
     * fade to the theme's `dimOpacity`. Called while another is lit, the focus
     * moves directly: only the dimming changes, so nothing retracts first. A
     * category that is not there takes its slot and changes nothing.
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
    /**
     * Drop the category spotlight, every category back to full. The lit
     * category is held until the fade lands; a no-op when nothing is lit, which
     * still takes its slot.
     */
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
