import { describe, expect, it } from "vitest"
import {
  ContextMap,
  Registry,
  type Command,
  type Node2D,
} from "@motionscript/sdk"
import { ManifestAssetCatalog } from "@motionscript/core"

import { ChartLegend } from "../kit/chart-legend"
import { NODES } from "../nodes"
import { draw, horizontalMarkers, layOut, scrub, verticalMarkers } from "../tests/harness"
import { partOf, partsOf as partsIn, plotOf } from "../kit/tests/parts"
import { HorizontalAxis } from "../kit/horizontal-axis"
import { VerticalAxis } from "../kit/vertical-axis"
import { ChartArea, ChartLine } from "./chart-line"
import { LineChart, lineChartDomains } from "./line-chart"

// A host adds a command before its arguments are filled in, so every factory
// has to survive the empty `args` a fresh row carries as well as a real one.

const registry = new Registry({ nodes: NODES })
const linear = (t: number) => t

const ROWS = [
  { month: "Jan", revenue: 10, cost: 4 },
  { month: "Feb", revenue: 14, cost: 6 },
  { month: "Mar", revenue: 12, cost: 9 },
]

/** Mounted, since a command on an unmounted node is inert by design. */
function chart(props: Record<string, unknown> = {}): LineChart {
  const node = registry.instantiate({
    id: "chart",
    type: "lineChart",
    parentId: null,
    layerOrder: 0,
    props: {
      data: ROWS,
      xField: "month",
      series: [
        { field: "revenue", label: "Revenue" },
        { field: "cost", label: "Cost" },
      ],
      ...props,
    },
  }) as LineChart
  node.attach({
    assets: new ManifestAssetCatalog({ image: {}, video: {}, audio: {}, font: {} }),
    context: ContextMap.EMPTY,
    time: 0,
  })
  return node
}

/** A chart with a region already drawn in. `regionReveal` is the chart's own signal, not an authored prop. */
function lit(node: LineChart): void {
  node.region = { x: [0, 1] }
  node.regionReveal = 1
}

function run(node: LineChart, key: string, args: Record<string, unknown>, duration = 1) {
  return registry.nodeCommand("lineChart", key)!(node, args, duration, linear)
}

/** The call-out as `command` draws it at `t`. */
function regionAt(node: LineChart, command: Command, t: number) {
  command.at(t)
  return { region: node.region, regionReveal: node.regionReveal }
}

