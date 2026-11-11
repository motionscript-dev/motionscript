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
  type Stroke,
  type StrokeResolved,
} from "@motionscript/sdk"

import { fresh } from "../kit/entries"
import { loadPaints } from "../kit/paints"
import {
  DEFAULT_CHART_THEME,
  EMPTY_REGION_BOX,
  hasRegion,
  type RegionBox,
} from "./shared"

/**
 * The call-out of a {@link LineChart}: a washed rectangle with a dashed rule on
 * each bounded edge, drawn from the pre-mapped `box`. Dimming the series outside
 * is {@link ChartLine}'s job, clipped against the same box so the two agree on
 * the boundary. An unbounded edge is the plot's own border, and a rule there
 * would assert a limit the author did not set.
 */
export const ChartRegion = component2d({
  key: "chartRegion",
  state: {
    /** In this node's pixel space (origin at centre, y-up), mapped by the parent. A degenerate box draws nothing. */
    box: fresh<RegionBox>(() => EMPTY_REGION_BOX),
    stroke: Types.custom<Stroke, StrokeResolved[]>(DEFAULT_CHART_THEME.region.stroke, { resolve: strokeOps.resolve, lerp: strokeOps.lerp }),
    fill: Types.custom<Fill, FillResolved[]>(DEFAULT_CHART_THEME.region.fill, { resolve: fillOps.resolve, lerp: fillOps.lerp }),
    /** Driven by the chart's `regionReveal`, so the rules and the series' dimming move as one. */
    reveal: 0,
  },
  load: (loader, state) => loadPaints(loader, { fills: [state.fill], strokes: [state.stroke] }),
  render: (ctx, state) => {
    const box = state.box
    if (!hasRegion(box)) return

    const r = Math.max(0, Math.min(1, state.reveal))
    if (r <= 0) return

    const width = box.right - box.left
    const height = box.top - box.bottom
    const cx = (box.left + box.right) / 2
    const cy = (box.bottom + box.top) / 2

    if (state.fill.length > 0) {
      ctx.draw(new Graphics2D().rect({ x: cx, y: cy, width, height }).fill(state.fill).opacity(r))
    }

    if (state.stroke.length === 0) return

    // One `draw` per rule: stroking a union of disjoint open paths paints nothing.
    const rule = (points: { x: number; y: number }[]) =>
      ctx.draw(new Graphics2D().line({ points }).stroke(state.stroke).opacity(r))

    if (box.xBounded) {
      const half = (height / 2) * r
      for (const x of [box.left, box.right]) rule([{ x, y: cy - half }, { x, y: cy + half }])
    }
    if (box.yBounded) {
      const half = (width / 2) * r
      for (const y of [box.bottom, box.top]) rule([{ x: cx - half, y }, { x: cx + half, y }])
    }
  },
})

export type ChartRegion = NodeOf<typeof ChartRegion>
