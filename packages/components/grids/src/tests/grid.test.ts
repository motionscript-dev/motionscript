import { describe, expect, it } from "vitest"

import { Canvas2D, component2d, ContextMap, Path, Rect, Types, type Node2D, type Values } from "@motionscript/sdk"
import { ManifestAssetCatalog, NullRenderContext } from "@motionscript/core"

import { ItemGrid, PATH_TEMPLATES, shuffled, type Arrangement } from "../kit"
import { NODES } from "../nodes"
import { PathGrid } from "../path-grid"
import { LINEAR, clip, row, squares, step, type GridNode } from "./harness"

/**
 * The grids as a document uses them: rows in a composition, commands placed on
 * a timeline, and the tree asked what it looks like at a time — in any order.
 */

const at = (node: Node2D) => [Math.round(node.layoutBounds.x * 100) / 100 + 0, Math.round(node.layoutBounds.y * 100) / 100 + 0]
const slotOf = (grid: Node2D, child: Node2D) => (grid as GridNode)._placementOf(child)

describe("the grids in a document", () => {
  it("lays a rectangular grid's children out in rows, and hugs them", () => {
    const c = clip([row("g", "rectangularGrid", "", 0, { columns: 3, columnGap: 10, rowGap: 10 }), ...squares("g", 5)])
    c.seek(0)
    expect(at(c.node("s0"))).toEqual([-70, -35])
    expect(at(c.node("s2"))).toEqual([70, -35])
    expect(at(c.node("s4"))).toEqual([0, 35])
    const grid = c.node<Node2D>("g").layoutBounds
    expect([grid.width, grid.height]).toEqual([200, 130])
  })

  it("turns a radial grid's items outward through their slot, not their own rotation", () => {
    const c = clip([row("g", "radialGrid", "", 0, { radius: 100, rotateItems: true }), ...squares("g", 4)])
    c.seek(0)
    const grid = c.node<Node2D>("g")
    const right = c.node<Node2D>("s1")
    expect(at(right)).toEqual([100, 0])
    expect(slotOf(grid, right)?.rotation).toBe(90)
    expect((right as unknown as { rotation: number }).rotation).toBe(0)
    expect(right.global.rotation).toBe(90)
  })

  it("sees a sphere through a camera of its own, and puts items at depth", () => {
    const c = clip([row("g", "sphereGrid", "", 0, { radius: 150, focalLength: 700 }), ...squares("g", 12)])
    c.seek(0)
    const grid = c.node<Node2D>("g")
    expect(grid._spaceCamera()?.perspective).toBe(700)
    const depths = [...Array(12).keys()].map((i) => slotOf(grid, c.node(`s${i}`))?.depth ?? 0)
    expect(Math.max(...depths)).toBeGreaterThan(100)
    expect(Math.min(...depths)).toBeLessThan(-100)
  })

  it("puts a sphere's items in the space of an orbit camera round it, rather than a camera of its own", () => {
    const c = clip([
      row("cam", "orbitCamera", "", 0, { orbit: 30 }),
      row("g", "sphereGrid", "cam", 0, { radius: 150 }),
      ...squares("g", 8),
    ])
    c.seek(0)
    expect(c.node<Node2D>("g")._spaceCamera()).toBeNull()
    expect(c.node<Node2D>("cam")._spaceCamera()?.orbit).toBe(30)
  })

  it("follows a Path node elsewhere in the scene", () => {
    const c = clip([
      // A document path is stored in its unit box and drawn at its size.
      row("p", "path", "", 0, { data: "M -0.5 0 L 0.5 0", width: 200, height: 10, x: 0, y: 200, stroke: "white" }),
      row("g", "pathGrid", "", 1, { pathNode: "p", width: 400, height: 400 }),
      ...squares("g", 3),
    ])
    c.seek(0)
    expect(at(c.node("s0"))).toEqual([-100, -200])
    expect(at(c.node("s2"))).toEqual([100, -200])
  })
})

describe("the per-item commands", () => {
  const nodes = () => [row("g", "rectangularGrid", "", 0, { columns: 4 }), ...squares("g", 4)]

  it("reveals the items one after another and leaves no state behind", () => {
    const c = clip(nodes(), [step("r", "reveal", "g", 1, 1, { style: "fade", stagger: 0.5 })])
    const grid = c.node<Node2D>("g")
    const opacity = (i: number) => slotOf(grid, c.node(`s${i}`))?.opacity ?? 1

    c.seek(1)
    expect([0, 1, 2, 3].map(opacity)).toEqual([0, 0, 0, 0])
    c.seek(1.5)
    expect(opacity(0)).toBe(1)
    expect(opacity(3)).toBe(0)
    expect(opacity(1)).toBeGreaterThan(opacity(2))
    c.seek(2.5)
    expect((grid as GridNode).revealState).toBeNull()
    expect([0, 1, 2, 3].map(opacity)).toEqual([1, 1, 1, 1])
    // Seeking back lands on the same frame as going forward did.
    c.seek(1.5)
    expect(opacity(3)).toBe(0)
  })

  it("keeps items hidden after a conceal", () => {
    const c = clip(nodes(), [step("c", "conceal", "g", 0, 1, { style: "scale" })])
    c.seek(2)
    const grid = c.node<Node2D>("g")
    expect(slotOf(grid, c.node("s2"))?.scale).toBeCloseTo(0)
  })

  it("focuses one item and pushes the rest back, then lets go", () => {
    const c = clip(nodes(), [
      step("f", "focus", "g", 0, 1, { item: 1, dim: 0.5, grow: 0.2 }),
      step("u", "unfocus", "g", 2, 1),
    ])
    const grid = c.node<Node2D>("g")
    c.seek(1.5)
    expect(slotOf(grid, c.node("s1"))?.scale).toBeCloseTo(1.2)
    expect(slotOf(grid, c.node("s0"))?.opacity).toBeCloseTo(0.5)
    c.seek(3.5)
    expect(slotOf(grid, c.node("s0"))).toBeNull()
  })

  it("sends a wave through that settles back", () => {
    const c = clip(nodes(), [step("w", "wave", "g", 0, 1, { style: "scale", amount: 0.5, stagger: 0.6 })])
    const grid = c.node<Node2D>("g")
    c.seek(0.3)
    expect(slotOf(grid, c.node("s0"))?.scale ?? 1).toBeGreaterThan(1.2)
    expect(slotOf(grid, c.node("s3"))?.scale ?? 1).toBe(1)
    c.seek(1.2)
    expect(slotOf(grid, c.node("s0"))).toBeNull()
  })
})

describe("the commands that move items to new slots", () => {
  it("swaps two items, travelling between their slots", () => {
    const c = clip(
      [row("g", "rectangularGrid", "", 0, { columns: 2, columnGap: 40 }), ...squares("g", 2)],
      [step("x", "swap", "g", 0, 1, { first: 0, second: 1 })],
    )
    c.seek(0)
    expect(at(c.node("s0"))).toEqual([-50, 0])
    c.seek(0.5)
    expect(at(c.node("s0"))).toEqual([0, 0])
    c.seek(1)
    expect(at(c.node("s0"))).toEqual([50, 0])
    expect(c.node<GridNode>("g").order).toEqual([1, 0])
  })

  it("re-flows into a new column count", () => {
    const c = clip(
      [row("g", "rectangularGrid", "", 0, { columns: 4, columnGap: 0, rowGap: 0 }), ...squares("g", 4)],
      [step("k", "columnsTo", "g", 0, 1, { columns: 2, stagger: 0 })],
    )
    c.seek(0)
    expect(at(c.node("s3"))).toEqual([90, 0])
    c.seek(1)
    expect(at(c.node("s3"))).toEqual([30, 30])
  })

  it("morphs into another grid's arrangement and keeps following it", () => {
    const c = clip(
      [
        row("a", "rectangularGrid", "", 0, { columns: 4, columnGap: 0 }),
        ...squares("a", 4),
        row("b", "radialGrid", "", 1, { radius: 100, x: 300 }),
      ],
      [step("m", "morphInto", "a", 0, 1, { target: "b", stagger: 0 })],
    )
    c.seek(1)
    const grid = c.node<Node2D>("a")
    const ring = c.node<Node2D>("b")
    const offset = ring.global.x - grid.global.x
    expect(at(c.node("s0"))).toEqual([offset, -100])
    expect(at(c.node("s1"))).toEqual([offset + 100, 0])
    expect(c.node<GridNode>("a").arrangeLike).toBe("b")
  })

  it("opens a camera while it morphs onto a sphere", () => {
    const c = clip(
      [row("a", "radialGrid", "", 0), ...squares("a", 6), row("b", "sphereGrid", "", 1, { focalLength: 650 })],
      [step("m", "morphInto", "a", 1, 1, { target: "b" })],
    )
    c.seek(0.5)
    expect(c.node<Node2D>("a")._spaceCamera()).toBeNull()
    c.seek(1.5)
    expect(c.node<Node2D>("a")._spaceCamera()?.perspective).toBe(650)
  })

  it("brings an item on a sphere round to the front", () => {
    const c = clip(
      [row("g", "sphereGrid", "", 0, { radius: 100 }), ...squares("g", 10)],
      [step("t", "turnTo", "g", 0, 1, { item: 6 })],
    )
    c.seek(1)
    const grid = c.node<Node2D>("g")
    const front = slotOf(grid, c.node("s6"))
    expect(front?.depth).toBeCloseTo(100)
    expect(at(c.node("s6"))).toEqual([0, 0])
  })
})

