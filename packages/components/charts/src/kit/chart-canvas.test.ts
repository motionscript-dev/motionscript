import { describe, expect, it } from "vitest"

import { fillOps } from "@motionscript/sdk"

import { draw, fillOf, rectsOf } from "../tests/harness"
import { ChartBorder } from "./chart-border"
import { ChartCanvas } from "./chart-canvas"
import { DEFAULT_PLOT_AREA } from "./shared"

/**
 * The plot's backdrop and its frame, drawn into a recording context. The frame
 * is a separate node so it can sit over the marks while the panel sits under
 * them.
 */

const BOX = { width: 400, height: 200 }

function canvas(props: Record<string, unknown> = {}) {
  return new ChartCanvas({
    width: 400,
    height: 200,
    fill: "#111111",
    xGridStroke: { weight: 2, fill: "#ff0000" },
    yGridStroke: { weight: 3, fill: "#0000ff" },
    xMarkers: [0, 25, 50, 75, 100],
    xExtent: [0, 100],
    yMarkers: [0, 5, 10],
    yExtent: [0, 10],
    ...props,
  } as never)
}

describe("ChartCanvas", () => {
  it("draws the panel first, a rect of the whole box in the fill", () => {
    const [panel] = draw(canvas(), BOX).ops()
    expect(rectsOf(panel)).toEqual([{ x: 0, y: 0, width: 400, height: 200 }])
    expect(fillOf(panel)).toEqual(fillOps.resolve("#111111"))
  })

  it("then the vertical grid, one rule under every interior marker, at the weight of the stroke", () => {
    const [, vertical] = draw(canvas(), BOX).ops()
    // Markers 0 and 100 are the panel's own edges and fall under the border: skipped.
    expect(rectsOf(vertical)).toEqual([
      { x: -100, y: 0, width: 2, height: 200 },
      { x: 0, y: 0, width: 2, height: 200 },
      { x: 100, y: 0, width: 2, height: 200 },
    ])
    expect(fillOf(vertical)).toEqual(fillOps.resolve("#ff0000"))
  })

  it("then the horizontal grid, across the full width", () => {
    const [, , horizontal] = draw(canvas(), BOX).ops()
    // Only 5 is interior to 0..10; it sits halfway up.
    expect(rectsOf(horizontal)).toEqual([{ x: 0, y: 0, width: 400, height: 3 }])
    expect(fillOf(horizontal)).toEqual(fillOps.resolve("#0000ff"))
  })

  it("places a rule by its marker's fraction of the extent, evenly spaced or not", () => {
    const [, vertical, horizontal] = draw(
      canvas({ xMarkers: [10, 30, 90], yMarkers: [1, 9] }),
      BOX
    ).ops()
    expect(rectsOf(vertical).map((r) => r.x)).toEqual([-160, -80, 160])
    expect(rectsOf(horizontal).map((r) => r.y)).toEqual([-80, 80])
  })

  it("skips a marker on, past or outside an edge: it would sit under the border", () => {
    const [, vertical] = draw(canvas({ xMarkers: [-5, 0, 0.0000001, 99.9999999, 100, 150, 50] }), BOX).ops()
    expect(rectsOf(vertical).map((r) => r.x)).toEqual([0])
  })

  it("draws no rule for a chart whose horizontal axis has no numeric positions", () => {
    const [, vertical] = draw(canvas({ xMarkers: [] }), BOX).ops()
    expect(rectsOf(vertical)).toEqual([])
  })

  it("draws no rule for an extent with no width", () => {
    const [, vertical, horizontal] = draw(canvas({ xExtent: [5, 5], yExtent: [3, 1] }), BOX).ops()
    expect(rectsOf(vertical)).toEqual([])
    expect(rectsOf(horizontal)).toEqual([])
  })

  it("uses the stroke's weight for the width of a rule", () => {
    const [, vertical, horizontal] = draw(
      canvas({ xGridStroke: { weight: 9, fill: "red" }, yGridStroke: { weight: 1, fill: "blue" } }),
      BOX
    ).ops()
    expect(rectsOf(vertical)[0].width).toBe(9)
    expect(rectsOf(horizontal)[0].height).toBe(1)
  })

  it("draws no rule for a stroke with no layers", () => {
    const ctx = draw(canvas({ xGridStroke: [], yGridStroke: [] }), BOX)
    // The panel is all there is.
    expect(ctx.ops()).toHaveLength(1)
  })

  it("draws nothing for a box with no width or no height", () => {
    expect(draw(canvas({ width: 0 }), { width: 0, height: 200 }).drawn).toEqual([])
    expect(draw(canvas({ height: 0 }), { width: 400, height: 0 }).drawn).toEqual([])
  })

  it("takes its size from the box it is laid out in, not from its props", () => {
    const [panel] = draw(canvas(), { width: 300, height: 150 }).ops()
    expect(rectsOf(panel)).toEqual([{ x: 0, y: 0, width: 300, height: 150 }])
  })

  it("defaults to the unpainted panel and the shared grid strokes", () => {
    const node = new ChartCanvas({ width: 100, height: 100 } as never)
    expect(node.fill).toEqual([])
    expect(node.xMarkers).toEqual([])
    expect(node.xExtent).toEqual([0, 1])
    expect(node.fill).toEqual(DEFAULT_PLOT_AREA.fill)
  })
})

describe("ChartBorder", () => {
  it("draws one rect of the whole box with the stroke and no fill, so the interior stays clear", () => {
    const border = new ChartBorder({ width: 400, height: 200, stroke: { weight: 6, fill: "#00ff00" } } as never)
    const ctx = draw(border, BOX)
    expect(ctx.ops()).toHaveLength(1)
    const [ops] = ctx.ops()
    expect(rectsOf(ops)).toEqual([{ x: 0, y: 0, width: 400, height: 200 }])
    expect(ops.map((op) => op.kind)).toEqual(["rect", "stroke"])
    expect(ops[1]).toMatchObject({ kind: "stroke", strokes: [{ weight: 6 }] })
  })

  it("draws nothing for an empty box", () => {
    const border = new ChartBorder({ width: 0, height: 100 } as never)
    expect(draw(border, { width: 0, height: 100 }).drawn).toEqual([])
    expect(draw(new ChartBorder({} as never), { width: 100, height: 0 }).drawn).toEqual([])
  })

  it("takes the plot area's frame by default", () => {
    const border = new ChartBorder({ width: 10, height: 10 } as never)
    expect(draw(border, { width: 10, height: 10 }).ops()[0][1]).toMatchObject({ strokes: [{ weight: 6 }] })
  })

  it("follows its stroke when it changes", () => {
    const border = new ChartBorder({ width: 10, height: 10 } as never)
    border.set({ stroke: { weight: 2, fill: "red" } } as never)
    expect(draw(border, { width: 10, height: 10 }).ops()[0][1]).toMatchObject({ strokes: [{ weight: 2 }] })
  })
})