describe("LineChart commands", () => {
  it.each([
    "enter",
    "spotlightRegion",
    "clearRegion",
    "zoomTo",
    "resetZoom",
    "showSeries",
    "hideSeries",
    "spotlightSeries",
  ])("%s builds from empty args and takes its slot", (key) => {
    const command = run(chart(), key, {})
    expect(command.duration).toBe(1)
  })

  it("draws a spotlit region on from nothing", () => {
    const node = chart()
    const command = run(node, "spotlightRegion", { region: { x: [0, 1] } })
    expect(regionAt(node, command, 0.5)).toEqual({ region: { x: [0, 1] }, regionReveal: 0.5 })
    expect(regionAt(node, command, 1)).toEqual({ region: { x: [0, 1] }, regionReveal: 1 })
  })

  it("treats a region bounding neither axis as a clear", () => {
    const node = chart()
    lit(node)
    const command = run(node, "spotlightRegion", { region: {} })
    expect(regionAt(node, command, 0.5)).toEqual({ region: { x: [0, 1] }, regionReveal: 0.5 })
    expect(regionAt(node, command, 1)).toEqual({ region: null, regionReveal: 0 })
  })

  it("cross-fades one region into the next", () => {
    const node = chart()
    lit(node)
    const command = run(node, "spotlightRegion", { region: { y: [5, 10] } })
    expect(regionAt(node, command, 0.25)).toEqual({ region: { x: [0, 1] }, regionReveal: 0.5 })
    expect(regionAt(node, command, 1)).toEqual({ region: { y: [5, 10] }, regionReveal: 1 })
  })

  it("retracts the region it clears, holding it until the retraction lands", () => {
    const node = chart()
    lit(node)
    const command = run(node, "clearRegion", {})
    expect(regionAt(node, command, 0)).toEqual({ region: { x: [0, 1] }, regionReveal: 1 })
    expect(regionAt(node, command, 0.5)).toEqual({ region: { x: [0, 1] }, regionReveal: 0.5 })
    expect(regionAt(node, command, 1)).toEqual({ region: null, regionReveal: 0 })
  })

  it("zooms to a region and back", () => {
    const node = chart()
    expect(run(node, "zoomTo", { region: { y: [0, 20] } }).duration).toBe(1)
    expect(run(node, "resetZoom", {}).duration).toBe(1)
  })

  it("holds rather than throwing on a series it does not have", () => {
    const node = chart()
    for (const key of ["showSeries", "hideSeries", "spotlightSeries"]) {
      expect(run(node, key, { seriesIndex: 9 }).duration).toBe(1)
    }
  })

  it("runs every command on a chart with no legend and no axes", () => {
    const bare = { style: { legend: "none", showXAxis: false, showYAxis: false } }
    for (const key of ["enter", "showSeries", "hideSeries", "spotlightSeries"]) {
      expect(run(chart(bare), key, { seriesIndex: 0 }).duration).toBe(1)
    }
  })

  it("offers the per-series argument as a series, by index", () => {
    const commands = registry.node("lineChart")!.commands
    expect(commands.get("spotlightSeries")?.args).toEqual([
      { key: "seriesIndex", kind: "series", default: 0, min: 0, step: 1 },
    ])
  })
})

/** The chart's parts, read off the frame it built: its last child. */
function partsOf(node: LineChart) {
  return {
    vAxis: partOf(node, VerticalAxis) as unknown as Node2D,
    hAxis: partOf(node, HorizontalAxis) as unknown as Node2D,
    lines: partsIn(node, ChartLine),
    legend: partOf(node, ChartLegend) ?? null,
  }
}

/** What each part holds: the state the entrance moves between. */
function parts(node: LineChart) {
  const { vAxis, hAxis, lines, legend } = partsOf(node)
  return {
    markers: [...verticalMarkers(vAxis), ...horizontalMarkers(hAxis)].map((marker) => [marker.opacity, marker.x, marker.y]),
    progress: lines.map((line) => line.progress),
    enabled: lines.map((line) => line.enabled),
    legend: legend ? [legend.opacity, legend.y] : null,
  }
}

/** `enter` built and seeked to its first frame, the way a timeline arriving at it does. */
function entering(node: LineChart, duration = 1) {
  const step = node.enter({ duration, easing: linear })._stepper()
  step.seek(0)
  return (seconds: number) => step.seek(seconds)
}

