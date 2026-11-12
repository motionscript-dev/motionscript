import { describe, expect, it } from "vitest"

import { Graphics2D, type GraphicsOp } from "@motionscript/sdk"

import { attachAt, draw } from "../tests/harness"
import { ChartArea, ChartLine, areaFill, traceX } from "./chart-line"
import { EMPTY_REGION_BOX, type RegionBox } from "./shared"

/**
 * One series' line and the area under it: traced in from the left, hidden by a
 * flag, and under a region spotlight drawn twice, dimmed whole and then full
 * inside the box.
 */

const BOX = { width: 200, height: 100 }
const pt = (x: number, y: number) => ({ x, y })
const L = [pt(0, 0), pt(10, 0), pt(20, 10)]

function line(props: Record<string, unknown> = {}) {
  return new ChartLine({ ...BOX, points: L, curve: "linear", stroke: { weight: 4, fill: "#ff0000" }, ...props } as never)
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

const ellipses = (ops: readonly GraphicsOp[]) => ops.flatMap((op) => (op.kind === "ellipse" ? [op.state as { x: number; y: number; width: number }] : []))
const opacityOf = (graphics: Graphics2D) => graphics.groupOpacity()

const REGION: RegionBox = { left: -5, right: 5, bottom: -5, top: 5, xBounded: true, yBounded: true }

describe("ChartLine: what it draws", () => {
  it("draws the whole line as one stroked line when it is fully traced", () => {
    const ctx = draw(line(), BOX)
    expect(ctx.drawn).toHaveLength(1)
    expect(pointsOf(ctx.ops()[0])).toEqual(L)
  })

  it("rounds a linear line's corners by twice the stroke weight, and leaves a curve's alone", () => {
    expect(radiusOf(draw(line(), BOX).ops()[0])).toBe(8)
    expect(radiusOf(draw(line({ curve: "smooth" }), BOX).ops()[0])).toBe(0)
  })

  it("draws a smooth curve through every point, many samples between them", () => {
    const drawn = pointsOf(draw(line({ curve: "smooth" }), BOX).ops()[0])!
    expect(drawn.length).toBeGreaterThan(L.length * 4)
    for (const p of L) expect(drawn.some((q) => Math.abs(q.x - p.x) < 1e-9 && Math.abs(q.y - p.y) < 1e-9)).toBe(true)
  })

  it("draws a step line level between points, changing half way", () => {
    expect(pointsOf(draw(line({ curve: "step" }), BOX).ops()[0])).toEqual([pt(0, 0), pt(5, 0), pt(5, 0), pt(10, 0), pt(15, 0), pt(15, 10), pt(20, 10)])
  })

  it("draws nothing when it is not enabled, has no points, or has no trace", () => {
    expect(draw(line({ enabled: false }), BOX).drawn).toHaveLength(0)
    expect(draw(line({ points: [] }), BOX).drawn).toHaveLength(0)
    expect(draw(line({ progress: 0 }), BOX).drawn).toHaveLength(0)
  })

  it("rests fully traced and enabled, so an editor's paused canvas shows the chart", () => {
    const node = line()
    expect([node.progress, node.enabled]).toEqual([1, true])
  })
})

describe("ChartLine: tracing", () => {
  it("reaches across the points' x span, left to right", () => {
    expect(traceX(L, 0)).toBe(0)
    expect(traceX(L, 0.5)).toBe(10)
    expect(traceX(L, 1)).toBe(Infinity)
  })

  it("shows the line up to the x reached, ending on the point where it crosses", () => {
    expect(pointsOf(draw(line({ progress: 0.75 }), BOX).ops()[0])).toEqual([pt(0, 0), pt(10, 0), pt(15, 5)])
  })

  it("reveals more of the line as progress rises, never less", () => {
    let last = 0
    for (const progress of [0.1, 0.3, 0.6, 0.9, 1]) {
      const drawn = pointsOf(draw(line({ progress }), BOX).ops()[0])!
      const reach = drawn[drawn.length - 1].x
      expect(reach).toBeGreaterThanOrEqual(last)
      last = reach
    }
  })
})

describe("ChartLine: dots", () => {
  it("draws a dot of the given size on every point, in the dot fill", () => {
    const ctx = draw(line({ dotSize: 12, dotFill: "#00ff00" }), BOX)
    const dots = ellipses(ctx.ops()[1])
    expect(dots.map((d) => [d.x, d.y, d.width])).toEqual(L.map((p) => [p.x, p.y, 12]))
  })

  it("draws none at size 0", () => {
    expect(draw(line({ dotSize: 0 }), BOX).drawn).toHaveLength(1)
  })

  it("grows each dot in as the trace passes it", () => {
    const dots = ellipses(draw(line({ dotSize: 4, progress: 0.5 }), BOX).ops()[1])
    // The trace is at x = 10: the first dot is full, the one on the trace not yet grown, the last not reached.
    expect(dots.map((d) => d.width)).toEqual([4])
  })
})

describe("ChartLine: under a spotlit region", () => {
  it("draws the whole line dimmed first, then the stretch inside the box at full strength", () => {
    const ctx = draw(line({ spotlight: REGION, dimOpacity: 0.3 }), BOX)
    expect(ctx.drawn).toHaveLength(2)
    expect(opacityOf(ctx.drawn[0])).toBeCloseTo(0.3)
    expect(pointsOf(ctx.ops()[1])).toEqual([pt(0, 0), pt(5, 0)])
    expect(opacityOf(ctx.drawn[1])).toBe(1)
  })

  it("dims the dots outside the box and leaves the ones inside", () => {
    const ctx = draw(line({ spotlight: REGION, dimOpacity: 0.3, dotSize: 4 }), BOX)
    const [, , dimmed, bright] = ctx.drawn
    expect(ellipses([...dimmed.ops()]).map((d) => d.x)).toEqual([10, 20])
    expect(opacityOf(dimmed)).toBeCloseTo(0.3)
    expect(ellipses([...bright.ops()]).map((d) => d.x)).toEqual([0])
  })

  it("draws one pass at full strength when there is no region", () => {
    const ctx = draw(line({ spotlight: EMPTY_REGION_BOX }), BOX)
    expect(ctx.drawn).toHaveLength(1)
    expect(opacityOf(ctx.drawn[0])).toBe(1)
  })
})

describe("ChartLine.enter, from one end to another", () => {
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
    expect(at(node, command, 1)).toEqual({ progress: 0, enabled: false })
  })

  it("eases out unless told otherwise", () => {
    const node = attachAt(line())
    node.enter({ duration: 1 }).at(0.5)
    expect(node.progress).toBeGreaterThan(0.5)
  })
})

