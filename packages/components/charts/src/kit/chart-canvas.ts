import {
  Graphics2D,
  Types,
  component2d,
  fillOps,
  strokeOps,
  type Fill,
  type FillResolved,
  type NodeOf,
  // Named so this component's emitted type reaches `Node2D` and its props through the sdk, not core.
  type Node2D as _Node2D,
  type Node2DProps as _Node2DProps,
  type RenderContext,
  type Stroke,
  type StrokeResolved,
  type Vector2,
} from "@motionscript/sdk"

import { fresh } from "./entries"
import { loadPaints } from "./paints"
import type { Range } from "./shared"

const strokeEntry = () => Types.custom<Stroke, StrokeResolved[]>([], { resolve: strokeOps.resolve, lerp: strokeOps.lerp })

/** Where along a scale a fraction lands in a run of `length` px centred on 0. */
function along(value: number, [min, max]: Range, length: number): number {
  return (max <= min ? 0 : (value - min) / (max - min) - 0.5) * length
}

/** One rule per draw: stroking a union of open paths paints nothing, and a dashed rule keeps its own phase. */
export function rule(ctx: RenderContext, from: Vector2, to: Vector2, stroke: StrokeResolved[], opacity = 1): void {
  ctx.draw(new Graphics2D().line({ points: [from, to] }).stroke(stroke).opacity(opacity))
}

/**
 * The plot backdrop: the panel fill, the grid and the axis rules, sized from its
 * box. Grid lines are placed from data-unit marker positions mapped through the
 * extents, so each lands under its marker however the markers are spaced; a line
 * on an edge is drawn just inside it.
 */
export const ChartCanvas = component2d({
  key: "chartCanvas",
  state: {
    fill: Types.custom<Fill, FillResolved[]>([], { resolve: fillOps.resolve, lerp: fillOps.lerp }),
    /** The vertical grid lines, one per `xMarkers` entry. */
    xGridStroke: strokeEntry(),
    /** The horizontal grid lines, one per `yMarkers` entry. */
    yGridStroke: strokeEntry(),
    xMarkers: fresh<number[]>(() => []),
    yMarkers: fresh<number[]>(() => []),
    /** `[min, max]` of each scale, mapping the markers into the panel. */
    xExtent: fresh<Range>(() => [0, 1]),
    yExtent: fresh<Range>(() => [0, 1]),
    /** The baseline and the value-axis rule. */
    axisStroke: strokeEntry(),
    /** Where the horizontal axis rule sits on the y scale, or `null` for none. */
    xAxisAt: Types.custom<number | null>(null),
    /** Where the vertical axis rule sits on the x scale, or `null` for none. */
    yAxisAt: Types.custom<number | null>(null),
  },
  load: (loader, state) => loadPaints(loader, { fills: [state.fill], strokes: [state.xGridStroke, state.yGridStroke, state.axisStroke] }),
  render: (ctx, state) => {
    const { width: W, height: H } = ctx.size
    if (W <= 0 || H <= 0) return
    if (state.fill.length > 0) ctx.draw(new Graphics2D().rect({ x: 0, y: 0, width: W, height: H }).fill(state.fill))

    const inside = (at: number, length: number, weight: number) => Math.max(-length / 2 + weight / 2, Math.min(length / 2 - weight / 2, at))
    const verticals = (values: readonly number[], stroke: StrokeResolved[]) => {
      const weight = stroke[0]?.weight ?? 0
      if (weight <= 0) return
      for (const v of values) {
        const x = inside(along(v, state.xExtent, W), W, weight)
        rule(ctx, { x, y: -H / 2 }, { x, y: H / 2 }, stroke)
      }
    }
    const horizontals = (values: readonly number[], stroke: StrokeResolved[]) => {
      const weight = stroke[0]?.weight ?? 0
      if (weight <= 0) return
      for (const v of values) {
        const y = inside(along(v, state.yExtent, H), H, weight)
        rule(ctx, { x: -W / 2, y }, { x: W / 2, y }, stroke)
      }
    }
    const within = ([min, max]: Range) => (v: number) => v >= Math.min(min, max) - 1e-9 && v <= Math.max(min, max) + 1e-9
    verticals(state.xMarkers.filter(within(state.xExtent)), state.xGridStroke)
    horizontals(state.yMarkers.filter(within(state.yExtent)), state.yGridStroke)
    if (state.xAxisAt !== null) horizontals([state.xAxisAt], state.axisStroke)
    if (state.yAxisAt !== null) verticals([state.yAxisAt], state.axisStroke)
  },
})

export type ChartCanvas = NodeOf<typeof ChartCanvas>
