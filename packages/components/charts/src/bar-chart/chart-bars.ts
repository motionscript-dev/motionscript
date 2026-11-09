import {
  Graphics2D,
  Text,
  Types,
  component2d,
  fillOps,
  shadowOps,
  strokeOps,
  textOps,
  type Fill,
  type FillResolved,
  type NodeOf,
  // Named so this component's emitted type reaches `Node2D` through the sdk, not core.
  type Node2D as _Node2D,
  type Node2DProps,
  type Shadow,
  type ShadowResolved,
  type Stroke,
  type StrokeResolved,
  type TextStyle,
} from "@motionscript/sdk"

import { fresh } from "../kit/entries"
import { frameEase } from "../kit/motion"
import { loadPaints } from "../kit/paints"
import { clampUnit, formatMarker } from "../kit/shared"
import { DEFAULT_BAR_CHART_THEME } from "./shared"

/**
 * One drawn column, already mapped into the plot's **centred pixel space**
 * (origin at the plot centre, y-up) by the parent {@link BarChart}.
 *
 * `from`/`to` are the two ends of the column rather than a base and a height,
 * for the same reason {@link BarSpan} is a span: it is the one shape that fits a
 * grouped bar, a stacked segment and a negative value without a special case.
 */
export interface BarGeometry {
  /** Centre x of the column. */
  x: number
  /** Column width in px. */
  width: number
  /** Pixel y of the column's base — the baseline when grouped, the running stack top when stacked. */
  from: number
  /** Pixel y of its far end, at full {@link ChartBarsProps.growth}. */
  to: number
  /** Whether the far end takes the theme's corner radius (the stack's cap). */
  round: boolean
  /** The value this column plots, for the figure printed on it. */
  value: number
  /**
   * The figure printed on it, written as the chart's value axis writes its
   * ticks, so the two cannot disagree. Absent, the bare marker reading of
   * {@link value}.
   */
  caption?: string
}

/** Gap between a grouped column's end and the figure printed over it, in px. */
const VALUE_GAP = 10
/** A segment shorter than this many multiples of the type size prints no figure. */
const VALUE_FIT = 1.6
/** Fallback type size when the theme's value style leaves it unset or autofit. */
const VALUE_SIZE = 24

export interface ChartBarsProps extends Node2DProps {
  /** This series' columns, one per row of the chart's data. */
  bars: BarGeometry[]
  /** Pixel y of value 0 — where every column grows *from*. */
  baseline: number
  /** Column paint — this series' own, or the theme palette's entry for its index. */
  fill: Fill
  /** Optional outline on every column. */
  barStroke: Stroke
  /** Optional drop shadow on every column. */
  barShadow: Shadow
  /** Radius of the far-end corners, in px. */
  cornerRadius: number
  /**
   * Rise of every column in `[0, 1]`, measured **about the baseline**: 0
   * collapses them all onto it, 1 draws them at full length.
   *
   * Scaling about the baseline rather than about each column's own base is what
   * keeps a stack flush mid-animation — every segment's base and end travel by
   * the same factor, so the segments stay stacked instead of the upper ones
   * floating above the still-growing lower ones. It also means a negative
   * column grows *down* out of the same signal.
   */
  growth: number
  /**
   * Per-column opacity multiplier, by row index — how the chart's category
   * spotlight reaches a single column without touching the series it belongs
   * to. Missing entries read as 1.
   */
  dims: number[]
  /** Whether the figure each column plots is printed on it. */
  showValues: boolean
  /** Type style for those figures. */
  valueStyle: TextStyle
  /**
   * Whether this series draws at all — the wholesale switch behind
   * `BarChart.showSeries`/`hideSeries`, alongside the slot weight that animates
   * the reflow. Off skips the columns *and* their figures.
   */
  enabled: boolean
}

/** What the column geometry reads. */
interface Columns {
  readonly bars: readonly BarGeometry[]
  readonly baseline: number
  readonly growth: number
  readonly dims: readonly number[]
  readonly enabled: boolean
  readonly valueStyle: TextStyle
}

/**
 * How far column `i` is dimmed — the chart's category spotlight, and the series
 * switch on top of it.
 *
 * The captions read this rather than being hidden by `render`'s guard: they are
 * real child nodes, so a `return` in the draw would leave them on screen over a
 * series that isn't there.
 */
function dimAt(s: Columns, index: number): number {
  if (!s.enabled) return 0
  return clampUnit(s.dims[index] ?? 1)
}

/** The two ends of column `i` at the current growth. */
function endsAt(s: Columns, index: number): { base: number; end: number } | null {
  const bar = s.bars[index]
  if (!bar) return null
  const g = clampUnit(s.growth)
  return { base: s.baseline + (bar.from - s.baseline) * g, end: s.baseline + (bar.to - s.baseline) * g }
}

/** The type size the figures are set at, guarding the autofit/unset cases. */
function valueSize(s: Columns): number {
  const size = s.valueStyle.fontSize
  return typeof size === "number" ? size : VALUE_SIZE
}

/** Whether column `i`'s figure sits inside the column (a stacked segment) or past its end. */
function insideAt(s: Columns, index: number): boolean {
  const bar = s.bars[index]
  return bar !== undefined && Math.abs(bar.from - s.baseline) > 0.5
}

/**
 * The figure printed on column `i`, or `""` where there is no room for it.
 *
 * Blanking the text rather than dropping the node keeps the caption list
 * index-aligned with the columns, so a chart that rescales into more room simply
 * starts printing again.
 */
