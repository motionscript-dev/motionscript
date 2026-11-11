import { describe, expect, it } from "vitest"
import { AssetDeclaration, ManifestAssetCatalog, NullRenderContext } from "@motionscript/core"
import { Fills, Rect, Registry, type NodeConstructor } from "@motionscript/sdk"

import { DotGridPattern } from "../dot-grid-pattern"
import { GridPattern } from "../grid-pattern"
import { LineGridPattern } from "../line-grid-pattern"
import { ViewportPattern } from "../kit"
import { NODES } from "../nodes"

const registry = new Registry({ nodes: NODES as unknown as NodeConstructor[] })

describe("the package's nodes", () => {
  it("register under the three document keys, and nothing else", () => {
    const builtin = new Set(new Registry().nodeKeys())
    expect(registry.nodeKeys().filter((key) => !builtin.has(key))).toEqual([
      "dotGridPattern",
      "gridPattern",
      "lineGridPattern",
    ])
    expect(registry.node("lineGridPattern")?.ctor).toBe(LineGridPattern.node)
    expect(registry.node("dotGridPattern")?.ctor).toBe(DotGridPattern.node)
    expect(registry.node("gridPattern")?.ctor).toBe(GridPattern.node)
  })

  it("are not part of core's own vocabulary", () => {
    const core = new Registry()
    for (const key of ["line-grid", "lineGridPattern", "dotGridPattern", "gridPattern"]) {
      expect(core.hasNode(key)).toBe(false)
    }
  })

  it("describe themselves as shapes: a shape's paints, layout and paint commands", () => {
    for (const key of ["lineGridPattern", "dotGridPattern", "gridPattern"]) {
      expect(Object.keys(registry.describe(key)!.properties!)).toEqual(expect.arrayContaining(
        ["fill", "stroke", "shadow", "overlay", "start", "end", "flow", "gap", "wrap", "columns", "align"],
      ))
      expect(registry.commandKeys(key)).toEqual(expect.arrayContaining(["fillTo", "strokeTo", "shadowTo", "overlayTo", "progressTo", "flash"]))
    }
  })

  it("build the camera-aware one from the ViewportPattern module", () => {
    const entries = Object.keys(registry.describe("gridPattern")!.properties!)
    expect(entries).toEqual(expect.arrayContaining(Object.keys(ViewportPattern.state)))
  })
})

/** A plain box of the given size, to lay out. */
const tile = (width: number, height: number) => new Rect({ width, height })

describe("LineGridPattern lays its children out like every other shape", () => {
  it("honours `flow` rather than centring everything", () => {
    const scope = new NullRenderContext()
    const a = tile(100, 50)
    const b = tile(100, 50)
    const grid = new LineGridPattern({
      width: 400,
      height: 100,
      flow: "horizontal",
      gap: 10,
      align: "centerLeft",
      children: [a, b],
    } as never)

    grid.measure({ maxWidth: 1000, maxHeight: 1000 }, scope)
    grid.layout({ x: 0, y: 0, width: 400, height: 100 }, scope)
    expect(a.layoutBounds.x).toBe(-150)
    expect(b.layoutBounds.x - a.layoutBounds.x).toBe(110)
  })
})

describe("the minor-line stroke is declared as an asset", () => {
  const image = (src: string) => ({ src, width: 8, height: 8, sizeBytes: 0 })
  const catalog = new ManifestAssetCatalog({
    image: Object.fromEntries(["stamp.png", "sub.png"].map((src) => [src, image(src)])),
    video: {},
    audio: {},
    font: {},
  })

  function declared(node: LineGridPattern | GridPattern): Record<string, string> {
    const scope = new AssetDeclaration(catalog)
    node.declareAssets(scope)
    return Object.fromEntries([...scope.declarations].map(([key, decl]) => [key, decl.type]))
  }

  it("LineGridPattern", () => {
    const grid = new LineGridPattern({
      stroke: { fill: "white", weight: 1 },
      subdivisions: 2,
      subStroke: { fill: Fills.image("sub.png"), weight: 1 },
    })
    expect(declared(grid)).toEqual({ "sub.png": "image" })
  })

  it("GridPattern", () => {
    const grid = new GridPattern({
      stroke: { fill: Fills.image("stamp.png"), weight: 1 },
      subdivisions: 2,
      subStroke: { fill: Fills.image("sub.png"), weight: 1 },
    })
    expect(declared(grid)).toEqual({ "stamp.png": "image", "sub.png": "image" })
  })
})
