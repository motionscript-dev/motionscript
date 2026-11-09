import { describe, expect, it } from "vitest"

import { NullRenderContext } from "@motionscript/core"
import { Fills, type BoxBounds, type StrokeResolved } from "@motionscript/sdk"

import { LineGridPattern } from "../line-grid-pattern"
import { linesOf, mount, pathOf, render, strokesOf } from "./recorder.fixtures"

type Props = ConstructorParameters<typeof LineGridPattern>[0]

/** A grid mounted and laid out in a `width` × `height` box, rendered into a recorder. */
function drawn(props: Record<string, unknown>, width = 200, height = 200) {
  const grid = mount(new LineGridPattern({ width, height, ...props } as Props))
  grid.layout({ x: 0, y: 0, width, height } as BoxBounds, new NullRenderContext())
  return { grid, ctx: render(grid) }
}

const WHITE = { weight: 2, fill: "white" }

describe("the default minor-line stroke", () => {
  it("is the major stroke at half opacity when there are subdivisions", () => {
    const grid = new LineGridPattern({ stroke: WHITE, subdivisions: 2 })
    const sub = grid.subStroke
    expect(sub).toHaveLength(1)
    expect(sub[0].weight).toBe(2)
    expect(sub[0].fill[0].opacity).toBe(0.5)
  })

  it("keeps the rest of the major stroke: weight, dash, caps, joins", () => {
    const grid = new LineGridPattern({
      stroke: { weight: 3, fill: "red", dash: [4, 2], cap: "round", join: "bevel" },
      subdivisions: 4,
    })
    expect(grid.subStroke[0]).toMatchObject({ weight: 3, dash: [4, 2], cap: "round", join: "bevel" })
    expect(grid.subStroke[0].fill[0]).toMatchObject({ type: "solid", color: [1, 0, 0, 1] })
  })

  it("halves the opacity of an authored fill opacity rather than replacing it", () => {
    const grid = new LineGridPattern({
      stroke: { weight: 1, fill: { type: "solid", color: "white", opacity: 0.8 } },
      subdivisions: 2,
    })
    expect(grid.subStroke[0].fill[0].opacity).toBeCloseTo(0.4, 12)
  })

  it("dims every layer of a stacked stroke", () => {
    const grid = new LineGridPattern({
      stroke: [{ weight: 1, fill: "red" }, { weight: 3, fill: "blue" }],
      subdivisions: 2,
    })
    expect(grid.subStroke.map((s) => [s.weight, s.fill[0].opacity])).toEqual([[1, 0.5], [3, 0.5]])
  })

  it("is worked out from the stroke it was built with, and kept when the stroke changes later", () => {
    const grid = new LineGridPattern({ stroke: WHITE, subdivisions: 2 })
    const built = grid.subStroke
    grid.set({ stroke: { weight: 9, fill: "blue" } })
    expect(grid.subStroke).toEqual(built)
  })

  it("leaves the major stroke as it was", () => {
    const grid = new LineGridPattern({ stroke: WHITE, subdivisions: 2 })
    expect((grid.stroke as StrokeResolved[])[0].fill[0].opacity).toBeUndefined()
  })

  it("leaves an authored subStroke alone", () => {
    const grid = new LineGridPattern({ stroke: WHITE, subdivisions: 2, subStroke: { weight: 1, fill: "red" } })
    expect(grid.subStroke[0].weight).toBe(1)
    expect(grid.subStroke[0].fill[0]).toMatchObject({ color: [1, 0, 0, 1] })
    expect(grid.subStroke[0].fill[0].opacity).toBeUndefined()
  })

  it("leaves an authored empty subStroke alone, too: no minor lines were asked for", () => {
    const grid = new LineGridPattern({ stroke: WHITE, subdivisions: 2, subStroke: [] })
    expect(grid.subStroke).toEqual([])
  })

  it("has none when there is no stroke to derive it from", () => {
    expect(new LineGridPattern({ subdivisions: 2 }).subStroke).toEqual([])
  })

  it("has none with a single division, there being no minor lines to draw", () => {
    expect(new LineGridPattern({ stroke: WHITE, subdivisions: 1 }).subStroke).toEqual([])
    expect(new LineGridPattern({ stroke: WHITE }).subStroke).toEqual([])
  })

  it("is derived from the stroke as it was at construction, not kept in step with it", () => {
    const grid = new LineGridPattern({ stroke: WHITE, subdivisions: 2 })
    grid.set({ stroke: { weight: 9, fill: "blue" } })
    expect(grid.subStroke[0].weight).toBe(2)
  })
})