/** The layout centres of the items `ids`, relative to the grid's centre, y down. */
const centres = (c: ReturnType<typeof clip>, ids: string[]) => ids.map((id) => at(c.node(id)))
const ids = (count: number, prefix = "s") => Array.from({ length: count }, (_, i) => `${prefix}${i}`)

describe("a grid's size and where it puts its items", () => {
  it("hugs 0 x 0 with no children", () => {
    for (const type of ["rectangularGrid", "radialGrid", "sphereGrid"]) {
      const c = clip([row("g", type, "", 0)])
      c.seek(0)
      const bounds = c.node<Node2D>("g").layoutBounds
      expect([bounds.width, bounds.height], type).toEqual([0, 0])
    }
  })

  it("keeps a path grid at its own fixed size with no children, since a template is drawn to fill it", () => {
    const c = clip([row("g", "pathGrid", "", 0)])
    c.seek(0)
    const bounds = c.node<Node2D>("g").layoutBounds
    expect([bounds.width, bounds.height]).toEqual([640, 400])
  })

  it("hugs one child exactly in a one-column grid", () => {
    const c = clip([row("g", "rectangularGrid", "", 0, { columns: 1 }), ...squares("g", 1)])
    c.seek(0)
    const bounds = c.node<Node2D>("g").layoutBounds
    expect([bounds.width, bounds.height]).toEqual([60, 60])
    expect(at(c.node("s0"))).toEqual([0, 0])
  })

  it("hugs the extent of the slots, so one child in a three-column grid leaves room for the other two", () => {
    const c = clip([row("g", "rectangularGrid", "", 0, { columns: 3, columnGap: 10 }), ...squares("g", 1)])
    c.seek(0)
    const bounds = c.node<Node2D>("g").layoutBounds
    // The block is centred on three columns, and the grid is as wide as the item furthest from the centre.
    expect(bounds.width).toBe(2 * (70 + 30))
    expect(at(c.node("s0"))).toEqual([-70, 0])
  })

  it("places one child of a ring at the top and hugs the ring's extent", () => {
    const c = clip([row("g", "radialGrid", "", 0, { radius: 100 }), ...squares("g", 1)])
    c.seek(0)
    expect(at(c.node("s0"))).toEqual([0, -100])
    const bounds = c.node<Node2D>("g").layoutBounds
    expect([bounds.width, bounds.height]).toEqual([60, 260])
  })

  it("gathers every item at the centre with a spread of 0, and the grid with them", () => {
    const c = clip([row("g", "rectangularGrid", "", 0, { columns: 2, columnGap: 40, spread: 0 }), ...squares("g", 2)])
    c.seek(0)
    expect(centres(c, ["s0", "s1"])).toEqual([[0, 0], [0, 0]])
    const bounds = c.node<Node2D>("g").layoutBounds
    expect([bounds.width, bounds.height]).toEqual([60, 60])
  })

  it("pushes the items apart past a spread of 1", () => {
    const apart = (spread: number) => {
      const c = clip([row("g", "rectangularGrid", "", 0, { columns: 2, columnGap: 40, spread }), ...squares("g", 2)])
      c.seek(0)
      return centres(c, ["s0", "s1"])
    }
    expect(apart(1)).toEqual([[-50, 0], [50, 0]])
    expect(apart(2)).toEqual([[-100, 0], [100, 0]])
    expect(apart(0.5)).toEqual([[-25, 0], [25, 0]])
    expect(apart(3)).toEqual([[-150, 0], [150, 0]])
  })

  it("puts the child `order` names in each slot: slot k holds child order[k]", () => {
    const c = clip([row("g", "rectangularGrid", "", 0, { columns: 3, columnGap: 10, order: [2, 0, 1] }), ...squares("g", 3)])
    c.seek(0)
    expect(centres(c, ["s2", "s0", "s1"])).toEqual([[-70, 0], [0, 0], [70, 0]])
  })

  it("repairs an order that has a stale entry or a repeat, keeping the valid entries first", () => {
    const c = clip([row("g", "rectangularGrid", "", 0, { columns: 3, columnGap: 10, order: [5, 1, 1] }), ...squares("g", 3)])
    c.seek(0)
    expect(centres(c, ["s1", "s0", "s2"])).toEqual([[-70, 0], [0, 0], [70, 0]])
  })

  it("follows the clock for a ring that turns on its own, in either direction of travel", () => {
    const c = clip([row("g", "radialGrid", "", 0, { radius: 100, spinSpeed: 90 }), ...squares("g", 4)])
    c.seek(0)
    expect(at(c.node("s0"))).toEqual([0, -100])
    c.seek(1)
    expect(at(c.node("s0"))).toEqual([100, 0])
    c.seek(2)
    expect(at(c.node("s0"))).toEqual([0, 100])
    c.seek(1)
    expect(at(c.node("s0"))).toEqual([100, 0])
  })
})

describe("the rectangular grid's cells", () => {
  const filler = (id: string) => row(id, "rect", "g", 0, { width: "fill", height: "fill", fill: "red" })
  const size = (node: Node2D) => [node.layoutBounds.width, node.layoutBounds.height]

  it("gives a child set to fill the whole cell in fixed mode", () => {
    const c = clip([row("g", "rectangularGrid", "", 0, { columns: 2, cellMode: "fixed", cellWidth: 100, cellHeight: 80 }), filler("f")])
    c.seek(0)
    expect(size(c.node("f"))).toEqual([100, 80])
  })

  it("gives a child set to fill an equal share of the grid's box in fill mode", () => {
    const c = clip([
      row("g", "rectangularGrid", "", 0, { columns: 2, cellMode: "fill", columnGap: 20, rowGap: 0, width: 400, height: 200 }),
      filler("f"),
      filler("h"),
    ])
    c.seek(0)
    expect(size(c.node("f"))).toEqual([190, 200])
    expect(at(c.node("f"))).toEqual([-105, 0])
    expect(at(c.node("h"))).toEqual([105, 0])
  })

  it("lays children out down the columns when asked, with a short last column", () => {
    const c = clip([
      row("g", "rectangularGrid", "", 0, { columns: 3, fillDirection: "column", columnGap: 10, rowGap: 10 }),
      ...squares("g", 5),
    ])
    c.seek(0)
    expect(centres(c, ids(5))).toEqual([[-70, -35], [-70, 35], [0, -35], [0, 35], [70, -35]])
  })

  it("seats the short last column at its end when asked", () => {
    const c = clip([
      row("g", "rectangularGrid", "", 0, { columns: 3, fillDirection: "column", lastLineAlign: "end", columnGap: 10, rowGap: 10 }),
      ...squares("g", 5),
    ])
    c.seek(0)
    expect(at(c.node("s4"))).toEqual([70, 35])
  })

  it("shifts every other column down by a share of a row's pitch", () => {
    const c = clip([row("g", "rectangularGrid", "", 0, { columns: 3, columnGap: 10, rowGap: 10, columnOffset: 0.5 }), ...squares("g", 6)])
    c.seek(0)
    const [first, second] = centres(c, ["s0", "s1"])
    expect(second[1] - first[1]).toBe(35)
  })
})

describe("the sphere grid's facing and culling", () => {
  it("tilts an outward item to the surface and leaves a billboard facing the viewer", () => {
    const tilts = (facing: string) => {
      const c = clip([row("g", "sphereGrid", "", 0, { radius: 100, facing }), ...squares("g", 12)])
      c.seek(0)
      const grid = c.node<Node2D>("g")
      return ids(12).map((id) => {
        const placement = slotOf(grid, c.node(id))
        return [placement?.rotationX ?? 0, placement?.rotationY ?? 0]
      })
    }
    expect(tilts("outward").some(([x, y]) => x !== 0 || y !== 0)).toBe(true)
    expect(tilts("billboard").every(([x, y]) => x === 0 && y === 0)).toBe(true)
  })

  it("hides the faces turned away, with or without a focal length of its own to look through", () => {
    const hidden = (props: Record<string, unknown>) => {
      const c = clip([row("g", "sphereGrid", "", 0, { radius: 100, depthFade: 0, cullBackfaces: true, ...props }), ...squares("g", 40)])
      c.seek(0)
      const grid = c.node<Node2D>("g")
      return ids(40).filter((id) => slotOf(grid, c.node(id))?.opacity === 0).length
    }
    const flatter = hidden({ focalLength: 5000 })
    const closer = hidden({ focalLength: 150 })
    expect(flatter).toBeGreaterThan(10)
    expect(closer).toBeGreaterThan(flatter)
    expect(hidden({ cullBackfaces: false })).toBe(0)
  })

  it("fades the back items by depthFade", () => {
    const c = clip([row("g", "sphereGrid", "", 0, { radius: 100, depthFade: 1 }), ...squares("g", 40)])
    c.seek(0)
    const grid = c.node<Node2D>("g")
    const opacities = ids(40).map((id) => slotOf(grid, c.node(id))?.opacity ?? 1)
    expect(Math.min(...opacities)).toBeLessThan(0.1)
    expect(Math.max(...opacities)).toBeGreaterThan(0.9)
  })
})

