import { describe, expect, it } from "vitest"
import {
  Canvas2D,
  ContextMap,
  Registry,
  fillOps,
  type CommandSpec,
  type CompositionDocument,
  type Node2D,
  type Size2D,
} from "@motionscript/sdk"
import {
  ManifestAssetCatalog,
  NullRenderContext,
  ClipTimeline,
  sampleTree,
} from "@motionscript/core"

import { NODES } from "./nodes"
import { SPOTLIGHT_DIM } from "./kit/shared"
import { CategoryAxis, ChartBars, barChartDomain, type BarChart } from "./bar-chart"
import { ChartLegend } from "./kit/chart-legend"
import { ChartLine, lineChartDomains, type LineChart } from "./line-chart"
import { PieLegend, PieRing, pieArcs, resolvePieSlices, type PieChart } from "./pie-chart"
import { ringFills } from "./pie-chart/pie-ring"
import { cartesianOf, verticalMarkers } from "./tests/harness"

const STAGE = { width: 1280, height: 720 }

/** Gives text a size, so the axes and the legend lay out as they would in a host. */
class Measurer extends NullRenderContext {
  override measureText(...args: unknown[]): Size2D {
    const [text, fontSize] = args as [string, number]
    return { width: text.length * fontSize * 0.55, height: fontSize * 1.2 }
  }
}

type CommandRow = Omit<CommandSpec, "id" | "targetId" | "at" | "duration" | "args"> &
  Partial<Pick<CommandSpec, "at" | "duration" | "args">>

const ROOT = { id: "", type: "canvas2d", parentId: null, layerOrder: 0, props: {} }

/** One chart, present throughout, and `commands` on it — each at 1 s for 1 s, linear, unless it says otherwise. */
function clipDoc(type: string, props: Record<string, unknown>, commands: CommandRow[]): CompositionDocument {
  return {
    kind: "composition",
    nodes: [ROOT, { id: "chart", type, parentId: "", layerOrder: 0, props: { width: 760, height: 460, ...props } }],
    commands: commands.map((command, i) => ({
      id: `c${i}`,
      targetId: "chart",
      at: 1,
      duration: 1,
      args: {},
      easing: { kind: "linear" },
      ...command,
    })),
  } as CompositionDocument
}

/** Compiles `doc` the way a clip does, and returns a seek that evaluates, lays out and draws the frame at a time. */
function play<T>(doc: CompositionDocument) {
  const registry = new Registry({ nodes: NODES })
  const canvas = new Canvas2D({ id: "", ...STAGE, flow: "freeform" } as never)
  const timeline = new ClipTimeline(doc, registry, canvas)
  const assets = new ManifestAssetCatalog({ image: {}, video: {}, audio: {}, font: {} })
  const measurer = new Measurer()
  const attach = (time: number) => canvas.attach({ assets, context: ContextMap.EMPTY, time })
  const layout = () => canvas.layout({ x: 0, y: 0, ...STAGE }, measurer)
  attach(0)
  timeline.build()
  layout()
  timeline.compile(() => {
    sampleTree(canvas)
    layout()
  })
  return (time: number): T => {
    attach(time)
    timeline.syncPresence(time)
    timeline.evaluateAt(time)
    layout()
    const chart = timeline.liveNode("chart") as Node2D
    measurer.execute(() => chart.render(measurer))
    return chart as T
  }
}

const ROWS = [
  { month: "Jan", revenue: 10, cost: 4, share: 5 },
  { month: "Feb", revenue: 14, cost: 6, share: 3 },
  { month: "Mar", revenue: 12, cost: 9, share: 2 },
]

const LINE = {
  data: ROWS,
  xField: "month",
  series: [
    { field: "revenue", label: "Revenue" },
    { field: "cost", label: "Cost" },
  ],
}