describe("LineChart.enter: the finished chart at rest, armed on its first frame", () => {
  it("rests as the finished chart: every line traced, the legend in place, every marker shown", () => {
    const rest = parts(chart())
    expect(rest.progress).toEqual([1, 1])
    expect(rest.legend).toEqual([1, 0])
    expect(rest.markers.length).toBeGreaterThan(0)
    expect(rest.markers.every(([opacity]) => opacity === 1)).toBe(true)
  })

  it("puts every part at its pre-entrance state on its first frame", () => {
    const node = chart()
    entering(node)
    const armed = parts(node)
    expect(armed.progress).toEqual([0, 0])
    expect(armed.legend![0]).toBe(0)
    // The legend waits above its place.
    expect(armed.legend![1]).toBeLessThan(0)
    expect(armed.markers.every(([opacity]) => opacity === 0)).toBe(true)
  })

  it("arms the same way however often it is built", () => {
    const node = chart()
    entering(node)
    const once = parts(node)
    entering(node)
    entering(node)
    expect(parts(node)).toEqual(once)
  })

  it("leaves what the chart plots alone", () => {
    const node = chart({ series: [{ field: "revenue", label: "Revenue" }, { field: "cost", label: "Cost", enabled: false }] })
    const before = { data: node.data, region: node.region, reveal: node.regionReveal }
    entering(node)
    expect({ data: node.data, region: node.region, reveal: node.regionReveal }).toEqual(before)
  })

  it("moves nothing in a chart that has no legend", () => {
    const node = chart({ style: { legend: "none" } })
    expect(() => entering(node)).not.toThrow()
    expect(parts(node)).toMatchObject({ legend: null, progress: [0, 0] })
  })

  it("lands back on the chart at rest", () => {
    const node = chart()
    const rest = parts(node)
    const seek = entering(node, 2)
    expect(parts(node).progress).toEqual([0, 0])
    seek(2)
    const landed = parts(node)
    expect(landed.enabled).toEqual(rest.enabled)
    const numbers = (state: ReturnType<typeof parts>) => [...state.markers.flat(), ...state.progress, ...(state.legend ?? [])]
    numbers(rest).forEach((value, i) => expect(numbers(landed)[i], `[${i}]`).toBeCloseTo(value, 8))
  })

  it("holds an authored region back until the last quarter", () => {
    const node = chart({ region: { x: [0, 1] } })
    const seek = entering(node, 2)
    expect(node.regionReveal).toBe(0)
    seek(1.4)
    expect(node.regionReveal).toBe(0)
    seek(1.75)
    expect(node.regionReveal).toBeCloseTo(0.5)
    seek(2)
    expect(node.regionReveal).toBe(1)
  })
})

/** A chart with a numeric x field, so both axes zoom as numbers. */
function numeric(props: Record<string, unknown> = {}): LineChart {
  return chart({
    data: [0, 1, 2, 3, 4].map((x) => ({ x, revenue: 10 + x * 4, cost: 4 + x })),
    xField: "x",
    ...props,
  })
}

const yRange = (node: LineChart) => lineChartDomains(node).y.range
const xRange = (node: LineChart) => lineChartDomains(node).x.range
const yTicks = (node: LineChart) => lineChartDomains(node).y.ticks
const home = (node: LineChart) => (node as unknown as { home: unknown }).home
const close = (actual: readonly number[], expected: readonly number[]) => {
  expect(actual).toHaveLength(expected.length)
  expected.forEach((value, i) => expect(actual[i], `[${i}]`).toBeCloseTo(value, 8))
}

/** Builds `command` and lands it, the way a timeline walking the list does. */
function land(command: Command): void {
  command.at(1)
}