describe("the path grid's source and spacing", () => {
  const grid = (props: Record<string, unknown>, count = 3) =>
    clip([row("g", "pathGrid", "", 0, { width: 400, height: 400, ...props }), ...squares("g", count)])

  it("follows a path of its own for the custom shape: y-down like SVG, centred on its own bounds", () => {
    const c = grid({ shape: "custom", path: "M 0 0 L 200 100" })
    c.seek(0)
    // The path runs down and to the right as an SVG writes it, so the items do too.
    expect(centres(c, ids(3))).toEqual([[-100, -50], [0, 0], [100, 50]])
  })

  it("falls back to a circle for the custom shape with no path to follow", () => {
    const custom = grid({ shape: "custom" }, 4)
    const circle = grid({ shape: "circle" }, 4)
    custom.seek(0)
    circle.seek(0)
    expect(centres(custom, ids(4))).toEqual(centres(circle, ids(4)))
  })

  it("takes a path of the grid's own over a template once the shape is custom, and never before", () => {
    const withPath = grid({ shape: "line", path: "M 0 0 L 200 100" })
    const line = grid({ shape: "line" })
    withPath.seek(0)
    line.seek(0)
    expect(centres(withPath, ids(3))).toEqual(centres(line, ids(3)))
  })

  it("follows a Path node elsewhere in the scene, centred on the data's own bounds", () => {
    const items = [0, 1, 2].map((i) => new Rect({ id: `s${i}`, width: 60, height: 60, fill: "red" } as never))
    const follower = new PathGrid({ id: "g", pathNode: "p", width: 400, height: 400, children: items } as never)
    const path = new Path({ id: "p", data: "M 0 0 L 100 0", x: 0, y: 200, stroke: "white" } as never)
    const canvas = new Canvas2D({ id: "", width: 1200, height: 900, flow: "freeform", children: [path, follower] } as never)
    canvas.attach({ assets: new ManifestAssetCatalog({ image: {}, video: {}, audio: {}, font: {} }), context: ContextMap.EMPTY, time: 0 })
    canvas.layout({ x: 0, y: 0, width: 1200, height: 900 }, new NullRenderContext())
    expect(items.map(at)).toEqual([[-50, -200], [0, -200], [50, -200]])
  })

  it("keeps to its own template when the node it names is not a path", () => {
    const named = grid({ shape: "line", pathNode: "other" })
    const alone = grid({ shape: "line" })
    for (const c of [named, alone]) c.seek(0)
    expect(centres(named, ids(3))).toEqual(centres(alone, ids(3)))
  })

  it("keeps to its own template when the node it names is not there", () => {
    const missing = grid({ shape: "line", pathNode: "nowhere" })
    const alone = grid({ shape: "line" })
    for (const c of [missing, alone]) c.seek(0)
    expect(centres(missing, ids(3))).toEqual(centres(alone, ids(3)))
  })

  it("sets items a fixed distance apart along the path", () => {
    const c = grid({ shape: "line", spacing: "fixed", spacingDistance: 50 })
    c.seek(0)
    expect(centres(c, ids(3))).toEqual([[-200, 0], [-150, 0], [-100, 0]])
  })

  it("moves the items along the path with the clip's clock at flowSpeed", () => {
    const c = grid({ shape: "line", flowSpeed: 0.1 }, 2)
    c.seek(0)
    expect(centres(c, ids(2))).toEqual([[-200, 0], [200, 0]])
    c.seek(1)
    expect(at(c.node("s0"))).toEqual([-160, 0])
    c.seek(0.5)
    expect(at(c.node("s0"))).toEqual([-180, 0])
    // Items carried past the end of an open path are hidden, not piled on it.
    const last = slotOf(c.node<Node2D>("g"), c.node("s1"))
    expect(last?.opacity).toBe(0)
  })

  it("turns items to follow the path by default, and leaves them upright when told not to", () => {
    const turned = grid({ shape: "circle" }, 4)
    const upright = grid({ shape: "circle", alignToPath: false }, 4)
    turned.seek(0)
    upright.seek(0)
    const rotation = (c: ReturnType<typeof clip>, id: string) => slotOf(c.node<Node2D>("g"), c.node(id))?.rotation ?? 0
    expect(Math.abs(rotation(turned, "s1") - 90)).toBeLessThan(2)
    expect(rotation(upright, "s1")).toBe(0)
    expect(slotOf(upright.node<Node2D>("g"), upright.node("s1"))).toBeNull()
  })

  it.each([...PATH_TEMPLATES])("places items on the %s template inside the grid's box", (shape) => {
    const c = grid({ shape }, 6)
    c.seek(0)
    for (const [x, y] of centres(c, ids(6))) {
      expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true)
      expect(Math.abs(x)).toBeLessThanOrEqual(200 + 1e-6)
      expect(Math.abs(y)).toBeLessThanOrEqual(200 + 1e-6)
    }
  })
})

describe("the reveal styles", () => {
  const nodes = () => [row("g", "rectangularGrid", "", 0, { columns: 4, columnGap: 0, rowGap: 0 }), ...squares("g", 4)]
  /** A reveal of one second with every item on the same beat, eased in a straight line. */
  const reveal = (style: string) => clip(nodes(), [step("r", "reveal", "g", 0, 1, { style, stagger: 0 }, LINEAR)])
  const placement = (c: ReturnType<typeof clip>, id = "s0") => slotOf(c.node<Node2D>("g"), c.node(id))

  it("fades the item in", () => {
    const c = reveal("fade")
    c.seek(0.5)
    expect(placement(c)).toMatchObject({ opacity: 0.5, scale: 1, rotation: 0 })
  })

  it("grows the item from nothing", () => {
    const c = reveal("scale")
    c.seek(0.5)
    expect(placement(c)).toMatchObject({ scale: 0.5, opacity: 1 })
  })

  it("flies the item out of the grid's centre, appearing within the first quarter", () => {
    const c = reveal("center")
    c.seek(0.125)
    // An eighth of the way out from the centre, at half opacity.
    expect(at(c.node("s3"))).toEqual([11.25, 0])
    expect(placement(c, "s3")?.opacity).toBe(0.5)
    c.seek(0.25)
    // Fully in view by a quarter of the way: nothing left to place but the position.
    expect(placement(c, "s3")).toBeNull()
    expect(at(c.node("s3"))).toEqual([22.5, 0])
  })

  it("rises the item into place from below while it fades in", () => {
    const c = reveal("rise")
    c.seek(0.5)
    // Half of the 60 px it rises from, below its place.
    expect(at(c.node("s0"))).toEqual([-90, 30])
    expect(placement(c)?.opacity).toBe(0.5)
  })

  it("rises by at least 40 px, however small the item", () => {
    const small = Array.from({ length: 2 }, (_, i) => row(`s${i}`, "rect", "g", i, { width: 20, height: 20, fill: "red" }))
    const c = clip(
      [row("g", "rectangularGrid", "", 0, { columns: 2, columnGap: 0, rowGap: 0 }), ...small],
      [step("r", "reveal", "g", 0, 1, { style: "rise", stagger: 0 }, LINEAR)],
    )
    c.seek(0.5)
    expect(at(c.node("s0"))).toEqual([-10, 20])
  })

  it("flips the item up from edge-on", () => {
    const c = reveal("flip")
    c.seek(0.5)
    expect(placement(c)).toMatchObject({ rotationX: 45, scale: 1, opacity: 1 })
  })

  it("spins the item in while it grows", () => {
    const c = reveal("spin")
    c.seek(0.5)
    expect(placement(c)).toMatchObject({ rotation: -90, scale: 0.5 })
  })

  it.each(["fade", "scale", "center", "rise", "flip", "spin"])("leaves %s with no trace once it has finished", (style) => {
    const c = reveal(style)
    c.seek(1.5)
    expect(placement(c)).toBeNull()
    expect(c.node<GridNode>("g").revealState).toBeNull()
  })

  it.each([
    ["fade", { opacity: 0 }],
    ["scale", { scale: 0 }],
    ["center", { opacity: 0 }],
    ["rise", { opacity: 0 }],
    ["flip", { rotationX: 90 }],
    ["spin", { scale: 0, rotation: -180 }],
  ])("holds every item out of view in its own way before %s has begun", (style, hidden) => {
    const c = reveal(style)
    c.seek(0)
    for (const id of ids(4)) expect(placement(c, id), id).toMatchObject(hidden)
  })
})

