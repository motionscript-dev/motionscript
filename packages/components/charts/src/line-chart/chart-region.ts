import {
  Graphics2D,
  Types,
  component2d,
  fillOps,
  strokeOps,
  type Fill,
  type FillResolved,
  type NodeOf,
  // Named so this component's emitted type reaches `Node2D` through the sdk, not core.
  type Node2D as _Node2D,
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
 * The **region call-out** of a {@link LineChart}: a washed rectangle over the
 * plot with a dashed rule down each edge the author actually bounded. Sized and
 * positioned entirely from the pre-mapped `box` rather
 * than its own box — the region already carries the plot geometry.
 *
 * It draws only the *marking*; fading the series outside the region is
 * {@link ChartLine}'s job (it clips its own polyline against the same box), so
 * the two can't disagree about where the boundary is.
 *
 * Only bounded edges get a rule: a region given just an `x` range spans the full
 * plot height, so its top and bottom edges are the plot's own border, not a data
 * bound — drawing dashes there would assert a limit the author didn't set.
 */
export const ChartRegion = component2d({
  key: "chartRegion",
  state: {
    /** The highlighted slice, already resolved into this node's local pixel space (origin at centre, y-up) by the parent {@link LineChart}. A degenerate box draws nothing. */
    box: fresh<RegionBox>(() => EMPTY_REGION_BOX),
    /** Dashed rule marking each *bounded* edge of the box. */
    stroke: Types.custom<Stroke, StrokeResolved[]>(DEFAULT_CHART_THEME.region.stroke, { resolve: strokeOps.resolve, lerp: strokeOps.lerp }),
    /** Wash filling the box, under the series lines. */
    fill: Types.custom<Fill, FillResolved[]>(DEFAULT_CHART_THEME.region.fill, { resolve: fillOps.resolve, lerp: fillOps.lerp }),
    /** Reveal of the annotation in `[0, 1]`, driven by the chart's own `regionReveal` so the rules and the series' dimming move as one. */
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

    // Wash first, so the rules sit over their own tint.
    if (state.fill.length > 0) {
      ctx.draw(new Graphics2D().rect({ x: cx, y: cy, width, height }).fill(state.fill).opacity(r))
    }

    // One rule per bounded edge, growing from the region's centre outward as
    // `reveal` climbs — the same "trace it in" beat as the series lines.
    if (state.stroke.length === 0) return

    // One `draw` per rule rather than four line ops under a single paint:
    // shapes chained before a `stroke()` are combined into one surface, and
    // stroking a union of disjoint open paths doesn't paint.
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
