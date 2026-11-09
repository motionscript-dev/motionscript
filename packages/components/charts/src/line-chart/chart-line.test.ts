import { describe, expect, it } from "vitest"

import { Graphics2D, type GraphicsOp } from "@motionscript/sdk"

import { attachAt, draw } from "../tests/harness"
import { ChartLine } from "./chart-line"
import { EMPTY_REGION_BOX, type RegionBox } from "./shared"

/**
 * One series' polyline: traced in by arc length, hidden by a flag, and — under a
 * region spotlight — drawn twice, dimmed whole and then full inside the box.
 */

const BOX = { width: 200, height: 100 }
const pt = (x: number, y: number) => ({ x, y })
const L = [pt(0, 0), pt(10, 0), pt(10, 10)]

function line(props: Record<string, unknown> = {}) {
  return new ChartLine({ ...BOX, points: L, stroke: { weight: 4, fill: "#ff0000" }, ...props } as never)
}

/** The point list of a draw's line op. */
function pointsOf(ops: readonly GraphicsOp[]) {
  const found = ops.find((op) => op.kind === "line")
  return found?.kind === "line" ? found.state.points : undefined
}

const radiusOf = (ops: readonly GraphicsOp[]) => {
  const found = ops.find((op) => op.kind === "line")
  return found?.kind === "line" ? found.state.radius : undefined
}

const opacityOf = (graphics: Graphics2D) => graphics.groupOpacity()

const REGION: RegionBox = { left: -5, right: 5, bottom: -5, top: 5, xBounded: true, yBounded: true }

describe("ChartLine: what it draws", () => {
  it("draws the whole polyline as one stroked line when it is fully traced", () => {
    const ctx = draw(line(), BOX)
    expect(ctx.drawn).toHaveLength(1)
    expect(pointsOf(ctx.ops()[0])).toEqual(L)
    expect(ctx.ops()[0].map((op) => op.kind)).toEqual(["line", "stroke"])
  })

  it("rounds the joins by twice the stroke weight", () => {
    expect(radiusOf(draw(line(), BOX).ops()[0])).toBe(8)
    expect(radiusOf(draw(line({ stroke: { weight: 9, fill: "red" } }), BOX).ops()[0])).toBe(18)
  })

  it("draws nothing when it is not enabled", () => {
    expect(draw(line({ enabled: false }), BOX).drawn).toEqual([])
  })

  it("draws nothing for fewer than two points", () => {
    expect(draw(line({ points: [] }), BOX).drawn).toEqual([])
    expect(draw(line({ points: [pt(1, 1)] }), BOX).drawn).toEqual([])
  })

  it("draws nothing at a progress of 0 or less", () => {
    expect(draw(line({ progress: 0 }), BOX).drawn).toEqual([])
    expect(draw(line({ progress: -1 }), BOX).drawn).toEqual([])
  })

  it("draws the whole line at a progress past 1", () => {
    expect(pointsOf(draw(line({ progress: 4 }), BOX).ops()[0])).toEqual(L)
  })

  it("rests fully traced and enabled, so an editor's paused canvas shows the chart", () => {
    const node = new ChartLine({ ...BOX, points: L, stroke: { weight: 1, fill: "red" } } as never)
    expect(node.progress).toBe(1)
    expect(node.enabled).toBe(true)
    expect(node.dimOpacity).toBe(0.2)
    expect(node.spotlight).toEqual(EMPTY_REGION_BOX)
  })

  it("follows its points when they change", () => {
    const node = line()
    node.set({ points: [pt(0, 0), pt(5, 5)] } as never)
    expect(pointsOf(draw(node, BOX).ops()[0])).toEqual([pt(0, 0), pt(5, 5)])
  })
})

