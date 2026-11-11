import {
  Graphics2D,
  Text,
  Types,
  clamp,
  component2d,
  fillOps,
  shadowOps,
  strokeOps,
  textOps,
  type Fill,
  type FillResolved,
  type NodeOf,
  // Named so this component's emitted type reaches `Node2D` and its props through the sdk, not core.
  type Node2D as _Node2D,
  type Node2DProps as _Node2DProps,
  type Shadow,
  type ShadowResolved,
  type Stroke,
  type StrokeResolved,
  type TextStyle,
} from "@motionscript/sdk"

import { fresh } from "../kit/entries"
import { frameEase } from "../kit/motion"
import { loadPaints } from "../kit/paints"
import { formatMarker } from "../kit/shared"
import { DEFAULT_BAR_CHART_THEME } from "./shared"

/**
 * One drawn column in the plot's centred pixel space (origin at the centre,
 * y-up), mapped by the parent {@link BarChart}. `from`/`to` are the two ends
 * rather than a base and a height, like {@link BarSpan}: one shape fits grouped,
 * stacked and negative.
 */
export interface BarGeometry {
  /** Centre x. */
  x: number
  width: number
  /** Pixel y of the base: the baseline when grouped, the running stack top when stacked. */
  from: number
  /** Pixel y of the far end at full growth. */
  to: number
  /** Whether the far end takes the corner radius (the stack's cap). */
  round: boolean
  /** The value plotted, for the printed figure. */
  value: number
  /** The printed figure, written as the value axis writes its ticks; absent, the bare marker reading of `value`. */
  caption?: string
}

/** Gap between a grouped column's end and the figure printed over it, in px. */
const VALUE_GAP = 10
/** A segment shorter than this many multiples of the type size prints no figure. */
const VALUE_FIT = 1.6
/** Fallback type size when the theme's value style leaves it unset or autofit. */
const VALUE_SIZE = 24

interface Columns {
  readonly bars: readonly BarGeometry[]
  readonly baseline: number
  readonly growth: number
  readonly dims: readonly number[]
  readonly enabled: boolean
  readonly valueStyle: TextStyle
}

/**
 * Column `i`'s dimming: the category spotlight, then the series switch. Captions
 * read this because they are child nodes, which a `render` guard would leave on
 * screen over a series that is not there.
 */
function dimAt(s: Columns, index: number): number {
  if (!s.enabled) return 0
  return clamp(s.dims[index] ?? 1, 0, 1)
}

function endsAt(s: Columns, index: number): { base: number; end: number } | null {
  const bar = s.bars[index]
  if (!bar) return null
  const g = clamp(s.growth, 0, 1)
  return { base: s.baseline + (bar.from - s.baseline) * g, end: s.baseline + (bar.to - s.baseline) * g }
}

function valueSize(s: Columns): number {
  const size = s.valueStyle.fontSize
  return typeof size === "number" ? size : VALUE_SIZE
}

function insideAt(s: Columns, index: number): boolean {
  const bar = s.bars[index]
  return bar !== undefined && Math.abs(bar.from - s.baseline) > 0.5
}

/** Column `i`'s figure, or `""` where there is no room. Blanking rather than dropping the node keeps captions index-aligned, so a rescale into more room prints again. */
function captionAt(s: Columns, index: number): string {
  const bar = s.bars[index]
  if (!bar || bar.value === 0) return ""
  // An interior segment prints inside itself and must hold a line of type; a grouped column prints past its end.
  if (insideAt(s, index)) {
    const ends = endsAt(s, index)
    if (!ends) return ""
    if (Math.abs(ends.end - ends.base) < valueSize(s) * VALUE_FIT) return ""
  }
  return bar.caption ?? formatMarker(bar.value)
}

function captionY(s: Columns, index: number): number {
  const ends = endsAt(s, index)
  if (!ends) return 0
  if (insideAt(s, index)) return (ends.base + ends.end) / 2
  // Text is centred on `y`: clear the end by the gap plus half a line, on the side the column reached.
  const direction = ends.end >= ends.base ? 1 : -1
  return ends.end + direction * (VALUE_GAP + valueSize(s) / 2)
}

/**
 * One series of a {@link BarChart}: its column in every category plus the
 * printed figures. A node per series, like `ChartLine`, so `showSeries` and
 * `spotlightSeries` mean the same on both: enable the node or tween its opacity.
 * Positions come from the parent, which owns the slot arithmetic.
 *
 * The figures are {@link Text} children, so they take the theme's type style,
 * are measured by layout, and hide with the series.
 */
export const ChartBars = component2d({
  key: "chartBars",
  state: {
    bars: fresh<BarGeometry[]>(() => []),
    /** Pixel y of value 0, where every column grows from. */
    baseline: 0,
    fill: Types.custom<Fill, FillResolved[]>([], { resolve: fillOps.resolve, lerp: fillOps.lerp }),
    barStroke: Types.custom<Stroke, StrokeResolved[]>(DEFAULT_BAR_CHART_THEME.bar.stroke, { resolve: strokeOps.resolve, lerp: strokeOps.lerp }),
    barShadow: Types.custom<Shadow, ShadowResolved[]>(DEFAULT_BAR_CHART_THEME.bar.shadow, { resolve: shadowOps.resolve, lerp: shadowOps.lerp }),
    cornerRadius: DEFAULT_BAR_CHART_THEME.bar.cornerRadius,
    /**
     * Rise of every column in `[0, 1]` about the baseline, not each column's own
     * base: every segment travels by the same factor, so a stack stays flush
     * mid-animation and a negative column grows down.
     */
    growth: 1,
    /** Per-column opacity by row index, how the category spotlight reaches one column. Missing reads as 1. */
    dims: fresh<number[]>(() => []),
    showValues: false,
    valueStyle: Types.custom<TextStyle>(DEFAULT_BAR_CHART_THEME.valueStyle),
    /** The wholesale switch behind `showSeries`/`hideSeries`; off skips the columns and their figures. */
    enabled: true,
  },
  // A node made of its figures would otherwise hug them.
  defaults: { width: "fill", height: "fill" },
  // One caption per column, built once (the row count is fixed at construction)
  // and bound to the live geometry so it travels with its column.
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
  // The stroke and shadow sit past the conventional slots, so they are named here.
  load: (loader, state) =>
    loadPaints(loader, { fills: [state.fill], shadows: [state.barShadow], strokes: [state.barStroke] }),
  commands: {
    /** Raise every column from the baseline (`growth` 0 to 1). The resting state is the finished one; the chart arms it back to 0. */
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
        // One `Graphics2D` per column: opacity belongs to the command list, and the spotlight dims single columns.
        const g = new Graphics2D()
        const rect = g.rect({
          x: bar.x,
          y: (ends.base + ends.end) / 2,
          width: bar.width,
          height,
          // Corner keys are visual (y-up): a column reaching up rounds `top*`, one reaching down `bottom*`. Only the far end rounds.
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