describe("LineGridPattern drawing — the order of things", () => {
  const subbed = { stroke: { weight: 4, fill: "white" }, subStroke: { weight: 1, fill: "red" }, divisions: 2, subdivisions: 2 }

  it("paints fill and shadow of the whole rect first, behind the lines", () => {
    const { ctx } = drawn({ ...subbed, fill: "blue", shadow: { blur: 8, fill: "black" } })
    expect(ctx.events[0]).toBe("draw:rect+shadow+fill")
    expect(ctx.events.slice(0, 2)).toEqual(["draw:rect+shadow+fill", "beginClip"])
  })

  it("draws the fill as a rect the size of the layout box", () => {
    const { ctx } = drawn({ ...subbed, fill: "blue" }, 240, 120)
    const op = ctx.drawings[0].graphics.ops()[0] as { kind: string; state: { width: number; height: number } }
    expect(op.kind).toBe("rect")
    expect(op.state).toMatchObject({ width: 240, height: 120 })
  })

  it("carries the node's start and end on the fill rect", () => {
    const { ctx } = drawn({ ...subbed, fill: "blue", start: 0.25, end: 0.75 })
    const op = ctx.drawings[0].graphics.ops()[0] as { state: { start: number; end: number } }
    expect(op.state).toMatchObject({ start: 0.25, end: 0.75 })
  })

  it("draws the lines inside one clip to the rect, minor lines first so the major sit on top", () => {
    const { ctx } = drawn(subbed)
    expect(ctx.events.slice(ctx.events.indexOf("beginClip"))).toContain("endClip")
    const lines = ctx.lineDrawings
    expect(lines).toHaveLength(2)
    expect(strokesOf(lines[0])[0].weight).toBe(1)
    expect(strokesOf(lines[1])[0].weight).toBe(4)
    const clipped = ctx.events.slice(ctx.events.indexOf("beginClip"), ctx.events.lastIndexOf("endClip") + 1)
    expect(clipped).toEqual(["beginClip", "draw:path+stroke", "draw:path+stroke", "endClip"])
  })

  it("clips to the rect of its layout box", () => {
    const { ctx } = drawn(subbed, 240, 120)
    const clip = ctx.clips[0].ops()[0] as { kind: string; state: { width: number; height: number } }
    expect(clip.kind).toBe("rect")
    expect(clip.state).toMatchObject({ width: 240, height: 120 })
  })

  it("draws no minor lines without subdivisions, whatever subStroke says", () => {
    const { ctx } = drawn({ ...subbed, subdivisions: 1 })
    expect(ctx.lineDrawings).toHaveLength(1)
    expect(strokesOf(ctx.lineDrawings[0])[0].weight).toBe(4)
  })

  it("draws no minor lines when there is no minor stroke", () => {
    const { ctx } = drawn({ stroke: { weight: 2, fill: "white" }, subStroke: [], divisions: 2, subdivisions: 2 })
    expect(ctx.lineDrawings).toHaveLength(1)
  })

  it("hands its lines an empty stroke when it has none, so nothing is painted", () => {
    const { ctx } = drawn({ fill: "blue", divisions: 2 })
    expect(ctx.events).toEqual(["draw:rect+shadow+fill", "beginClip", "draw:path+stroke", "endClip"])
    expect(strokesOf(ctx.lineDrawings[0])).toEqual([])
  })

  it("balances its clip", () => {
    const { ctx } = drawn(subbed)
    expect(ctx.events.filter((e) => e === "beginClip")).toHaveLength(ctx.events.filter((e) => e === "endClip").length)
  })
})

function verticalLines(divisions: number, width = 200, height = 200): number[] {
  const { ctx } = drawn({ stroke: { weight: 2, fill: "white" }, divisions }, width, height)
  return linesOf(pathOf(ctx.lineDrawings[0]).data).vertical
}

