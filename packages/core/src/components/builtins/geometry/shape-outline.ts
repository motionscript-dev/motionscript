/**
 * The silhouette of every shape type as a {@link VectorPath}, asked at two scales: the shape node classes draw it
 * every frame in pixels, and the path editor converts a shape to an editable Path node (in the unit box that node
 * stores) the moment a point moves. One definition keeps a converted triangle the same triangle, rounding included.
 *
 * Named shapes (triangle, pentagon, ...) are stretched to fill their box, whereas the parametric `polygon`/`polygram`
 * stay inscribed in the box's ellipse: that is what keeps a `sides` tween smooth, but a triangle then doesn't touch
 * the bottom of its bounds (its base vertices sit 30° below horizontal). Figma's polygon does the same.
 *
 * Everything works in **y-down** coordinates, as the stored `d` string does; the node classes flip once on the way
 * to the (y-up) renderer.
 */

import type { CornerRadiusResolved } from "@/attributes/shape/corners/corner-radius";
import type { CornerStyle } from "@/attributes/shape/corners/corner-style";
import type { Vector2 } from "@/attributes/layout/vector2";
import { distance } from "@/attributes/shape/path/bezier"
import { pathOps } from "@/attributes/shape/path/ops"
import type { PathAnchor, PathSubpath, VectorPath } from "@/attributes/shape/path/types";

/** The shape types this module can draw an outline for. */
export type ShapeOutlineKind =
  | "rect"
  | "ellipse"
  | "polygon"
  | "polygram"
  | "triangle"
  | "rightTriangle"
  | "pentagon"
  | "hexagon"
  | "octagon"
  | "star"

/** Everything an outline can depend on. Unstated fields take the schema's default. */
export interface ShapeOutlineOptions {
  /** The node's box, in pixels. */
  width: number
  height: number
  /** Vertex/corner rounding, in pixels. Ignored by the shapes that have no corners. */
  cornerRadius?: number | CornerRadiusResolved
  cornerStyle?: CornerStyle
  /** Vertex count — `polygon`/`polygram`'s `sides`, `star`'s number of points. */
  sides?: number
  /** Inner radius as a fraction of the outer: a polygram's or star's point depth, an ellipse's donut hole. */
  ratio?: number
  /** The ellipse's arc, in degrees. */
  startAngle?: number
  sweep?: number
}

/** The named shapes' vertex counts and turn from "a vertex at the top". The octagon is half a step off: with a vertex on top it reads as a rotated stop sign, which has a flat top. */
const NAMED_POLYGONS: Record<string, { sides: number; turn: number }> = {
  pentagon: { sides: 5, turn: 0 },
  hexagon: { sides: 6, turn: 0 },
  octagon: { sides: 8, turn: Math.PI / 8 },
}

/** A star's default point depth: the classic five-pointed star, inner vertices where a pentagram's extended edges cross. Not the polygram's round 50%, which is a control you move; this opens on the star people picture. */
export const STAR_DEFAULT_RATIO = 0.382

/** The default number of points on a Star node. */
export const STAR_DEFAULT_POINTS = 5

/** The outline in **pixel** space: centred on the origin, `width` x `height`, y-down. Empty for a degenerate box, which draws nothing rather than NaN coordinates. */
export function shapeOutlinePixels(
  kind: ShapeOutlineKind,
  options: ShapeOutlineOptions
): VectorPath {
  const { width, height } = options
  if (!(width > 0) || !(height > 0)) return []

  switch (kind) {
    case "rect":
      return [rectOutline(width, height, options)]
    case "ellipse":
      return ellipseOutline(width, height, options)
    case "triangle":
      return [
        polygonOutline(
          [
            { x: 0, y: -height / 2 },
            { x: width / 2, y: height / 2 },
            { x: -width / 2, y: height / 2 },
          ],
          options
        ),
      ]
    case "rightTriangle":
      return [
        polygonOutline(
          [
            { x: -width / 2, y: -height / 2 },
            { x: width / 2, y: height / 2 },
            { x: -width / 2, y: height / 2 },
          ],
          options
        ),
      ]
    case "polygon":
      // The parametric one: inscribed, *not* stretched — see the module note.
      return [
        polygonOutline(
          regularVertices(sidesOf(options, 5), 0, width / 2, height / 2),
          options
        ),
      ]
    case "polygram":
      return [
        polygonOutline(
          starVertices(
            sidesOf(options, 5),
            clamp01(options.ratio ?? 0.5),
            width / 2,
            height / 2
          ),
          options
        ),
      ]
    case "star":
      return [
        polygonOutline(
          fillBox(
            starVertices(
              sidesOf(options, STAR_DEFAULT_POINTS),
              clamp01(options.ratio ?? STAR_DEFAULT_RATIO),
              1,
              1
            ),
            width,
            height
          ),
          options
        ),
      ]
    default: {
      const named = NAMED_POLYGONS[kind]
      if (!named) return []
      return [
        polygonOutline(
          fillBox(regularVertices(named.sides, named.turn, 1, 1), width, height),
          options
        ),
      ]
    }
  }
}