/** What a line chart draws: a trace per series (0 when it is not drawn), each line's opacity, and the legend. */
/** A line chart's lines and legend, read off the frame it built. */
function lineParts(chart: LineChart) {
  const { axis, plot, below } = cartesianOf(chart)
  return {
    axis,
    lines: plot.children.filter((part) => part instanceof ChartLine) as ChartLine[],
    legend: (below.find((part) => part instanceof ChartLegend) ?? null) as ChartLegend | null,
  }
}

function lineFrame(chart: LineChart) {
  const { axis, lines, legend } = lineParts(chart)
  return {
    markers: verticalMarkers(axis).map((marker) => marker.opacity),
    traces: lines.map((line) => (line.enabled ? line.progress : 0)),
    opacities: lines.map((line) => line.opacity),
    legend: legend!.opacity,
    entries: [...legend!.reveal],
    yScale: lineChartDomains(chart).y.range,
  }
}

const BAR = {
  data: ROWS,
  categoryField: "month",
  series: [
    { field: "revenue", label: "Revenue" },
    { field: "cost", label: "Cost" },
  ],
}

/** A bar chart's columns, captions and legend, read off the frame it built. */
function barParts(chart: BarChart) {
  const { axis, plot, below } = cartesianOf(chart)
  return {
    axis,
    plot,
    barSets: plot.children.filter((part) => part instanceof ChartBars) as ChartBars[],
    cAxis: below.find((part) => part instanceof CategoryAxis) as CategoryAxis,
    legend: (below.find((part) => part instanceof ChartLegend) ?? null) as ChartLegend | null,
  }
}

function barFrame(chart: BarChart) {
  const { axis, barSets, legend } = barParts(chart)
  return {
    markers: verticalMarkers(axis).map((marker) => marker.opacity),
    growth: chart.growth,
    weights: [...chart.weights],
    drawn: barSets.map((bars) => bars.enabled),
    opacities: barSets.map((bars) => bars.opacity),
    legend: legend!.opacity,
    entries: [...legend!.reveal],
  }
}

function barFrame2(chart: BarChart) {
  return { growth: chart.growth }
}


function regionFrame(chart: LineChart) {
  return { region: chart.region, reveal: chart.regionReveal }
}

function categoryFrame(chart: BarChart) {
  return {
    spotlight: chart.spotlight,
    reveal: chart.spotlightReveal,
    dims: [...barParts(chart).cAxis.dims],
    axisDims: [...barParts(chart).cAxis.dims],
    barDims: [...barParts(chart).barSets[0].dims],
  }
}

const PIE = { data: ROWS, categoryField: "month", valueField: "share" }

/** A pie chart's ring and legend, read off the row it built: its last child. */
function pieParts(chart: PieChart) {
  const row = chart.children[chart.children.length - 1] as Node2D
  return {
    ring: row.children.find((part) => part instanceof PieRing) as PieRing,
    legend: (row.children.find((part) => part instanceof PieLegend) ?? null) as PieLegend | null,
  }
}

function pieFrame(chart: PieChart) {
  return {
    sweep: pieParts(chart).ring.growth,
    labels: pieParts(chart).ring.labelReveal,
    pops: [...chart.pops],
  }
}

