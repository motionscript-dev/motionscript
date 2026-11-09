import { describe, expect, it } from "vitest"

import { NullRenderContext } from "@motionscript/core"
import { Camera } from "@motionscript/sdk"

import { GridPattern } from "../grid-pattern"
import { Recorder, linesOf, mount, pathOf, strokesOf } from "./recorder.fixtures"

type Props = ConstructorParameters<typeof GridPattern>[0]

const SCOPE = new NullRenderContext()
const STROKE = { weight: 2, fill: "white" }

/** What a pattern paints under a camera with the given look, in an 800 x 600 viewport. */
function drawn(props: Record<string, unknown>, look: Record<string, unknown> = {}) {
  const grid = new GridPattern({ stroke: STROKE, ...props } as Props)
  const camera = new Camera({ width: 800, height: 600, ...look, children: [grid] } as never)
  mount(camera)
  camera.layout({ x: 0, y: 0, width: 800, height: 600 }, SCOPE)
  const ctx = new Recorder()
  grid.render(ctx)
  return { grid, camera, ctx }
}

const sorted = (values: number[]) => [...values].sort((a, b) => a - b)
const multiples = (values: number[], of: number) => values.map((v) => ((v % of) + of) % of)

describe("GridPattern drawing — the world-anchored lines", () => {
  it("tiles lines at multiples of the cell size across what the camera sees", () => {
    const { ctx } = drawn({ cellSize: 100 })
    const { vertical, horizontal } = linesOf(pathOf(ctx.lineDrawings[0]).data)
    expect(sorted(vertical)).toEqual([-400, -300, -200, -100, 0, 100, 200, 300, 400])
    expect(sorted(horizontal)).toEqual([-300, -200, -100, 0, 100, 200, 300])
  })

  it("draws a cell size of 100 by default", () => {
    const { grid, ctx } = drawn({})
    expect(grid.cellSize).toBe(100)
    expect(linesOf(pathOf(ctx.lineDrawings[0]).data).vertical).toHaveLength(9)
  })

  it("keeps each line at the same world position when the camera pans", () => {
    const still = linesOf(pathOf(drawn({ cellSize: 100 }).ctx.lineDrawings[0]).data)
    const panned = linesOf(pathOf(drawn({ cellSize: 100 }, { lookAt: { x: 50, y: 0 } }).ctx.lineDrawings[0]).data)
    // The view slid 50 to the right, so one line left it on the left and none arrived yet on the right...
    expect(sorted(panned.vertical)).toEqual([-300, -200, -100, 0, 100, 200, 300, 400])
    // ... and every line both views can see is where it was in the world.
    for (const x of still.vertical.filter((v) => v >= -300)) expect(panned.vertical).toContain(x)
  })

  it("never moves a line to follow the camera: every position stays on the world lattice", () => {
    for (const lookAt of [{ x: 13, y: 7 }, { x: -250, y: 333 }, { x: 1000.5, y: -0.25 }]) {
      const { vertical, horizontal } = linesOf(pathOf(drawn({ cellSize: 100 }, { lookAt }).ctx.lineDrawings[0]).data)
      expect(multiples(vertical, 100).every((m) => Math.abs(m) < 1e-9)).toBe(true)
      expect(multiples(horizontal, 100).every((m) => Math.abs(m) < 1e-9)).toBe(true)
    }
  })

  it("fills a zoomed-out view with more lines and a zoomed-in one with fewer", () => {
    const count = (zoom: number) => linesOf(pathOf(drawn({ cellSize: 100 }, { zoom }).ctx.lineDrawings[0]).data).vertical.length
    expect(count(0.5)).toBeGreaterThan(count(1))
    expect(count(2)).toBeLessThan(count(1))
  })

  it("covers the turned viewport when the camera has a heading", () => {
    const { vertical } = linesOf(pathOf(drawn({ cellSize: 100 }, { heading: 90 }).ctx.lineDrawings[0]).data)
    // At 90 degrees the visible world is 600 wide: -300..300 and a line past each edge for the overscan.
    expect(sorted(vertical)).toEqual([-300, -200, -100, 0, 100, 200, 300])
  })

  it("scrolls the lattice against the world by `offset`", () => {
    const { vertical, horizontal } = linesOf(pathOf(drawn({ cellSize: 100, offset: { x: 30, y: 10 } }).ctx.lineDrawings[0]).data)
    expect(multiples(vertical, 100).every((m) => Math.abs(m - 30) < 1e-9)).toBe(true)
    expect(multiples(horizontal, 100).every((m) => Math.abs(m - 10) < 1e-9)).toBe(true)
  })

  it("uses a number for both axes and a vector for each its own", () => {
    const uniform = linesOf(pathOf(drawn({ cellSize: 200 }).ctx.lineDrawings[0]).data)
    expect(sorted(uniform.vertical)).toEqual([-400, -200, 0, 200, 400])
    expect(sorted(uniform.horizontal)).toEqual([-200, 0, 200])

    const perAxis = linesOf(pathOf(drawn({ cellSize: { x: 200, y: 50 } }).ctx.lineDrawings[0]).data)
    expect(sorted(perAxis.vertical)).toEqual([-400, -200, 0, 200, 400])
    expect(sorted(perAxis.horizontal)).toEqual([-300, -250, -200, -150, -100, -50, 0, 50, 100, 150, 200, 250, 300])
  })

  it("floors a fractional subdivision count and keeps at least one", () => {
    const drawings = (subdivisions: number) => drawn({
      cellSize: 100, subdivisions, subStroke: { weight: 1, fill: "red" },
    }).ctx.lineDrawings.length
    expect(drawings(2.9)).toBe(2)
    expect(drawings(0.4)).toBe(1)
    expect(drawings(0)).toBe(1)
    expect(drawings(1)).toBe(1)
  })

  it("draws nothing for the lines without a stroke", () => {
    const grid = new GridPattern({ cellSize: 100 } as Props)
    const camera = new Camera({ width: 800, height: 600, children: [grid] } as never)
    mount(camera)
    camera.layout({ x: 0, y: 0, width: 800, height: 600 }, SCOPE)
    const ctx = new Recorder()
    grid.render(ctx)
    expect(ctx.lineDrawings).toHaveLength(0)
    expect(ctx.events).toEqual(["beginClip", "draw:rect+shadow+fill", "endClip"])
  })

  it("fills its own box when there is no camera", () => {
    const grid = new GridPattern({ cellSize: 100, stroke: STROKE } as Props)
    mount(grid)
    grid.layout({ x: 0, y: 0, width: 200, height: 100 }, SCOPE)
    const ctx = new Recorder()
    grid.render(ctx)
    const { vertical, horizontal } = linesOf(pathOf(ctx.lineDrawings[0]).data)
    expect(sorted(vertical)).toEqual([-100, 0, 100])
    expect(horizontal).toEqual([0])
  })
})