/** The same outline in the **unit box** a Path node stores (pixels divided by the node's size); what a shape-to-path conversion writes. Divided at the end rather than computed in unit space so a corner radius stays circular: 20px on 400x200 is 0.05 x 0.1 of the box and comes back round because the renderer multiplies by the same two numbers. */
export function shapeOutline(
  kind: ShapeOutlineKind,
  options: ShapeOutlineOptions
): VectorPath {
  const { width, height } = options
  const pixels = shapeOutlinePixels(kind, options)
  if (!(width > 0) || !(height > 0)) return pixels
  return pathOps.map(pixels, (p) => ({ x: p.x / width, y: p.y / height }))
}

/** Whether this module knows how to draw a type — i.e. whether it can be edited as a path. */
export function hasShapeOutline(kind: string): kind is ShapeOutlineKind {
  return OUTLINE_KINDS.has(kind)
}

const OUTLINE_KINDS: ReadonlySet<string> = new Set<ShapeOutlineKind>([
  "rect",
  "ellipse",
  "polygon",
  "polygram",
  "triangle",
  "rightTriangle",
  "pentagon",
  "hexagon",
  "octagon",
  "star",
])

function corner(point: Vector2): PathAnchor {
  return { point, inHandle: null, outHandle: null }
}

function sidesOf(options: ShapeOutlineOptions, fallback: number): number {
  return Math.max(3, Math.round(options.sides ?? fallback))
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}


/** Vertices of a regular n-gon on the ellipse `rx` x `ry`, starting at the top and stepping clockwise as the engine's `polygonVertices` does, so a converted `polygon` keeps its point order. `turn` rotates the figure; see {@link NAMED_POLYGONS}. */
function regularVertices(
  sides: number,
  turn: number,
  rx: number,
  ry: number
): Vector2[] {
  const step = (2 * Math.PI) / sides
  const out: Vector2[] = []
  for (let i = 0; i < sides; i++) {
    // −π/2 is straight up in y-down coordinates.
    const a = -Math.PI / 2 + turn + i * step
    out.push({ x: rx * Math.cos(a), y: ry * Math.sin(a) })
  }
  return out
}

/** Outer and inner vertices alternating — a star with `points` points. */
function starVertices(
  points: number,
  ratio: number,
  rx: number,
  ry: number
): Vector2[] {
  const step = Math.PI / points
  const out: Vector2[] = []
  for (let i = 0; i < points * 2; i++) {
    const a = -Math.PI / 2 + i * step
    const k = i % 2 === 0 ? 1 : ratio
    out.push({ x: rx * k * Math.cos(a), y: ry * k * Math.sin(a) })
  }
  return out
}

/** Stretches a vertex ring so its bounding box is the node's box: the one step separating a shape from its parametric sibling (a triangle's base lands on the bottom edge). A ring with no extent on an axis keeps that axis rather than dividing by zero. */
function fillBox(points: Vector2[], width: number, height: number): Vector2[] {
  if (points.length === 0) return points
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  const spanX = maxX - minX
  const spanY = maxY - minY
  const kx = spanX > 1e-9 ? width / spanX : 1
  const ky = spanY > 1e-9 ? height / spanY : 1
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  return points.map((p) => ({ x: (p.x - cx) * kx, y: (p.y - cy) * ky }))
}

/** The cubic control-point offset approximating a circular arc, as a fraction of the tangent-point-to-corner distance: `k = (4/3)·tan(φ/4) / tan(φ/2)` for central angle φ. The familiar 0.5523 holds only at φ = 90°; a star's inner vertices turn nearly 180°, where it would visibly flatten the curve. */
function arcHandleRatio(sweep: number): number {
  const half = sweep / 2
  if (Math.abs(half) < 1e-6) return 0
  return ((4 / 3) * Math.tan(sweep / 4)) / Math.tan(half)
}