describe("the wave styles", () => {
  const nodes = () => [row("g", "rectangularGrid", "", 0, { columns: 4, columnGap: 0, rowGap: 0 }), ...squares("g", 4)]
  /** A wave of one second with every item on the same beat; at half way every item is at the crest. */
  const wave = (style: string) => clip(nodes(), [step("w", "wave", "g", 0, 1, { style, amount: 0.5, stagger: 0 }, LINEAR)])
  const placement = (c: ReturnType<typeof clip>, id = "s0") => slotOf(c.node<Node2D>("g"), c.node(id))

  it("swells the item", () => {
    const c = wave("scale")
    c.seek(0.5)
    expect(placement(c)?.scale).toBeCloseTo(1.5)
  })

  it("lifts the item by a share of its height, with a floor of 40 px", () => {
    const c = wave("lift")
    c.seek(0.5)
    expect(at(c.node("s0"))).toEqual([-90, -30])
  })

  it("lifts by at least 40 px, however small the item", () => {
    const small = Array.from({ length: 2 }, (_, i) => row(`s${i}`, "rect", "g", i, { width: 20, height: 20, fill: "red" }))
    const c = clip(
      [row("g", "rectangularGrid", "", 0, { columns: 2, columnGap: 0, rowGap: 0 }), ...small],
      [step("w", "wave", "g", 0, 1, { style: "lift", amount: 0.5, stagger: 0 }, LINEAR)],
    )
    c.seek(0.5)
    expect(at(c.node("s0"))).toEqual([-10, -20])
  })

  it("fades the item", () => {
    const c = wave("fade")
    c.seek(0.5)
    expect(placement(c)?.opacity).toBeCloseTo(0.5)
  })

  it("turns the item a share of a full turn", () => {
    const c = wave("spin")
    c.seek(0.5)
    expect(placement(c)?.rotation).toBeCloseTo(180)
  })

  it.each(["scale", "lift", "fade", "spin"])("settles %s back to rest at the start and the end", (style) => {
    const c = wave(style)
    c.seek(0)
    expect(placement(c)).toBeNull()
    c.seek(1.5)
    expect(placement(c)).toBeNull()
    expect(c.node<GridNode>("g").waveState).toBeNull()
  })
})

describe("focus and conceal, in sequence", () => {
  const nodes = () => [row("g", "rectangularGrid", "", 0, { columns: 4, columnGap: 0, rowGap: 0 }), ...squares("g", 4)]
  const placement = (c: ReturnType<typeof clip>, id: string) => slotOf(c.node<Node2D>("g"), c.node(id))
  const focus = (c: ReturnType<typeof clip>) => c.node<GridNode>("g").focusState
  const reveal = (c: ReturnType<typeof clip>) => c.node<GridNode>("g").revealState

  it("dims every item and grows none when the item named is not there", () => {
    // Whether this should throw is open; until it is answered an out-of-range item focuses nothing.
    const c = clip(nodes(), [step("f", "focus", "g", 0, 1, { item: 99, dim: 0.5, grow: 0.2 }, LINEAR)])
    c.seek(1)
    expect(focus(c)?.values).toEqual([-1, -1, -1, -1])
    for (const id of ids(4)) expect(placement(c, id), id).toMatchObject({ opacity: 0.5, scale: 0.9 })
  })

  it("focuses an item by its place in the layers, and a negative one like one that is not there", () => {
    const c = clip(nodes(), [step("f", "focus", "g", 0, 1, { item: 2, dim: 0.5, grow: 0.2 }, LINEAR)])
    c.seek(1)
    expect(focus(c)?.values).toEqual([-1, -1, 1, -1])
    expect(placement(c, "s2")).toMatchObject({ scale: 1.2, opacity: 1 })
    const negative = clip(nodes(), [step("f", "focus", "g", 0, 1, { item: -1 }, LINEAR)])
    negative.seek(1)
    expect(focus(negative)?.values).toEqual([-1, -1, -1, -1])
  })

  it("starts a second focus from where the first ended, easing the item, the dim and the grow", () => {
    const c = clip(nodes(), [
      step("a", "focus", "g", 0, 1, { item: 0, dim: 0.5, grow: 0.2 }, LINEAR),
      step("b", "focus", "g", 2, 1, { item: 2, dim: 0.8, grow: 0.4 }, LINEAR),
    ])
    c.seek(2)
    expect(focus(c)?.values).toEqual([1, -1, -1, -1])
    c.seek(2.5)
    const mid = focus(c)!
    expect(mid.values).toEqual([0, -1, 0, -1])
    expect(mid.dim).toBeCloseTo(0.65)
    expect(mid.grow).toBeCloseTo(0.3)
    c.seek(3)
    expect(focus(c)).toMatchObject({ dim: 0.8, values: [-1, -1, 1, -1] })
  })

  it("lets go of the focus: unfocus eases every value to 0 and leaves nothing behind", () => {
    const c = clip(nodes(), [
      step("a", "focus", "g", 0, 1, { item: 0, dim: 0.5, grow: 0.2 }, LINEAR),
      step("b", "unfocus", "g", 2, 1, {}, LINEAR),
    ])
    c.seek(2.5)
    expect(focus(c)?.values).toEqual([0.5, -0.5, -0.5, -0.5])
    c.seek(3)
    expect(focus(c)).toBeNull()
    expect(placement(c, "s0")).toBeNull()
  })

  it("does nothing to unfocus a grid that has nothing in focus", () => {
    const c = clip(nodes(), [step("b", "unfocus", "g", 0, 1, {}, LINEAR)])
    c.seek(0.5)
    expect(focus(c)).toBeNull()
  })

  it("conceals from every item shown when the reveal before it has finished", () => {
    const c = clip(nodes(), [
      step("r", "reveal", "g", 0, 1, { style: "fade", stagger: 0 }, LINEAR),
      step("k", "conceal", "g", 2, 1, { style: "fade", stagger: 0 }, LINEAR),
    ])
    c.seek(1.5)
    expect(reveal(c)).toBeNull()
    c.seek(2)
    expect(reveal(c)?.values).toEqual([1, 1, 1, 1])
    c.seek(2.5)
    expect(reveal(c)?.values).toEqual([0.5, 0.5, 0.5, 0.5])
    c.seek(3)
    expect(reveal(c)?.values).toEqual([0, 0, 0, 0])
  })

  it("conceals from every item shown for a grid that was never revealed", () => {
    const c = clip(nodes(), [step("k", "conceal", "g", 0, 1, { style: "fade", stagger: 0 }, LINEAR)])
    c.seek(0)
    expect(reveal(c)?.values).toEqual([1, 1, 1, 1])
  })

  it("builds a conceal on the state its predecessors end in, so one placed mid-reveal starts from every item shown", () => {
    // The reveal is half way at 0.5, but a command is built on the state the commands before it leave behind.
    const c = clip(nodes(), [
      step("r", "reveal", "g", 0, 1, { style: "fade", stagger: 0 }, LINEAR),
      step("k", "conceal", "g", 0.5, 1, { style: "fade", stagger: 0 }, LINEAR),
    ])
    c.seek(0.25)
    expect(reveal(c)?.values).toEqual([0.25, 0.25, 0.25, 0.25])
    c.seek(0.5)
    expect(reveal(c)?.values).toEqual([1, 1, 1, 1])
    c.seek(1)
    expect(reveal(c)?.values).toEqual([0.5, 0.5, 0.5, 0.5])
    c.seek(1.5)
    expect(reveal(c)?.values).toEqual([0, 0, 0, 0])
  })

  it("keeps each item at its own beat through a conceal that follows a staggered reveal", () => {
    const c = clip(nodes(), [step("k", "conceal", "g", 0, 1, { style: "fade", stagger: 0.5 }, LINEAR)])
    c.seek(0.5)
    const values = reveal(c)!.values
    expect(values[0]).toBeLessThan(values[3])
    c.seek(1)
    expect(reveal(c)?.values).toEqual([0, 0, 0, 0])
  })
})

describe("a stagger inside the command", () => {
  const nodes = (count: number) => [row("g", "rectangularGrid", "", 0, { columns: 4, columnGap: 0, rowGap: 0 }), ...squares("g", count)]
  const values = (c: ReturnType<typeof clip>) => c.node<GridNode>("g").revealState!.values

  it("ends every item with the command, even at the largest stagger", () => {
    const c = clip(nodes(4), [step("r", "reveal", "g", 0, 1, { style: "fade", stagger: 0.95 }, LINEAR)])
    c.seek(0.999)
    expect(Math.min(...values(c))).toBeGreaterThan(0.97)
    c.seek(1)
    expect(c.node<GridNode>("g").revealState).toBeNull()
    expect(slotOf(c.node<Node2D>("g"), c.node("s3"))).toBeNull()
  })

  it("takes the same time for four items as for four hundred", () => {
    // The last item begins at 95% of the command whatever the count, and the first has begun by the first frame.
    for (const count of [4, 400]) {
      const c = clip(nodes(count), [step("r", "reveal", "g", 0, 1, { style: "fade", stagger: 0.95 }, LINEAR)])
      c.seek(0.9)
      const last = values(c)[count - 1]
      expect(last, `${count} items`).toBe(0)
      c.seek(0.975)
      expect(values(c)[count - 1], `${count} items`).toBeCloseTo(0.5)
      expect(values(c)[0], `${count} items`).toBe(1)
    }
  })

  it("follows the order the command names: reverse starts with the last item", () => {
    const c = clip(nodes(4), [step("r", "reveal", "g", 0, 1, { style: "fade", stagger: 0.5, staggerOrder: "reverse" }, LINEAR)])
    c.seek(0.45)
    const v = values(c)
    expect(v[3]).toBeGreaterThan(v[2])
    expect(v[2]).toBeGreaterThan(v[1])
    expect(v[1]).toBeGreaterThan(v[0])
  })

  it("deals a random stagger the same way on every seek, and on every build", () => {
    const build = () => clip(nodes(8), [step("r", "reveal", "g", 0, 1, { style: "fade", stagger: 0.5, staggerOrder: "random" }, LINEAR)])
    const one = build()
    const two = build()
    one.seek(0.4)
    const first = [...values(one)]
    one.seek(0.8)
    one.seek(0.4)
    expect(values(one)).toEqual(first)
    two.seek(0.4)
    expect(values(two)).toEqual(first)
  })
})