describe("GridPattern drawing — the paper and the order", () => {
  it("fills the visible region with its fill and shadow, inside the clip, before any line", () => {
    const { ctx } = drawn({ cellSize: 100, fill: "blue" }, { zoom: 2, lookAt: { x: 50, y: 25 } })
    expect(ctx.events.slice(0, 2)).toEqual(["beginClip", "draw:rect+shadow+fill"])
    const rect = ctx.drawings[0].graphics.ops()[0] as { state: { x: number; y: number; width: number; height: number } }
    expect(rect.state).toMatchObject({ x: 50, y: 25, width: 400, height: 300 })
  })

  it("carries the node's start and end on the fill rect", () => {
    const { ctx } = drawn({ cellSize: 100, fill: "blue", start: 0.2, end: 0.8 })
    const rect = ctx.drawings[0].graphics.ops()[0] as { state: { start: number; end: number } }
    expect(rect.state).toMatchObject({ start: 0.2, end: 0.8 })
  })

  it("draws the minor lines first, so the major sit on top", () => {
    const { ctx } = drawn({ cellSize: 100, subdivisions: 2, subStroke: { weight: 1, fill: "red" } })
    expect(ctx.events).toEqual(["beginClip", "draw:rect+shadow+fill", "draw:path+stroke", "draw:path+stroke", "endClip"])
    expect(strokesOf(ctx.lineDrawings[0])[0].weight).toBe(1)
    expect(strokesOf(ctx.lineDrawings[1])[0].weight).toBe(2)
  })

  it("puts the major lines at the cell size and the minor ones between them", () => {
    const { ctx } = drawn({ cellSize: 100, subdivisions: 2, subStroke: { weight: 1, fill: "red" } })
    const [minor, major] = ctx.lineDrawings
    expect(sorted(linesOf(pathOf(major).data).vertical)).toEqual([-400, -300, -200, -100, 0, 100, 200, 300, 400].filter((v) => v % 100 === 0))
    expect(sorted(linesOf(pathOf(minor).data).vertical)).toEqual([-350, -250, -150, -50, 50, 150, 250, 350])
  })

  it("draws no minor lines with a single subdivision, whatever subStroke says", () => {
    const { ctx } = drawn({ cellSize: 100, subdivisions: 1, subStroke: { weight: 1, fill: "red" } })
    expect(ctx.lineDrawings).toHaveLength(1)
  })

  it("draws no minor lines when there is no minor stroke", () => {
    const { ctx } = drawn({ cellSize: 100, subdivisions: 2, subStroke: [] })
    expect(ctx.lineDrawings).toHaveLength(1)
  })

  it("paints a solid stroke's lines as one union path: every vertical, then every horizontal", () => {
    const { ctx } = drawn({ cellSize: 100 })
    expect(ctx.lineDrawings).toHaveLength(1)
    const { data, centerBounds } = pathOf(ctx.lineDrawings[0])
    expect(data).toHaveLength(2 * (9 + 7))
    data.forEach((command, i) => expect(command.type).toBe(i % 2 === 0 ? "M" : "L"))
    // The first nine pairs are the verticals, the last seven the horizontals.
    expect(linesOf(data.slice(0, 18)).vertical).toHaveLength(9)
    expect(linesOf(data.slice(18)).horizontal).toHaveLength(7)
    expect(centerBounds).toEqual([-1, -1, 1, 1])
  })

  it("runs the union path's lines past the view, snapped outward to the lattice", () => {
    const { ctx } = drawn({ cellSize: 100 })
    const [first, second] = pathOf(ctx.lineDrawings[0]).data as Array<{ y: number }>
    // The view reaches y = 300 and the overscan one more; the next lattice position out is 400.
    expect([first.y, second.y]).toEqual([-400, 400])
  })

  it("centres the strokes on their lines, whatever alignment was authored", () => {
    const { ctx } = drawn({ cellSize: 100, stroke: { weight: 2, fill: "white", align: "inside" } })
    expect(strokesOf(ctx.lineDrawings[0])[0].align).toBe(0)
  })

  it("clips everything to the visible region", () => {
    const { ctx } = drawn({ cellSize: 100 }, { zoom: 2 })
    expect(ctx.clips).toHaveLength(1)
    expect(ctx.clips[0].ops()[0]).toMatchObject({ kind: "rect", state: { width: 400, height: 300 } })
  })
})