describe("LineGridPattern drawing — the lines", () => {
  it("draws divisions + 1 major lines on each axis, evenly spaced, inset by half the stroke", () => {
    const { ctx } = drawn({ stroke: { weight: 2, fill: "white" }, divisions: 4 })
    const { vertical, horizontal } = linesOf(pathOf(ctx.lineDrawings[0]).data)
    // 200 wide, a stroke of 2: the outermost lines sit a half weight inside the rect.
    expect(vertical).toEqual([-99, -49.5, 0, 49.5, 99])
    expect(horizontal).toEqual([-99, -49.5, 0, 49.5, 99])
  })

  it("spaces the lines of each axis by its own extent", () => {
    const { ctx } = drawn({ stroke: { weight: 2, fill: "white" }, divisions: 2 }, 400, 200)
    const { vertical, horizontal } = linesOf(pathOf(ctx.lineDrawings[0]).data)
    expect(vertical).toEqual([-199, 0, 199])
    expect(horizontal).toEqual([-99, 0, 99])
  })

  it("splits the lines into major and minor: a division is divided into subdivisions", () => {
    const { ctx } = drawn({ stroke: { weight: 2, fill: "white" }, divisions: 2, subdivisions: 2 })
    const [minor, major] = ctx.lineDrawings
    expect(linesOf(pathOf(major).data).vertical).toEqual([-99, 0, 99])
    expect(linesOf(pathOf(minor).data).vertical).toEqual([-49.5, 49.5])
  })

  it("paints each group as one path, every line a subpath of it", () => {
    const { ctx } = drawn({ stroke: { weight: 2, fill: "white" }, divisions: 4 })
    const { data } = pathOf(ctx.lineDrawings[0])
    expect(data.filter((c) => c.type === "M")).toHaveLength(10)
    expect(data.filter((c) => c.type === "L")).toHaveLength(10)
  })

  it("runs the lines past the rect by the overscan, snapped outward to the lattice, for the clip to trim", () => {
    const { ctx } = drawn({ stroke: { weight: 2, fill: "white" }, divisions: 4 })
    const [first, second] = pathOf(ctx.lineDrawings[0]).data as Array<{ y: number }>
    // Reaching at least the rect's own edge (100) and landing on the 49.5 lattice.
    expect(first.y).toBeLessThanOrEqual(-100)
    expect(second.y).toBeGreaterThanOrEqual(100)
    expect(Math.abs(first.y / 49.5 - Math.round(first.y / 49.5))).toBeLessThan(1e-9)
  })

  it("grows the inset with the thickest stroke of either group", () => {
    const { ctx } = drawn({
      stroke: { weight: 2, fill: "white" }, subStroke: { weight: 8, fill: "red" }, divisions: 2, subdivisions: 2,
    })
    // The thickest stroke is the minor one, 8: the lines sit a half of it (4) inside the rect.
    const { vertical } = linesOf(pathOf(ctx.lineDrawings[1]).data)
    expect(vertical).toEqual([-96, 0, 96])
  })

  it("centres every stroke on its line, whatever alignment was authored", () => {
    const { grid, ctx } = drawn({ stroke: { weight: 2, fill: "white", align: "inside" }, divisions: 2 })
    expect(strokesOf(ctx.lineDrawings[0])[0].align).toBe(0)
    expect((grid.stroke as StrokeResolved[])[0].align).toBe(-1)
  })

  it("paints a dashed stroke as one path too: its dashes run per line, as the renderer fits them", () => {
    const { ctx } = drawn({ stroke: { weight: 2, fill: "white", dash: [6, 4] }, divisions: 2 })
    expect(ctx.lineDrawings).toHaveLength(1)
    expect(strokesOf(ctx.lineDrawings[0])[0].dash).toEqual([6, 4])
  })

  it("floors a fractional division count", () => {
    expect(verticalLines(2.9)).toEqual(verticalLines(2))
    expect(verticalLines(2.9)).toEqual([-99, 0, 99])
  })

  it("takes fewer than one division as one", () => {
    for (const divisions of [0, 0.2, -3]) expect(verticalLines(divisions)).toEqual(verticalLines(1))
  })

  it("takes fewer than one subdivision as one, which draws no minor lines", () => {
    const { ctx } = drawn({ stroke: { weight: 2, fill: "white" }, subStroke: { weight: 1, fill: "red" }, divisions: 2, subdivisions: 0.5 })
    expect(ctx.lineDrawings).toHaveLength(1)
  })

  // The tiling was centred on 0 with a step of width / cells, so for an odd number of
  // cells the box edges fell between lattice positions: `divisions: 1` drew one line through the
  // middle of the box and `divisions: 3` three lines at -66, 0, 66.
  it("puts a line on each edge of the box, whatever the number of divisions", () => {
    expect(verticalLines(1)).toEqual([-99, 99])
    expect(verticalLines(3)).toEqual([-99, -33, 33, 99])
  })

  it("spaces an odd number of divisions evenly from edge to edge", () => {
    const lines = verticalLines(5)
    expect(lines).toHaveLength(6)
    for (const [i, x] of lines.entries()) expect(x).toBeCloseTo(-99 + (i * 198) / 5, 9)
  })

  it("draws the same lines for an even count as it always has", () => {
    expect(verticalLines(2)).toEqual([-99, 0, 99])
    expect(verticalLines(4)).toEqual([-99, -49.5, 0, 49.5, 99])
    expect(verticalLines(6)).toEqual([-99, -66, -33, 0, 33, 66, 99])
  })

  it("puts a line on each edge of each axis, whatever its own count of cells", () => {
    const { ctx } = drawn({ stroke: { weight: 2, fill: "white" }, divisions: 3 }, 400, 200)
    const { vertical, horizontal } = linesOf(pathOf(ctx.lineDrawings[0]).data)
    expect(vertical).toHaveLength(4)
    for (const [i, x] of vertical.entries()) expect(x).toBeCloseTo(-199 + (i * 398) / 3, 9)
    expect(horizontal).toEqual([-99, -33, 33, 99])
  })

  it("makes the division lines the major ones, an edge among them, with an odd number of divisions", () => {
    const { ctx } = drawn({ stroke: { weight: 2, fill: "white" }, divisions: 3, subdivisions: 2 })
    const [minor, major] = ctx.lineDrawings
    expect(linesOf(pathOf(major).data).vertical).toEqual([-99, -33, 33, 99])
    expect(linesOf(pathOf(minor).data).vertical).toEqual([-66, 0, 66])
  })

  it("puts the edges among the major lines when the subdivisions are odd and the divisions are one", () => {
    const { ctx } = drawn({ stroke: { weight: 2, fill: "white" }, divisions: 1, subdivisions: 3 })
    const [minor, major] = ctx.lineDrawings
    expect(linesOf(pathOf(major).data).vertical).toEqual([-99, 99])
    expect(linesOf(pathOf(minor).data).vertical).toEqual([-33, 33])
  })

  it("draws no lines in a box with no size", () => {
    const { ctx } = drawn({ stroke: { weight: 2, fill: "white" }, divisions: 4 }, 0, 0)
    expect(ctx.lineDrawings).toHaveLength(0)
  })

  it("draws no lines in a box thinner than its strokes", () => {
    const { ctx } = drawn({ stroke: { weight: 2, fill: "white" }, divisions: 4 }, 1, 1)
    expect(ctx.lineDrawings).toHaveLength(0)
  })

  it("draws its centre bounds as the box, so the path recentres on the node", () => {
    const { ctx } = drawn({ stroke: { weight: 2, fill: "white" }, divisions: 2 }, 240, 120)
    expect(pathOf(ctx.lineDrawings[0]).centerBounds).toEqual([-120, -60, 120, 60])
  })
})