describe("ChartLine.hold", () => {
  it("keeps the line traced and on through a show, and switches it off once a hide lands", () => {
    const node = attachAt(line({ enabled: false, progress: 0 }))
    const show = node.hold({ data: { shown: true }, duration: 1 })
    show.at(0)
    expect([node.progress, node.enabled]).toEqual([1, true])
    const hide = node.hold({ data: { shown: false }, duration: 1 })
    hide.at(0.5)
    expect(node.enabled).toBe(true)
    hide.at(1)
    expect(node.enabled).toBe(false)
  })
})

describe("ChartArea", () => {
  const area = (props: Record<string, unknown> = {}) =>
    new ChartArea({ ...BOX, points: L, curve: "linear", baseline: -50, fill: "#ff0000", area: "solid", ...props } as never)
  const outline = (ops: readonly GraphicsOp[]) => {
    const path = ops.find((op) => op.kind === "path")
    if (path?.kind !== "path") return []
    return (path.state.data as { x?: number; y?: number }[]).filter((c) => c.x !== undefined).map((c) => pt(c.x!, c.y!))
  }

  it("fills down to the baseline when it has no base", () => {
    expect(outline(draw(area(), BOX).ops()[0])).toEqual([...L, pt(20, -50), pt(0, -50)])
  })

  it("fills down to the series below it in a stack", () => {
    const base = L.map((p) => pt(p.x, p.y - 5))
    expect(outline(draw(area({ base }), BOX).ops()[0])).toEqual([...L, ...[...base].reverse()])
  })

  it("draws nothing for area: none, or with nothing traced", () => {
    expect(draw(area({ area: "none" }), BOX).drawn).toHaveLength(0)
    expect(draw(area({ progress: 0 }), BOX).drawn).toHaveLength(0)
  })

  it("traces in with its line, cut at the same x", () => {
    const cut = outline(draw(area({ progress: 0.75 }), BOX).ops()[0])
    expect(cut.slice(0, 3)).toEqual([pt(0, 0), pt(10, 0), pt(15, 5)])
    expect(cut.slice(3)).toEqual([pt(15, -50), pt(0, -50)])
  })

  it("paints the series colour at the area's opacity", () => {
    const fill = areaFill([{ type: "solid", color: [1, 0, 0, 1] }], "solid", 0.4, { top: 10, bottom: -50 }, { top: 10, bottom: -50 })
    expect(fill).toEqual([{ type: "solid", color: [1, 0, 0, 1], opacity: 0.4 }])
  })

  it("fades a gradient from the area's opacity at the top to nearly nothing at the bottom of the whole area", () => {
    const [layer] = areaFill([{ type: "solid", color: [1, 0, 0, 1] }], "gradient", 0.4, { top: 10, bottom: -50 }, { top: 10, bottom: -50 }) as never as {
      type: string
      colors: number[][]
      start: { y: number }
      end: { y: number }
    }[]
    expect(layer.type).toBe("linear-gradient")
    expect(layer.colors[0][3]).toBeCloseTo(0.4)
    expect(layer.colors[1][3]).toBeLessThan(0.05)
    expect([layer.start.y, layer.end.y]).toEqual([1, -1])
    // A piece of the area (a spotlight's cut) places the ends on the whole's top and bottom.
    const [part] = areaFill([{ type: "solid", color: [1, 0, 0, 1] }], "gradient", 0.4, { top: 10, bottom: -50 }, { top: 10, bottom: -20 }) as never as { start: { y: number }; end: { y: number } }[]
    expect([part.start.y, part.end.y]).toEqual([1, -3])
  })

  it("dims the whole area under a region and redraws the part inside it at full strength", () => {
    const ctx = draw(area({ spotlight: REGION, dimOpacity: 0.3 }), BOX)
    expect(ctx.drawn).toHaveLength(2)
    expect(opacityOf(ctx.drawn[0])).toBeCloseTo(0.3)
    expect(opacityOf(ctx.drawn[1])).toBe(1)
    for (const p of outline(ctx.ops()[1])) {
      expect(p.x).toBeGreaterThanOrEqual(REGION.left - 1e-9)
      expect(p.x).toBeLessThanOrEqual(REGION.right + 1e-9)
    }
  })
})
