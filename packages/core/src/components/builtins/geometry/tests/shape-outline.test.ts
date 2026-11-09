import { describe, expect, it } from "vitest"

import { shapeOutlinePixels } from "@/components/builtins/geometry/shape-outline";

/**
 * The rounded rectangle's corners.
 *
 * One property pins all four and is the one that was broken: every anchor of a
 * rounded rect lies **on the rectangle**. A corner arc runs between two points a
 * radius back along each edge, so no anchor and no handle can sit outside the
 * box — and the moment one does, that corner draws inverted.
 *
 * The top-left was the one that did, because it is the corner the clockwise walk
 * *closes* into: it is reached travelling up the left edge, while the code said
 * down. Nothing caught it because the shape is only converted to a path when
 * somebody edits its points, and three of the four corners were right.
 */

const WIDTH = 400
const HEIGHT = 200
const RADIUS = 40

const rounded = () =>
  shapeOutlinePixels("rect", {
    width: WIDTH,
    height: HEIGHT,
    cornerRadius: RADIUS,
  })[0]

/** Every point the outline mentions: anchors and both of their handles. */
const allPoints = () =>
  rounded().anchors.flatMap((anchor) =>
    [anchor.point, anchor.inHandle, anchor.outHandle].filter(
      (p): p is { x: number; y: number } => p !== null
    )
  )

describe("a rounded rectangle's outline", () => {
  it("keeps every anchor and handle inside the box", () => {
    const half = { x: WIDTH / 2, y: HEIGHT / 2 }
    for (const point of allPoints()) {
      expect(Math.abs(point.x)).toBeLessThanOrEqual(half.x + 1e-6)
      expect(Math.abs(point.y)).toBeLessThanOrEqual(half.y + 1e-6)
    }
  })

  it("starts the top-left corner a radius down the left edge", () => {
    // The walk arrives here going up, so the arc begins *below* the corner and
    // ends a radius along the top — not above the rectangle, which is what the
    // reversed version did.
    const [start, end] = rounded().anchors
    expect(start.point).toEqual({ x: -WIDTH / 2, y: -HEIGHT / 2 + RADIUS })
    expect(end.point).toEqual({ x: -WIDTH / 2 + RADIUS, y: -HEIGHT / 2 })
  })

  it("gives all four corners the same shape", () => {
    // Two anchors per corner, each a radius back along its own edge. Measuring
    // the span between them catches a corner walked the wrong way round, which
    // would come out as the diagonal across a radius rather than along it.
    const anchors = rounded().anchors
    expect(anchors).toHaveLength(8)
    for (let i = 0; i < 8; i += 2) {
      const a = anchors[i].point
      const b = anchors[i + 1].point
      expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(RADIUS * Math.SQRT2)
    }
  })

  it("draws a plain rectangle with four corners and no handles", () => {
    const square = shapeOutlinePixels("rect", { width: 100, height: 50 })[0]
    expect(square.anchors).toHaveLength(4)
    expect(square.anchors.every((a) => a.inHandle === null)).toBe(true)
    expect(square.anchors.map((a) => a.point)).toEqual([
      { x: -50, y: -25 },
      { x: 50, y: -25 },
      { x: 50, y: 25 },
      { x: -50, y: 25 },
    ])
  })
})
