import { describe, expect, it } from "vitest"

import { NullRenderContext } from "@/render/null-render-context";
import type { Node2D } from "@/components/trees/2d/node2d";
import { recorded } from "@/components/trees/tests/recording-context.fixtures";
import { attachScope } from "@/components/trees/node/node.fixtures";

import { Hexagon, Octagon, Pentagon, RightTriangle, Star, Triangle, PathShape } from "@/components/builtins/geometry/geometry";
import { pathOps } from "@/attributes/shape/path/ops";

/**
 * The shape components, constructed and drawn.
 *
 * Everything about their *geometry* is already covered by
 * `shape-outline.test.ts`, which tests the outline functions directly and
 * without a renderer. What is left is the half that only shows up once a real
 * node exists: that they construct at all, that they read their box, and
 * that what the renderer is handed — the silhouette they draw and the clip —
 * comes back with something in them.
 *
 * That last one is not a formality. `clipSelf` is what hit-testing grabs on,
 * so a shape that returned an empty clip would be a shape nobody can click,
 * and nothing else in the suite would notice.
 */

/** Every named shape, as its component, built from the props each test gives it. */
type Shape = new (props: { fill: string; width: number; height: number }) => Node2D

const SHAPES: readonly { name: string; Class: Shape }[] = [
  { name: "Triangle", Class: Triangle },
  { name: "RightTriangle", Class: RightTriangle },
  { name: "Pentagon", Class: Pentagon },
  { name: "Hexagon", Class: Hexagon },
  { name: "Octagon", Class: Octagon },
  { name: "Star", Class: Star },
]

/** Reaches the protected clip hook the renderer calls. */
function hooks(node: object) {
  return node as unknown as {
    clipSelf(): { isEmpty(): boolean }
  }
}

/**
 * Attaches a node and puts it through a real layout pass, so its `layoutRect` is the box every
 * outline here is derived from.
 *
 * Without this the rect is 0×0 and each shape draws an empty path — which the
 * `ops()` count would happily report as "one op", so the assertions below would
 * pass over a class that draws nothing at all. {@link NullRenderContext} is
 * the engine's own headless walk, so the pass is the real one.
 */
function laidOut<T extends Node2D>(node: T, width: number, height: number): T {
  node.attach(attachScope())
  node.layout({ x: 0, y: 0, width, height }, new NullRenderContext())
  return node
}

/** The path commands the silhouette a shape draws carries. */
function silhouette(node: Node2D): unknown[] {
  const op = recorded(node).graphics
    .flatMap((g) => g.ops() as readonly { kind: string; state: unknown }[])
    .find((candidate) => candidate.kind === "path")
  const data = (op?.state as { data?: unknown[] } | undefined)?.data
  return Array.isArray(data) ? data : []
}

describe("the bounds-filling shapes", () => {
  it.each(SHAPES)("$name takes the box it is laid out in", ({ Class }) => {
    const node = laidOut(new Class({ fill: "red", width: 300, height: 180 }), 300, 180)
    expect(node.measuredWidth).toBe(300)
    expect(node.measuredHeight).toBe(180)
  })

  it.each(SHAPES)("$name draws a closed silhouette", ({ Class }) => {
    const node = laidOut(new Class({ fill: "red", width: 300, height: 180 }), 300, 180)
    const commands = silhouette(node)
    // A move, at least two lines, and the close: the least any of these is.
    expect(commands.length).toBeGreaterThanOrEqual(4)
    expect(commands.at(-1)).toEqual({ type: "Z" })
  })

  it.each(SHAPES)("$name is clickable across its whole box", ({ Class }) => {
    // The box, deliberately: hit-testing a node's box is what selecting it from
    // inside the outline's concave parts needs.
    const node = laidOut(new Class({ fill: "red", width: 300, height: 180 }), 300, 180)
    expect(hooks(node).clipSelf().isEmpty()).toBe(false)
  })

  it.each(SHAPES)("$name survives a zero-size box", ({ Class }) => {
    // Reachable while a node is being dragged into existence, and the outline
    // functions answer with an empty path rather than NaN coordinates.
    const node = laidOut(new Class({ fill: "red", width: 0, height: 0 }), 0, 0)
    expect(silhouette(node)).toEqual([])
  })

  it("carries the star's own two controls", () => {
    const star = new Star({ width: 100, height: 100, points: 7, ratio: 0.4 })
    expect(star.points).toBe(7)
    expect(star.ratio).toBe(0.4)
  })

  it("takes the corner controls every one of them shares", () => {
    const hexagon = new Hexagon({
      width: 100,
      height: 100,
      cornerRadius: 8,
      cornerStyle: "angled",
    })
    expect(hexagon.cornerRadius).toBe(8)
    expect(hexagon.cornerStyle).toBe("angled")
  })
})

describe("the editable path", () => {
  const DIAMOND = "M 0 -0.5 L 0.5 0 L 0 0.5 L -0.5 0 Z"

  it("scales its unit geometry onto its box", () => {
    const node = laidOut(
      new PathShape({ fill: "red", width: 400, height: 200, data: DIAMOND }),
      400,
      200
    )
    expect(node.data).toBe(DIAMOND)
    // The stored diamond's top point is (0, −0.5) in unit space, y-down. On a
    // 400×200 node that is 100px *above* the centre in the renderer's y-up
    // local space — which is the whole of what this node does.
    expect(silhouette(node)[0]).toEqual({ type: "M", x: 0, y: 100 })
  })

  it("is clickable across its whole box", () => {
    const node = laidOut(
      new PathShape({ fill: "red", width: 400, height: 200, data: DIAMOND }),
      400,
      200
    )
    expect(hooks(node).clipSelf().isEmpty()).toBe(false)
  })

  it("draws nothing rather than throwing on empty geometry", () => {
    const node = laidOut(
      new PathShape({ fill: "red", width: 400, height: 200, data: "" }),
      400,
      200
    )
    expect(silhouette(node)).toEqual([])
  })
})

describe("vectorPathToCommands", () => {
  it("flips y, so a stored path draws the way it was authored", () => {
    // Stored geometry is y-down like SVG; a node's own space is y-up. Getting
    // this backwards draws every shape upside down, which is the kind of thing
    // that looks fine on a triangle and wrong on everything else.
    const commands = pathOps.anchorCommands(
      pathOps.anchors("M 0 -0.5 L 0.5 0.5"),
      (p) => ({ x: p.x * 100, y: -p.y * 100 })
    )
    expect(commands).toEqual([
      { type: "M", x: 0, y: 50 },
      { type: "L", x: 50, y: -50 },
    ])
  })

  it("closes a straight join with Z alone", () => {
    // `Z` already draws the line home, so restating it would put a zero-length
    // command in front of every closed shape.
    const commands = pathOps.anchorCommands(
      pathOps.anchors("M 0 0 L 1 0 L 1 1 Z"),
      (p) => p
    )
    expect(commands.map((c) => c.type)).toEqual(["M", "L", "L", "Z"])
  })

  it("states a curved join, which Z cannot draw", () => {
    const commands = pathOps.anchorCommands(
      pathOps.anchors("M 0 0 L 1 0 C 1 1 0.5 1 0 0 Z"),
      (p) => p
    )
    expect(commands.map((c) => c.type)).toEqual(["M", "L", "C", "Z"])
  })
})
