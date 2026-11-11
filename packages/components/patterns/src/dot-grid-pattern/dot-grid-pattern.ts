import {
  Flow,
  Graphics2D,
  Paint,
  Types,
  component2d,
  lerpVector2,
  type NodeOf,
  type Size2D,
  type Vector2,
  // Named so the emitted declaration reaches these through the sdk, not core.
  type Alignment as _Alignment,
  type Fill as _Fill,
  type FillResolved as _FillResolved,
  type FlowMode as _FlowMode,
  type FlowResolved as _FlowResolved,
  type GapSize as _GapSize,
  type Node2D as _Node2D,
  type Node2DProps as _Node2DProps,
  type Shadow as _Shadow,
  type ShadowResolved as _ShadowResolved,
  type Stroke as _Stroke,
  type StrokeResolved as _StrokeResolved,
} from "@motionscript/sdk"

import { addTiledLines } from "../kit"

// The tiling `LineGridPattern` uses, so dots stay on its intersections at every offset.
function gridPositions(
  min: number,
  max: number,
  step: number,
  offset: number,
  subdivisions: number,
  overscan: number
): { pos: number; isMajor: boolean }[] {
  const out: { pos: number; isMajor: boolean }[] = []
  // Anchored at the near edge, so a column or row sits on each edge of the box for any cell count.
  addTiledLines(min, max, step, offset, subdivisions, overscan, (pos, isMajor) => {
    out.push({ pos, isMajor })
  }, min)
  return out
}

const state = {
  ...Paint.state,
  ...Flow.state,
  /** Cells along each axis, as in `LineGridPattern.divisions`: 4 puts 5 major dots on each. */
  divisions: 4,
  /** `1` draws only the major dots; `2` puts one minor dot between each pair. */
  subdivisions: 1,
  /** Radius of a major dot. */
  radius: 3,
  /** A minor dot's radius as a fraction of a major one's, not a second paint stack, so a gradient crosses every dot. */
  subScale: 0.5,
  /** As `LineGridPattern.offset`, so the two stay aligned while both scroll. */
  offset: Types.custom<Vector2>({ x: 0, y: 0 }, { lerp: lerpVector2 }),
}

interface DotField {
  readonly divisions: number
  readonly subdivisions: number
  readonly radius: number
  readonly subScale: number
  readonly offset: Vector2
}

/**
 * A field of dots on the same `divisions` / `subdivisions` / `offset` as
 * `LineGridPattern`, so laid over one the dots sit on its intersections. The
 * dots are the silhouette `Paint.draw` paints; a background is a rectangle behind
 * it. `clip` and picking use the node's box, not the silhouette, so outer dots
 * clip as they pan out and the node stays selectable between dots. `start` and
 * `end` act on nothing: trimming a disc leaves a crescent, not a partial grid.
 */
export const DotGridPattern = component2d({
  key: "dotGridPattern",
  state,
  commands: { ...Paint.commands },
  measure: (measurer, state, children) => Flow.measure(measurer, state, children, Paint.inset(state)),
  layout: (box, state, children) => Flow.layout(box, state, children, Paint.inset(state)),
  render: (ctx, state) => {
    const untrimmed = {
      fill: state.fill, stroke: state.stroke, shadow: state.shadow, overlay: state.overlay, start: 0, end: 1, clip: state.clip,
    }
    const box = new Graphics2D().rect({ width: ctx.size.width, height: ctx.size.height })
    Paint.draw(ctx, untrimmed, dots(ctx.size, state), { clipShape: box })
  },
})

export type DotGridPattern = NodeOf<typeof DotGridPattern>

/** Every dot as one un-painted union: the paint stacks belong to the grid, not a dot. */
function dots(size: Size2D, s: DotField): Graphics2D | null {
  const { width, height } = size
  if (width <= 0 || height <= 0) return null

  const divisions = Math.max(1, Math.floor(s.divisions))
  const subdivisions = Math.max(1, Math.floor(s.subdivisions))
  const major = Math.max(0, s.radius)
  const minor = major * Math.max(0, s.subScale)
  if (major <= 0 && minor <= 0) return null

  // Inset by a dot's radius so an edge dot sits inside the box rather than being halved by the clip.
  const cols = divisions * subdivisions
  const insetX = Math.max(0, width / 2 - major)
  const insetY = Math.max(0, height / 2 - major)
  const xs = gridPositions(
    -insetX,
    insetX,
    (insetX * 2) / cols,
    s.offset.x,
    subdivisions,
    major
  )
  const ys = gridPositions(
    -insetY,
    insetY,
    (insetY * 2) / cols,
    s.offset.y,
    subdivisions,
    major
  )

  const field = new Graphics2D()
  let drew = false
  for (const column of xs) {
    for (const row of ys) {
      // Major only where both axes are: an intersection of two major rules.
      const size = column.isMajor && row.isMajor ? major : minor
      if (size <= 0) continue
      field.ellipse({ x: column.pos, y: row.pos, width: size * 2, height: size * 2 })
      drew = true
    }
  }
  return drew ? field : null
}