describe("ChartLine: tracing", () => {
  const traced = (progress: number, points = L) => pointsOf(draw(line({ progress, points }), BOX).ops()[0])!

  it("shows the points up to the arc length reached, and a point partway along the segment it is in", () => {
    // 20 px of line in all: a quarter is 5 px along the first segment.
    expect(traced(0.25)).toEqual([pt(0, 0), pt(5, 0)])
    // Three quarters is 15 px: the whole first segment and half the second.
    expect(traced(0.75)).toEqual([pt(0, 0), pt(10, 0), pt(10, 5)])
  })

  it("ends on the corner when the reveal lands exactly on it", () => {
    const half = traced(0.5)
    expect(half[0]).toEqual(pt(0, 0))
    expect(half[half.length - 1]).toEqual(pt(10, 0))
  })

  it("paces itself by length, not by point count: a long segment takes its share of the time", () => {
    const uneven = [pt(0, 0), pt(1, 0), pt(100, 0)]
    const half = traced(0.5, uneven)
    // Half of 100 px is x = 50, which is inside the long segment, not at the second point.
    expect(half[half.length - 1]).toEqual(pt(50, 0))
    expect(half).toHaveLength(3)
  })

  it("reveals more of the line as progress rises, never less", () => {
    let previous = 0
    for (const p of [0.1, 0.3, 0.5, 0.7, 0.9, 1]) {
      const pts = traced(p)
      const end = pts[pts.length - 1]
      const length = Math.abs(end.x) + Math.abs(end.y)
      expect(length).toBeGreaterThanOrEqual(previous)
      previous = length
    }
  })

  it("returns the whole line at 1, the same array it was given", () => {
    expect(traced(1)).toEqual(L)
  })

  it("shows every point of a line that has no length", () => {
    const stacked = [pt(3, 3), pt(3, 3), pt(3, 3)]
    expect(traced(0.5, stacked)).toEqual(stacked)
  })

  it("steps over a segment of no length without dividing by it", () => {
    const withRepeat = [pt(0, 0), pt(0, 0), pt(10, 0)]
    const half = traced(0.5, withRepeat)
    expect(half[half.length - 1]).toEqual(pt(5, 0))
    for (const p of half) expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true)
  })

  it("draws only the trace as the line, with the same stroke and round joins", () => {
    const [ops] = draw(line({ progress: 0.25 }), BOX).ops()
    expect(radiusOf(ops)).toBe(8)
    expect(ops[1]).toMatchObject({ kind: "stroke", strokes: [{ weight: 4 }] })
  })
})

describe("ChartLine: under a spotlit region", () => {
  it("draws the whole line dimmed first, then the stretch inside the box at full strength", () => {
    const inside = [pt(-3, 0), pt(3, 0), pt(20, 0)]
    const ctx = draw(line({ points: inside, spotlight: REGION, dimOpacity: 0.3 }), BOX)
    expect(ctx.drawn).toHaveLength(2)
    expect(opacityOf(ctx.drawn[0])).toBeCloseTo(0.3)
    expect(pointsOf(ctx.ops()[0])).toEqual(inside)
    expect(opacityOf(ctx.drawn[1])).toBe(1)
    // Inside the box: from the first point to where the line leaves at x = 5.
    expect(pointsOf(ctx.ops()[1])).toEqual([pt(-3, 0), pt(3, 0), pt(5, 0)])
  })

  it("draws one more pass for each run the line makes inside the box", () => {
    const weaving = [pt(-3, 0), pt(10, 0), pt(10, 3), pt(3, 3)]
    const ctx = draw(line({ points: weaving, spotlight: REGION }), BOX)
    // The dimmed whole, then two runs in the box.
    expect(ctx.drawn).toHaveLength(3)
    expect(opacityOf(ctx.drawn[1])).toBe(1)
    expect(opacityOf(ctx.drawn[2])).toBe(1)
  })

  it("draws the dimmed whole alone for a line that never enters the box", () => {
    const ctx = draw(line({ points: [pt(-30, 20), pt(30, 20)], spotlight: REGION }), BOX)
    expect(ctx.drawn).toHaveLength(1)
    expect(opacityOf(ctx.drawn[0])).toBeCloseTo(0.2)
  })

  it("draws one pass at full strength when there is no region", () => {
    const ctx = draw(line({ spotlight: EMPTY_REGION_BOX }), BOX)
    expect(ctx.drawn).toHaveLength(1)
    expect(opacityOf(ctx.drawn[0])).toBe(1)
  })

  it("holds the dim between 0 and 1", () => {
    expect(opacityOf(draw(line({ spotlight: REGION, dimOpacity: 4 }), BOX).drawn[0])).toBe(1)
    expect(opacityOf(draw(line({ spotlight: REGION, dimOpacity: -1 }), BOX).drawn[0])).toBe(0)
  })

  it("dims and clips only the stretch that has been traced", () => {
    const long = [pt(-3, 0), pt(3, 0), pt(40, 0)]
    const ctx = draw(line({ points: long, spotlight: REGION, progress: 0.5 }), BOX)
    const dimmed = pointsOf(ctx.ops()[0])!
    expect(dimmed[dimmed.length - 1].x).toBeLessThan(40)
  })
})