describe("a line chart's commands, from a document", () => {
  it("enter holds its first frame from the chart's arrival, and lands it", () => {
    const seek = play<LineChart>(clipDoc("lineChart", LINE, [{ type: "enter" }]))

    expect(lineFrame(seek(0))).toMatchObject({ traces: [0, 0], legend: 0 })
    expect(lineFrame(seek(0.5))).toMatchObject({ traces: [0, 0], legend: 0 })
    expect(lineFrame(seek(0.5)).markers.every((o) => o === 0)).toBe(true)

    // Axes take the first 0.35, the lines the next 0.5, the legend the rest.
    const during = lineFrame(seek(1.5))
    expect(during.traces[0]).toBeCloseTo(0.3)
    expect(during.traces[1]).toBeCloseTo(0.3)
    expect(during.legend).toBe(0)

    const after = lineFrame(seek(2.5))
    expect(after).toMatchObject({ traces: [1, 1], legend: 1 })
    expect(after.markers.every((o) => o === 1)).toBe(true)
  })

  it("showSeries traces a hidden series in with its legend entry", () => {
    const seek = play<LineChart>(clipDoc(
      "lineChart",
      { ...LINE, series: [LINE.series[0], { ...LINE.series[1], enabled: false }] },
      [{ type: "showSeries", args: { seriesIndex: 1 } }],
    ))
    const during = lineFrame(seek(1.5))
    expect(during.traces[1]).toBeCloseTo(0.5)
    expect(during.entries[1]).toBeCloseTo(0.5)
    expect(lineFrame(seek(2.5))).toMatchObject({ traces: [1, 1], entries: [1, 1] })
  })

  it("hideSeries retraces a series out with its legend entry", () => {
    const seek = play<LineChart>(clipDoc("lineChart", LINE, [{ type: "hideSeries", args: { seriesIndex: 0 } }]))
    const during = lineFrame(seek(1.5))
    expect(during.traces[0]).toBeCloseTo(0.5)
    expect(during.entries[0]).toBeCloseTo(0.5)
    expect(lineFrame(seek(2.5))).toMatchObject({ traces: [0, 1], entries: [0, 1] })
  })

  it("spotlightSeries dims every other series", () => {
    const seek = play<LineChart>(clipDoc("lineChart", LINE, [{ type: "spotlightSeries", args: { seriesIndex: 0 } }]))
    expect(lineFrame(seek(1.5)).opacities[1]).toBeCloseTo((1 + SPOTLIGHT_DIM) / 2)
    const [lit, dimmed] = lineFrame(seek(2.5)).opacities
    expect(lit).toBe(1)
    expect(dimmed).toBeCloseTo(SPOTLIGHT_DIM)
  })

  it("holds for its whole slot when there is nothing to zoom or to reset", () => {
    const resting = lineFrame(play<LineChart>(clipDoc("lineChart", LINE, []))(0)).yScale
    const seek = play<LineChart>(clipDoc("lineChart", LINE, [
      { type: "zoomTo", args: { region: {} } },
      { type: "resetZoom", at: 2.5 },
    ]))
    for (const time of [0.5, 1.5, 2.5, 3, 4]) expect(lineFrame(seek(time)).yScale).toEqual(resting)
  })

  it("zooms from an auto axis without a cut, and back", () => {
    const seek = play<LineChart>(clipDoc("lineChart", LINE, [
      { type: "zoomTo", args: { region: { y: [10, 25] } } },
      { type: "resetZoom", at: 3 },
    ]))
    const [low, high] = lineFrame(seek(0.5)).yScale

    for (const t of [0.1, 0.25, 0.5, 0.75]) {
      const [lo, hi] = lineFrame(seek(1 + t)).yScale
      expect(lo).toBeCloseTo(low + (10 - low) * t)
      expect(hi).toBeCloseTo(high + (25 - high) * t)
    }
    expect(lineFrame(seek(2.5)).yScale).toEqual([10, 25])
    expect(lineFrame(seek(3.5)).yScale[1]).toBeCloseTo((25 + high) / 2)
    expect(lineFrame(seek(4.5)).yScale).toEqual([low, high])
  })

  it("spotlightRegion draws the call-out on from nothing", () => {
    const seek = play<LineChart>(clipDoc("lineChart", LINE, [
      { type: "spotlightRegion", args: { region: { x: [0, 1] } } },
    ]))
    expect(regionFrame(seek(0.5))).toEqual({ region: null, reveal: 0 })
    expect(regionFrame(seek(1.5))).toEqual({ region: { x: [0, 1] }, reveal: 0.5 })
    expect(regionFrame(seek(2.5))).toEqual({ region: { x: [0, 1] }, reveal: 1 })
    // A seek back below the command is the chart as authored.
    expect(regionFrame(seek(0.5))).toEqual({ region: null, reveal: 0 })
  })

  it("clearRegion retracts a call-out the chart was authored with, and lets go of it at the end", () => {
    const seek = play<LineChart>(clipDoc("lineChart", { ...LINE, region: { x: [0, 1] }, regionReveal: 1 }, [
      { type: "clearRegion" },
    ]))
    expect(regionFrame(seek(0.5))).toEqual({ region: { x: [0, 1] }, reveal: 1 })
    expect(regionFrame(seek(1.5))).toEqual({ region: { x: [0, 1] }, reveal: 0.5 })
    expect(regionFrame(seek(2.5))).toEqual({ region: null, reveal: 0 })
    expect(regionFrame(seek(0.5))).toEqual({ region: { x: [0, 1] }, reveal: 1 })
  })

  it("clearRegion retracts the region a spotlightRegion drew, which it is built on the end of", () => {
    const doc = clipDoc("lineChart", LINE, [
      { type: "spotlightRegion", args: { region: { y: [8, 12] } } },
      { type: "clearRegion", at: 3 },
    ])
    const seek = play<LineChart>(doc)
    expect(regionFrame(seek(2.5))).toEqual({ region: { y: [8, 12] }, reveal: 1 })
    expect(regionFrame(seek(3.5))).toEqual({ region: { y: [8, 12] }, reveal: 0.5 })
    expect(regionFrame(seek(4.5))).toEqual({ region: null, reveal: 0 })

    // Every frame is a function of its time, whichever way the playhead came.
    const times = [0.5, 1.5, 2.5, 3.5, 4.5]
    const forward = new Map(times.map((time) => [time, regionFrame(seek(time))]))
    const scrubbed = play<LineChart>(doc)
    for (const time of [4.5, 1.5, 3.5, 0.5, 2.5, 1.5]) {
      expect(regionFrame(scrubbed(time)), `t = ${time}`).toEqual(forward.get(time))
    }
  })

  it("spotlightRegion cross-fades from the region already up to the next", () => {
    const seek = play<LineChart>(clipDoc("lineChart", LINE, [
      { type: "spotlightRegion", args: { region: { x: [0, 1] } } },
      { type: "spotlightRegion", args: { region: { y: [8, 12] } }, at: 3 },
    ]))
    // The old region retracts over the first half, the new one draws on over the second.
    expect(regionFrame(seek(3.25))).toEqual({ region: { x: [0, 1] }, reveal: 0.5 })
    expect(regionFrame(seek(4))).toEqual({ region: { y: [8, 12] }, reveal: 1 })
  })

  it("spotlightRegion and clearRegion hold their slots when there is nothing to draw or to clear", () => {
    const seek = play<LineChart>(clipDoc("lineChart", LINE, [
      { type: "spotlightRegion", args: { region: {} } },
      { type: "clearRegion", at: 2.5 },
    ]))
    for (const time of [0.5, 1.5, 2.5, 3.5, 4.5]) expect(regionFrame(seek(time)), `t = ${time}`).toEqual({ region: null, reveal: 0 })
  })
})