describe("GridPattern drawing — the default minor stroke", () => {
  it("is the major stroke at half opacity when there are subdivisions", () => {
    const grid = new GridPattern({ stroke: STROKE, subdivisions: 2 } as Props)
    expect(grid.subStroke).toHaveLength(1)
    expect(grid.subStroke[0].weight).toBe(2)
    expect(grid.subStroke[0].fill[0].opacity).toBe(0.5)
  })

  it("is what the minor lines are drawn with", () => {
    const { ctx } = drawn({ cellSize: 100, subdivisions: 2 })
    const [minor, major] = ctx.lineDrawings
    expect(strokesOf(minor)[0].fill[0].opacity).toBe(0.5)
    expect(strokesOf(major)[0].fill[0].opacity).toBeUndefined()
  })

  it("leaves an authored subStroke alone", () => {
    const grid = new GridPattern({ stroke: STROKE, subdivisions: 2, subStroke: { weight: 1, fill: "red" } } as Props)
    expect(grid.subStroke[0].weight).toBe(1)
    expect(grid.subStroke[0].fill[0].opacity).toBeUndefined()
  })

  it("is not derived without a stroke, or without subdivisions", () => {
    expect(new GridPattern({ subdivisions: 2 } as Props).subStroke).toEqual([])
    expect(new GridPattern({ stroke: STROKE } as Props).subStroke).toEqual([])
    expect(new GridPattern({ stroke: STROKE, subdivisions: 1 } as Props).subStroke).toEqual([])
  })
})