describe("LineChart.zoomTo and resetZoom", () => {
  it("zooms the named axis to the range, in whole, and leaves the other alone", () => {
    const node = numeric()
    const x = [...xRange(node)]
    land(run(node, "zoomTo", { region: { y: [12, 20] } }))
    close(yRange(node), [12, 20])
    close(xRange(node), x)
  })

  it("keeps the number of ticks, moving each to its place in the new range", () => {
    const node = numeric()
    const count = yTicks(node).length
    land(run(node, "zoomTo", { region: { y: [12, 20] } }))
    const ticks = yTicks(node)
    expect(ticks).toHaveLength(count)
    close([ticks[0], ticks[ticks.length - 1]], [12, 20])
  })

  it("reads a range written back to front as the same span", () => {
    const node = numeric()
    land(run(node, "zoomTo", { region: { y: [20, 12] } }))
    close(yRange(node), [12, 20])
  })

  it("is continuous from an auto axis, the first time it is asked", () => {
    const node = numeric()
    const [lo, hi] = yRange(node)
    const step = run(node, "zoomTo", { region: { y: [12, 20] } })._stepper()
    step.seek(0)
    step.seek(0.5)
    const [midLo, midHi] = yRange(node)
    expect(midLo).toBeCloseTo((lo + 12) / 2)
    expect(midHi).toBeCloseTo((hi + 20) / 2)
  })

  it("brings the chart back to where it started", () => {
    const node = numeric()
    const start = { x: [...xRange(node)], y: [...yRange(node)], ticks: [...yTicks(node)] }
    land(run(node, "zoomTo", { region: { y: [12, 20] } }))
    land(run(node, "resetZoom", {}))
    close(yRange(node), start.y)
    close(xRange(node), start.x)
    close(yTicks(node), start.ticks)
  })

  it("holds when it was never zoomed, taking its slot and writing nothing", () => {
    const node = numeric()
    const before = { ...lineChartDomains(node) }
    const reset = run(node, "resetZoom", {}, 1.5)
    expect(reset.duration).toBe(1.5)
    reset.at(0.5)
    reset.at(1)
    expect(lineChartDomains(node)).toEqual(before)
    expect(home(node)).toBeNull()
  })

  it("holds, and remembers nothing, when the region bounds neither axis", () => {
    const node = numeric()
    const before = { ...lineChartDomains(node) }
    for (const region of [{}, undefined, null]) {
      const zoom = run(node, "zoomTo", { region }, 2)
      expect(zoom.duration).toBe(2)
      zoom.at(1)
    }
    expect(lineChartDomains(node)).toEqual(before)
    expect(home(node)).toBeNull()
  })

  it("remembers the first domain only, however many zooms follow", () => {
    const node = numeric()
    const start = [...yRange(node)]
    land(run(node, "zoomTo", { region: { y: [12, 20] } }))
    land(run(node, "zoomTo", { region: { y: [14, 16] } }))
    land(run(node, "zoomTo", { region: { y: [15, 15.5] } }))
    close(yRange(node), [15, 15.5])
    land(run(node, "resetZoom", {}))
    close(yRange(node), start)
  })

  it("lets go of the domain it remembered when it resets, so a second reset has nothing to do", () => {
    const node = numeric()
    land(run(node, "zoomTo", { region: { y: [12, 20] } }))
    land(run(node, "resetZoom", {}))
    expect(home(node)).toBeNull()
    const rest = { ...lineChartDomains(node) }
    land(run(node, "resetZoom", {}))
    expect(lineChartDomains(node)).toEqual(rest)
  })

  it("remembers as part of its frames, so a seek back before the zoom forgets again", () => {
    const node = numeric()
    const zoom = run(node, "zoomTo", { region: { y: [12, 20] } })
    expect(home(node)).not.toBeNull()
    const reset = run(node, "resetZoom", {})
    expect(home(node)).toBeNull()
    reset.at(0)
    expect(home(node)).toBeNull()
    zoom.at(0.5)
    expect(home(node)).not.toBeNull()
  })

  it("repeats: each zoom remembers wherever the chart rests when it is asked, and each reset returns there", () => {
    const node = numeric()
    const start = [...yRange(node)]
    for (const target of [[12, 20], [20, 40], [0, 5]] as const) {
      land(run(node, "zoomTo", { region: { y: target as unknown as [number, number] } }))
      close(yRange(node), target)
      land(run(node, "resetZoom", {}))
      close(yRange(node), start)
      expect(home(node)).toBeNull()
    }
  })

  it("resets to the chart as it stood when the zoom was asked, not as it was first authored", () => {
    const node = numeric()
    land(run(node, "zoomTo", { region: { y: [12, 20] } }))
    land(run(node, "resetZoom", {}))
    // A restated axis moves the resting chart; the next zoom remembers that.
    node.set({ yAxis: { range: [0, 100] } })
    land(run(node, "zoomTo", { region: { y: [40, 60] } }))
    land(run(node, "resetZoom", {}))
    close(yRange(node), [0, 100])
  })

  it("zooms both axes together and brings both back", () => {
    const node = numeric()
    const start = { x: [...xRange(node)], y: [...yRange(node)] }
    land(run(node, "zoomTo", { region: { x: [1, 2], y: [12, 20] } }))
    close(xRange(node), [1, 2])
    close(yRange(node), [12, 20])
    land(run(node, "resetZoom", {}))
    close(xRange(node), start.x)
    close(yRange(node), start.y)
  })

  it("is a frame of its time: scrubbing a zoom and a reset lands on the same ranges either way round", () => {
    const node = numeric()
    const zoom = node.zoomTo({ data: { region: { y: [12, 20] } }, duration: 1, easing: linear })._stepper()
    zoom.seek(0)
    zoom.seek(0.3)
    const forward = [...yRange(node)]
    zoom.seek(1)
    zoom.seek(0)
    zoom.seek(0.3)
    close(yRange(node), forward)
  })
})

