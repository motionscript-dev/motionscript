/**
 * The silhouette of every shape type, as a {@link VectorPath}.
 *
 * One module, two callers with the same question asked at different scales:
 *
 * - The **shape node classes** (`nodes/shapes`) draw their outline every frame
 *   from their laid-out box, so they ask in pixels.
 * - The **path editor** converts a shape into an editable Path node the moment
 *   somebody moves one of its points, so it asks in the unit box the Path node
 *   stores its geometry in (see `./vector-path`).
 *
 * Sharing the definition is what makes that conversion invisible: a triangle
 * that becomes a path is the *same* triangle, down to the rounding on its
 * corners, rather than a fresh approximation of one.
 *
 * ## Why these shapes exist at all
 *
 * The engine's `Polygon` inscribes its n-gon in the node's box — the vertices
 * sit on the box's inscribed ellipse — which is what makes a `sides` tween
 * smooth: every vertex count is the same circle sampled differently, so a
 * triangle morphing into a square doesn't lurch. The cost is that a triangle
 * *doesn't touch the bottom of its own bounds*, because the two base vertices
 * sit at 30° below the horizontal rather than on the ellipse's lowest point.
 * Figma's polygon does exactly the same thing for exactly the same reason.
 *
 * That is right for a shape you intend to animate and wrong for a shape you
 * intend to *be a triangle*. So the parametric `polygon`/`polygram` keep the
 * inscribed geometry, and the named shapes here are stretched to fill their box
 * — the vertices are computed on the circle exactly as before, then their
 * bounding box is mapped onto the node's. Same silhouette, no gap.
 *
 * Everything here works in **y-down** coordinates, the convention the stored
 * `d` string uses. The node classes flip once on the way to the renderer, whose
 * local space is y-up.
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
  /**
   * The inner radius as a fraction of the outer one: a polygram's or star's
   * point depth, and an ellipse's donut hole.
   */
  ratio?: number
  /** The ellipse's arc, in degrees. */
  startAngle?: number
  sweep?: number
}

/**
 * The named shapes' vertex counts and how far they're turned from "a vertex at
 * the top".
 *
 * Pointy-top is the regular polygon's natural orientation and the one every icon
 * set draws a pentagon and a hexagon in. The octagon is the exception, and it is
 * not a matter of taste: an octagon with a vertex at the top reads as a rotated
 * stop sign, because a stop sign is the only octagon most people have ever
 * looked at and it has a flat top. Half a step turns it into that one.
 */
const NAMED_POLYGONS: Record<string, { sides: number; turn: number }> = {
  pentagon: { sides: 5, turn: 0 },
  hexagon: { sides: 6, turn: 0 },
  octagon: { sides: 8, turn: Math.PI / 8 },
}

/**
 * A star's default point depth: the classic five-pointed star, where the inner
 * vertices sit where the extended edges of a pentagram cross.
 *
 * Not the polygram node's 50%, and deliberately so. The parametric polygram
 * opens at a round number because it is a *control* you are expected to move;
 * this node exists for the person who wanted a star and got a geometry lesson,
 * so it opens on the star they were picturing.
 */
export const STAR_DEFAULT_RATIO = 0.382

/** The default number of points on a Star node. */
export const STAR_DEFAULT_POINTS = 5

/**
 * The shape's outline in **pixel** space: centred on the origin, spanning
 * `width` × `height`, y-down.
 *
 * Returns an empty path for a degenerate box, which draws nothing rather than
 * producing NaN coordinates the renderer would have to cope with.
 */
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

/**
 * The same outline in the **unit box** a Path node stores — pixels divided by
 * the node's own size, so the geometry is a fraction of the box rather than a
 * count of pixels inside it.
 *
 * This is what a shape→path conversion writes. Dividing at the end rather than
 * computing in unit space throughout is what keeps a corner radius circular: a
 * 20px corner on a 400×200 node is 0.05 × 0.1 of the box, and only comes back
 * out round because the renderer multiplies by the same two numbers.
 */
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

// ── Building blocks ────────────────────────────────────────────────────────

function corner(point: Vector2): PathAnchor {
  return { point, inHandle: null, outHandle: null }
}

function sidesOf(options: ShapeOutlineOptions, fallback: number): number {
  return Math.max(3, Math.round(options.sides ?? fallback))
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}


/**
 * The vertices of a regular n-gon on the ellipse `rx` × `ry`, starting at the
 * top and stepping clockwise — the same order and the same first vertex
 * The engine's own `polygonVertices` uses, so a converted `polygon` keeps its
 * points in the order the author has been looking at.
 *
 * `turn` rotates the whole figure; see {@link NAMED_POLYGONS}.
 */
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

/**
 * Stretches a vertex ring so its bounding box *is* the node's box.
 *
 * The one line that separates a shape from its parametric sibling. Everything
 * before it is the inscribed figure; this maps that figure's own extent onto the
 * box, so the flat base of a triangle lands on the bottom edge and a pentagon's
 * two lower vertices land on the left and right ones.
 *
 * A ring with no extent on an axis (which no shape here produces, but a
 * `sides: 3` star with ratio 0 comes close) keeps that axis rather than dividing
 * by zero.
 */
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