describe("GridPattern drawing — dashed strokes stay locked to the world", () => {
  const dashed = { weight: 2, fill: "white", dash: [10, 6] }

  it("draws each line on its own", () => {
    const { ctx } = drawn({ cellSize: 100, stroke: dashed })
    // Nine verticals and seven horizontals, one drawing each.
    expect(ctx.lineDrawings).toHaveLength(16)
  })

  it("draws each as a single move and line", () => {
    const { ctx } = drawn({ cellSize: 100, stroke: dashed })
    for (const drawing of ctx.lineDrawings) expect(pathOf(drawing).data.map((c) => c.type)).toEqual(["M", "L"])
  })

  it("snaps the span of every line to a whole number of dash cycles, anchored to the world", () => {
    const { ctx } = drawn({ cellSize: 100, stroke: dashed })
    const spans = ctx.lineDrawings.map((d) => pathOf(d).data as Array<{ x: number; y: number }>)
    const verticals = spans.filter(([from, to]) => from.x === to.x)
    const horizontals = spans.filter(([from, to]) => from.y === to.y)
    expect(verticals).toHaveLength(9)
    expect(horizontals).toHaveLength(7)
    // y: -301 floors to -304 (-19 cycles of 16), 301 ceils to 304; x: -401 to -416, 401 to 416.
    for (const [from, to] of verticals) expect([from.y, to.y]).toEqual([-304, 304])
    for (const [from, to] of horizontals) expect([from.x, to.x]).toEqual([-416, 416])
  })

  it("gives every line the same length, so the renderer has nothing to refit", () => {
    const { ctx } = drawn({ cellSize: 100, stroke: dashed })
    const lengths = new Set(ctx.lineDrawings.map((d) => {
      const [from, to] = pathOf(d).data as Array<{ x: number; y: number }>
      return Math.hypot(to.x - from.x, to.y - from.y)
    }))
    expect([...lengths].sort((a, b) => a - b)).toEqual([608, 832])
    for (const length of lengths) expect(length % 16).toBe(0)
  })

  it("starts the dash phase at the world coordinate each line starts at", () => {
    const { ctx } = drawn({ cellSize: 100, stroke: dashed })
    const [vertical] = ctx.lineDrawings
    // The line starts at world y = -304, so the dash offset is the negation of that.
    expect(strokesOf(vertical)[0].dashOffset).toBe(304)
    const horizontal = ctx.lineDrawings.find((d) => (pathOf(d).data as Array<{ x: number; y: number }>)[0].y === (pathOf(d).data as Array<{ x: number; y: number }>)[1].y)!
    expect(strokesOf(horizontal)[0].dashOffset).toBe(416)
  })

  it("subtracts the world start from an authored dash offset", () => {
    const { ctx } = drawn({ cellSize: 100, stroke: { ...dashed, dashOffset: 3 } })
    expect(strokesOf(ctx.lineDrawings[0])[0].dashOffset).toBe(3 - -304)
  })

  it("keeps the phase a whole number of cycles from the world, whatever the camera does", () => {
    for (const lookAt of [{ x: 0, y: 0 }, { x: 37, y: 41 }, { x: -611, y: 123.5 }, { x: 5, y: -999 }]) {
      const { ctx } = drawn({ cellSize: 100, stroke: dashed }, { lookAt })
      for (const drawing of ctx.lineDrawings) {
        // dashOffset = -start, and start is a multiple of the cycle (16): the pattern never shifts against the world.
        expect(Math.abs(strokesOf(drawing)[0].dashOffset % 16)).toBe(0)
      }
    }
  })

  it("shifts only the dashed layers of a stack", () => {
    const { ctx } = drawn({ cellSize: 100, stroke: [dashed, { weight: 1, fill: "red" }] })
    const [first, second] = strokesOf(ctx.lineDrawings[0])
    expect(first.dashOffset).toBe(304)
    expect(second.dashOffset).toBe(0)
    expect(second.dash).toBeUndefined()
  })

  it("takes the cycle from the longest dash pattern in the stack", () => {
    const { ctx } = drawn({ cellSize: 100, stroke: [{ weight: 2, fill: "white", dash: [4, 4] }, { weight: 2, fill: "red", dash: [10, 10] }] })
    const [from, to] = pathOf(ctx.lineDrawings[0]).data as Array<{ y: number }>
    // A cycle of 20: -301 floors to -320, 301 ceils to 320.
    expect([from.y, to.y]).toEqual([-320, 320])
  })

  it("draws a pattern of no length as a solid stroke: one union path", () => {
    const { ctx } = drawn({ cellSize: 100, stroke: { weight: 2, fill: "white", dash: [0, 0] } })
    expect(ctx.lineDrawings).toHaveLength(1)
  })

  it("draws a solid stroke as a union path, not per line", () => {
    expect(drawn({ cellSize: 100 }).ctx.lineDrawings).toHaveLength(1)
  })

  it("draws both groups per line when both are dashed", () => {
    const { ctx } = drawn({ cellSize: 100, subdivisions: 2, stroke: dashed, subStroke: { weight: 1, fill: "red", dash: [4, 4] } })
    // Majors: 9 + 7. Minors: the 8 + 6 half-way lines.
    expect(ctx.lineDrawings).toHaveLength(14 + 16)
  })
})