describe("a bar chart's commands, from a document", () => {
  it("enter holds its first frame from the chart's arrival, and raises the columns", () => {
    const seek = play<BarChart>(clipDoc("barChart", BAR, [{ type: "enter" }]))

    expect(barFrame(seek(0.5))).toMatchObject({ growth: 0, legend: 0 })
    expect(barFrame(seek(0.5)).markers.every((o) => o === 0)).toBe(true)

    const during = barFrame(seek(1.5))
    expect(during.growth).toBeCloseTo(0.3)
    expect(during.legend).toBe(0)

    const after = barFrame(seek(2.5))
    expect(after).toMatchObject({ growth: 1, legend: 1 })
    expect(after.markers.every((o) => o === 1)).toBe(true)
  })

  it("showSeries widens a hidden series back into the group", () => {
    const seek = play<BarChart>(clipDoc(
      "barChart",
      { ...BAR, series: [BAR.series[0], { ...BAR.series[1], enabled: false }] },
      [{ type: "showSeries", args: { seriesIndex: 1 } }],
    ))
    expect(barFrame(seek(0.5)).weights).toEqual([1, 0])
    const during = barFrame(seek(1.5))
    expect(during.weights[1]).toBeCloseTo(0.5)
    expect(during.entries[1]).toBeCloseTo(0.5)
    expect(barFrame(seek(2.5))).toMatchObject({ weights: [1, 1], drawn: [true, true], entries: [1, 1] })
  })

  it("hideSeries narrows a series out of the group", () => {
    const seek = play<BarChart>(clipDoc("barChart", BAR, [{ type: "hideSeries", args: { seriesIndex: 0 } }]))
    expect(barFrame(seek(0.5)).weights).toEqual([1, 1])
    const during = barFrame(seek(1.5))
    expect(during.weights[0]).toBeCloseTo(0.5)
    expect(during.drawn[0]).toBe(true)
    expect(barFrame(seek(2.5))).toMatchObject({ weights: [0, 1], drawn: [false, true], entries: [0, 1] })
  })

  it("spotlightSeries dims every other series", () => {
    const seek = play<BarChart>(clipDoc("barChart", BAR, [{ type: "spotlightSeries", args: { seriesIndex: 0 } }]))
    expect(barFrame(seek(1.5)).opacities[1]).toBeCloseTo((1 + SPOTLIGHT_DIM) / 2)
    const [lit, dimmed] = barFrame(seek(2.5)).opacities
    expect(lit).toBe(1)
    expect(dimmed).toBeCloseTo(SPOTLIGHT_DIM)
  })

  it("spotlightCategory dims every other category toward the theme's dim", () => {
    const seek = play<BarChart>(clipDoc("barChart", BAR, [{ type: "spotlightCategory", args: { categoryIndex: 1 } }]))
    expect(categoryFrame(seek(0.5))).toMatchObject({ spotlight: null, reveal: 0, dims: [1, 1, 1] })

    const during = categoryFrame(seek(1.5))
    expect(during).toMatchObject({ spotlight: 1, reveal: 0.5 })
    expect(during.dims[0]).toBeCloseTo((1 + SPOTLIGHT_DIM) / 2)
    expect(during.dims[1]).toBe(1)
    expect(during.dims[2]).toBeCloseTo((1 + SPOTLIGHT_DIM) / 2)

    const after = categoryFrame(seek(2.5))
    expect(after).toMatchObject({ spotlight: 1, reveal: 1 })
    expect(after.dims[0]).toBeCloseTo(SPOTLIGHT_DIM)
    expect(after.dims[1]).toBe(1)
    // The dimming reaches the captions and the columns both.
    expect(after.axisDims).toEqual(after.dims)
    expect(after.barDims).toEqual(after.dims)

    // A seek back below the command is the chart as authored.
    expect(categoryFrame(seek(0.5))).toMatchObject({ spotlight: null, reveal: 0, dims: [1, 1, 1] })
  })

  it("clearCategory fades the spotlight a spotlightCategory raised, and lets go of the category at the end", () => {
    const doc = clipDoc("barChart", BAR, [
      { type: "spotlightCategory", args: { categoryIndex: 2 } },
      { type: "clearCategory", at: 3 },
    ])
    const seek = play<BarChart>(doc)
    expect(categoryFrame(seek(2.5))).toMatchObject({ spotlight: 2, reveal: 1 })
    // Built on the spotlight's end: it fades from fully lit, and the category stays until the fade lands.
    expect(categoryFrame(seek(3.5))).toMatchObject({ spotlight: 2, reveal: 0.5 })
    expect(categoryFrame(seek(4.5))).toMatchObject({ spotlight: null, reveal: 0, dims: [1, 1, 1] })

    const times = [0.5, 1.5, 2.5, 3.5, 4.5]
    const forward = new Map(times.map((time) => [time, categoryFrame(seek(time))]))
    const scrubbed = play<BarChart>(doc)
    for (const time of [4.5, 1.5, 3.5, 0.5, 2.5, 1.5]) {
      expect(categoryFrame(scrubbed(time)), `t = ${time}`).toEqual(forward.get(time))
    }
  })

  it("spotlightCategory moves the focus to another category without retracting first", () => {
    const seek = play<BarChart>(clipDoc("barChart", BAR, [
      { type: "spotlightCategory", args: { categoryIndex: 0 } },
      { type: "spotlightCategory", args: { categoryIndex: 2 }, at: 3 },
    ]))
    expect(categoryFrame(seek(2.5))).toMatchObject({ spotlight: 0, reveal: 1 })
    expect(categoryFrame(seek(3.5))).toMatchObject({ spotlight: 2, reveal: 1 })
  })

  it("spotlightCategory and clearCategory hold their slots for a category that is not there or a spotlight that is not up", () => {
    const seek = play<BarChart>(clipDoc("barChart", BAR, [
      { type: "spotlightCategory", args: { categoryIndex: 9 } },
      { type: "clearCategory", at: 2.5 },
    ]))
    for (const time of [0.5, 1.5, 2.5, 3.5, 4.5]) {
      expect(categoryFrame(seek(time)), `t = ${time}`).toMatchObject({ spotlight: null, reveal: 0, dims: [1, 1, 1] })
    }
  })
})

