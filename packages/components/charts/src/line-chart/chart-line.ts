import {
  Graphics2D,
  Types,
  component2d,
  strokeOps,
  type NodeOf,
  // Named so this component's emitted type reaches `Node2D` through the sdk, not core.
  type Node2D as _Node2D,
  type Stroke,
  type StrokeResolved,
  type Vector2,
} from "@motionscript/sdk"

import { fresh } from "../kit/entries"
import { frameEase } from "../kit/motion"
import { loadPaints } from "../kit/paints"
import { SPOTLIGHT_DIM } from "../kit/shared"
import {
  EMPTY_REGION_BOX,
  clipPolylineToBox,
  hasRegion,
  type RegionBox,
} from "./shared"

/**
 * The prefix of `pts` revealed at fraction `p ∈ [0, 1]`, measuring the reveal
 * by *cumulative arc length* so the line traces at a steady pace regardless of
 * uneven point spacing. Returns the whole-point prefix plus one interpolated
 * point partway along the active segment.
 */
function tracePoints(pts: Vector2[], p: number): Vector2[] {
  if (p >= 1 || pts.length < 2) return pts
  if (p <= 0) return []

  const segLen: number[] = []
  let total = 0
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
    segLen.push(d)
    total += d
  }
  if (total === 0) return pts

  let target = total * p
  const out: Vector2[] = [pts[0]]
  for (let i = 0; i < segLen.length; i++) {
    if (target >= segLen[i]) {
      out.push(pts[i + 1])
      target -= segLen[i]
    } else {
      const t = segLen[i] === 0 ? 0 : target / segLen[i]
      out.push({
        x: pts[i].x + (pts[i + 1].x - pts[i].x) * t,
        y: pts[i].y + (pts[i + 1].y - pts[i].y) * t,
      })
      break
    }
  }
  return out
}

/**
 * A single series line of a {@link LineChart}: one rounded polyline traced
 * through pre-mapped pixel `points`, drawn as one {@link Graphics2D} command list.
 * Sized and positioned by the parent, which shares the plot's coordinate frame.
 *
 * Two signals drive it: `progress` traces the line in
 * (animated by `enter`) and `enabled` shows or hides it wholesale.
 */
export const ChartLine = component2d({
  key: "chartLine",
  state: {
    /** The series polyline, already mapped into this node's local pixel space (origin at centre, y-up) by the parent {@link LineChart}. Ordered along x. */
    points: fresh<Vector2[]>(() => []),
    /** Line colour + weight (+ optional dash/cap/join) — the per-series stroke. */
    stroke: Types.custom<Stroke, StrokeResolved[]>([], { resolve: strokeOps.resolve, lerp: strokeOps.lerp }),
    /**
     * Reveal of the line in `[0, 1]`: 0 hides it, 1 traces it fully from its left
     * end to its right. Defaults to 1, so the paused editor canvas paints the line;
     * `enter` drives it from 0 regardless of where it rests.
     */
    progress: 1,
    /** Whether this line is drawn at all: the switch the chart flips alongside its legend's per-series toggle. */
    enabled: true,
    /** A slice of the plot to spotlight, in this node's own pixel space: outside it the line drops to `dimOpacity`. */
    spotlight: fresh<RegionBox>(() => EMPTY_REGION_BOX),
    /** Opacity the out-of-region stretches fade to. */
    dimOpacity: SPOTLIGHT_DIM,
  },
  load: (loader, state) => loadPaints(loader, { strokes: [state.stroke] }),
  commands: {
    /**
     * Trace the line from `from` to `to` over the command — by default in from
     * its left end to its right. `showSeries` and `hideSeries` are the same
     * motion in opposite directions, so both are this with their ends stated.
     *
     * `enabled` rides along in the same value rather than being set before or
     * after the command: a line is drawable for every `t` the trace covers and
     * undrawn outside it, which is what makes arriving at a time backwards show
     * what arriving forwards does.
     */
    enter: {
      args: { from: Types.number(0, { min: 0, max: 1 }), to: Types.number(1, { min: 0, max: 1 }) },
      run: (timeline) => {
        const { from, to } = timeline.args
        const ease = frameEase(timeline)
        return timeline.animate((t) => {
          const progress = from + (to - from) * ease(t)
          // Hidden only once it has fully retraced, so the last frame of a hide is
          // the empty plot rather than a line that vanished a frame early.
          return { progress, enabled: progress > 0 }
        })
      },
    },
  },
  render: (ctx, state) => {
    if (!state.enabled) return
    const pts = state.points
    if (pts.length < 2) return

    const p = Math.max(0, Math.min(1, state.progress))
    if (p <= 0) return

    const drawn = tracePoints(pts, p)
    if (drawn.length < 2) return
    const stroke = state.stroke
    const radius = (stroke[0]?.weight ?? 0) * 2 // round the joins

    const box = state.spotlight
    if (!hasRegion(box)) {
      ctx.draw(new Graphics2D().line({ points: drawn, radius }).stroke(stroke))
      return
    }

    // Spotlit: the whole line goes down to `dimOpacity`, then the stretches
    // inside the region are re-drawn over it at full strength. Two passes rather
    // than one dim + one bright *complementary* pair, so the bright run has
    // continuous geometry through the region and its joins round the way an
    // unspotlit line's do — and so the boundary lands exactly on the region edge.
    ctx.draw(
      new Graphics2D()
        .line({ points: drawn, radius })
        .stroke(stroke)
        .opacity(Math.max(0, Math.min(1, state.dimOpacity)))
    )

    // One `draw` per run: shapes chained before a `stroke()` are combined into a
    // single surface, and stroking a union of disjoint open paths doesn't paint
    // — so a line that leaves the region and comes back would lose both halves.
    for (const run of clipPolylineToBox(drawn, box)) {
      ctx.draw(new Graphics2D().line({ points: run, radius }).stroke(stroke))
    }
  },
})

export type ChartLine = NodeOf<typeof ChartLine>