describe("LineGridPattern drawing — panning with offset", () => {
  const props = { stroke: { weight: 2, fill: "white" }, divisions: 2, subdivisions: 2 }
  const lines = (offset: { x: number; y: number }) => {
    const { ctx } = drawn({ ...props, offset })
    const [minor, major] = ctx.lineDrawings
    return { minor: linesOf(pathOf(minor).data), major: linesOf(pathOf(major).data) }
  }

  it("scrolls the lines by the offset: each sits at its tile index times the step, plus the offset", () => {
    const { major, minor } = lines({ x: 10, y: 0 })
    // Step 49.5; tile indices -2..1 land inside the rect once panned, and the line that scrolled out the far side is gone.
    expect(major.vertical).toEqual([-89, 10])
    expect(minor.vertical).toEqual([-39.5, 59.5])
  })

  it("leaves the other axis alone", () => {
    const still = lines({ x: 0, y: 0 })
    const panned = lines({ x: 20, y: 0 })
    expect(panned.major.horizontal).toEqual(still.major.horizontal)
    expect(panned.minor.horizontal).toEqual(still.minor.horizontal)
  })

  it("keeps the area full: a pan never leaves the rect with fewer lines than it began with, give or take one", () => {
    const base = lines({ x: 0, y: 0 })
    const count = (l: typeof base) => l.major.vertical.length + l.minor.vertical.length
    for (const x of [7, 25, 49.5, -30]) {
      expect(Math.abs(count(lines({ x, y: 0 })) - count(base))).toBeLessThanOrEqual(1)
    }
  })

  it("keeps each line's class as it scrolls: a whole-step pan hands the major to the next position", () => {
    const step = 49.5
    const still = lines({ x: 0, y: 0 })
    const panned = lines({ x: step, y: 0 })
    for (const x of still.major.vertical.filter((v) => v + step <= 99)) expect(panned.major.vertical).toContain(x + step)
    for (const x of still.minor.vertical.filter((v) => v + step <= 99)) expect(panned.minor.vertical).toContain(x + step)
  })

  it("keeps a line's class when the pan is negative", () => {
    const step = 49.5
    const still = lines({ x: 0, y: 0 })
    const panned = lines({ x: -step, y: 0 })
    for (const x of still.major.vertical.filter((v) => v - step >= -99)) expect(panned.major.vertical).toContain(x - step)
  })

  it("pans an odd number of divisions from the edge lattice, keeping its major lines the division lines", () => {
    const odd = { stroke: { weight: 2, fill: "white" }, divisions: 3, subdivisions: 2 }
    const { ctx } = drawn({ ...odd, offset: { x: 10, y: 0 } })
    const [minor, major] = ctx.lineDrawings
    // Step 33 from -99: the lattice shifted 10 right, the line that left the far side gone.
    expect(linesOf(pathOf(major).data).vertical).toEqual([-89, -23, 43])
    expect(linesOf(pathOf(minor).data).vertical).toEqual([-56, 10, 76])
  })

  it("tweens: a pan halfway is the pan between the two", () => {
    const grid = mount(new LineGridPattern({ width: 200, height: 200, ...props } as Props))
    grid.to({ data: { offset: { x: 40, y: 0 } }, duration: 1 }).at(0.5)
    expect(grid.offset).toEqual({ x: 20, y: 0 })
  })
})

describe("LineGridPattern", () => {
  it("clips its children to its rect when asked, the rect of its layout box", () => {
    const grid = new LineGridPattern({ width: 200, height: 100 })
    grid.layout({ x: 0, y: 0, width: 200, height: 100 } as BoxBounds, new NullRenderContext())
    const clip = (grid as unknown as { clipSelf(): { ops(): Array<{ kind: string; state: { width: number; height: number } }> } }).clipSelf()
    expect(clip.ops()[0]).toMatchObject({ kind: "rect", state: { width: 200, height: 100 } })
  })

  it("defaults to four divisions, one subdivision and no offset", () => {
    const grid = new LineGridPattern({})
    expect([grid.divisions, grid.subdivisions, grid.offset]).toEqual([4, 1, { x: 0, y: 0 }])
  })

  it("paints an image stroke without declaring more than the fill layers it has", () => {
    const grid = new LineGridPattern({ stroke: { weight: 2, fill: Fills.image("a.png") }, subdivisions: 2 })
    expect(grid.subStroke[0].fill[0]).toMatchObject({ type: "image", src: "a.png", opacity: 0.5 })
  })
})
