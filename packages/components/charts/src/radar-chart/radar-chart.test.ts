import { describe, expect, it } from "vitest"
import { Registry, Rect, Text, type Node2D } from "@motionscript/sdk"

import { ChartLegend } from "../kit/chart-legend"
import { SPOTLIGHT_DIM } from "../kit/shared"
import { CHART_STYLE_PRESETS } from "../kit/style"
import { NODES } from "../nodes"
import { attachAt, layOut, scrub } from "../tests/harness"
import { RadarChart, radarFractions, radarScale } from "./radar-chart"
import { RadarGrid } from "./radar-grid"
import { RadarSeries, seriesVertices } from "./radar-series"
import { fitRadius, labelAnchor, labelPoint, niceCeil, spokeDirection } from "./shared"

const registry = new Registry({ nodes: NODES })
const BOX = { width: 960, height: 640 }
const linear = (t: number) => t
const ROWS = [
  { skill: "Design", a: 80, b: 40 },
  { skill: "Motion", a: 60, b: 100 },
  { skill: "Code", a: 40, b: 20 },
  { skill: "Audio", a: 100, b: 60 },
]
const SERIES = [
  { field: "a", label: "Ana" },
  { field: "b", label: "Ben" },
]

function chart(props: Record<string, unknown> = {}): RadarChart {
  const node = attachAt(new RadarChart({ ...BOX, data: ROWS, categoryField: "skill", series: SERIES, ...props } as never))
  layOut(node, BOX)
  return node
}

/** The pieces, read off the frame the chart built: its last child. */
function partsOf(node: RadarChart) {
  const frame = node.children[node.children.length - 1] as Node2D
  const plot = frame.children.find((c) => c.children.some((p) => p instanceof RadarGrid)) as Node2D
  return {
    frame,
    plot,
    grid: plot.children.find((c) => c instanceof RadarGrid) as RadarGrid,
    series: plot.children.filter((c) => c instanceof RadarSeries) as RadarSeries[],
    labels: plot.children.find((c) => c instanceof Rect) as Node2D | undefined,
    legend: (frame.children.find((c) => c instanceof ChartLegend) ?? null) as ChartLegend | null,
  }
}

const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 6)

describe("radar scale", () => {
  it("rounds the largest value up tidily when max is unset", () => {
    expect(niceCeil(100)).toBe(100)
    expect(niceCeil(86)).toBe(100)
    expect(niceCeil(101)).toBe(120)
    expect(niceCeil(0.34)).toBeCloseTo(0.4)
    expect(niceCeil(0)).toBe(1)
    expect(radarScale({ data: ROWS, categoryField: "skill", series: SERIES, min: 0, max: 0 })).toEqual({ min: 0, max: 100 })
  })

  it("honours max, and falls back when max is not above min", () => {
    const base = { data: ROWS, categoryField: "skill", series: SERIES }
    expect(radarScale({ ...base, min: 0, max: 200 })).toEqual({ min: 0, max: 200 })
    expect(radarScale({ ...base, min: 50, max: 40 }).max).toBeGreaterThan(50)
  })

  it("maps values between min and max, clamped", () => {
    const base = { data: ROWS, categoryField: "skill", series: SERIES, min: 20, max: 100 }
    expect(radarFractions(base, 0)).toEqual([0.75, 0.5, 0.25, 1])
    expect(radarFractions(base, 1)).toEqual([0.25, 1, 0, 0.5])
    expect(radarFractions(base, 5)).toEqual([])
  })
})

describe("radar geometry", () => {
  it("runs spokes from 12 o'clock clockwise", () => {
    const [top, right, bottom, left] = [0, 1, 2, 3].map((i) => spokeDirection(i, 4))
    close(top.x, 0), close(top.y, 1)
    close(right.x, 1), close(right.y, 0)
    close(bottom.x, 0), close(bottom.y, -1)
    close(left.x, -1), close(left.y, 0)
  })

  it("scales the polygon's vertices by value and growth", () => {
    const [top, right] = seriesVertices([1, 0.5, 0, 0], 200)
    close(top.x, 0), close(top.y, 200)
    close(right.x, 100), close(right.y, 0)
    close(seriesVertices([1, 1, 1], 100, 0.5)[0].y, 50)
  })

  it("fits the web inside the box with room for every label", () => {
    const names = ["Design", "Motion", "Code", "Audio"]
    const bare = fitRadius({ width: 600, height: 600 }, names, 28, false)
    const labelled = fitRadius({ width: 600, height: 600 }, names, 28, true)
    expect(bare).toBeGreaterThan(labelled)
    expect(labelled).toBeGreaterThan(0)
    expect(fitRadius({ width: 100, height: 20 }, names, 28, true)).toBe(0)
  })
})