/** A closed vertex ring as a subpath with each corner rounded or chamfered by `cornerRadius`, clamped per corner to half of each adjacent edge so a large radius can't turn the outline inside out. Zero radius returns the plain polygon. */
function polygonOutline(
  points: Vector2[],
  options: ShapeOutlineOptions
): PathSubpath {
  const radius = uniformRadius(options.cornerRadius)
  if (points.length < 3 || radius <= 0) {
    return { anchors: points.map(corner), closed: true }
  }
  const style = options.cornerStyle ?? "rounded"

  const anchors: PathAnchor[] = []
  for (let i = 0; i < points.length; i++) {
    const c = points[i]
    const prev = points[(i - 1 + points.length) % points.length]
    const next = points[(i + 1) % points.length]

    const toPrev = direction(c, prev)
    const toNext = direction(c, next)
    if (!toPrev || !toNext) {
      anchors.push(corner(c))
      continue
    }

    const cosine = Math.max(-1, Math.min(1, toPrev.x * toNext.x + toPrev.y * toNext.y))
    const interior = Math.acos(cosine)
    // Edges that double back have no corner to round; leave it sharp.
    if (interior < 1e-6 || Math.PI - interior < 1e-6) {
      anchors.push(corner(c))
      continue
    }

    // Never more than half the edge, so adjacent corners can't overlap.
    const tangent = Math.min(
      radius / Math.tan(interior / 2),
      distance(c, prev) / 2,
      distance(c, next) / 2
    )
    const a = { x: c.x + toPrev.x * tangent, y: c.y + toPrev.y * tangent }
    const b = { x: c.x + toNext.x * tangent, y: c.y + toNext.y * tangent }

    if (style === "angled") {
      // A chamfer: the same two tangent points, joined by a straight line.
      anchors.push(corner(a), corner(b))
      continue
    }

    const k = arcHandleRatio(Math.PI - interior)
    anchors.push(
      { point: a, inHandle: null, outHandle: { x: a.x + (c.x - a.x) * k, y: a.y + (c.y - a.y) * k } },
      { point: b, inHandle: { x: b.x + (c.x - b.x) * k, y: b.y + (c.y - b.y) * k }, outHandle: null }
    )
  }
  return { anchors, closed: true }
}

/** The unit vector from `from` towards `to`, or null when they coincide. */
function direction(from: Vector2, to: Vector2): Vector2 | null {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.hypot(dx, dy)
  if (len < 1e-9) return null
  return { x: dx / len, y: dy / len }
}


/** A single radius from whichever shape the value arrived in. Per-corner values only mean something on a rect, so other shapes take the smallest of the four: converting a mixed-corner rect can't invent a radius bigger than any the author set. */
function uniformRadius(value: number | CornerRadiusResolved | undefined): number {
  if (value === undefined) return 0
  if (typeof value === "number") return Math.max(0, value)
  return Math.max(
    0,
    Math.min(value.topLeft, value.topRight, value.bottomLeft, value.bottomRight)
  )
}

/** A rectangle with per-corner radii. Written out rather than via {@link polygonOutline} because its corners are set individually and its right angles make the arc exact (tangent length equals the radius, handle ratio 0.5523). */
function rectOutline(
  width: number,
  height: number,
  options: ShapeOutlineOptions
): PathSubpath {
  const radii = perCornerRadii(options.cornerRadius, width, height)
  const style = options.cornerStyle ?? "rounded"
  const x = width / 2
  const y = height / 2
  const k = arcHandleRatio(Math.PI / 2)

  const anchors: PathAnchor[] = []
  /** One corner, walking clockwise from the top-left: `at` is the sharp corner, `from`/`to` the directions the outline arrives and leaves along. */
  const push = (
    at: Vector2,
    incoming: Vector2,
    outgoing: Vector2,
    r: number
  ) => {
    if (r <= 0) {
      anchors.push(corner(at))
      return
    }
    const a = { x: at.x - incoming.x * r, y: at.y - incoming.y * r }
    const b = { x: at.x + outgoing.x * r, y: at.y + outgoing.y * r }
    if (style === "angled") {
      anchors.push(corner(a), corner(b))
      return
    }
    anchors.push(
      { point: a, inHandle: null, outHandle: { x: a.x + (at.x - a.x) * k, y: a.y + (at.y - a.y) * k } },
      { point: b, inHandle: { x: b.x + (at.x - b.x) * k, y: b.y + (at.y - b.y) * k }, outHandle: null }
    )
  }

  const right = { x: 1, y: 0 }
  const down = { x: 0, y: 1 }
  const left = { x: -1, y: 0 }
  const up = { x: 0, y: -1 }
  // The incoming direction is the one the walk travels when it reaches the corner, not the edge it leaves along:
  // the loop closes into the top-left heading **up**, and `down` would reverse that corner.
  push({ x: -x, y: -y }, up, right, radii.topLeft)
  push({ x, y: -y }, right, down, radii.topRight)
  push({ x, y }, down, left, radii.bottomRight)
  push({ x: -x, y }, left, up, radii.bottomLeft)
  return { anchors, closed: true }
}

