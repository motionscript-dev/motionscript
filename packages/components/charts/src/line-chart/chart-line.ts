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
  type PathCommand,
  type RenderContext,
  type Stroke,
  type StrokeResolved,
  type Vector2,
} from "@motionscript/sdk"

import { fade } from "../kit/cartesian"
import { fresh } from "../kit/entries"
import { frameEase } from "../kit/motion"
import { loadPaints } from "../kit/paints"
import { SPOTLIGHT_DIM } from "../kit/shared"
import {
  EMPTY_REGION_BOX,
  clipPolygonToBox,
  clipPolylineToBox,
  cutAt,
  curvePoints,
  hasRegion,
  type LineCurve,
  type RegionBox,
} from "./shared"

/** The x a trace at `progress` has reached, across `points` ordered along x. */
export function traceX(points: readonly Vector2[], progress: number): number {
  if (points.length === 0) return 0
  const first = points[0].x
  const last = points[points.length - 1].x
  return progress >= 1 ? Infinity : first + (last - first) * progress
}

/** The drawn path at `progress`: the whole curve once traced, else the part left of the trace. */
function traced(points: readonly Vector2[], curve: LineCurve, progress: number): Vector2[] {
  const path = curvePoints(points, curve)
  return progress >= 1 ? path : cutAt(path, traceX(points, progress))
}

const curveEntry = () => Types.custom<LineCurve>("smooth")

/** A closed outline as path commands. */
function outlineCommands(points: readonly Vector2[]): PathCommand[] {
  return [...points.map((p, i): PathCommand => ({ type: i === 0 ? "M" : "L", x: p.x, y: p.y })), { type: "Z" }]
}

function fillOutline(ctx: RenderContext, outline: readonly Vector2[], fill: FillResolved[], opacity: number): void {
  if (outline.length < 3 || opacity <= 0) return
  const { width, height } = ctx.size
  // A frame symmetric about the origin, so the outline draws where its points say rather than re-centred on itself.
  const centerBounds: [number, number, number, number] = [-width / 2, -height / 2, width / 2, height / 2]
  ctx.draw(new Graphics2D().path({ data: outlineCommands(outline), centerBounds }).fill(fill).opacity(opacity))
}

/**
 * One series of a {@link LineChart}: its line through pre-mapped pixel `points`,
 * shaped by `curve`, and a dot on each point. `progress` traces it in from the
 * left; `enabled` shows or hides it wholesale.
 */
export const ChartLine = component2d({
  key: "chartLine",
  state: {
    /** In this node's pixel space (origin at centre, y-up), mapped by the parent and ordered along x. */
    points: fresh<Vector2[]>(() => []),
    curve: curveEntry(),
    stroke: Types.custom<Stroke, StrokeResolved[]>([], { resolve: strokeOps.resolve, lerp: strokeOps.lerp }),
    /** A dot of `dotSize` on each point, in `dotFill`; none at size 0. */
    dotSize: 0,
    dotFill: Types.custom<Fill, FillResolved[]>([], { resolve: fillOps.resolve, lerp: fillOps.lerp }),
    /** Trace from the left end, `[0, 1]`. Rests at 1 so a paused editor canvas paints the line; `enter` drives it from 0. */
    progress: 1,
    /** Whether the line is drawn at all, flipped alongside its legend entry. */
    enabled: true,
    /** In this node's pixel space; outside it the line drops to `dimOpacity`. */
    spotlight: fresh<RegionBox>(() => EMPTY_REGION_BOX),
    dimOpacity: SPOTLIGHT_DIM,
  },
  load: (loader, state) => loadPaints(loader, { fills: [state.dotFill], strokes: [state.stroke] }),
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
    /** Hold the line fully traced while its chart moves it, switched on throughout a show and off once a hide lands. */
    hold: {
      args: { shown: Types.boolean(true) },
      run: (timeline) => {
        const { shown } = timeline.args
        return timeline.animate((t) => ({ progress: 1, enabled: shown || t < 1 }), { eased: false })
      },
    },
  },
  render: (ctx, state) => {
    if (!state.enabled) return
    const pts = state.points
    const p = clamp(state.progress, 0, 1)
    if (pts.length === 0 || p <= 0) return

    const box = state.spotlight
    const lit = hasRegion(box)
    const dim = clamp(state.dimOpacity, 0, 1)
    const stroke = state.stroke
    const weight = stroke[0]?.weight ?? 0
    const drawn = traced(pts, state.curve, p)

    if (drawn.length >= 2 && weight > 0) {
      // Rounded corners only where the line has corners to round.
      const radius = state.curve === "linear" ? weight * 2 : 0
      ctx.draw(new Graphics2D().line({ points: drawn, radius }).stroke(stroke).opacity(lit ? dim : 1))
      // One `draw` per run: shapes chained before `stroke()` combine into one surface, and stroking a union of disjoint open paths paints nothing.
      if (lit) for (const run of clipPolylineToBox(drawn, box)) ctx.draw(new Graphics2D().line({ points: run, radius }).stroke(stroke))
    }

    const size = state.dotSize
    if (size <= 0) return
    const reach = traceX(pts, p)
    const bright = new Graphics2D()
    const dimmed = new Graphics2D()
    let brightAny = false
    let dimAny = false
    for (const pt of pts) {
      // A dot grows in as the trace passes it.
      const grown = reach === Infinity ? 1 : clamp((reach - pt.x) / (size * 2), 0, 1)
      if (grown <= 0) continue
      const inside = !lit || (pt.x >= box.left && pt.x <= box.right && pt.y >= box.bottom && pt.y <= box.top)
      ;(inside ? bright : dimmed).ellipse({ x: pt.x, y: pt.y, width: size * grown, height: size * grown })
      if (inside) brightAny = true
      else dimAny = true
    }
    if (dimAny) ctx.draw(dimmed.fill(state.dotFill).opacity(dim))
    if (brightAny) ctx.draw(bright.fill(state.dotFill))
  },
})