describe("RadarChart: parts", () => {
  it("builds a web, a polygon per series, labels and a legend", () => {
    const { grid, series, labels, legend } = partsOf(chart())
    expect(grid.count).toBe(4)
    expect(grid.levels).toBe(4)
    expect(grid.shape).toBe("polygon")
    expect(series).toHaveLength(2)
    expect(labels!.children.filter((c) => c instanceof Text)).toHaveLength(4)
    expect(legend!.series.map((s) => s.label)).toEqual(["Ana", "Ben"])
  })

  it("hands each polygon its values as fractions of the scale and one shared radius", () => {
    const { series, grid } = partsOf(chart())
    expect(series[0].fractions).toEqual([0.8, 0.6, 0.4, 1])
    expect(series[1].fractions).toEqual([0.4, 1, 0.2, 0.6])
    expect(grid.radius).toBeGreaterThan(100)
    expect(series[0].radius).toBe(grid.radius)
    expect(series[1].radius).toBe(grid.radius)
  })

  it("scales to min and max", () => {
    const { series } = partsOf(chart({ min: 20, max: 120 }))
    expect(series[0].fractions[0]).toBeCloseTo(0.6)
  })

  it("starts a disabled series hidden", () => {
    const { series } = partsOf(chart({ series: [SERIES[0], { ...SERIES[1], enabled: false }] }))
    expect(series.map((s) => s.enabled)).toEqual([true, false])
    expect(partsOf(chart({ series: [SERIES[0], { ...SERIES[1], enabled: false }] })).legend!.reveal).toEqual([1, 0])
  })

  it("colours polygons from the palette, or a series' own fill", () => {
    const { series } = partsOf(chart({ series: [SERIES[0], { ...SERIES[1], fill: "#ff0000" }] }))
    expect(series[0].fill[0]).toMatchObject({ type: "solid" })
    expect(JSON.stringify(series[1].fill)).toContain("[1,0,0,1]")
    expect(JSON.stringify(series[0].fill)).not.toEqual(JSON.stringify(series[1].fill))
  })

  it("passes the marks style to the polygons", () => {
    const { series } = partsOf(chart({ style: { areaOpacity: 0.6, dots: false, dotSize: 14, strokeWidth: 9 } }))
    expect(series[0].areaOpacity).toBe(0.6)
    expect(series[0].dots).toBe(false)
    expect(series[0].dotSize).toBe(14)
    expect(series[0].stroke[0].weight).toBe(9)
  })

  it("passes the grid style to the web", () => {
    const { grid } = partsOf(chart({ style: { gridShape: "circle", gridLevels: 6, spokeStroke: [], gridStroke: [] } }))
    expect(grid.shape).toBe("circle")
    expect(grid.levels).toBe(6)
    expect(grid.spokeStroke).toEqual([])
    expect(grid.stroke).toEqual([])
  })

  it("leaves the labels out when spokeLabels is off", () => {
    const { labels, grid } = partsOf(chart({ style: { spokeLabels: false } }))
    expect(labels).toBeUndefined()
    // Without labels the web fills the box.
    expect(grid.radius).toBeGreaterThan(partsOf(chart()).grid.radius)
  })

  it("names each spoke after its row, in the muted colour", () => {
    const texts = partsOf(chart()).labels!.children as Text[]
    expect(texts.map((t) => t.text)).toEqual(["Design", "Motion", "Code", "Audio"])
  })

  it("pins labels just outside the rim, on their spokes", () => {
    const r = 200
    const [top, right, bottom, left] = [0, 1, 2, 3].map((i) => labelPoint(i, 4, r, 28))
    expect(top.y).toBeGreaterThan(r)
    close(top.x, 0)
    expect(right.x).toBeGreaterThan(r)
    expect(bottom.y).toBeLessThan(-r)
    expect(left.x).toBeLessThan(-r)
    expect(["centerLeft", "centerRight", "bottomCenter", "topCenter"]).toContain(labelAnchor(1, 4))
    expect([0, 1, 2, 3].map((i) => labelAnchor(i, 4))).toEqual(["bottomCenter", "centerLeft", "topCenter", "centerRight"])
  })
})