describe("shuffle, reorder and spread", () => {
  const nodes = (count = 4) => [row("g", "rectangularGrid", "", 0, { columns: count, columnGap: 0, rowGap: 0 }), ...squares("g", count)]
  const orderAfter = (count: number, command: string, args: Record<string, unknown>) => {
    const c = clip(nodes(count), [step("c", command, "g", 0, 1, args, LINEAR)])
    c.seek(2)
    return c.node<GridNode>("g").order
  }

  it("deals the current order in a seeded random permutation, the same for the same seed", () => {
    expect(orderAfter(4, "shuffle", { seed: 1 })).toEqual([3, 1, 0, 2])
    expect(orderAfter(4, "shuffle", { seed: 1 })).toEqual(orderAfter(4, "shuffle", { seed: 1 }))
    expect(orderAfter(4, "shuffle", { seed: 1 })).toEqual(shuffled([0, 1, 2, 3], 1))
  })

  it("deals another way for another seed", () => {
    const seen = new Set([1, 2, 3, 4, 5, 6].map((seed) => orderAfter(6, "shuffle", { seed }).join()))
    expect(seen.size).toBeGreaterThan(3)
  })

  it("deals seed 1 when none is given", () => {
    expect(orderAfter(4, "shuffle", {})).toEqual(orderAfter(4, "shuffle", { seed: 1 }))
  })

  it("is never the order it started in, for two items or more", () => {
    for (const count of [2, 3, 4, 5]) {
      const identity = Array.from({ length: count }, (_, i) => i)
      for (let seed = 1; seed <= 12; seed++) {
        expect(orderAfter(count, "shuffle", { seed }), `${count} items, seed ${seed}`).not.toEqual(identity)
      }
    }
  })

  it("trades two items for a pair, whatever the seed", () => {
    for (let seed = 1; seed <= 6; seed++) expect(orderAfter(2, "shuffle", { seed })).toEqual([1, 0])
  })

  it("leaves one item where it is", () => {
    expect(orderAfter(1, "shuffle", { seed: 5 })).toEqual([0])
  })

  it("deals from the order it finds, so a second shuffle builds on the first", () => {
    const c = clip(nodes(5), [
      step("a", "shuffle", "g", 0, 1, { seed: 2 }, LINEAR),
      step("b", "shuffle", "g", 2, 1, { seed: 2 }, LINEAR),
    ])
    c.seek(4)
    const once = shuffled([0, 1, 2, 3, 4], 2)
    expect(c.node<GridNode>("g").order).toEqual(shuffled(once, 2))
  })

  it("moves each item from its slot in the order it leaves to its slot in the new one", () => {
    const c = clip(nodes(3), [step("s", "shuffle", "g", 0, 1, { seed: 3, stagger: 0 }, LINEAR)])
    c.seek(0)
    expect(centres(c, ids(3))).toEqual([[-60, 0], [0, 0], [60, 0]])
    c.seek(1)
    const order = c.node<GridNode>("g").order
    const slotX = [-60, 0, 60]
    expect(order).toEqual([1, 0, 2])
    ids(3).forEach((id, item) => expect(at(c.node(id))).toEqual([slotX[order.indexOf(item)], 0]))
    c.seek(0.5)
    // Halfway, an item that stays in its slot has not moved and the two that trade have met in the middle.
    expect(centres(c, ids(3))).toEqual([[-30, 0], [-30, 0], [60, 0]])
  })

  it("reorders to a list written as text", () => {
    expect(orderAfter(4, "reorder", { order: "2, 0, 1" })).toEqual([2, 0, 1, 3])
    expect(orderAfter(4, "reorder", { order: "3 2 1 0" })).toEqual([3, 2, 1, 0])
  })

  it("reorders to a list of numbers", () => {
    expect(orderAfter(4, "reorder", { order: [3, 2, 1, 0] })).toEqual([3, 2, 1, 0])
  })

  it("repairs a repeat and a stale entry rather than leaving a slot empty or two items in one", () => {
    expect(orderAfter(4, "reorder", { order: "1,1,0" })).toEqual([1, 0, 2, 3])
    expect(orderAfter(4, "reorder", { order: "9, 0" })).toEqual([0, 1, 2, 3])
    expect(orderAfter(4, "reorder", { order: "3, 3, 3" })).toEqual([3, 0, 1, 2])
  })

  it("reorders to the grid's own order for an empty list", () => {
    expect(orderAfter(4, "reorder", { order: "" })).toEqual([0, 1, 2, 3])
    expect(orderAfter(4, "reorder", {})).toEqual([0, 1, 2, 3])
  })

  it("moves the items to their new slots over the command, in a straight line at a stagger of 0", () => {
    const c = clip(nodes(4), [step("r", "reorder", "g", 0, 1, { order: "3, 2, 1, 0", stagger: 0 }, LINEAR)])
    c.seek(0)
    expect(centres(c, ids(4))).toEqual([[-90, 0], [-30, 0], [30, 0], [90, 0]])
    // Every item swaps sides with the one opposite, so all four pass the centre together.
    c.seek(0.5)
    expect(centres(c, ids(4))).toEqual([[0, 0], [0, 0], [0, 0], [0, 0]])
    c.seek(1)
    expect(centres(c, ids(4))).toEqual([[90, 0], [30, 0], [-30, 0], [-90, 0]])
  })

  it("moves the whole arrangement in and out with spreadTo, from the spread it has", () => {
    const c = clip(
      [row("g", "rectangularGrid", "", 0, { columns: 2, columnGap: 40 }), ...squares("g", 2)],
      [step("a", "spreadTo", "g", 0, 1, { spread: 2 }, LINEAR), step("b", "spreadTo", "g", 2, 1, {}, LINEAR)],
    )
    c.seek(0)
    expect(centres(c, ids(2))).toEqual([[-50, 0], [50, 0]])
    c.seek(0.5)
    expect(c.node<GridNode>("g").spread).toBe(1.5)
    expect(centres(c, ids(2))).toEqual([[-75, 0], [75, 0]])
    c.seek(1)
    expect(centres(c, ids(2))).toEqual([[-100, 0], [100, 0]])
    // With no spread named it goes back to the arrangement itself.
    c.seek(3)
    expect(c.node<GridNode>("g").spread).toBe(1)
    expect(centres(c, ids(2))).toEqual([[-50, 0], [50, 0]])
  })

  it("gathers every item at the centre with a spread of 0", () => {
    const c = clip(
      [row("g", "rectangularGrid", "", 0, { columns: 2, columnGap: 40 }), ...squares("g", 2)],
      [step("a", "spreadTo", "g", 0, 1, { spread: 0 }, LINEAR)],
    )
    c.seek(1)
    expect(centres(c, ids(2))).toEqual([[0, 0], [0, 0]])
  })
})