describe("LineChart's axes under a plain to", () => {
  /** `to(data)` built and seeked to `t` of a 1 s move. */
  function moved(node: LineChart, data: Record<string, unknown>) {
    const step = node.to({ data, duration: 1, easing: linear })._stepper()
    step.seek(0)
    return (t: number) => {
      step.seek(t)
      return lineChartDomains(node).y
    }
  }

  it("rescales an auto axis continuously, from the range it draws", () => {
    const node = numeric()
    const [lo, hi] = yRange(node)
    const at = moved(node, { yAxis: { range: [0, 50] } })
    close(at(0).range, [lo, hi])
    close(at(0.5).range, [lo / 2, (hi + 50) / 2])
    close(at(1).range, [0, 50])
  })

  it("lands on a plain domain, the auto tick row still the data's", () => {
    const node = numeric()
    moved(node, { yAxis: { range: [0, 50] } })(1)
    expect(node.yAxis).toEqual({ label: "", range: [0, 50], ticks: undefined, format: undefined })
    close(yTicks(node), [0, 12.5, 25, 37.5, 50])
  })

  it("spreads explicit ticks across a restated range, keeping their count", () => {
    const node = numeric({ yAxis: { range: [0, 30], ticks: [0, 10, 20, 30] } })
    const at = moved(node, { yAxis: { range: [0, 60] } })
    close(at(1).ticks, [0, 20, 40, 60])
    close(at(0.5).ticks, [0, 15, 30, 45])
  })

  it("re-derives an auto range for a restated tick row", () => {
    const node = numeric()
    moved(node, { yAxis: { ticks: [0, 10, 20, 30] } })(1)
    expect(node.yAxis.range).toBeUndefined()
    close(yTicks(node), [0, 10, 20, 30])
  })
})

describe("lineChartDomains", () => {
  it("is worked out once while the data and axes it reads are unchanged", () => {
    const node = chart()
    const first = lineChartDomains(node)
    expect(lineChartDomains(node)).toBe(first)
    node.set({ yAxis: { range: [0, 50] } })
    expect(lineChartDomains(node).y.range).toEqual([0, 50])
    node.set({ data: ROWS.map((row) => ({ ...row, revenue: row.revenue * 10 })) })
    expect(lineChartDomains(node).y.range).toEqual([0, 50])
    expect(lineChartDomains(node).x).toEqual(first.x)
    node.set({ yAxis: {} })
    expect(lineChartDomains(node).y.range[1]).toBeGreaterThan(first.y.range[1])
  })
})

