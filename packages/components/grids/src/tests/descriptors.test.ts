import { describe, expect, it } from "vitest"

import { Registry, type NodeConstructor } from "@motionscript/sdk"

import { CELL_MODES, REVEAL_STYLES, SPHERE_FACINGS, STAGGER_ORDERS } from "../kit"
import { NODES } from "../nodes"
import { PATH_GRID_SHAPES } from "../path-grid"

/**
 * What a host reads to offer these nodes and draw a panel for them — derived
 * from the components' entries and commands, so these are the checks that
 * an editor hint survives until an editor asks for it.
 */

const registry = new Registry({ nodes: NODES as unknown as NodeConstructor[] })
const KEYS = ["rectangularGrid", "radialGrid", "pathGrid", "sphereGrid"]

describe("the grids' descriptors", () => {
  // Where a host shelves a grid, how it lays out and what a new one starts with are the host's to keep.
  it("registers every grid under its key, as a 2D node", () => {
    for (const key of KEYS) {
      expect(registry.hasNode(key)).toBe(true)
      expect(registry.describe(key)).toMatchObject({ key, dimension: "2d" })
    }
  })

  it("publishes the choices of every enum", () => {
    expect(registry.describe("rectangularGrid")!.properties!.cellMode.options).toEqual(CELL_MODES)
    expect(registry.describe("pathGrid")!.properties!.shape.options).toEqual(PATH_GRID_SHAPES)
    expect(registry.describe("sphereGrid")!.properties!.facing.options).toEqual(SPHERE_FACINGS)
  })

  it("marks what the commands write as state rather than settings", () => {
    const props = registry.describe("radialGrid")!.properties!
    for (const key of ["revealState", "waveState", "focusState", "transition"]) expect(props[key].kind).toBe("state")
  })

  it("offers the shared commands on every grid and each grid's own on it alone", () => {
    for (const key of KEYS) {
      expect(registry.commandKeys(key)).toEqual(expect.arrayContaining([
        "reveal", "conceal", "wave", "focus", "unfocus", "spreadTo", "shuffle", "swap", "reorder", "morphInto",
      ]))
    }
    expect(registry.commandKeys("rectangularGrid")).toEqual(expect.arrayContaining(["columnsTo", "gapTo", "cellSizeTo", "focusRow", "focusColumn"]))
    expect(registry.commandKeys("radialGrid")).toEqual(expect.arrayContaining(["spin", "turnTo", "radiusTo", "sweepTo"]))
    expect(registry.commandKeys("pathGrid")).toEqual(expect.arrayContaining(["flow", "trimTo", "setPath"]))
    expect(registry.commandKeys("sphereGrid")).toEqual(expect.arrayContaining(["spin", "orientTo", "turnTo", "radiusTo", "focalLengthTo"]))
    expect(registry.commandKeys("radialGrid")).not.toContain("columnsTo")
  })

  it("describes each command's arguments with their defaults", () => {
    const reveal = registry.node("radialGrid")!.commands.get("reveal")!
    const args = Object.fromEntries((reveal.args ?? []).map((a) => (typeof a === "string" ? [a, {}] : [a.key, a])))
    expect(args.style).toMatchObject({ kind: "enum", options: REVEAL_STYLES, default: "scale" })
    expect(args.staggerOrder).toMatchObject({ kind: "enum", options: STAGGER_ORDERS, default: "index" })
    expect(args.stagger).toMatchObject({ min: 0, max: 0.95, default: 0.5 })
  })
})
