import { describe, expect, it } from "vitest"
import { fillOps } from "@motionscript/sdk"

import { attachAt, layOut } from "../tests/harness"
import { BarChart } from "../bar-chart"
import { barCorners, ChartBars, type BarGeometry } from "../bar-chart/chart-bars"
import { ChartCanvas } from "./chart-canvas"
import { RadarChart } from "../radar-chart"
import { RadarGrid } from "../radar-chart/radar-grid"
import { partOf, partsOf } from "./tests/parts"
import { migrateChartStyle } from "./style"

const BOX = { width: 760, height: 460 }
const ROWS = [
  { m: "Jan", a: 10, b: -20 },
  { m: "Feb", a: 30, b: 10 },
]
const SERIES = [{ field: "a" }, { field: "b" }]

function bar(props: Record<string, unknown> = {}): BarChart {
  const node = attachAt(new BarChart({ ...BOX, data: ROWS, categoryField: "m", series: SERIES, ...props } as never))
  layOut(node, BOX)
  return node
}

describe("a chart style from before every text had its own field", () => {
  it("moves the palette, the shared type and the two inks onto the cartesian fields", () => {
    const out = migrateChartStyle("cartesian")({
      palette: ["#111111"],
      foreground: "#ffffff",
      muted: "#888888",
      fontFamily: "Inter",
      fontSize: 20,
      fontWeight: 400,
      background: "#000000",
      barRadius: 6,
      legend: "top",
    })
    expect(out).toEqual({
      seriesFills: ["#111111"],
      gridBackground: "#000000",
      barCornerRadius: { topLeft: 6, topRight: 6, bottomRight: 0, bottomLeft: 0 },
      legend: "top",
      legendText: { fontFamily: "Inter", fontSize: 20, fontWeight: 400, fill: "#ffffff" },
      xLabelText: { fontFamily: "Inter", fontSize: 20, fontWeight: 400, fill: "#888888" },
      yLabelText: { fontFamily: "Inter", fontSize: 20, fontWeight: 400, fill: "#888888" },
      xTitleText: { fontFamily: "Inter", fontSize: 22, fontWeight: 500, fill: "#888888" },
      yTitleText: { fontFamily: "Inter", fontSize: 22, fontWeight: 500, fill: "#888888" },
      valueText: { fontFamily: "Inter", fontSize: 17, fontWeight: 500, fill: "#ffffff" },
    })
  })

  it("keeps a pie's background on the whole chart and writes only what was stated", () => {
    expect(migrateChartStyle("pie")({ background: "#000000", muted: "#888888" })).toEqual({
      background: "#000000",
      labelText: { fill: "#888888" },
    })
  })

  it("hands a current style back untouched", () => {
    const current = { seriesFills: ["#111111"], background: "#000000", gridBackground: [] }
    expect(migrateChartStyle("cartesian")(current)).toBe(current)
    expect(migrateChartStyle("pie")({ background: "#000" })).toEqual({ background: "#000" })
  })
})

describe("chart and grid backgrounds", () => {
  it("paints the plot from gridBackground and the whole chart from background", () => {
    const node = bar({ style: { background: "#101010", gridBackground: "#202020" } })
    expect(partOf(node, ChartCanvas)!.fill).toEqual(fillOps.resolve("#202020"))
    const frame = node.children[0] as unknown as { fill: unknown }
    expect(frame.fill).toEqual(fillOps.resolve("#101010"))
  })

  it("fills a radar's web from gridBackground", () => {
    const node = attachAt(new RadarChart({ ...BOX, data: ROWS, categoryField: "m", series: SERIES, style: { gridBackground: ["#202020", "#ff0000/50"] } } as never))
    layOut(node, BOX)
    expect(partOf(node, RadarGrid)!.fill).toHaveLength(2)
  })
})

describe("bar corners", () => {
  const geometry = (over: Partial<BarGeometry> = {}): BarGeometry => ({ center: 0, thickness: 40, from: 0, to: 100, round: true, caption: "", ...over })
  const radius = { topLeft: 1, topRight: 2, bottomRight: 3, bottomLeft: 4 }
  const style = { topLeft: "rounded", topRight: "angled", bottomRight: "rounded", bottomLeft: "rounded" } as const
  const at = (horizontal: boolean, forward: boolean, bar = geometry()) =>
    barCorners({ cornerRadius: radius, cornerStyle: style, horizontal }, bar, forward, 100)

  it("reads the corners as for a bar standing up", () => {
    expect(at(false, true).cornerRadius).toEqual(radius)
    expect(at(false, true).cornerStyle).toEqual(style)
  })

  it("mirrors them for a bar below zero, and turns them for a horizontal bar", () => {
    expect(at(false, false).cornerRadius).toEqual({ topLeft: 4, topRight: 3, bottomRight: 2, bottomLeft: 1 })
    // Growing right: the far end (top pair) is the right side.
    expect(at(true, true).cornerRadius).toEqual({ topLeft: 4, topRight: 1, bottomRight: 2, bottomLeft: 3 })
    expect(at(true, false).cornerRadius).toEqual({ topLeft: 1, topRight: 4, bottomRight: 3, bottomLeft: 2 })
    expect(at(true, true).cornerStyle.bottomRight).toBe("angled")
  })

  it("keeps a stacked segment square where it meets its neighbours", () => {
    expect(at(false, true, geometry({ round: false, grounded: false })).cornerRadius).toEqual({ topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 })
    expect(at(false, true, geometry({ round: false, grounded: true })).cornerRadius).toEqual({ topLeft: 0, topRight: 0, bottomRight: 3, bottomLeft: 4 })
  })

  it("holds every radius inside the bar", () => {
    const big = { topLeft: 500, topRight: 500, bottomRight: 500, bottomLeft: 500 }
    const out = barCorners({ cornerRadius: big, cornerStyle: style, horizontal: false }, geometry({ thickness: 40 }), true, 30)
    expect(out.cornerRadius).toEqual({ topLeft: 15, topRight: 15, bottomRight: 15, bottomLeft: 15 })
  })

  it("rounds only the base of a stack's first segment and only the far end of its last", () => {
    const node = bar({ stack: "stacked", style: { barCornerRadius: 8 } })
    const [first, second] = partsOf(node, ChartBars).map((set) => set.bars[1])
    expect(first).toMatchObject({ grounded: true, round: false })
    expect(second).toMatchObject({ grounded: false, round: true })
  })
})
