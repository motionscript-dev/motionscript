import {
  Graphics2D,
  Types,
  clamp,
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

import { loadPaints } from "../kit/paints"
import { spokeDirection, type GridShape } from "./shared"

/**
 * The web of a {@link RadarChart}: `levels` rings and, if asked, a spoke to each
 * of `count` categories, drawn from the node's centre out to `radius`. `reveal`
 * grows the web from nothing.
 */
export const RadarGrid = component2d({
  key: "radarGrid",
  state: {
    count: 0,
    /** The rim, in px. */
    radius: 0,
    levels: 4,
    shape: Types.custom<GridShape>("polygon"),
    stroke: Types.custom<Stroke, StrokeResolved[]>([], { resolve: strokeOps.resolve, lerp: strokeOps.lerp }),
    /** The line out to each category; empty draws none. */
    spokeStroke: Types.custom<Stroke, StrokeResolved[]>([], { resolve: strokeOps.resolve, lerp: strokeOps.lerp }),
    /** How far the web has grown out, `0`-`1`. Rests at 1 so a paused canvas paints it. */
    reveal: 1,
  },
  defaults: { width: "fill", height: "fill" },
  load: (loader, state) => loadPaints(loader, { strokes: [state.stroke, state.spokeStroke] }),
  render: (ctx, state) => {
    const grow = clamp(state.reveal, 0, 1)
    const rim = state.radius * grow
    if (rim <= 0 || grow <= 0) return
    const count = Math.max(0, Math.round(state.count))
    const levels = Math.max(1, Math.round(state.levels))
    const round = state.shape === "circle" || count < 3

    // One draw per ring: rings chained into one surface would stroke only their union's outline.
    for (let level = 1; state.stroke.length > 0 && level <= levels; level++) {
      const r = (rim * level) / levels
      const ring = new Graphics2D()
      if (round) {
        ring.ellipse({ width: r * 2, height: r * 2 })
      } else {
        const points: Vector2[] = []
        for (let i = 0; i < count; i++) {
          const d = spokeDirection(i, count)
          points.push({ x: d.x * r, y: d.y * r })
        }
        ring.line({ points, closed: true })
      }
      ctx.draw(ring.stroke(state.stroke).opacity(grow))
    }

    if (state.spokeStroke.length === 0) return
    for (let i = 0; i < count; i++) {
      const d = spokeDirection(i, count)
      ctx.draw(
        new Graphics2D()
          .line({ points: [{ x: 0, y: 0 }, { x: d.x * rim, y: d.y * rim }] })
          .stroke(state.spokeStroke)
          .opacity(grow)
      )
    }
  },
})

export type RadarGrid = NodeOf<typeof RadarGrid>
