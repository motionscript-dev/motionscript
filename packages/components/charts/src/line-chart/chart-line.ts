import {
  Graphics2D,
  Types,
  component2d,
  strokeOps,
  type NodeOf,
  // Named so this component's emitted type reaches `Node2D` and its props through the sdk, not core.
  type Node2D as _Node2D,
  type Node2DProps as _Node2DProps,
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

/** The prefix of `pts` revealed at fraction `p`, measured by cumulative arc length so the trace keeps a steady pace over uneven spacing. */
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

/** One series of a {@link LineChart}: a rounded polyline through pre-mapped pixel `points`, one {@link Graphics2D} command list. `progress` traces it in; `enabled` shows or hides it wholesale. */
export const ChartLine = component2d({
  key: "chartLine",
  state: {
    /** In this node's pixel space (origin at centre, y-up), mapped by the parent and ordered along x. */
    points: fresh<Vector2[]>(() => []),
    stroke: Types.custom<Stroke, StrokeResolved[]>([], { resolve: strokeOps.resolve, lerp: strokeOps.lerp }),
    /** Trace from the left end, `[0, 1]`. Rests at 1 so a paused editor canvas paints the line; `enter` drives it from 0. */
    progress: 1,
    /** Whether the line is drawn at all, flipped alongside its legend entry. */
    enabled: true,
    /** In this node's pixel space; outside it the line drops to `dimOpacity`. */
    spotlight: fresh<RegionBox>(() => EMPTY_REGION_BOX),
    dimOpacity: SPOTLIGHT_DIM,
  },
  load: (loader, state) => loadPaints(loader, { strokes: [state.stroke] }),
  commands: {
    /**
     * Trace the line from `from` to `to`; `showSeries`/`hideSeries` are this with
     * the ends stated. `enabled` rides along in the same value, so the line is
     * drawable for every `t` the trace covers and arriving backwards matches
     * arriving forwards.
     */
    enter: {
      args: { from: Types.number(0, { min: 0, max: 1 }), to: Types.number(1, { min: 0, max: 1 }) },
      run: (timeline) => {
        const { from, to } = timeline.args
        const ease = frameEase(timeline)
        return timeline.animate((t) => {
          const progress = from + (to - from) * ease(t)
          // Hidden only once fully retraced, so a hide does not vanish a frame early.
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
    const radius = (stroke[0]?.weight ?? 0) * 2

    const box = state.spotlight
    if (!hasRegion(box)) {
      ctx.draw(new Graphics2D().line({ points: drawn, radius }).stroke(stroke))
      return
    }

    // Dim the whole line, then redraw the stretches inside the region at full strength: the bright run keeps continuous geometry and round joins, and the boundary lands on the region edge.
    ctx.draw(
      new Graphics2D()
        .line({ points: drawn, radius })
        .stroke(stroke)
        .opacity(Math.max(0, Math.min(1, state.dimOpacity)))
    )

    // One `draw` per run: shapes chained before `stroke()` combine into one surface, and stroking a union of disjoint open paths paints nothing.
    for (const run of clipPolylineToBox(drawn, box)) {
      ctx.draw(new Graphics2D().line({ points: run, radius }).stroke(stroke))
    }
  },
})

export type ChartLine = NodeOf<typeof ChartLine>
