import { describe, expect, it } from "vitest"
import { fillOps, type Node2D, type PathCommand } from "@motionscript/sdk"

import { attachAt, draw, layOut } from "../tests/harness"
import { PieChart } from "./pie-chart"
import { PieLegend } from "../kit/pie-legend"
import { PieRing, onFill, wedgePath } from "./pie-ring"

type Row = Node2D & { flow: string; fill: never }
const BOX = { width: 800, height: 500 }
const ROWS = [
  { m: "A", v: 50 },
  { m: "B", v: 30 },
  { m: "C", v: 20 },
]

function chart(props: Record<string, unknown> = {}): PieChart {
  const node = attachAt(new PieChart({ ...BOX, data: ROWS, categoryField: "m", valueField: "v", ...props } as never))
  layOut(node, BOX)
  return node
}

function parts(node: PieChart) {
  const row = node.children[node.children.length - 1] as Row
  return {
    row,
    ring: row.children.find((part) => part instanceof PieRing) as PieRing,
    legend: (row.children.find((part) => part instanceof PieLegend) ?? null) as PieLegend | null,
  }
}

describe("PieChart: style", () => {
  it("is a pie with inside labels and a bottom legend until styled", () => {
    const { ring, legend, row } = parts(chart())
    expect(ring.ring.holeRadius).toBe(0)
    expect(ring.labelPlacement).toBe("inside")
    expect(legend).not.toBeNull()
    expect(row.flow).toBe("vertical")
  })

  it("hands the marks to the ring", () => {
    const { ring } = parts(chart({ style: { innerRadius: 0.6, sliceGap: 9, sliceRadius: 12 } }))
    expect(ring.ring).toMatchObject({ holeRadius: 0.6, gap: 9, cornerRadius: 12 })
  })

  it("paints wedges and swatches from the palette by row, cycled", () => {
    const { ring, legend } = parts(chart({ style: { palette: ["#ff0000", "#00ff00"] } }))
    expect(ring.slices.map((slice) => fillOps.resolve(slice.fill))).toEqual(["#ff0000", "#00ff00", "#ff0000"].map((c) => fillOps.resolve(c)))
    expect(legend!.slices).toEqual(ring.slices)
  })

  it("sets outside labels in the muted colour, leaders included", () => {
    const { ring } = parts(chart({ style: { labelPlacement: "outside", muted: "#123456" } }))
    expect(ring.labelPlacement).toBe("outside")
    expect(fillOps.resolve((ring.label.leaderStroke as unknown as { fill: never }).fill)).toEqual(fillOps.resolve("#123456"))
    expect(fillOps.resolve(ring.label.textStyle.fill as never)).toEqual(fillOps.resolve("#123456"))
  })

  it("builds no labels when placement is none, and the centre in the foreground", () => {
    const none = parts(chart({ style: { labelPlacement: "none" }, centerLabel: "9" })).ring
    expect(none.children).toHaveLength(1)
    expect(fillOps.resolve(none.centerStyle.labelStyle.fill as never)).toEqual(fillOps.resolve("#f4f4f5"))
    expect(fillOps.resolve(none.centerStyle.captionStyle.fill as never)).toEqual(fillOps.resolve("#a1a1aa"))
  })

  it.each([
    ["right", "horizontal", 1, "vertical"],
    ["bottom", "vertical", 1, "horizontal"],
    ["top", "vertical", 0, "horizontal"],
  ])("puts a %s legend in a %s row at slot %i", (legend, flow, slot, legendFlow) => {
    const built = parts(chart({ style: { legend } }))
    expect(built.row.flow).toBe(flow)
    expect(built.row.children[slot]).toBe(built.legend)
    expect(built.legend!.flow).toBe(legendFlow)
  })

  it("builds no legend for none", () => {
    const built = parts(chart({ style: { legend: "none" } }))
    expect(built.legend).toBeNull()
    expect(built.row.children).toHaveLength(1)
  })

  it("sizes the legend swatch by style.swatch", () => {
    const marker = (swatch: string) => parts(chart({ style: { swatch } })).legend!.legend.markerStyle
    expect(marker("circle").borderRadius).toBe(marker("circle").width / 2)
    expect(marker("line").width).toBeGreaterThan(marker("line").height)
    expect(marker("square").width).toBe(marker("square").height)
  })

  it("follows a style change made after build", () => {
    const node = chart()
    node.set({ style: { innerRadius: 0.5, sliceGap: 1, foreground: "#ffffff" } } as never)
    expect(parts(node).ring.ring).toMatchObject({ holeRadius: 0.5, gap: 1 })
    expect(fillOps.resolve(parts(node).ring.centerStyle.labelStyle.fill as never)).toEqual(fillOps.resolve("#ffffff"))
  })

  it("paints the background behind the whole chart", () => {
    expect(fillOps.resolve(parts(chart({ style: { background: "#fafaf9" } })).row.fill)).toEqual(fillOps.resolve("#fafaf9"))
  })

  it("keeps a pie's centre text out of the wedges", () => {
    const text = (inner: number) => parts(chart({ centerLabel: "9", style: { innerRadius: inner } })).ring.children.at(-1)!
    layOut(text(0).parent as Node2D, BOX)
    expect(text(0).opacity).toBe(0)
    expect(text(0.6).opacity).toBe(1)
  })
})

describe("wedgePath", () => {
  const points = (commands: ReturnType<ReturnType<typeof wedgePath>["toCommands"]>) =>
    commands.flatMap((c: PathCommand) => (c.type === "Z" ? [] : [{ x: (c as { x: number }).x, y: (c as { y: number }).y }]))

  it("stays inside its radii, corners and gaps included", () => {
    for (const corner of [0, 8]) {
      for (const p of points(wedgePath(0, 1.5, 100, 200, 3, corner, 0).toCommands())) {
        const r = Math.hypot(p.x, p.y)
        expect(r).toBeGreaterThan(100 - 1e-6)
        expect(r).toBeLessThan(200 + 1e-6)
      }
    }
  })

  it("rounds corners with curves, and only then", () => {
    const types = (corner: number) => new Set(wedgePath(0, 1.5, 100, 200, 3, corner, 0).toCommands().map((c) => c.type))
    expect(types(0).has("Q")).toBe(false)
    expect(types(8).has("Q")).toBe(true)
  })

  it("clamps a corner that the wedge cannot hold", () => {
    for (const p of points(wedgePath(0, 0.05, 100, 120, 2, 500, 0).toCommands())) expect(Number.isFinite(p.x + p.y)).toBe(true)
  })

  it("closes a pie wedge at an apex drawn off the centre by the gap", () => {
    const apex = points(wedgePath(0, Math.PI / 2, 0, 200, 8, 0, 0).toCommands())
    expect(Math.min(...apex.map((p) => Math.hypot(p.x, p.y)))).toBeGreaterThan(5)
    const touching = points(wedgePath(0, Math.PI / 2, 0, 200, 0, 0, 0).toCommands())
    expect(Math.min(...touching.map((p) => Math.hypot(p.x, p.y)))).toBeLessThan(1e-6)
  })

  it("draws one path per wedge", () => {
    const ring = parts(chart({ style: { innerRadius: 0.5 } })).ring
    expect(draw(ring, BOX).drawn.filter((g) => g.ops().some((op) => op.kind === "path")).length).toBe(3)
  })
})

describe("onFill", () => {
  it("picks dark text on light paint, light on dark, dark on anything it cannot read", () => {
    expect(onFill("#fafafa")).toBe("#111113")
    expect(onFill("#1d4ed8")).toBe("#ffffff")
    expect(onFill({ type: "noise" } as never)).toBe("#111113")
  })
})
