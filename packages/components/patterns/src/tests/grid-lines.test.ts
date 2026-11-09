import { describe, expect, it } from "vitest"

import { strokeOps, type StrokeResolved } from "@motionscript/sdk"

import { centered, dimStroke, gridLinePaths, gridLines, maxWeight, type GridAxis } from "../kit"

const axis = (min: number, max: number, step: number, offset = 0): GridAxis => ({ min, max, step, offset })

describe("gridLines — the lines on each axis", () => {
  const x = axis(-100, 100, 50)
  const y = axis(-50, 50, 25)

  it("splits the positions of each axis into major and minor by the subdivision count", () => {
    const g = gridLines(x, y, 2, 0)
    // Tile indices -2..2 on x, a major every second one.
    expect(g.verticalMajor).toEqual([-100, 0, 100])
    expect(g.verticalMinor).toEqual([-50, 50])
    expect(g.horizontalMajor).toEqual([-50, 0, 50])
    expect(g.horizontalMinor).toEqual([-25, 25])
  })

  it("makes every line major with no subdivision", () => {
    const g = gridLines(x, y, 1, 0)
    expect(g.verticalMajor).toEqual([-100, -50, 0, 50, 100])
    expect(g.verticalMinor).toEqual([])
    expect(g.horizontalMinor).toEqual([])
  })

  it("runs every vertical line over the y extent and every horizontal one over the x extent", () => {
    const g = gridLines(x, y, 2, 0)
    expect([g.top, g.bottom]).toEqual([-50, 50])
    expect([g.left, g.right]).toEqual([-100, 100])
  })

  it("grows the span of each line by the overscan, snapped outward to the lattice", () => {
    const g = gridLines(x, y, 2, 10)
    // y: -60 snaps down to -75, 60 up to 75, in steps of 25; x: -110 to -150, 110 to 150, in steps of 50.
    expect([g.top, g.bottom]).toEqual([-75, 75])
    expect([g.left, g.right]).toEqual([-150, 150])
  })

  it("keeps the span where it is when the overscan already lands on the lattice", () => {
    const g = gridLines(x, y, 2, 25)
    expect([g.top, g.bottom]).toEqual([-75, 75])
  })

  it("adds the lines the overscan reaches, and no others", () => {
    expect(gridLines(x, y, 1, 10).verticalMajor).toHaveLength(5)
    expect(gridLines(x, y, 1, 60).verticalMajor).toEqual([-150, -100, -50, 0, 50, 100, 150])
  })

  it("pans the lines by the offset and keeps the area full", () => {
    const g = gridLines(axis(-100, 100, 50, 20), y, 2, 0)
    // Positions are n * 50 + 20 over the extent; a line that panned out the far side is gone.
    expect([...g.verticalMajor, ...g.verticalMinor].sort((a, b) => a - b)).toEqual([-80, -30, 20, 70])
  })

  it("snaps the span to the panned lattice, not the un-panned one", () => {
    const g = gridLines(axis(-100, 100, 50, 20), y, 2, 0)
    expect([g.left, g.right]).toEqual([-130, 120])
  })

  it("keeps the class of a line fixed to its tile index, so a whole-step pan hands the major to the next position", () => {
    const still = gridLines(axis(-100, 100, 50), y, 2, 0)
    const panned = gridLines(axis(-100, 100, 50, 50), y, 2, 0)
    // Every major of the still grid is a major of the panned one, a step to the right; a minor stays a minor.
    for (const pos of still.verticalMajor.filter((p) => p + 50 <= 100)) expect(panned.verticalMajor).toContain(pos + 50)
    for (const pos of still.verticalMinor.filter((p) => p + 50 <= 100)) expect(panned.verticalMinor).toContain(pos + 50)
  })

  it("classifies a line left of the centre the way one right of it is classified", () => {
    const g = gridLines(axis(-90, 90, 30), y, 3, 0)
    expect(g.verticalMajor).toEqual([-90, 0, 90])
  })

  it("snaps the span to a whole number of dash cycles, anchored to zero, when the stroke is dashed", () => {
    const g = gridLines(x, y, 2, 0, 12)
    // x: -100 floors to -108 (-9 cycles), 100 ceils to 108; y: -50 to -60, 50 to 60.
    expect([g.left, g.right]).toEqual([-108, 108])
    expect([g.top, g.bottom]).toEqual([-60, 60])
    for (const end of [g.left, g.right, g.top, g.bottom]) expect(Math.abs(end % 12)).toBe(0)
  })

  it("gives every dashed line the same length, a whole number of cycles", () => {
    const g = gridLines(axis(-130, 71, 40, 5), axis(-17, 233, 40, 9), 2, 3, 8)
    expect(Math.abs((g.bottom - g.top) % 8)).toBe(0)
    expect(Math.abs((g.right - g.left) % 8)).toBe(0)
  })

  it("ignores the offset when snapping a dashed span, the cycle being anchored to the world", () => {
    const a = gridLines(axis(-100, 100, 50, 0), y, 2, 0, 12)
    const b = gridLines(axis(-100, 100, 50, 17), y, 2, 0, 12)
    expect([b.left, b.right]).toEqual([a.left, a.right])
  })

  it("does not snap to a dash cycle of zero or less", () => {
    expect(gridLines(x, y, 2, 10, 0).top).toBe(-75)
    expect(gridLines(x, y, 2, 10, -5).top).toBe(-75)
  })

  it("keeps the lines where they are with a step of zero or less, and draws none", () => {
    const flat = gridLines(axis(-100, 100, 0), axis(-50, 50, -5), 2, 10)
    expect(flat.verticalMajor).toEqual([])
    expect(flat.horizontalMajor).toEqual([])
    // With nothing to snap to, the span is the extent grown by the overscan, as it is.
    expect([flat.left, flat.right]).toEqual([-110, 110])
    expect([flat.top, flat.bottom]).toEqual([-60, 60])
  })

  it("keeps a line that lands exactly on an edge", () => {
    expect(gridLines(axis(-100, 100, 100), y, 1, 0).verticalMajor).toEqual([-100, 0, 100])
  })

  it("tiles about zero when the axis names no anchor, so an odd count leaves the edges between lines", () => {
    const g = gridLines(axis(-90, 90, 60), y, 1, 0)
    expect(g.verticalMajor).toEqual([-60, 0, 60])
  })

  it("starts the lattice at the anchor when there is one, so the extent's edges are lines", () => {
    const g = gridLines({ ...axis(-90, 90, 60), anchor: -90 }, y, 1, 0)
    expect(g.verticalMajor).toEqual([-90, -30, 30, 90])
  })

  it("counts the tile index from the anchor, so a division line is the one a whole division from it", () => {
    const g = gridLines({ ...axis(-90, 90, 60), anchor: -90 }, y, 3, 0)
    expect(g.verticalMajor).toEqual([-90, 90])
    expect(g.verticalMinor).toEqual([-30, 30])
  })

  it("pans an anchored lattice by the offset and keeps each line's class", () => {
    const g = gridLines({ ...axis(-90, 90, 60, 20), anchor: -90 }, y, 3, 0)
    // Lines at -90 + n * 60 + 20: -70, -10, 50, 110 (out); the n = -1 line, -130, is out the near side.
    expect(g.verticalMajor).toEqual([-70])
    expect(g.verticalMinor).toEqual([-10, 50])
  })

  it("reaches an anchored lattice's lines through the overscan, and no others", () => {
    const g = gridLines({ ...axis(-90, 90, 60), anchor: -90 }, y, 1, 65)
    expect(g.verticalMajor).toEqual([-150, -90, -30, 30, 90, 150])
  })

  it("leaves an anchored axis with an even number of divisions where the centred lattice put it, majors and minors alike", () => {
    const close = (a: number[], b: number[]) => {
      expect(a).toHaveLength(b.length)
      for (const [i, v] of a.entries()) expect(v).toBeCloseTo(b[i], 9)
    }
    for (const divisions of [2, 4, 6]) {
      for (const subdivisions of [1, 2, 3, 4]) {
        for (const offset of [0, 7, -31.5]) {
          const x = axis(-120, 120, 240 / (divisions * subdivisions), offset)
          const centred = gridLines(x, y, subdivisions, 2)
          const anchored = gridLines({ ...x, anchor: x.min }, y, subdivisions, 2)
          const label = `${divisions} x ${subdivisions}, offset ${offset}`
          close(anchored.verticalMajor, centred.verticalMajor)
          close(anchored.verticalMinor, centred.verticalMinor)
          expect([anchored.left, anchored.right], label).toEqual([centred.left, centred.right])
        }
      }
    }
  })

  it("does not write to the axes it is given", () => {
    const frozenX = Object.freeze({ ...x })
    const frozenY = Object.freeze({ ...y })
    expect(() => gridLines(frozenX, frozenY, 2, 4, 8)).not.toThrow()
  })
})