describe("RadarChart: legend", () => {
  it("sits below by default, above for top, beside for right, and is gone for none", () => {
    const bottom = partsOf(chart())
    expect(bottom.frame.children.at(-1)).toBe(bottom.legend)
    expect((bottom.frame as unknown as { flow: string }).flow).toBe("vertical")
    const top = partsOf(chart({ style: { legend: "top" } }))
    expect(top.frame.children[0]).toBe(top.legend)
    const right = partsOf(chart({ style: { legend: "right" } }))
    expect((right.frame as unknown as { flow: string }).flow).toBe("horizontal")
    expect((right.legend as unknown as { flow: string }).flow).toBe("vertical")
    expect(partsOf(chart({ style: { legend: "none" } })).legend).toBeNull()
  })

  it("takes the series colours", () => {
    const { legend, series } = partsOf(chart())
    expect(legend!.swatches).toEqual(series.map((s) => s.fill))
  })
})

describe("RadarChart.enter", () => {
  const entering = (node: RadarChart, duration = 1) => scrub(node.enter({ duration, easing: linear }))

  it("rests finished", () => {
    const { grid, series, labels, legend } = partsOf(chart())
    expect(grid.reveal).toBe(1)
    expect(series.map((s) => s.progress)).toEqual([1, 1])
    expect(labels!.opacity).toBe(1)
    expect(legend!.opacity).toBe(1)
  })

  it("arms every part on its first frame", () => {
    const node = chart()
    entering(node)(0)
    const { grid, series, labels, legend } = partsOf(node)
    expect(grid.reveal).toBe(0)
    expect(series.map((s) => s.progress)).toEqual([0, 0])
    expect(labels!.opacity).toBe(0)
    expect(legend!.opacity).toBe(0)
    expect(legend!.y).toBeLessThan(0)
  })

  it("grows the web first, then the polygons staggered by series, then labels and legend", () => {
    const node = chart()
    const seek = entering(node)
    seek(0.2)
    let p = partsOf(node)
    expect(p.grid.reveal).toBeGreaterThan(0)
    expect(p.grid.reveal).toBeLessThan(1)
    expect(p.series.map((s) => s.progress)).toEqual([0, 0])
    seek(0.55)
    p = partsOf(node)
    expect(p.grid.reveal).toBe(1)
    expect(p.series[0].progress).toBeGreaterThan(0)
    expect(p.series[0].progress).toBeGreaterThan(p.series[1].progress)
    expect(p.legend!.opacity).toBe(0)
    seek(1)
    p = partsOf(node)
    expect(p.series.map((s) => s.progress)).toEqual([1, 1])
    expect(p.labels!.opacity).toBe(1)
    expect(p.legend!.opacity).toBe(1)
    expect(p.legend!.y).toBe(0)
  })

  it("arrives the same going back", () => {
    const node = chart()
    const seek = entering(node)
    seek(1)
    seek(0.55)
    const back = partsOf(node).series.map((s) => s.progress)
    const fresh = chart()
    entering(fresh)(0.55)
    expect(back).toEqual(partsOf(fresh).series.map((s) => s.progress))
  })

  it("survives a chart with no legend, labels or series", () => {
    const node = chart({ style: { legend: "none", spokeLabels: false }, series: [] })
    expect(() => entering(node)(1)).not.toThrow()
  })
})

describe("RadarChart series commands", () => {
  const run = (node: RadarChart, key: "showSeries" | "hideSeries" | "spotlightSeries", seriesIndex: number) =>
    scrub(registry.nodeCommand("radarChart", key)!(node as never, { seriesIndex }, 1, linear) as never)

  it("hideSeries shrinks a polygon and its legend entry, and showSeries brings them back", () => {
    const node = chart()
    const hide = run(node, "hideSeries", 1)
    hide(0.5)
    let p = partsOf(node)
    close(p.series[1].progress, 0.5)
    expect(p.series[0].progress).toBe(1)
    close(p.legend!.reveal[1], 0.5)
    hide(1)
    p = partsOf(node)
    expect(p.series[1].enabled).toBe(false)
    expect(p.legend!.reveal).toEqual([1, 0])

    const show = run(node, "showSeries", 1)
    show(0.5)
    close(partsOf(node).series[1].progress, 0.5)
    show(1)
    expect(partsOf(node).series[1].enabled).toBe(true)
    expect(partsOf(node).legend!.reveal).toEqual([1, 1])
  })

  it("spotlightSeries dims every other polygon and legend entry", () => {
    const node = chart()
    run(node, "spotlightSeries", 0)(1)
    const p = partsOf(node)
    expect(p.series[0].opacity).toBe(1)
    expect(p.series[1].opacity).toBeCloseTo(SPOTLIGHT_DIM)
    const entries = p.legend!.children as Node2D[]
    expect(entries[0].opacity).toBe(1)
    expect(entries[1].opacity).toBeCloseTo(SPOTLIGHT_DIM)
  })

  it("holds for a series that does not exist", () => {
    const node = chart()
    expect(() => run(node, "hideSeries", 9)(1)).not.toThrow()
    expect(partsOf(node).series.map((s) => s.progress)).toEqual([1, 1])
  })
})