describe("LineChart: stack modes", () => {
  const BOX = { width: 800, height: 400 }
  const laid = (props: Record<string, unknown> = {}) => {
    const node = chart(props)
    layOut(node, BOX)
    return node
  }
  /** Each line's points as data: y back out of the plot's pixels through the drawn range. */
  const values = (node: LineChart) => {
    const plot = plotOf(node).layoutBounds
    const [lo, hi] = lineChartDomains(node).y.range
    return partsIn(node, ChartLine).map((line) => line.points.map((p) => Math.round((p.y / plot.height + 0.5) * (hi - lo) + lo)))
  }

  it("plots each series at its own values apart", () => {
    expect(values(laid())).toEqual([[10, 14, 12], [4, 6, 9]])
  })

  it("sits each series on the sum of those before it when stacked, the scale reaching the top of the stack", () => {
    const node = laid({ stack: "stacked" })
    expect(values(node)).toEqual([[10, 14, 12], [14, 20, 21]])
    expect(lineChartDomains(node).y.range[0]).toBe(0)
    expect(lineChartDomains(node).y.range[1]).toBeGreaterThanOrEqual(21)
  })

  it("reads every row as shares of 100 in a percent stack, the axis captioned as percentages", () => {
    const node = laid({ stack: "percent" })
    const [first, second] = values(node)
    expect(second).toEqual([100, 100, 100])
    expect(first[0]).toBe(Math.round((10 / 14) * 100))
    expect(lineChartDomains(node).y.range).toEqual([0, 100])
    draw(node, BOX)
    expect(verticalMarkers(partsOf(node).vAxis).map((m) => m.text)).toEqual(["100%", "75%", "50%", "25%", "0%"])
  })

  it("fills each area down to the series below it in a stack, and to the baseline otherwise", () => {
    const stacked = partsIn(laid({ stack: "stacked", style: { area: "solid" } }), ChartArea)
    expect(stacked[0].base).toHaveLength(3)
    expect(stacked[1].base.map((p) => p.y)).toEqual(partsIn(laid({ stack: "stacked" }), ChartLine)[0].points.map((p) => p.y))
    expect(partsIn(laid({ style: { area: "solid" } }), ChartArea)[0].base).toEqual([])
  })

  it("keeps zero on the scale under an area, so it has a baseline to fill to", () => {
    const high = [{ month: "Jan", revenue: 180, cost: 170 }, { month: "Feb", revenue: 200, cost: 190 }]
    expect(lineChartDomains(laid({ data: high })).y.range[0]).toBeGreaterThan(0)
    expect(lineChartDomains(laid({ data: high, style: { area: "gradient" } })).y.range[0]).toBe(0)
  })

  it("sinks a hidden series into the one below it in a stack, the ones above settling", () => {
    const node = laid({ stack: "stacked" })
    const seek = scrub(node.hideSeries({ data: { seriesIndex: 0 }, duration: 1, easing: linear }))
    seek(0.5)
    expect(node.weights).toEqual([0.5, 1])
    layOut(node, BOX)
    expect(values(node)[1]).toEqual([9, 13, 15])
    expect(partsOf(node).lines[0].enabled).toBe(true)
    seek(1)
    expect(partsOf(node).lines[0].enabled).toBe(false)
    expect(partOf(node, ChartLegend)!.reveal).toEqual([0, 1])
  })
})

