import {
  Graphics2D,
  Types,
  clamp,
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
  type Vector2,
} from "@motionscript/sdk"

import { fresh } from "../kit/entries"
import { frameEase } from "../kit/motion"
import { loadPaints } from "../kit/paints"
import { spokeDirection } from "./shared"

/** The vertices of a series' polygon: spoke `i` at `fractions[i]` of the rim, scaled by `grow` about the centre. */
export function seriesVertices(fractions: readonly number[], radius: number, grow = 1): Vector2[] {
  return fractions.map((f, i) => {
    const d = spokeDirection(i, fractions.length)
    const r = radius * f * grow
    return { x: d.x * r, y: d.y * r }
  })
}

/** One series of a {@link RadarChart}: a closed polygon through its values, washed in its colour, with a dot on each vertex. `progress` grows it out of the centre. */
export const RadarSeries = component2d({
  key: "radarSeries",
  state: {
    /** Each spoke's value as a fraction of the rim, `0`-`1`, in spoke order. */
    fractions: fresh<number[]>(() => []),
    /** The rim, in px. */
    radius: 0,
    fill: Types.custom<Fill, FillResolved[]>([], { resolve: fillOps.resolve, lerp: fillOps.lerp }),
    stroke: Types.custom<Stroke, StrokeResolved[]>([], { resolve: strokeOps.resolve, lerp: strokeOps.lerp }),
    areaOpacity: 0.25,
    dots: true,
    dotSize: 10,
    /** Growth out of the centre, `0`-`1`. Rests at 1 so a paused canvas paints it; `enter` drives it from 0. */
    progress: 1,
    /** Whether the series is drawn at all, flipped alongside its legend entry. */
    enabled: true,
  },
  defaults: { width: "fill", height: "fill" },
  load: (loader, state) => loadPaints(loader, { fills: [state.fill], strokes: [state.stroke] }),
  commands: {
    /** Grow the polygon from `from` to `to` (of its full size); `showSeries`/`hideSeries` are this with the ends stated. */
    enter: {
      args: { from: Types.number(0, { min: 0, max: 1 }), to: Types.number(1, { min: 0, max: 1 }) },
      run: (timeline) => {
        const { from, to } = timeline.args
        const ease = frameEase(timeline)
        return timeline.animate((t) => {
          const progress = from + (to - from) * ease(t)
          // Hidden only once fully shrunk, so a hide does not vanish a frame early.
          return { progress, enabled: progress > 0 }
        })
      },
    },
  },
  render: (ctx, state) => {
    if (!state.enabled) return
    const grow = clamp(state.progress, 0, 1)
    if (grow <= 0 || state.radius <= 0 || state.fractions.length === 0) return
    const points = seriesVertices(state.fractions, state.radius, grow)

    if (points.length >= 2) {
      const fill = new Graphics2D().line({ points, closed: true })
      if (state.areaOpacity > 0 && state.fill.length > 0) ctx.draw(fill.fill(state.fill).opacity(clamp(state.areaOpacity, 0, 1)))
      if (state.stroke.length > 0) ctx.draw(new Graphics2D().line({ points, closed: true }).stroke(state.stroke))
    }

    if (state.dots && state.dotSize > 0 && state.fill.length > 0) {
      const dots = new Graphics2D()
      for (const p of points) dots.ellipse({ x: p.x, y: p.y, width: state.dotSize, height: state.dotSize })
      ctx.draw(dots.fill(state.fill))
    }
  },
})

export type RadarSeries = NodeOf<typeof RadarSeries>
