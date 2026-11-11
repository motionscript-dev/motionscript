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
import { horizontalMarkers, verticalMarkers } from "../tests/harness"
import { ChartLine } from "./chart-line"
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

  it("declares showLegend, so a host can read it back", () => {
    const props = registry.describe("lineChart")!.properties!
    expect(props.showLegend).toMatchObject({ kind: "boolean", default: true })
    expect(chart({ showLegend: false }).showLegend).toBe(false)
    expect(run(chart({ showLegend: false }), "showSeries", { seriesIndex: 0 }).duration).toBe(1)
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
  const frame = node.children[node.children.length - 1] as Node2D
  const [top, bottom] = frame.children as Node2D[]
  const [vAxis, plot] = top.children as Node2D[]
  const [hAxis, legend] = (bottom.children[1] as Node2D).children as Node2D[]
  return {
    vAxis,
    hAxis,
    lines: (plot.children as Node2D[]).filter((part) => part instanceof ChartLine) as ChartLine[],
    legend: legend instanceof ChartLegend ? legend : null,
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
    const node = chart({ showLegend: false })
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