describe("the rectangular grid's own commands", () => {
  const props = { columns: 2, columnGap: 10, rowGap: 10 }
  const nodes = () => [row("g", "rectangularGrid", "", 0, props), ...squares("g", 4)]
  const grid = (c: ReturnType<typeof clip>) => c.node<Node2D>("g") as unknown as Record<string, unknown>

  it("eases the gap between columns and rows to the value it is given", () => {
    const c = clip(nodes(), [step("g", "gapTo", "g", 0, 1, { columnGap: 50, rowGap: 30 }, LINEAR)])
    c.seek(0.5)
    expect([grid(c).columnGap, grid(c).rowGap]).toEqual([30, 20])
    expect(centres(c, ids(4))).toEqual([[-45, -40], [45, -40], [-45, 40], [45, 40]])
    c.seek(1)
    expect([grid(c).columnGap, grid(c).rowGap]).toEqual([50, 30])
    expect(centres(c, ids(4))).toEqual([[-55, -45], [55, -45], [-55, 45], [55, 45]])
  })

  it("moves only the gap it is given", () => {
    const c = clip(nodes(), [step("g", "gapTo", "g", 0, 1, { columnGap: 50 }, LINEAR)])
    c.seek(1)
    expect([grid(c).columnGap, grid(c).rowGap]).toEqual([50, 10])
    const rows = clip(nodes(), [step("g", "gapTo", "g", 0, 1, { rowGap: 70 }, LINEAR)])
    rows.seek(1)
    expect([grid(rows).columnGap, grid(rows).rowGap]).toEqual([10, 70])
  })

  it("switches to fixed cells as it starts and eases them from the cell now measured", () => {
    const c = clip(
      [row("g", "rectangularGrid", "", 0, { columns: 2, columnGap: 0, rowGap: 0 }), ...squares("g", 4)],
      [step("c", "cellSizeTo", "g", 1, 1, { cellWidth: 160, cellHeight: 100 }, LINEAR)],
    )
    c.seek(0.5)
    // Before the command, the cells are the largest child and the mode is the grid's own.
    expect(grid(c).cellMode).toBe("fit")
    c.seek(1)
    expect([grid(c).cellMode, grid(c).cellWidth, grid(c).cellHeight]).toEqual(["fixed", 60, 60])
    c.seek(1.5)
    expect([grid(c).cellWidth, grid(c).cellHeight]).toEqual([110, 80])
    expect(at(c.node("s3"))).toEqual([55, 40])
    c.seek(2)
    expect([grid(c).cellMode, grid(c).cellWidth, grid(c).cellHeight]).toEqual(["fixed", 160, 100])
    c.seek(3)
    expect([grid(c).cellMode, grid(c).cellWidth, grid(c).cellHeight]).toEqual(["fixed", 160, 100])
  })

  it("keeps a side it is not given at the measured cell", () => {
    const c = clip(
      [row("g", "rectangularGrid", "", 0, { columns: 2, columnGap: 0, rowGap: 0 }), ...squares("g", 4)],
      [step("c", "cellSizeTo", "g", 0, 1, { cellWidth: 160 }, LINEAR)],
    )
    c.seek(1)
    expect([grid(c).cellWidth, grid(c).cellHeight]).toEqual([160, 60])
  })

  it("seeks back to the grid's own cells before the command", () => {
    const c = clip(
      [row("g", "rectangularGrid", "", 0, { columns: 2, columnGap: 0, rowGap: 0 }), ...squares("g", 4)],
      [step("c", "cellSizeTo", "g", 1, 1, { cellWidth: 160, cellHeight: 100 }, LINEAR)],
    )
    c.seek(3)
    c.seek(0)
    expect(grid(c).cellMode).toBe("fit")
    expect(at(c.node("s3"))).toEqual([30, 30])
  })

  describe("focusing a row or a column", () => {
    const six = () => [row("g", "rectangularGrid", "", 0, { columns: 3, columnGap: 0, rowGap: 0 }), ...squares("g", 6)]
    const placement = (c: ReturnType<typeof clip>, id: string) => slotOf(c.node<Node2D>("g"), c.node(id))

    it("brings a row forward and pushes the rest back", () => {
      const c = clip(six(), [step("f", "focusRow", "g", 0, 1, { row: 1, dim: 0.5, grow: 0.2 }, LINEAR)])
      c.seek(1)
      for (const id of ["s3", "s4", "s5"]) expect(placement(c, id), id).toMatchObject({ scale: 1.2, opacity: 1 })
      for (const id of ["s0", "s1", "s2"]) expect(placement(c, id), id).toMatchObject({ scale: 0.9, opacity: 0.5 })
    })

    it("brings a column forward and pushes the rest back", () => {
      const c = clip(six(), [step("f", "focusColumn", "g", 0, 1, { column: 2, dim: 0.5, grow: 0.2 }, LINEAR)])
      c.seek(1)
      for (const id of ["s2", "s5"]) expect(placement(c, id), id).toMatchObject({ scale: 1.2, opacity: 1 })
      for (const id of ["s0", "s1", "s3", "s4"]) expect(placement(c, id), id).toMatchObject({ scale: 0.9, opacity: 0.5 })
    })

    it("counts rows from the top and columns from the left", () => {
      const rowFocus = clip(six(), [step("f", "focusRow", "g", 0, 1, { row: 0 }, LINEAR)])
      rowFocus.seek(1)
      expect(rowFocus.node<GridNode>("g").focusState?.values).toEqual([1, 1, 1, -1, -1, -1])
      const columnFocus = clip(six(), [step("f", "focusColumn", "g", 0, 1, { column: 0 }, LINEAR)])
      columnFocus.seek(1)
      expect(columnFocus.node<GridNode>("g").focusState?.values).toEqual([1, -1, -1, 1, -1, -1])
    })

    it("dims every item when the row or column is not there", () => {
      const c = clip(six(), [step("f", "focusRow", "g", 0, 1, { row: 9 }, LINEAR)])
      c.seek(1)
      expect(c.node<GridNode>("g").focusState?.values).toEqual([-1, -1, -1, -1, -1, -1])
    })

    it("follows the grid's own slots, so a reordered grid focuses the items now in that row", () => {
      const c = clip(
        [row("g", "rectangularGrid", "", 0, { columns: 3, columnGap: 0, rowGap: 0, order: [3, 4, 5, 0, 1, 2] }), ...squares("g", 6)],
        [step("f", "focusRow", "g", 0, 1, { row: 0 }, LINEAR)],
      )
      c.seek(1)
      // Row 0 now holds items 3, 4 and 5.
      expect(c.node<GridNode>("g").focusState?.values).toEqual([-1, -1, -1, 1, 1, 1])
    })
  })
})

describe("the radial grid's commands", () => {
  const ring = (commands: ReturnType<typeof step>[], props: Record<string, unknown> = {}) =>
    clip([row("g", "radialGrid", "", 0, { radius: 100, ...props }), ...squares("g", 4)], commands)
  const prop = (c: ReturnType<typeof clip>, key: string) => (c.node<Node2D>("g") as unknown as Record<string, number>)[key]

  it("orbits the items by a number of degrees, from where the ring is", () => {
    const c = ring([step("a", "spin", "g", 0, 1, { degrees: 90 }, LINEAR), step("b", "spin", "g", 1, 1, { degrees: 90 }, LINEAR)])
    c.seek(0.5)
    expect(prop(c, "startAngle")).toBe(45)
    c.seek(1)
    expect(prop(c, "startAngle")).toBe(90)
    expect(at(c.node("s0"))).toEqual([100, 0])
    c.seek(2)
    expect(prop(c, "startAngle")).toBe(180)
    expect(at(c.node("s0"))).toEqual([0, 100])
    c.seek(5)
    expect(prop(c, "startAngle")).toBe(180)
  })

  it("makes one full turn when it is given no degrees", () => {
    const c = ring([step("a", "spin", "g", 0, 1, {}, LINEAR)])
    c.seek(0.5)
    expect(prop(c, "startAngle")).toBe(180)
    c.seek(1)
    expect(prop(c, "startAngle")).toBe(360)
    expect(centres(c, ids(4))).toEqual([[0, -100], [100, 0], [0, 100], [-100, 0]])
  })

  it("turns the ring the shorter way until an item sits at the top", () => {
    const first = ring([step("t", "turnTo", "g", 0, 1, { item: 1 }, LINEAR)])
    first.seek(0.5)
    expect(prop(first, "startAngle")).toBe(-45)
    first.seek(1)
    expect(prop(first, "startAngle")).toBe(-90)
    expect(at(first.node("s1"))).toEqual([0, -100])

    const other = ring([step("t", "turnTo", "g", 0, 1, { item: 3 }, LINEAR)])
    other.seek(1)
    expect(prop(other, "startAngle")).toBe(90)
    expect(at(other.node("s3"))).toEqual([0, -100])
  })

  it("turns by the slot an item is in, not by its place in the layers", () => {
    const c = ring([step("t", "turnTo", "g", 0, 1, { item: 2 }, LINEAR)], { order: [2, 0, 1, 3] })
    c.seek(1)
    // Item 2 is in slot 0, already at the top.
    expect(prop(c, "startAngle")).toBe(0)
    expect(at(c.node("s2"))).toEqual([0, -100])
  })

  it("does not turn for an item that is not there", () => {
    const c = ring([step("t", "turnTo", "g", 0, 1, { item: 9 }, LINEAR)])
    c.seek(1)
    expect(prop(c, "startAngle")).toBe(0)
  })

  it("eases the radius", () => {
    const c = ring([step("r", "radiusTo", "g", 0, 1, { radius: 300 }, LINEAR)])
    c.seek(0.5)
    expect(prop(c, "radius")).toBe(200)
    expect(at(c.node("s0"))).toEqual([0, -200])
    c.seek(1)
    expect(at(c.node("s0"))).toEqual([0, -300])
  })

  it("opens and closes the arc like a fan", () => {
    const c = ring([step("s", "sweepTo", "g", 0, 1, { sweep: 90 }, LINEAR)])
    c.seek(0)
    expect(prop(c, "sweep")).toBe(360)
    c.seek(0.5)
    expect(prop(c, "sweep")).toBe(225)
    c.seek(1)
    expect(prop(c, "sweep")).toBe(90)
    // Four items over a quarter of the circle: one at each end.
    expect(at(c.node("s0"))).toEqual([0, -100])
    expect(at(c.node("s3"))).toEqual([100, 0])
  })
})