function captionAt(s: Columns, index: number): string {
  const bar = s.bars[index]
  if (!bar || bar.value === 0) return ""
  // An interior segment prints inside itself, so it has to be tall enough to
  // hold a line of type; a grouped column prints in the headroom above its end,
  // where the only constraint is the plot's own top.
  if (insideAt(s, index)) {
    const ends = endsAt(s, index)
    if (!ends) return ""
    if (Math.abs(ends.end - ends.base) < valueSize(s) * VALUE_FIT) return ""
  }
  return bar.caption ?? formatMarker(bar.value)
}

/** Where column `i`'s figure sits, in the node's centred y-up space. */
function captionY(s: Columns, index: number): number {
  const ends = endsAt(s, index)
  if (!ends) return 0
  if (insideAt(s, index)) return (ends.base + ends.end) / 2
  // Text is centred on its `y`, so clear the column's end by the gap plus half a
  // line — on whichever side of the baseline the column actually reached.
  const direction = ends.end >= ends.base ? 1 : -1
  return ends.end + direction * (VALUE_GAP + valueSize(s) / 2)
}

/**
 * One **series** of a {@link BarChart}, drawn as one command list: its column in
 * every category, plus the figures printed on them.
 *
 * A node per series rather than a node per bar, deliberately — it is the same
 * unit `ChartLine` is, which is what lets `showSeries`/`hideSeries`/
 * `spotlightSeries` mean exactly the same thing on a bar chart as on a line
 * chart: enable the node, or tween its opacity. The columns' *positions* come
 * from the parent (it owns the slot arithmetic both modes share), so this part
 * only has to know how to draw a span and grow it.
 *
 * The figures are real {@link Text} children rather than glyphs in the command
 * list, so they take the theme's type style, are measured by the layout engine,
 * and ride the node's own opacity — which is why hiding the series takes its
 * figures with it for free.
 */
export const ChartBars = component2d({
  key: "chartBars",
  state: {
    bars: fresh<BarGeometry[]>(() => []),
    baseline: 0,
    fill: Types.custom<Fill, FillResolved[]>([], { resolve: fillOps.resolve, lerp: fillOps.lerp }),
    barStroke: Types.custom<Stroke, StrokeResolved[]>(DEFAULT_BAR_CHART_THEME.bar.stroke, { resolve: strokeOps.resolve, lerp: strokeOps.lerp }),
    barShadow: Types.custom<Shadow, ShadowResolved[]>(DEFAULT_BAR_CHART_THEME.bar.shadow, { resolve: shadowOps.resolve, lerp: shadowOps.lerp }),
    cornerRadius: DEFAULT_BAR_CHART_THEME.bar.cornerRadius,
    growth: 1,
    dims: fresh<number[]>(() => []),
    showValues: false,
    valueStyle: Types.custom<TextStyle>(DEFAULT_BAR_CHART_THEME.valueStyle),
    enabled: true,
  },
  // A plain node filled its parent; one made of its figures would hug them.
  defaults: { width: "fill", height: "fill" },
  // One caption per column, built once (the row count is fixed at construction,
  // like an axis's marker count) and bound to the live geometry so it travels
  // with its column as the chart grows, rescales or reflows.
  children: (state) => {
    if (!state.showValues) return []
    return state.bars.map((_, i) =>
      Text({
        ...textOps.styleProps(state.valueStyle),
        text: () => captionAt(state, i),
        x: () => state.bars[i]?.x ?? 0,
        y: () => captionY(state, i),
        opacity: () => dimAt(state, i),
      })
    )
  },
  // The column stroke and shadow are named past the conventional slots, so they are named here.
  load: (loader, state) =>
    loadPaints(loader, { fills: [state.fill], shadows: [state.barShadow], strokes: [state.barStroke] }),
  commands: {
    /**
     * Raise every column from the baseline by tweening `growth` `0 → 1`.
     *
     * The mirror of `ChartLine.enter`: same contract that the resting state is
     * the finished one, so the chart arms this back to 0 before animating rather
     * than the node hiding itself at construction. No priming to 0 first: the
     * value at `t` is a function of `t`, so a repeat call re-raises by definition.
     */
    enter: (timeline) => {
      const ease = frameEase(timeline)
      return timeline.animate((t) => ({ growth: ease(t) }))
    },
  },
  render: (ctx, state) => {
    if (state.enabled) {
      for (let i = 0; i < state.bars.length; i++) {
        const bar = state.bars[i]
        const ends = endsAt(state, i)
        if (!ends || bar.width <= 0) continue
        const height = Math.abs(ends.end - ends.base)
        if (height <= 0) continue

        const radius = bar.round ? Math.min(state.cornerRadius, height) : 0
        // A column per `Graphics2D` rather than one list for the series: the
        // category spotlight dims individual columns, and opacity is a property
        // of the command list rather than of a shape within it.
        const g = new Graphics2D()
        const rect = g.rect({
          x: bar.x,
          y: (ends.base + ends.end) / 2,
          width: bar.width,
          height,
          // Corner keys are visual (the renderer keeps them in y-up author space),
          // so a column reaching *up* rounds its `top*` corners and one reaching
          // down its `bottom*` ones. Only the far end rounds, which is what makes
          // a stack read as a single capped column.
          cornerRadius:
            radius > 0
              ? ends.end >= ends.base
                ? { topLeft: radius, topRight: radius, bottomLeft: 0, bottomRight: 0 }
                : { bottomLeft: radius, bottomRight: radius, topLeft: 0, topRight: 0 }
              : 0,
        })
        rect.shadow(state.barShadow)
        rect.fill(state.fill)
        rect.stroke(state.barStroke)
        ctx.draw(g.opacity(dimAt(state, i)))
      }
    }
    ctx.children()
  },
})

export type ChartBars = NodeOf<typeof ChartBars>