describe("GridPattern cellSize", () => {
  const tweened = (from: number | { x: number; y: number }, to: number | { x: number; y: number }, t: number) => {
    const grid = mount(new GridPattern({ cellSize: from } as Props))
    grid.to({ data: { cellSize: to }, duration: 1 }).at(t)
    return grid.cellSize
  }

  it("tweens a number to a number as a number", () => {
    expect(tweened(100, 200, 0.5)).toBe(150)
  })

  it("tweens a number to a vector by promoting the number to a uniform one", () => {
    expect(tweened(100, { x: 200, y: 50 }, 0.5)).toEqual({ x: 150, y: 75 })
  })

  it("tweens a vector to a number the same way", () => {
    expect(tweened({ x: 100, y: 200 }, 100, 0.5)).toEqual({ x: 100, y: 150 })
  })

  it("tweens a vector to a vector axis by axis", () => {
    expect(tweened({ x: 100, y: 100 }, { x: 300, y: 50 }, 0.25)).toEqual({ x: 150, y: 87.5 })
  })

  it("lands on the destination as authored at the end", () => {
    expect(tweened(100, 200, 1)).toBe(200)
    expect(tweened(100, { x: 200, y: 50 }, 1)).toEqual({ x: 200, y: 50 })
  })

  it("scrolls the lattice smoothly as the cell size tweens: the line spacing follows it", () => {
    const grid = new GridPattern({ cellSize: 100, stroke: STROKE } as Props)
    const camera = new Camera({ width: 800, height: 600, children: [grid] } as never)
    mount(camera)
    camera.layout({ x: 0, y: 0, width: 800, height: 600 }, SCOPE)
    grid.to({ data: { cellSize: 200 }, duration: 1 }).at(0.5)
    const ctx = new Recorder()
    grid.render(ctx)
    const vertical = sorted(linesOf(pathOf(ctx.lineDrawings[0]).data).vertical)
    expect(vertical).toEqual([-300, -150, 0, 150, 300])
  })
})