describe("the path grid's commands", () => {
  const along = (commands: ReturnType<typeof step>[], props: Record<string, unknown> = {}, count = 4) =>
    clip([row("g", "pathGrid", "", 0, { shape: "circle", width: 400, height: 400, ...props }), ...squares("g", count)], commands)
  const prop = (c: ReturnType<typeof clip>, key: string) => (c.node<Node2D>("g") as unknown as Record<string, unknown>)[key]

  it("moves the items round the path by a number of loops, keeping their spacing", () => {
    const c = along([step("f", "flow", "g", 0, 1, { loops: 0.5 }, LINEAR)])
    c.seek(0)
    expect(centres(c, ["s0", "s1"])).toEqual([[0, -200], [200, 0]])
    c.seek(0.5)
    expect(prop(c, "offset")).toBe(0.25)
    // A quarter of the way round, each item has taken the place of the one before it.
    expect(centres(c, ["s0", "s1"])).toEqual([[200, 0], [0, 200]])
    c.seek(1)
    expect(prop(c, "offset")).toBe(0.5)
    expect(centres(c, ["s0", "s1"])).toEqual([[0, 200], [-200, 0]])
  })

  it("makes one loop when it is given none, and a loop is where it began", () => {
    const c = along([step("f", "flow", "g", 0, 1, {}, LINEAR)])
    c.seek(1)
    expect(prop(c, "offset")).toBe(1)
    expect(centres(c, ["s0", "s1"])).toEqual([[0, -200], [200, 0]])
  })

  it("builds a second flow on the offset the first left", () => {
    const c = along([step("a", "flow", "g", 0, 1, { loops: 0.25 }, LINEAR), step("b", "flow", "g", 1, 1, { loops: 0.25 }, LINEAR)])
    c.seek(2)
    expect(prop(c, "offset")).toBe(0.5)
  })

  it("squeezes the items into part of the path", () => {
    const c = along([step("t", "trimTo", "g", 0, 1, { trimStart: 0.25, trimEnd: 0.5 }, LINEAR)], { shape: "line" })
    c.seek(0)
    expect(centres(c, ["s0", "s3"])).toEqual([[-200, 0], [200, 0]])
    c.seek(0.5)
    expect([prop(c, "trimStart"), prop(c, "trimEnd")]).toEqual([0.125, 0.75])
    c.seek(1)
    expect([prop(c, "trimStart"), prop(c, "trimEnd")]).toEqual([0.25, 0.5])
    expect(centres(c, ["s0", "s3"])).toEqual([[-100, 0], [0, 0]])
  })

  it("moves the items onto another template, each from its place on the old path to its place on the new", () => {
    const c = along([step("p", "setPath", "g", 1, 1, { shape: "square", stagger: 0 }, LINEAR)])
    c.seek(0.5)
    expect(prop(c, "shape")).toBe("circle")
    expect(centres(c, ["s0", "s1"])).toEqual([[0, -200], [200, 0]])
    // The grid is on its new shape from the first frame of the command, and the items have not yet left the old.
    c.seek(1)
    expect(prop(c, "shape")).toBe("square")
    expect(c.node<GridNode>("g").transition).not.toBeNull()
    expect(centres(c, ["s0", "s1"])).toEqual([[0, -200], [200, 0]])
    c.seek(1.5)
    expect(centres(c, ["s0", "s1"])).toEqual([[-100, -200], [200, -100]])
    c.seek(2)
    expect(c.node<GridNode>("g").transition).toBeNull()
    expect(centres(c, ["s0", "s1"])).toEqual([[-200, -200], [200, -200]])
  })

  it("moves the items onto a path node in the scene, and lets go of the template", () => {
    const c = clip(
      [
        row("p", "path", "", 0, { data: "M -0.5 0 L 0.5 0", width: 200, height: 10, x: 0, y: 200, stroke: "white" }),
        row("g", "pathGrid", "", 1, { shape: "circle", width: 400, height: 400 }),
        ...squares("g", 3),
      ],
      [step("p", "setPath", "g", 0, 1, { pathNode: "p", stagger: 0 }, LINEAR)],
    )
    c.seek(1)
    expect(prop(c, "pathNode")).toBe("p")
    expect(centres(c, ids(3))).toEqual([[-100, -200], [0, -200], [100, -200]])
  })

  it("clears the path node when it moves onto a template", () => {
    const c = clip(
      [
        row("p", "path", "", 0, { data: "M -0.5 0 L 0.5 0", width: 200, height: 10, x: 0, y: 200, stroke: "white" }),
        row("g", "pathGrid", "", 1, { pathNode: "p", width: 400, height: 400 }),
        ...squares("g", 3),
      ],
      [step("p", "setPath", "g", 0, 1, { shape: "line", stagger: 0 }, LINEAR)],
    )
    c.seek(1)
    expect(prop(c, "pathNode")).toBe("")
    expect(prop(c, "shape")).toBe("line")
    expect(centres(c, ids(3))).toEqual([[-200, 0], [0, 0], [200, 0]])
  })
})

describe("the sphere grid's commands", () => {
  const ball = (commands: ReturnType<typeof step>[], props: Record<string, unknown> = {}) =>
    clip([row("g", "sphereGrid", "", 0, { radius: 100, ...props }), ...squares("g", 6)], commands)
  const prop = (c: ReturnType<typeof clip>, key: string) => (c.node<Node2D>("g") as unknown as Record<string, number>)[key]
  const turns = (c: ReturnType<typeof clip>) => [prop(c, "yaw"), prop(c, "pitch"), prop(c, "roll")]

  it("turns about the vertical axis by default, a full turn at a time", () => {
    const c = ball([step("s", "spin", "g", 0, 1, {}, LINEAR)])
    c.seek(0.5)
    expect(turns(c)).toEqual([180, 0, 0])
    c.seek(1)
    expect(turns(c)).toEqual([360, 0, 0])
  })

  it("turns about the axis it is given: x tilts, z rolls", () => {
    const c = ball([
      step("a", "spin", "g", 0, 1, { axis: "x", degrees: 90 }, LINEAR),
      step("b", "spin", "g", 1, 1, { axis: "z", degrees: 45 }, LINEAR),
      step("c", "spin", "g", 2, 1, { axis: "y", degrees: 30 }, LINEAR),
    ])
    c.seek(0.5)
    expect(turns(c)).toEqual([0, 45, 0])
    c.seek(1)
    expect(turns(c)).toEqual([0, 90, 0])
    c.seek(2)
    expect(turns(c)).toEqual([0, 90, 45])
    c.seek(3)
    expect(turns(c)).toEqual([30, 90, 45])
  })

  it("turns to a set orientation, easing all three together", () => {
    const c = ball([step("o", "orientTo", "g", 0, 1, { yaw: 40, pitch: 10, roll: 20 }, LINEAR)])
    c.seek(0.5)
    expect(turns(c)).toEqual([20, 5, 10])
    c.seek(1)
    expect(turns(c)).toEqual([40, 10, 20])
  })

  it("leaves an angle it is not given where it is", () => {
    const c = ball([step("o", "orientTo", "g", 0, 1, { yaw: 40 }, LINEAR)], { pitch: 15 })
    c.seek(1)
    expect(turns(c)).toEqual([40, 15, 0])
  })

  it("eases the radius", () => {
    const c = ball([step("r", "radiusTo", "g", 0, 1, { radius: 300 }, LINEAR)])
    c.seek(0.5)
    expect(prop(c, "radius")).toBe(200)
    c.seek(1)
    expect(prop(c, "radius")).toBe(300)
  })

  it("dollies the camera: the focal length the grid is seen through follows", () => {
    const c = ball([step("f", "focalLengthTo", "g", 0, 1, { focalLength: 400 }, LINEAR)])
    const camera = () => c.node<Node2D>("g")._spaceCamera()?.perspective
    c.seek(0)
    expect(camera()).toBe(900)
    c.seek(0.5)
    expect(prop(c, "focalLength")).toBe(650)
    expect(camera()).toBe(650)
    c.seek(1)
    expect(camera()).toBe(400)
  })

  it("turns the shorter way to bring an item to the front, and zeroes the roll", () => {
    const c = ball([step("t", "turnTo", "g", 0, 1, { item: 3 }, LINEAR)], { roll: 40 })
    c.seek(1)
    expect(prop(c, "roll")).toBe(0)
    expect(at(c.node("s3"))).toEqual([0, 0])
    const placement = slotOf(c.node<Node2D>("g"), c.node("s3"))
    expect(placement?.depth).toBeCloseTo(100)
  })

  it("brings an item round by the slot it is in, not by its place in the layers", () => {
    const c = ball([step("t", "turnTo", "g", 0, 1, { item: 3 }, LINEAR)], { order: [3, 0, 1, 2, 4, 5] })
    c.seek(1)
    expect(at(c.node("s3"))).toEqual([0, 0])
  })

  it("does not turn for an item that is not there", () => {
    const c = ball([step("t", "turnTo", "g", 0, 1, { item: 33 }, LINEAR)])
    c.seek(1)
    expect(turns(c)).toEqual([0, 0, 0])
  })

  // The yaw the clock adds while the command runs is not counted, so the item lands off the front.
  it.skip("brings an item to the front of a sphere that turns on its own", () => {
    const c = ball([step("t", "turnTo", "g", 0, 1, { item: 3 }, LINEAR)], { spinSpeed: 30 })
    c.seek(1)
    const x = at(c.node("s3"))
    expect(Math.abs(x[0]) + Math.abs(x[1])).toBeLessThan(1)
  })
})

