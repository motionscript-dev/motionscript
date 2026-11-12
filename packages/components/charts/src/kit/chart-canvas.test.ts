import { describe, expect, it } from "vitest"

import { fillOps, type GraphicsOp } from "@motionscript/sdk"

import { draw, fillOf, rectsOf } from "../tests/harness"
import { ChartCanvas } from "./chart-canvas"

/**
 * The plot's backdrop: the panel, the grid and the axis rules, drawn into a
 * recording context. Every rule is its own draw, so a dashed one keeps its own
 * phase.
 */

const BOX = { width: 400, height: 200 }

function canvas(props: Record<string, unknown> = {}) {
  return new ChartCanvas({
    width: 400,
    height: 200,
    fill: "#111111",
    xGridStroke: { weight: 2, fill: "#ff0000", align: "center" },
    yGridStroke: { weight: 4, fill: "#0000ff", align: "center" },
    xMarkers: [0, 25, 50, 75, 100],
    xExtent: [0, 100],
    yMarkers: [0, 5, 10],
    yExtent: [0, 10],
    ...props,
  } as never)
}

/** A rule's two ends, rounded off the renderer's sixty-fourth nudge. */
function ruleOf(ops: readonly GraphicsOp[]) {
  const line = ops.find((op) => op.kind === "line")
  if (line?.kind !== "line") return null
  return line.state.points!.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }))
}

const strokeWeight = (ops: readonly GraphicsOp[]) => {
  const stroke = ops.find((op) => op.kind === "stroke")
  return stroke?.kind === "stroke" ? (stroke.strokes as { weight: number }[])[0].weight : undefined
}

describe("ChartCanvas", () => {
  it("draws the panel first, a rect of the whole box in the fill", () => {
    const [panel] = draw(canvas(), BOX).ops()
    expect(rectsOf(panel)).toEqual([{ x: 0, y: 0, width: 400, height: 200 }])
    expect(fillOf(panel)).toEqual(fillOps.resolve("#111111"))
  })

  it("draws no panel when it has no fill", () => {
    const ops = draw(canvas({ fill: [] }), BOX).ops()
    expect(ops.every((op) => ruleOf(op) !== null)).toBe(true)
  })

  it("rules a vertical line at every x marker, edges held just inside the box", () => {
    const rules = draw(canvas({ yMarkers: [] }), BOX).ops().slice(1)
    expect(rules.map((ops) => ruleOf(ops)![0].x)).toEqual([-199, -100, 0, 100, 199])
    expect(rules.every((ops) => strokeWeight(ops) === 2)).toBe(true)
    expect(ruleOf(rules[2])).toEqual([{ x: 0, y: -100 }, { x: 0, y: 100 }])
  })

  it("rules a horizontal line at every y marker, across the full width", () => {
    const rules = draw(canvas({ xMarkers: [] }), BOX).ops().slice(1)
    expect(rules.map((ops) => ruleOf(ops)![0].y)).toEqual([-98, 0, 98])
    expect(ruleOf(rules[1])).toEqual([{ x: -200, y: 0 }, { x: 200, y: 0 }])
  })

  it("places a rule by its marker's fraction of the extent, evenly spaced or not", () => {
    const rules = draw(canvas({ xMarkers: [10, 30], yMarkers: [] }), BOX).ops().slice(1)
    expect(rules.map((ops) => ruleOf(ops)![0].x)).toEqual([-160, -80])
  })

  it("skips a marker outside the extent", () => {
    const rules = draw(canvas({ xMarkers: [-10, 50, 120], yMarkers: [] }), BOX).ops().slice(1)
    expect(rules).toHaveLength(1)
  })

  it("draws no grid for a stroke of no layers", () => {
    expect(draw(canvas({ xGridStroke: [], yGridStroke: [] }), BOX).drawn).toHaveLength(1)
  })

  it("rules the axis lines where it is told, in their own stroke", () => {
    const ops = draw(canvas({ xMarkers: [], yMarkers: [], axisStroke: { weight: 3, fill: "#00ff00", align: "center" }, xAxisAt: 0, yAxisAt: 50 }), BOX).ops().slice(1)
    expect(ops.map(ruleOf)).toEqual([
      [{ x: -200, y: -98 }, { x: 200, y: -98 }],
      [{ x: 0, y: -100 }, { x: 0, y: 100 }],
    ])
    expect(ops.map(strokeWeight)).toEqual([3, 3])
  })

  it("draws no axis lines by default", () => {
    expect(draw(canvas({ xMarkers: [], yMarkers: [], axisStroke: { weight: 3, fill: "#00ff00" } }), BOX).drawn).toHaveLength(1)
  })

  it("draws nothing for an empty box", () => {
    expect(draw(canvas({ width: 0 }), { width: 0, height: 200 }).drawn).toEqual([])
  })

  it("takes its size from the box it is laid out in, not from its props", () => {
    const [panel] = draw(canvas(), { width: 300, height: 150 }).ops()
    expect(rectsOf(panel)).toEqual([{ x: 0, y: 0, width: 300, height: 150 }])
  })

  it("defaults to the unpainted panel and no grid", () => {
    const node = new ChartCanvas({ width: 100, height: 100 } as never)
    expect(node.fill).toEqual([])
    expect(node.xMarkers).toEqual([])
    expect(node.xExtent).toEqual([0, 1])
    expect(node.xGridStroke).toEqual([])
  })
})