describe("ChartLine.enter, from one end to another", () => {
  // A command on a node that is not in a tree is inert by design, so these mount theirs.
  // What a frame of the trace leaves the line holding.
  const at = (node: ChartLine, command: { at(t: number): unknown }, t: number) => {
    command.at(t)
    return { progress: node.progress, enabled: node.enabled }
  }
  const trace = (node: ChartLine, from: number, to: number, duration: number, easing: (t: number) => number) =>
    node.enter({ data: { from, to }, duration, easing })

  it("runs progress from one end to the other, with the line enabled while it has any trace", () => {
    const node = attachAt(line())
    const command = trace(node, 0, 1, 1, (t) => t)
    expect(at(node, command, 0)).toEqual({ progress: 0, enabled: false })
    expect(at(node, command, 0.5)).toEqual({ progress: 0.5, enabled: true })
    expect(at(node, command, 1)).toEqual({ progress: 1, enabled: true })
  })

  it("retraces from full to nothing, staying enabled until the last frame is empty", () => {
    const node = attachAt(line())
    const command = trace(node, 1, 0, 1, (t) => t)
    expect(at(node, command, 0)).toEqual({ progress: 1, enabled: true })
    expect(at(node, command, 0.99)).toMatchObject({ enabled: true })
    expect(at(node, command, 0.99).progress).toBeCloseTo(0.01)
    expect(at(node, command, 1)).toEqual({ progress: 0, enabled: false })
  })

  it("takes the duration it is given", () => {
    expect(trace(attachAt(line()), 0, 1, 2.5, (t) => t).duration).toBe(2.5)
  })

  it("eases the progress", () => {
    const node = attachAt(line())
    const command = trace(node, 0, 1, 1, (t) => t * t)
    expect(at(node, command, 0.5).progress).toBeCloseTo(0.25)
  })

  it("starts a trace part way when told to", () => {
    const node = attachAt(line())
    const command = trace(node, 0.4, 0.8, 1, (t) => t)
    expect(at(node, command, 0).progress).toBeCloseTo(0.4)
    expect(at(node, command, 1).progress).toBeCloseTo(0.8)
  })
})

describe("ChartLine.enter", () => {
  it("traces the line in from nothing, whatever it rested at", () => {
    const node = attachAt(line())
    const command = node.enter({ duration: 1, easing: (t: number) => t })
    command.at(0)
    expect({ progress: node.progress, enabled: node.enabled }).toEqual({ progress: 0, enabled: false })
    command.at(1)
    expect({ progress: node.progress, enabled: node.enabled }).toEqual({ progress: 1, enabled: true })
    expect(command.duration).toBe(1)
  })

  it("eases out unless told otherwise", () => {
    const node = attachAt(line())
    node.enter({ duration: 1 }).at(0.5)
    expect(node.progress).toBeGreaterThan(0.5)
  })
})