// ── Corners ────────────────────────────────────────────────────────────────

/**
 * The cubic control-point offset that approximates a circular arc, as a
 * fraction of the distance from the tangent point to the corner.
 *
 * `k = (4/3)·tan(φ/4) / tan(φ/2)`, where φ is the arc's central angle. The
 * familiar 0.5523 is this at φ = 90°; a shallow corner needs less and a sharp
 * one needs more, which is why the constant can't simply be hard-coded — a
 * five-pointed star's inner vertices turn through nearly 180°, where 0.5523
 * would visibly flatten the curve.
 */
function arcHandleRatio(sweep: number): number {
  const half = sweep / 2
  if (Math.abs(half) < 1e-6) return 0
  return ((4 / 3) * Math.tan(sweep / 4)) / Math.tan(half)
}

/**
 * A closed ring of vertices as a subpath, with each corner rounded or chamfered
 * by `cornerRadius`.
 *
 * The radius is clamped per corner to half of each adjacent edge, so a large
 * radius on a small shape rounds it as far as it can go instead of turning the
 * outline inside out. A radius of zero (or a `cornerStyle` of neither kind)
 * returns the plain polygon, which is the common case and costs nothing.
 */
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

    // The interior angle at this vertex, and the arc that replaces it.
    const cosine = Math.max(-1, Math.min(1, toPrev.x * toNext.x + toPrev.y * toNext.y))
    const interior = Math.acos(cosine)
    // A vertex where the two edges double back on themselves has no corner to
    // round; leaving it sharp is the only honest answer.
    if (interior < 1e-6 || Math.PI - interior < 1e-6) {
      anchors.push(corner(c))
      continue
    }

    // How far back along each edge the arc starts. Never more than half the
    // edge, so two adjacent corners can't overlap.
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


/**
 * A single radius from whichever shape the value arrived in.
 *
 * A per-corner value only means anything on a rect, which builds its outline
 * corner by corner below; every other shape takes the smallest of the four, so
 * converting a rect with mixed corners into a polygon can't silently invent a
 * radius bigger than any the author set.
 */
function uniformRadius(value: number | CornerRadiusResolved | undefined): number {
  if (value === undefined) return 0
  if (typeof value === "number") return Math.max(0, value)
  return Math.max(
    0,
    Math.min(value.topLeft, value.topRight, value.bottomLeft, value.bottomRight)
  )
}

// ── Rect ───────────────────────────────────────────────────────────────────

/**
 * A rectangle, with each corner carrying its own radius.
 *
 * Written out rather than routed through {@link polygonOutline} because a rect
 * is the one shape whose corners are *individually* set, and because its right
 * angles make the arc exact: the tangent length equals the radius and the handle
 * ratio is the familiar 0.5523, with no trigonometry involved.
 */
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
  /**
   * One corner, walking clockwise from the top-left: `at` is the sharp corner,
   * `from`/`to` the directions the outline arrives and leaves along.
   */
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
  // Clockwise, and the *incoming* direction is the one the walk is travelling
  // when it reaches the corner — not the edge it is about to leave along. The
  // loop closes back into the top-left from the bottom-left, so it arrives there
  // heading **up**; `down` put that corner's first anchor a radius *above* the
  // rectangle and drew the arc back into the box, which is the reversed top-left
  // corner you get on any rounded rect converted to a path.
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

// ── Ellipse ────────────────────────────────────────────────────────────────

/**
 * The ellipse family: a full oval, an arc (`sweep` under 360°), a ring
 * (`ratio` above 0), and the wedge the two make together.
 *
 * The arc is emitted as cubics rather than as an SVG `A` command, and that is
 * the whole reason this is worth writing out. A Path node's geometry is stored
 * as a fraction of its box and multiplied back by the box's *two* dimensions —
 * so an arc, whose parameters describe a circle rather than a set of points,
 * would come out of a non-uniform resize as a different curve rather than a
 * stretched one. Cubics survive that transform exactly.
 */
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

  // A full oval with no hole is the common case: one closed ring.
  const full = sweep >= 360
  // Degrees clockwise from twelve o'clock, matching the appearance schema's
  // `startAngle` — which is measured the way a clock face is, not the way
  // `Math.atan2` is.
  const from = ((options.startAngle ?? 0) - 90) * (Math.PI / 180)
  const to = from + sweep * (Math.PI / 180)

  if (full && inner <= 0) {
    return [{ anchors: arcAnchors(rx, ry, from, to, true), closed: true }]
  }
  if (full) {
    // A ring: two closed rings, the inner one wound the other way so the
    // even-odd fill leaves a hole.
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

/**
 * An elliptical arc as a run of anchors, split into segments of at most 90° —
 * the span a single cubic approximates to within a fraction of a pixel.
 *
 * `whole` drops the duplicated final anchor, for the case where the arc closes
 * back on its own start.
 */
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
  // The classic elliptical-arc approximation: each control point sits α along
  // the curve's own tangent, with α = (4/3)·tan(Δ/4) for a segment spanning Δ.
  // Signed with the step, so a clockwise arc bulges the right way.
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