describe("an entrance without its legend or its series", () => {
  const enter = [{ type: "enter" }]

  it("keeps the legend beat's share, so the bar columns and the call-out land where they were laid out", () => {
    // 0.35 axes, 0.5 columns, 0.15 legend: the columns are done at 0.85 of the slot
    // whether or not there is a legend to follow them.
    const bare = play<BarChart>(clipDoc("barChart", { ...BAR, showLegend: false }, enter))
    expect(barFrame2(bare(1.425)).growth).toBeCloseTo(0.15)
    expect(barFrame2(bare(1.85)).growth).toBeCloseTo(1)
  })

  it("lands the line chart's call-out in the last quarter of the slot", () => {
    const seek = play<LineChart>(clipDoc("lineChart", { ...LINE, showLegend: false, region: { x: [0, 1] }, regionReveal: 0 }, enter))
    // Axes, lines and the (absent) legend share the first 0.75; only then does the call-out draw on.
    expect(seek(1.7).regionReveal).toBe(0)
    expect(seek(1.875).regionReveal).toBeCloseTo(0.5)
    expect(seek(2).regionReveal).toBeCloseTo(1)
  })

  it("holds the lines' beat for a chart with no series", () => {
    const seek = play<LineChart>(clipDoc("lineChart", { ...LINE, series: [] }, enter))
    // The legend rises over the last 0.15, not straight after the axes.
    expect(lineParts(seek(1.5)).legend?.opacity).toBe(0)
    expect(lineParts(seek(1.925)).legend?.opacity).toBeCloseTo(0.5)
  })
})