/** The four radii, clamped so opposite corners on an edge can't overlap. */
function perCornerRadii(
  value: number | CornerRadiusResolved | undefined,
  width: number,
  height: number
): CornerRadiusResolved {
  const raw: CornerRadiusResolved =
    value === undefined
      ? { topLeft: 0, topRight: 0, bottomLeft: 0, bottomRight: 0 }
      : typeof value === "number"
        ? {
            topLeft: value,
            topRight: value,
            bottomLeft: value,
            bottomRight: value,
          }
        : value
  const cap = Math.min(width, height) / 2
  return {
    topLeft: Math.max(0, Math.min(raw.topLeft, cap)),
    topRight: Math.max(0, Math.min(raw.topRight, cap)),
    bottomLeft: Math.max(0, Math.min(raw.bottomLeft, cap)),
    bottomRight: Math.max(0, Math.min(raw.bottomRight, cap)),
  }
}

/** The ellipse family: oval, arc (`sweep` under 360°), ring (`ratio` above 0) and wedge. The arc is emitted as cubics, not an SVG `A`: a Path node's geometry is a fraction of its box, so an `A` (whose parameters describe a circle) would come out of a non-uniform resize as a different curve, where cubics stretch exactly. */
function ellipseOutline(
  width: number,
  height: number,
  options: ShapeOutlineOptions
): VectorPath {
  const rx = width / 2
  const ry = height / 2
  const inner = clamp01(options.ratio ?? 0)
  const sweep = Math.max(0, Math.min(360, options.sweep ?? 360))
  if (sweep <= 0) return []

  const full = sweep >= 360
  // Degrees clockwise from twelve o'clock, matching the appearance schema's `startAngle` (a clock face, not `Math.atan2`).
  const from = ((options.startAngle ?? 0) - 90) * (Math.PI / 180)
  const to = from + sweep * (Math.PI / 180)

  if (full && inner <= 0) {
    return [{ anchors: arcAnchors(rx, ry, from, to, true), closed: true }]
  }
  if (full) {
    // A ring: two closed rings, the inner wound the other way so even-odd fill leaves a hole.
    return [
      { anchors: arcAnchors(rx, ry, from, to, true), closed: true },
      { anchors: arcAnchors(rx * inner, ry * inner, to, from, true), closed: true },
    ]
  }

  // An arc, closed back on itself: out along the outer edge, back along the
  // inner one (or through the centre, when there is no hole).
  const outer = arcAnchors(rx, ry, from, to, false)
  const back =
    inner > 0
      ? arcAnchors(rx * inner, ry * inner, to, from, false)
      : [corner({ x: 0, y: 0 })]
  return [{ anchors: [...outer, ...back], closed: true }]
}

/** An elliptical arc as anchors, split into segments of at most 90° (the span one cubic approximates to within a fraction of a pixel). `whole` drops the duplicated final anchor when the arc closes on its own start. */
function arcAnchors(
  rx: number,
  ry: number,
  from: number,
  to: number,
  whole: boolean
): PathAnchor[] {
  const total = to - from
  const steps = Math.max(1, Math.ceil(Math.abs(total) / (Math.PI / 2)))
  const step = total / steps
  // Each control point sits α along the curve's tangent, α = (4/3)·tan(Δ/4) for a segment spanning Δ; signed with
  // the step so a clockwise arc bulges the right way.
  const alpha = (4 / 3) * Math.tan(step / 4)

  const anchors: PathAnchor[] = []
  for (let i = 0; i <= steps; i++) {
    const a = from + step * i
    const point = { x: rx * Math.cos(a), y: ry * Math.sin(a) }
    // d/da of the point — the arc's tangent at this angle.
    const tangent = { x: -rx * Math.sin(a), y: ry * Math.cos(a) }
    const offset = { x: tangent.x * alpha, y: tangent.y * alpha }
    anchors.push({
      point,
      inHandle:
        i === 0 ? null : { x: point.x - offset.x, y: point.y - offset.y },
      outHandle:
        i === steps ? null : { x: point.x + offset.x, y: point.y + offset.y },
    })
  }

  if (whole && anchors.length > 1) {
    // The arc came back to where it started; fold the duplicate into the first
    // anchor so the ring has one anchor per corner rather than two stacked.
    const last = anchors.pop()!
    anchors[0].inHandle = last.inHandle
  }
  return anchors
}