describe("LineChart: style", () => {
  it("declares one style entry in the chart family, with presets and the line's marks", () => {
    const style = registry.describe("lineChart")!.properties!.style as unknown as {
      kind: string
      family: string
      presets: Record<string, unknown>
      properties: Record<string, { group: string; default: unknown }>
    }
    expect(style.kind).toBe("style")
    expect(style.family).toBe("chart")
    expect(Object.keys(style.presets)).toContain("paper")
    expect(style.properties.curve).toMatchObject({ group: "marks", default: "smooth" })
    expect(style.properties.area).toMatchObject({ group: "marks", default: "none" })
    expect(style.properties.values).toMatchObject({ group: "labels", default: "none" })
    expect(style.properties.legend).toMatchObject({ group: "legend", default: "bottom" })
    expect(style.properties.barRadius).toBeUndefined()
  })

  it("has no theme or showLegend entry", () => {
    const props = registry.describe("lineChart")!.properties!
    expect(props.theme).toBeUndefined()
    expect(props.showLegend).toBeUndefined()
    expect(props.stack).toMatchObject({ kind: "enum", default: "none" })
  })

  it("tweens the stroke and the palette with to({ style })", () => {
    const node = chart()
    const seek = scrub(node.to({ data: { style: { strokeWidth: 8, palette: ["#000000", "#000000"] } }, duration: 1, easing: linear }))
    seek(0.5)
    const [line] = partsOf(node).lines
    expect(line.stroke[0].weight).toBeCloseTo(6)
    const [r] = (line.stroke[0].fill[0] as unknown as { color: number[] }).color
    expect(r).toBeGreaterThan(0)
    expect(r).toBeLessThan(0x4f / 255)
  })

  it("lays a partial style over the last, leaving the fields it does not name", () => {
    const node = chart({ style: { strokeWidth: 6 } })
    node.set({ style: { foreground: "#000000" } })
    expect(node.style.strokeWidth).toBe(6)
  })

  it("steps the curve at the middle of a tween", () => {
    const node = chart()
    const seek = scrub(node.to({ data: { style: { curve: "step" } }, duration: 1, easing: linear }))
    seek(0.4)
    expect(partsOf(node).lines[0].curve).toBe("smooth")
    seek(0.6)
    expect(partsOf(node).lines[0].curve).toBe("step")
  })

  it("puts the legend where the style says, or builds none", () => {
    expect(partOf(chart({ style: { legend: "none" } }), ChartLegend)).toBeUndefined()
    expect(partOf(chart({ style: { legend: "right" } }), ChartLegend)!.flow).toBe("vertical")
    const legendY = (legend: string) => {
      const node = chart({ style: { legend } })
      layOut(node, { width: 800, height: 400 })
      return partOf(node, ChartLegend)!.parent!.layoutBounds.y
    }
    expect(legendY("top")).toBeLessThan(legendY("bottom"))
  })

  it("leaves out an axis the style turns off, the plot taking its room", () => {
    const full = chart()
    const bare = chart({ style: { showXAxis: false, showYAxis: false } })
    layOut(full, { width: 800, height: 400 })
    layOut(bare, { width: 800, height: 400 })
    expect(partOf(bare, VerticalAxis)).toBeUndefined()
    expect(partOf(bare, HorizontalAxis)).toBeUndefined()
    expect(plotOf(bare).layoutBounds.width).toBeGreaterThan(plotOf(full).layoutBounds.width)
    expect(plotOf(bare).layoutBounds.height).toBeGreaterThan(plotOf(full).layoutBounds.height)
  })

  it("lines the row under the plot up with the plot", () => {
    const node = chart({ yAxis: { label: "Revenue" } })
    layOut(node, { width: 800, height: 400 })
    const plot = plotOf(node).layoutBounds
    const axis = (partsOf(node).hAxis as Node2D).layoutBounds
    expect(axis.width).toBeCloseTo(plot.width)
    expect(axis.x).toBeCloseTo(plot.x)
  })

  it("prints each point's value when asked", () => {
    const node = chart({ style: { values: "above" } })
    draw(node, { width: 800, height: 400 })
    expect(plotTexts(node)).toEqual(["10", "14", "12", "4", "6", "9"])
  })
})

describe("LineChart: categories on the x axis", () => {
  it("ticks every category when there are a dozen or fewer", () => {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"]
    const node = chart({ data: months.map((month, i) => ({ month, revenue: i, cost: i })) })
    draw(node, { width: 1200, height: 400 })
    expect(horizontalMarkers(partsOf(node).hAxis).map((m) => m.text)).toEqual(months)
  })
})

describe("LineChart: clipping", () => {
  it("clips the plot from a zoom's first frame until a reset lands, and not at rest", () => {
    const node = numeric()
    const clip = () => (plotOf(node) as unknown as { clip: boolean }).clip
    expect(clip()).toBe(false)
    land(run(node, "zoomTo", { region: { y: [12, 20] } }))
    expect(clip()).toBe(true)
    const reset = run(node, "resetZoom", {})
    reset.at(0.5)
    expect(clip()).toBe(true)
    reset.at(1)
    expect(clip()).toBe(false)
  })
})

/** Every caption the plot holds: the value labels. */
function plotTexts(node: LineChart): string[] {
  return (plotOf(node).children as Node2D[]).flatMap((n) => {
    const text = (n as unknown as { text?: unknown }).text
    return typeof text === "string" ? [text] : []
  })
}