describe("an axis range tweened from auto", () => {
  it("moves continuously from the resolved scale (line chart)", () => {
    const seek = play<LineChart>(clipDoc("lineChart", LINE, [{ type: "to", args: { yAxis: { range: [0, 40] } } }]))
    const yScale = (chart: LineChart) => lineChartDomains(chart).y.range
    const [low, high] = yScale(seek(0.5))
    for (const t of [0.1, 0.3, 0.45, 0.6, 0.9]) {
      const [lo, hi] = yScale(seek(1 + t))
      expect(lo).toBeCloseTo(low + (0 - low) * t)
      expect(hi).toBeCloseTo(high + (40 - high) * t)
    }
    expect(yScale(seek(2.5))).toEqual([0, 40])
  })

  it("moves continuously from the resolved scale (bar chart)", () => {
    const seek = play<BarChart>(clipDoc("barChart", BAR, [{ type: "to", args: { valueAxis: { range: [0, 40] } } }]))
    const valueScale = (chart: BarChart) => barChartDomain(chart).range
    const [low, high] = valueScale(seek(0.5))
    for (const t of [0.1, 0.3, 0.45, 0.6, 0.9]) {
      const [lo, hi] = valueScale(seek(1 + t))
      expect(lo).toBeCloseTo(low + (0 - low) * t)
      expect(hi).toBeCloseTo(high + (40 - high) * t)
    }
    expect(valueScale(seek(2.5))).toEqual([0, 40])
  })
})