describe("gridLinePaths — the lines as path commands", () => {
  const x = axis(-100, 100, 50)
  const y = axis(-50, 50, 25)

  it("writes each vertical line as a move and a line from top to bottom", () => {
    const { major } = gridLinePaths(x, y, 2, 0)
    expect(major.slice(0, 4)).toEqual([
      { type: "M", x: -100, y: -50 },
      { type: "L", x: -100, y: 50 },
      { type: "M", x: 0, y: -50 },
      { type: "L", x: 0, y: 50 },
    ])
  })

  it("writes each horizontal line from left to right, after all the verticals of its group", () => {
    const { major } = gridLinePaths(x, y, 2, 0)
    // Three verticals (six commands) first, then three horizontals.
    expect(major).toHaveLength(12)
    expect(major.slice(6, 8)).toEqual([
      { type: "M", x: -100, y: -50 },
      { type: "L", x: 100, y: -50 },
    ])
  })

  it("splits the lines into a major path and a minor one", () => {
    const { major, minor } = gridLinePaths(x, y, 2, 0)
    expect(major).toHaveLength(12)
    expect(minor).toHaveLength(8)
    const minorX = minor.filter((c) => c.type === "M" && c.y === -50).map((c) => (c as { x: number }).x)
    expect(minorX).toEqual([-50, 50])
  })

  it("has no minor path without subdivisions", () => {
    const { major, minor } = gridLinePaths(x, y, 1, 0)
    expect(minor).toEqual([])
    expect(major).toHaveLength(2 * (5 + 5))
  })

  it("spans the overscanned extent, snapped as gridLines snaps it", () => {
    const { major } = gridLinePaths(x, y, 1, 10)
    const first = major[0] as { x: number; y: number }
    const second = major[1] as { x: number; y: number }
    expect([first.y, second.y]).toEqual([-75, 75])
  })

  it("is a plain solid path: no dash cycle is applied", () => {
    const { major } = gridLinePaths(x, y, 1, 0)
    expect((major[0] as { y: number }).y).toBe(-50)
  })

  it("alternates moves and lines throughout", () => {
    const { major, minor } = gridLinePaths(x, y, 3, 0)
    for (const path of [major, minor]) {
      path.forEach((command, i) => expect(command.type).toBe(i % 2 === 0 ? "M" : "L"))
    }
  })
})