describe("morphing into another grid's arrangement", () => {
  const four = (extra: ReturnType<typeof row>[], commands: ReturnType<typeof step>[]) =>
    clip(
      [row("a", "rectangularGrid", "", 0, { columns: 4, columnGap: 0 }), ...squares("a", 4), ...extra],
      commands,
    )
  const ring = (props: Record<string, unknown> = {}) => row("b", "radialGrid", "", 1, { radius: 100, x: 300, ...props })
  const RING_AT_300 = [[300, -100], [400, 0], [300, 100], [200, 0]]
  const OWN = [[-90, 0], [-30, 0], [30, 0], [90, 0]]

  it("goes back to the grid's own arrangement when the target is empty", () => {
    const c = four([ring()], [
      step("m", "morphInto", "a", 0, 1, { target: "b", stagger: 0 }, LINEAR),
      step("n", "morphInto", "a", 2, 1, { target: "", stagger: 0 }, LINEAR),
    ])
    c.seek(1.5)
    expect(centres(c, ids(4))).toEqual(RING_AT_300)
    expect(c.node<GridNode>("a").arrangeLike).toBe("b")
    c.seek(2)
    expect(c.node<GridNode>("a").arrangeLike).toBe("")
    expect(centres(c, ids(4))).toEqual(RING_AT_300)
    // Half way back, then home: the same road as the way out.
    c.seek(2.5)
    expect(centres(c, ids(4))).toEqual([[105, -50], [185, 0], [165, 50], [145, 0]])
    c.seek(3)
    expect(centres(c, ids(4))).toEqual(OWN)
    expect(c.node<GridNode>("a").transition).toBeNull()
  })

  it("takes the arrangement of a grid that is itself borrowing one: the target's own, not the one it follows", () => {
    const c = four(
      [ring({ arrangeLike: "c" }), row("c", "sphereGrid", "", 2, { radius: 50, x: -300 })],
      [step("m", "morphInto", "a", 0, 1, { target: "b", stagger: 0 }, LINEAR)],
    )
    c.seek(1)
    expect(centres(c, ids(4))).toEqual(RING_AT_300)
  })

  it("follows each of two grids that borrow each other without going round forever", () => {
    const c = clip([
      row("a", "rectangularGrid", "", 0, { columns: 4, columnGap: 0, arrangeLike: "b" }),
      ...squares("a", 4),
      row("b", "radialGrid", "", 1, { radius: 100, x: 300, arrangeLike: "a" }),
      ...squares("b", 4, "t"),
    ])
    c.seek(0)
    // a's items take b's ring, and b's take a's row, each in the other's place.
    expect(centres(c, ids(4))).toEqual(RING_AT_300)
    expect(centres(c, ids(4, "t"))).toEqual([[-390, 0], [-330, 0], [-270, 0], [-210, 0]])
  })

  it("follows the target as it moves while the items travel", () => {
    const c = four([ring()], [
      step("m", "morphInto", "a", 0, 1, { target: "b", stagger: 0 }, LINEAR),
      step("v", "moveTo", "b", 1, 1, { x: 500, y: 0 }, LINEAR),
    ])
    c.seek(1)
    expect(centres(c, ids(4))).toEqual(RING_AT_300)
    c.seek(1.5)
    expect(c.node<Node2D>("b").global.x).toBe(400)
    expect(centres(c, ids(4))).toEqual([[400, -100], [500, 0], [400, 100], [300, 0]])
    c.seek(2)
    expect(centres(c, ids(4))).toEqual([[500, -100], [600, 0], [500, 100], [400, 0]])
  })

  it("follows the target as it turns: the borrowed arrangement is carried round with it", () => {
    const c = four([ring({ x: 0 })], [
      step("m", "morphInto", "a", 0, 1, { target: "b", stagger: 0 }, LINEAR),
      step("r", "rotateTo", "b", 1, 1, { rotation: 90 }, LINEAR),
    ])
    c.seek(1)
    expect(centres(c, ids(4))).toEqual([[0, -100], [100, 0], [0, 100], [-100, 0]])
    c.seek(2)
    // A quarter turn clockwise: the top of the ring is now its right.
    expect(centres(c, ids(4))).toEqual([[100, 0], [0, 100], [-100, 0], [0, -100]])
    const turned = slotOf(c.node<Node2D>("a"), c.node("s0"))
    expect(turned?.rotation).toBe(90)
  })

  it("keeps the items where the target puts them after the morph ends, and stays the target's follower", () => {
    const c = four([ring()], [step("m", "morphInto", "a", 0, 1, { target: "b", stagger: 0 }, LINEAR)])
    c.seek(5)
    expect(c.node<GridNode>("a").arrangeLike).toBe("b")
    expect(c.node<GridNode>("a").transition).toBeNull()
    expect(centres(c, ids(4))).toEqual(RING_AT_300)
  })
})

describe("a grid of the author's own", () => {
  const own = { radius: Types.number(120) }
  const arranger: ItemGrid.Arranger<Values<typeof own>> = {
    arrangement: (s): Arrangement => ({ kind: "radial", radius: s.radius, startAngle: 0, sweep: 360, direction: "clockwise", rotateItems: false, spinSpeed: 0 }),
  }
  const ArcGrid = ItemGrid.define(component2d({
    key: "arcGridOfOurOwn",
    state: { ...ItemGrid.state, ...own },
    defaults: ItemGrid.defaults,
    commands: { ...ItemGrid.commands },
    ...ItemGrid.fields(arranger),
  }), arranger)
  const types = [...NODES, ArcGrid]

  it("lays its items out by its own arrangement and takes the shared commands", () => {
    const c = clip([row("g", "arcGridOfOurOwn", "", 0, { radius: 100 }), ...squares("g", 4)], [step("r", "reveal", "g", 0, 1, { style: "fade", stagger: 0 }, LINEAR)], types)
    c.seek(0)
    expect(centres(c, ids(4))).toEqual([[0, -100], [100, 0], [0, 100], [-100, 0]])
    c.seek(0.5)
    expect(slotOf(c.node<Node2D>("g"), c.node("s1"))?.opacity).toBe(0.5)
  })

  it("is one another grid can morph into, and one a host can tell is a grid", () => {
    const c = clip([
      row("a", "rectangularGrid", "", 0, { columns: 4 }), ...squares("a", 4),
      row("b", "arcGridOfOurOwn", "", 1, { radius: 100, x: 200 }),
    ], [step("m", "morphInto", "a", 0, 1, { target: "b", stagger: 0 })], types)
    c.seek(1)
    const offset = c.node<Node2D>("b").global.x - c.node<Node2D>("a").global.x
    expect(centres(c, ids(4))).toEqual([[offset, -100], [offset + 100, 0], [offset, 100], [offset - 100, 0]])
    expect(ItemGrid.isGrid(c.node("a"))).toBe(true)
    expect(ItemGrid.isGrid(c.node("b"))).toBe(true)
    expect(ItemGrid.isGrid(c.node("s0"))).toBe(false)
  })
})

describe("where the grids part from the classes they replaced, on purpose", () => {
  /** Children of assorted sizes under `parentId`, ids `s0…`. */
  const boxes = (parentId: string, count: number) =>
    Array.from({ length: count }, (_, i) => row(`s${i}`, "rect", parentId, i, { width: 40 + ((i * 23) % 50), height: 30 + ((i * 37) % 45), fill: "red" }))

  it("hugs its items through the camera it has this frame, whatever was drawn before", () => {
    // The class measured with the camera of the last layout, so its size hung on the seek before.
    const sizeAt = (seeks: number[]) => {
      const c = clip([row("g", "sphereGrid", "", 0, { radius: 150 }), ...boxes("g", 12)], [step("f", "focalLengthTo", "g", 0, 1, { focalLength: 300 })])
      for (const time of seeks) c.seek(time)
      const box = c.node<Node2D>("g").layoutBounds
      return [box.width, box.height]
    }
    expect(sizeAt([1, 0.5])).toEqual(sizeAt([0.5]))
  })

  it("stands a sphere that opens its own camera untilted: the camera is the space, as for any space root", () => {
    // The class tilted the flattened picture by its own rotationX.
    class Transforms extends NullRenderContext {
      readonly seen: { matrix?: unknown }[] = []
      override transform(state: Parameters<NullRenderContext["transform"]>[0]) {
        this.seen.push(state as { matrix?: unknown })
        return super.transform(state)
      }
    }
    const c = clip([row("g", "sphereGrid", "", 0, { radius: 150, rotationX: 30, width: 500, height: 500 }), ...squares("g", 6)])
    const into = new Transforms()
    c.seek(0, into)
    expect(into.seen[1]).toBeDefined()
    expect(into.seen[1].matrix).toBeUndefined()
  })

  it("ranks a stagger by where the commands before it left the items", () => {
    // Item 3 is in the first column once the reorder is done; the class ranked by the columns the tree was laid out in.
    const c = clip([row("g", "rectangularGrid", "", 0, { columns: 4 }), ...squares("g", 4)], [
      step("o", "reorder", "g", 0, 1, { order: "3, 2, 1, 0", stagger: 0 }),
      step("r", "reveal", "g", 2, 1, { style: "fade", staggerOrder: "column", stagger: 0.9 }, LINEAR),
    ])
    c.seek(2.05)
    const values = c.node<GridNode>("g").revealState!.values
    expect(values[3]).toBeGreaterThan(values[0])
  })
})