describe("a bar chart's plot", () => {
  it("maps the columns across the plot panel as laid out, so a column end sits on its grid line", () => {
    for (const props of [{}, { valueAxis: { label: "Revenue" }, categoryAxis: { label: "Month" } }, { showLegend: false }]) {
      const chart = play<BarChart>(clipDoc("barChart", { ...BAR, ...props }, []))(0)
      const { plot, barSets } = barParts(chart)
      const panel = plot.layoutBounds
      expect(panel.height).toBeGreaterThan(0)
      const [min, max] = barChartDomain(chart).range
      // A column of the scale's top value ends on the panel's top edge; the baseline, at its floor.
      const columns = barSets[0].bars
      expect(barSets[0].baseline).toBeCloseTo(min <= 0 ? ((0 - min) / (max - min) - 0.5) * panel.height : -panel.height / 2)
      const top = Math.max(...ROWS.map((row) => row.revenue))
      expect(columns[ROWS.findIndex((row) => row.revenue === top)].to).toBeCloseTo(((top - min) / (max - min) - 0.5) * panel.height)
      // The slots tile the panel's width.
      const slot = panel.width / ROWS.length
      columns.forEach((column, i) => expect(Math.abs(column.x - (-panel.width / 2 + slot * (i + 0.5)))).toBeLessThan(slot / 2))
    }
  })
})

describe("a pie chart's commands, from a document", () => {
  it("enter holds its first frame from the chart's arrival, and sweeps it in", () => {
    const seek = play<PieChart>(clipDoc("pieChart", PIE, [{ type: "enter" }]))
    expect(pieFrame(seek(0.5))).toMatchObject({ sweep: 0, labels: 0 })

    // The wedges sweep over the first 0.65, the labels follow.
    const during = pieFrame(seek(1.5))
    expect(during.sweep).toBeCloseTo(0.5 / 0.65)
    expect(during.labels).toBe(0)

    expect(pieFrame(seek(2.5))).toMatchObject({ sweep: 1, labels: 1 })
  })

  it("selectSlice grows a slice out", () => {
    const seek = play<PieChart>(clipDoc("pieChart", PIE, [{ type: "selectSlice", args: { sliceIndex: 1 } }]))
    expect(pieFrame(seek(0.5)).pops).toEqual([0, 0, 0])
    expect(pieFrame(seek(1.5)).pops[1]).toBeCloseTo(0.5)
    expect(pieFrame(seek(2.5)).pops).toEqual([0, 1, 0])
  })

  it.each([
    ["deselectSlice", { sliceIndex: 1 }, [0, 0.5, 0], [0, 0, 0]],
    ["selectOnlySlice", { sliceIndex: 2 }, [0, 0.5, 0.5], [0, 0, 1]],
    ["clearSelection", {}, [0, 0.5, 0], [0, 0, 0]],
  ])("%s moves the slices a selectSlice grew out", (type, args, during, after) => {
    const doc = clipDoc("pieChart", PIE, [
      { type: "selectSlice", args: { sliceIndex: 1 }, at: 0.5, duration: 0.5 },
      { type, args, at: 2 },
    ])
    const seek = play<PieChart>(doc)
    expect(pieFrame(seek(0.25)).pops).toEqual([0, 0, 0])
    expect(pieFrame(seek(1.5)).pops).toEqual([0, 1, 0])
    pieFrame(seek(2.5)).pops.forEach((pop, i) => expect(pop).toBeCloseTo(during[i]))
    expect(pieFrame(seek(3.5)).pops).toEqual(after)

    // The selection is the chart's own state, so a frame is the same whichever way the playhead came.
    const times = [0.25, 0.75, 1.5, 2.5, 3.5]
    const forward = new Map(times.map((time) => [time, pieFrame(seek(time)).pops]))
    const scrubbed = play<PieChart>(doc)
    for (const time of [3.5, 0.75, 2.5, 0.25, 1.5, 0.75]) {
      expect(pieFrame(scrubbed(time)).pops, `t = ${time}`).toEqual(forward.get(time))
    }
  })
})

