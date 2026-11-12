import {
  Graphics2D,
  Text,
  Types,
  clamp,
  component2d,
  fillOps,
  type Fill,
  type FillResolved,
  type NodeOf,
  // Named so this component's emitted type reaches `Node2D` and its props through the sdk, not core.
  type Node2D,
  type Node2DProps as _Node2DProps,
  type RectCornerRadius as _RectCornerRadius,
  type RectCornerStyle as _RectCornerStyle,
  type TextStyle,
  type CornerRadiusResolved,
  type CornerStyleResolved,
} from "@motionscript/sdk"

import { boundText } from "../kit/cartesian"
import { asParts, fresh } from "../kit/entries"
import { frameEase } from "../kit/motion"
import { loadPaints } from "../kit/paints"
import { formatMarker } from "../kit/shared"
import { inkOn } from "./shared"

/**
 * One drawn bar in the plot's centred pixel space (origin at the centre, y-up),
 * mapped by the parent {@link BarChart}: `center` and `thickness` across the
 * category slot, `from` and `to` along the value axis (y for a column, x for a
 * horizontal bar). Two ends rather than a base and a length, like `BarSpan`:
 * one shape fits grouped, stacked and negative.
 */
export interface BarGeometry {
  center: number
  thickness: number
  /** The base: the baseline when grouped, the running stack end when stacked. */
  from: number
  /** The far end at full growth. */
  to: number
  /** Whether the far end takes the far corners (the stack's last segment on its side). */
  round: boolean
  /** Whether the base takes the base corners (it stands on the baseline: every grouped bar, a stack's first segment). */
  grounded?: boolean
  /** The figure printed by the bar; empty for none. */
  caption: string
}

/** A figure inside a bar needs this much room around it, in multiples of the type size. */
const INSIDE_ROOM = 0.6

interface Bars {
  readonly bars: readonly BarGeometry[]
  readonly baseline: number
  readonly horizontal: boolean
  readonly growth: number
  readonly dims: readonly number[]
  readonly enabled: boolean
  readonly values: "none" | "end" | "inside"
  readonly valueStyle: TextStyle
}

/** Bar `i`'s dimming: the category spotlight, then the series switch. */
function dimAt(s: Bars, index: number): number {
  if (!s.enabled) return 0
  return clamp(s.dims[index] ?? 1, 0, 1)
}

/** Bar `i`'s two ends as grown so far, along the value axis. */
function endsAt(s: Bars, index: number): { base: number; end: number } | null {
  const bar = s.bars[index]
  if (!bar) return null
  const g = clamp(s.growth, 0, 1)
  return { base: s.baseline + (bar.from - s.baseline) * g, end: s.baseline + (bar.to - s.baseline) * g }
}

function sizeOf(style: TextStyle): number {
  return typeof style.fontSize === "number" ? style.fontSize : 24
}

/** Where bar `i`'s figure sits along the value axis: past its end, or in its middle. */
function captionAlong(s: Bars, index: number, extent: number): number {
  const ends = endsAt(s, index)
  if (!ends) return 0
  if (s.values === "inside") return (ends.base + ends.end) / 2
  const direction = ends.end >= ends.base ? 1 : -1
  return ends.end + direction * (sizeOf(s.valueStyle) * 0.4 + extent / 2)
}

/** Whether bar `i` has room for a figure `extent` long inside it. */
function fitsInside(s: Bars, index: number, extent: number, across: number): boolean {
  const bar = s.bars[index]
  const ends = endsAt(s, index)
  if (!bar || !ends) return false
  const room = sizeOf(s.valueStyle) * INSIDE_ROOM
  return Math.abs(ends.end - ends.base) >= extent + room && bar.thickness >= across
}

/**
 * One series of a {@link BarChart}: its bar in every category plus the printed
 * figures. A node per series, like `ChartLine`, so `showSeries` and
 * `spotlightSeries` mean the same on both: enable the node or tween its opacity.
 * Positions come from the parent, which owns the slot arithmetic.
 */