describe("maxWeight", () => {
  const layers = (...weights: number[]): StrokeResolved[] => strokeOps.resolve(weights.map((weight) => ({ weight, fill: "white" })))

  it("is the thickest layer", () => {
    expect(maxWeight(layers(1, 4, 2))).toBe(4)
    expect(maxWeight(layers(3))).toBe(3)
  })

  it("is 0 for no layers", () => {
    expect(maxWeight([])).toBe(0)
  })

  it("is 0 when every layer is hairline-thin or less", () => {
    expect(maxWeight(layers(0, 0))).toBe(0)
  })

  it("ignores a layer's colour, so a transparent stroke still counts", () => {
    expect(maxWeight(strokeOps.resolve([{ weight: 6, fill: "transparent" }]))).toBe(6)
  })
})

describe("centered", () => {
  it("sets every layer's alignment to the centre", () => {
    const inside = strokeOps.resolve([{ weight: 2, fill: "white", align: "inside" }, { weight: 1, fill: "red", align: "outside" }])
    expect(centered(inside).map((s) => s.align)).toEqual([0, 0])
  })

  it("replaces a numeric alignment, too", () => {
    expect(centered(strokeOps.resolve([{ weight: 2, fill: "white", align: 0.4 }]))[0].align).toBe(0)
  })

  it("keeps the other fields of each layer", () => {
    const [layer] = strokeOps.resolve([{ weight: 5, fill: "red", dash: [4, 2], join: "round", align: "inside" }])
    expect(centered([layer])[0]).toEqual({ ...layer, align: 0 })
  })

  it("hands back the very layer when it is centred already", () => {
    const [layer] = strokeOps.resolve([{ weight: 2, fill: "white", align: "center" }])
    expect(centered([layer])[0]).toBe(layer)
  })

  it("does not write to the strokes it is given", () => {
    const layers = strokeOps.resolve([{ weight: 2, fill: "white" }])
    centered(layers)
    expect(layers[0].align).toBe(-1)
  })

  it("is empty for no layers", () => {
    expect(centered([])).toEqual([])
  })
})