describe("a pie chart's ring and legend", () => {
  it("follow the chart's rows and palette once they are set", () => {
    const chart = play<PieChart>(clipDoc("pieChart", PIE, []))(0)
    chart.set({ data: [{ month: "Q1", share: 7 }, { month: "Q2", share: 1 }, { month: "Q3", share: 2 }] })

    const { ring, legend } = pieParts(chart)
    const slices = () => resolvePieSlices(chart.data, chart.categoryField, chart.valueField, chart.theme.sliceFills)
    expect(ring.slices).toEqual(slices())
    expect(legend!.slices).toEqual(slices())
    expect(ring.slices.map((slice) => slice.category)).toEqual(["Q1", "Q2", "Q3"])
    // The wedges are cut from the live values: Q1 is 70% of the ring.
    expect(pieArcs(ring.slices, ring.ring.startAngle)[0].fraction).toBeCloseTo(0.7)

    // A palette tween reaches the wedges and the swatches.
    chart.set({ theme: { sliceFills: ["#ff0000", "#00ff00", "#0000ff"] } })
    expect(ringFills(ring.slices)).toEqual(["#ff0000", "#00ff00", "#0000ff"].map((color) => fillOps.resolve(color)))
    expect(ring.slices).toEqual(slices())
  })
})

describe("a part a chart command writes, before the command starts", () => {
  // A part the chart built is no document row; the timeline baselines the slots a
  // command writes on one, so before the command starts and after a seek back the
  // part holds what it was built with, not the command's end.
  it("draws each series as the props describe it", () => {
    const hidden = play<LineChart>(clipDoc("lineChart", LINE, [{ type: "hideSeries", args: { seriesIndex: 0 } }]))
    expect(lineFrame(hidden(0.5))).toMatchObject({ traces: [1, 1], entries: [1, 1] })

    const lit = play<LineChart>(clipDoc("lineChart", LINE, [{ type: "spotlightSeries", args: { seriesIndex: 0 } }]))
    expect(lineFrame(lit(0.5)).opacities).toEqual([1, 1])

    // An entrance holds its first frame instead, so a seek back lands there, not on its end.
    const entering = play<LineChart>(clipDoc("lineChart", LINE, [{ type: "enter" }]))
    entering(2.5)
    expect(lineFrame(entering(0.5))).toMatchObject({ traces: [0, 0], legend: 0 })

    const narrowed = play<BarChart>(clipDoc("barChart", BAR, [{ type: "hideSeries", args: { seriesIndex: 0 } }]))
    expect(barFrame(narrowed(0.5))).toMatchObject({ drawn: [true, true], entries: [1, 1] })
  })

  it("keeps a pie's hole clear until revealCenter, and clears it again on a seek back", () => {
    const seek = play<PieChart>(
      clipDoc("pieChart", { ...PIE, showCenter: false }, [{ type: "revealCenter", at: 1, duration: 0.6 }])
    )
    const center = (time: number) => pieParts(seek(time)).ring.centerReveal
    expect(center(0)).toBe(0)
    expect(center(0.5)).toBe(0)
    expect(center(1.3)).toBeCloseTo(0.5)
    expect(center(2)).toBe(1)
    expect(center(0.5)).toBe(0)
  })
})