export type ChartLine = NodeOf<typeof ChartLine>

/**
 * The fill under one series of a {@link LineChart}: down to `base` (the series
 * below it in a stack) or, without one, to the `baseline`. Drawn by its own node
 * so every area sits under every line; the chart binds its trace, switch and
 * opacity to its line's, so the two move as one.
 */
export const ChartArea = component2d({
  key: "chartArea",
  state: {
    /** The series' points, as its line has them. */
    points: fresh<Vector2[]>(() => []),
    /** The line the area fills down to, at the same x positions; empty for the baseline. */
    base: fresh<Vector2[]>(() => []),
    /** Pixel y of the baseline. */
    baseline: 0,
    curve: curveEntry(),
    area: Types.custom<"none" | "solid" | "gradient">("solid"),
    /** The series colour; the area paints it at `areaOpacity`, a gradient fading it out towards the bottom. */
    fill: Types.custom<Fill, FillResolved[]>([], { resolve: fillOps.resolve, lerp: fillOps.lerp }),
    areaOpacity: 0.4,
    progress: 1,
    enabled: true,
    spotlight: fresh<RegionBox>(() => EMPTY_REGION_BOX),
    dimOpacity: SPOTLIGHT_DIM,
  },
  load: (loader, state) => loadPaints(loader, { fills: [state.fill] }),
  render: (ctx, state) => {
    const pts = state.points
    const p = clamp(state.progress, 0, 1)
    if (!state.enabled || state.area === "none" || pts.length < 2 || p <= 0 || state.fill.length === 0) return
    const outlineAt = (progress: number) => {
      const top = traced(pts, state.curve, progress)
      if (top.length < 2) return []
      const base = state.base.length === pts.length
        ? traced(state.base, state.curve, progress)
        : [{ x: top[0].x, y: state.baseline }, { x: top[top.length - 1].x, y: state.baseline }]
      return [...top, ...[...base].reverse()]
    }
    // The gradient spans the whole area's height, so it holds still while the area traces in and across a spotlight's cut.
    const span = verticalSpan(outlineAt(1))
    const paint = (outline: readonly Vector2[], opacity: number) =>
      fillOutline(ctx, outline, areaFill(state.fill, state.area, state.areaOpacity, span, verticalSpan(outline)), opacity)
    const outline = outlineAt(p)
    const box = state.spotlight
    if (!hasRegion(box)) {
      paint(outline, 1)
      return
    }
    paint(outline, clamp(state.dimOpacity, 0, 1))
    paint(clipPolygonToBox(outline, box), 1)
  },
})

interface Span {
  readonly top: number
  readonly bottom: number
}

function verticalSpan(points: readonly Vector2[]): Span {
  let top = -Infinity
  let bottom = Infinity
  for (const p of points) {
    if (p.y > top) top = p.y
    if (p.y < bottom) bottom = p.y
  }
  return { top, bottom }
}

/**
 * The area's paint for an outline spanning `own`: the series colour at
 * `opacity`, or for a gradient that colour fading to nearly nothing across
 * `whole`. A gradient maps onto the bounds of the shape it fills, so its ends
 * are placed in `own`'s unit box (y-up) at `whole`'s top and bottom.
 */
export function areaFill(colour: FillResolved[], area: "none" | "solid" | "gradient", opacity: number, whole: Span, own: Span): FillResolved[] {
  const top = colour[colour.length - 1]
  if (area !== "gradient" || top?.type !== "solid" || !(own.top > own.bottom)) return fade(colour, opacity) as FillResolved[]
  const [r, g, b, a] = top.color
  const middle = (own.top + own.bottom) / 2
  const half = (own.top - own.bottom) / 2
  return fillOps.resolve({
    type: "linear-gradient",
    colors: [[r, g, b, a * opacity], [r, g, b, a * opacity * 0.04]],
    start: { x: 0, y: (whole.top - middle) / half },
    end: { x: 0, y: (whole.bottom - middle) / half },
  })
}

export type ChartArea = NodeOf<typeof ChartArea>