export const ChartBars = component2d({
  key: "chartBars",
  state: {
    bars: fresh<BarGeometry[]>(() => []),
    /** Pixel position of value 0 along the value axis, where every bar grows from. */
    baseline: 0,
    /** Bars grow along x from a category column rather than along y from a row. */
    horizontal: false,
    fill: Types.custom<Fill, FillResolved[]>([], { resolve: fillOps.resolve, lerp: fillOps.lerp }),
    /** As for a bar standing up from the baseline: `topLeft`/`topRight` round its far end, the bottom pair its base. */
    cornerRadius: Types.cornerRadius(8),
    cornerStyle: Types.cornerStyle("rounded"),
    /**
     * Rise of every bar in `[0, 1]` about the baseline, not each bar's own base:
     * every segment travels by the same factor, so a stack stays flush
     * mid-animation and a negative bar grows the other way.
     */
    growth: 1,
    /** Per-bar opacity by row index, how the category spotlight reaches one bar. Missing reads as 1. */
    dims: fresh<number[]>(() => []),
    /** Read as built: whether each bar prints its figure, and where. */
    values: Types.custom<"none" | "end" | "inside">("none"),
    valueStyle: Types.custom<TextStyle>({ fontSize: 24, fill: "white" }),
    /** The wholesale switch behind `showSeries`/`hideSeries`; off skips the bars and their figures. */
    enabled: true,
  },
  // A node made of its figures would otherwise hug them.
  defaults: { width: "fill", height: "fill" },
  // One figure per bar, built once (the row count is fixed at construction)
  // and bound to the live geometry so it travels with its bar.
  children: (state) => {
    if (state.values === "none") return []
    return asParts(state.bars.map((_, i) => {
      const caption: Node2D = new Text({
        ...boundText(() => ({ ...state.valueStyle, ...(state.values === "inside" && { fill: inkOn(state.fill) }) })),
        text: () => state.bars[i]?.caption ?? "",
        x: () => (state.horizontal ? captionAlong(state, i, caption.layoutBounds.width) : (state.bars[i]?.center ?? 0)),
        y: () => (state.horizontal ? (state.bars[i]?.center ?? 0) : captionAlong(state, i, caption.layoutBounds.height)),
        opacity: () => {
          const box = caption.layoutBounds
          const along = state.horizontal ? box.width : box.height
          const across = state.horizontal ? box.height : box.width
          if (state.values === "inside" && !fitsInside(state, i, along, across)) return 0
          // A figure past the end rises in with its bar's last stretch.
          return dimAt(state, i) * clamp((state.growth - 0.6) / 0.4, 0, 1)
        },
      }) as unknown as Node2D
      return caption
    }))
  },
  load: (loader, state) => loadPaints(loader, { fills: [state.fill] }),
  commands: {
    /** Raise every bar from the baseline (`growth` 0 to 1). The resting state is the finished one; the chart arms it back to 0. */
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
        if (!ends || bar.thickness <= 0) continue
        // A segment inside a stack reaches a pixel under the next, so no seam of background shows between them.
        const seam = bar.round ? 0 : 1
        const length = Math.abs(ends.end - ends.base) + seam
        if (length <= seam) continue
        const forward = ends.end >= ends.base
        const mid = (ends.base + ends.end) / 2 + (forward ? seam : -seam) / 2
        const corners = barCorners(state, bar, forward, length)
        // One `Graphics2D` per bar: opacity belongs to the command list, and the spotlight dims single bars.
        const g = new Graphics2D().rect(state.horizontal
          ? { x: mid, y: bar.center, width: length, height: bar.thickness, ...corners }
          : { x: bar.center, y: mid, width: bar.thickness, height: length, ...corners })
        g.fill(state.fill)
        ctx.draw(g.opacity(dimAt(state, i)))
      }
    }
    ctx.children()
  },
})

export type ChartBars = NodeOf<typeof ChartBars>

type Corners<T> = { topLeft: T; topRight: T; bottomRight: T; bottomLeft: T }

/**
 * Turns corners written for a bar standing up into the drawn bar's visual
 * (y-up) corners: mirrored for a bar below zero, turned a quarter clockwise
 * for one growing right, and both for one growing left.
 */
function orient<T>(c: Corners<T>, horizontal: boolean, forward: boolean): Corners<T> {
  if (!horizontal) return forward ? c : { topLeft: c.bottomLeft, topRight: c.bottomRight, bottomRight: c.topRight, bottomLeft: c.topLeft }
  return forward
    ? { topLeft: c.bottomLeft, topRight: c.topLeft, bottomRight: c.topRight, bottomLeft: c.bottomRight }
    : { topLeft: c.topLeft, topRight: c.bottomLeft, bottomRight: c.bottomRight, bottomLeft: c.topRight }
}

/** Bar `bar`'s rect corners: the far pair only where its stack ends, the base pair only on the baseline, each held inside the bar. */
export function barCorners(
  state: { readonly cornerRadius: CornerRadiusResolved; readonly cornerStyle: CornerStyleResolved; readonly horizontal: boolean },
  bar: BarGeometry,
  forward: boolean,
  length: number
): { cornerRadius: Corners<number>; cornerStyle: CornerStyleResolved } {
  const grounded = bar.grounded ?? true
  const r = state.cornerRadius
  const ends = (bar.round ? 1 : 0) + (grounded ? 1 : 0)
  const cap = Math.max(0, Math.min(bar.thickness / 2, ends > 1 ? length / 2 : length))
  const fit = (v: number, on: boolean) => (on ? Math.max(0, Math.min(v, cap)) : 0)
  const upright: Corners<number> = {
    topLeft: fit(r.topLeft, bar.round),
    topRight: fit(r.topRight, bar.round),
    bottomRight: fit(r.bottomRight, grounded),
    bottomLeft: fit(r.bottomLeft, grounded),
  }
  return { cornerRadius: orient(upright, state.horizontal, forward), cornerStyle: orient(state.cornerStyle, state.horizontal, forward) }
}

/** A figure as the bar prints it when the chart gives no caption. */
export function barCaption(value: number): string {
  return value === 0 ? "" : formatMarker(value)
}