describe("RadarChart style", () => {
  it("keeps every drawn field bound, so a later style reaches the parts without a rebuild", () => {
    const node = chart()
    node.set({ style: { strokeWidth: 12, gridShape: "circle", gridLevels: 5, areaOpacity: 0.5, spokeText: { fontSize: 40 } } })
    layOut(node, BOX)
    const p = partsOf(node)
    expect(p.series[0].stroke[0].weight).toBe(12)
    expect(p.series[0].areaOpacity).toBe(0.5)
    expect(p.grid.shape).toBe("circle")
    expect(p.grid.levels).toBe(5)
    // Larger type leaves a smaller web.
    expect(p.grid.radius).toBeLessThan(partsOf(chart()).grid.radius)
  })

  it("applies a preset's series fills", () => {
    const { series } = partsOf(chart({ style: { seriesFills: CHART_STYLE_PRESETS.neon.seriesFills } }))
    expect(JSON.stringify(series[0].fill)).toContain("0.1333")
  })

  it("draws without error at every shape", () => {
    for (const gridShape of ["polygon", "circle"]) {
      const node = chart({ style: { gridShape } })
      expect(() => layOut(node, BOX)).not.toThrow()
    }
  })
})

describe("radarChart in the registry", () => {
  const described = registry.describe("radarChart")!

  it("describes its content entries and the chart style family", () => {
    const props = described.properties as Record<string, Record<string, unknown>>
    expect(props.categoryField).toBeDefined()
    expect(props.series).toBeDefined()
    expect(props.min).toMatchObject({ default: 0 })
    expect(props.max).toMatchObject({ default: 0 })
    expect(props.theme).toBeUndefined()
    expect(props.showLegend).toBeUndefined()
  })

  it("groups its style fields", () => {
    const style = (described.properties as Record<string, { kind: string; family: string; properties: Record<string, { group: string; animatable?: boolean }> }>).style
    expect(style).toMatchObject({ kind: "style", family: "chart" })
    const groups = (keys: string[]) => keys.map((k) => style.properties[k]?.group)
    expect(groups(["seriesFills"])).toEqual(["series"])
    expect(groups(["background", "gridBackground"])).toEqual(Array(2).fill("background"))
    expect(groups(["gridShape", "gridLevels", "gridStroke", "spokeStroke", "spokeLabels", "spokeText"])).toEqual(Array(6).fill("grid"))
    expect(groups(["strokeWidth", "areaOpacity", "dots", "dotSize"])).toEqual(Array(4).fill("marks"))
    expect(groups(["legend", "swatch", "legendText"])).toEqual(Array(3).fill("legend"))
    expect(style.properties.legend.animatable).toBe(false)
    expect(style.properties.spokeLabels.animatable).toBe(false)
    expect(style.properties.gridShape).toMatchObject({ kind: "enum", default: "polygon" })
    expect(style.properties.areaOpacity).toMatchObject({ default: 0.25, min: 0, max: 1 })
    expect(style.properties.cartesianGrid).toBeUndefined()
    expect(style.properties.gridColor).toBeUndefined()
    expect(style.properties.gridStroke).toMatchObject({ kind: "strokes" })
    expect(style.properties.spokeStroke).toMatchObject({ kind: "strokes" })
  })

  it("offers the per-series commands a series argument, and enter as an entrance", () => {
    const commands = registry.node("radarChart")!.commands
    for (const key of ["showSeries", "hideSeries", "spotlightSeries"]) {
      expect(commands.get(key)?.args).toEqual([{ key: "seriesIndex", kind: "series", default: 0, min: 0, step: 1 }])
    }
    expect(commands.get("enter")).toBeDefined()
  })
})