describe("dimStroke", () => {
  it("scales the opacity of every fill layer of every stroke", () => {
    const layers = strokeOps.resolve([{ weight: 2, fill: ["red", "blue"] }])
    const dimmed = dimStroke(layers, 0.5)
    expect(dimmed[0].fill.map((f) => f.opacity)).toEqual([0.5, 0.5])
  })

  it("multiplies an opacity that is there already", () => {
    const layers = strokeOps.resolve([{ weight: 2, fill: { type: "solid", color: "red", opacity: 0.6 } }])
    expect(dimStroke(layers, 0.5)[0].fill[0].opacity).toBeCloseTo(0.3, 12)
  })

  it("keeps the colour, the weight and the rest of the stroke", () => {
    const [layer] = strokeOps.resolve([{ weight: 7, fill: "red", dash: [3, 1], cap: "round", join: "bevel", dashOffset: 2 }])
    const [dimmed] = dimStroke([layer], 0.25)
    expect(dimmed).toMatchObject({ weight: 7, dash: [3, 1], cap: "round", join: "bevel", dashOffset: 2 })
    expect(dimmed.fill[0]).toMatchObject({ type: "solid", color: [1, 0, 0, 1] })
  })

  it("is a copy: the strokes it is given keep their opacity", () => {
    const layers = strokeOps.resolve([{ weight: 2, fill: "red" }])
    const dimmed = dimStroke(layers, 0.5)
    expect(dimmed).not.toBe(layers)
    expect(layers[0].fill[0].opacity).toBeUndefined()
  })

  it("dims by repeating: two halves make a quarter", () => {
    const layers = strokeOps.resolve([{ weight: 2, fill: "red" }])
    expect(dimStroke(dimStroke(layers, 0.5), 0.5)[0].fill[0].opacity).toBe(0.25)
  })

  it("is the strokes unchanged for a factor of 1, and clear for a factor of 0", () => {
    const layers = strokeOps.resolve([{ weight: 2, fill: "red" }])
    expect(dimStroke(layers, 1)[0].fill[0].opacity).toBe(1)
    expect(dimStroke(layers, 0)[0].fill[0].opacity).toBe(0)
  })

  it("is empty for no layers", () => {
    expect(dimStroke([], 0.5)).toEqual([])
  })

  it("dims every layer of a stack of strokes", () => {
    const layers = strokeOps.resolve([{ weight: 2, fill: "red" }, { weight: 4, fill: "blue" }])
    expect(dimStroke(layers, 0.5).map((s) => s.fill[0].opacity)).toEqual([0.5, 0.5])
  })
})
