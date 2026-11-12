import { describe, expect, it } from "vitest"
import {
  Canvas2D,
  ContextMap,
  Registry,
  type CommandSpec,
  type CompositionDocument,
  type Node2D,
  type Size2D,
} from "@motionscript/sdk"
import { ManifestAssetCatalog, NullRenderContext, ClipTimeline, sampleTree } from "@motionscript/core"

import { ChartLegend } from "../kit/chart-legend"
import { SPOTLIGHT_DIM } from "../kit/shared"
import { NODES } from "../nodes"
import { RadarGrid } from "./radar-grid"
import { RadarSeries } from "./radar-series"

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

const RADAR = {
  data: [
    { skill: "Design", a: 80, b: 40 },
    { skill: "Motion", a: 60, b: 100 },
    { skill: "Code", a: 40, b: 20 },
  ],
  categoryField: "skill",
  series: [
    { field: "a", label: "Ana" },
    { field: "b", label: "Ben" },
  ],
}

function parts(chart: Node2D) {
  const frame = chart.children[chart.children.length - 1] as Node2D
  const plot = frame.children.find((c) => c.children.some((p) => p instanceof RadarGrid)) as Node2D
  return {
    grid: plot.children.find((c) => c instanceof RadarGrid) as RadarGrid,
    series: plot.children.filter((c) => c instanceof RadarSeries) as RadarSeries[],
    legend: frame.children.find((c) => c instanceof ChartLegend) as ChartLegend,
  }
}

describe("radarChart in a composition", () => {
  it("grows in under enter: held armed before it, partway at its middle, finished at its end", () => {
    const seek = play<Node2D>(clipDoc("radarChart", RADAR, [{ type: "enter", at: 1, duration: 1 } as never]))
    const before = parts(seek(0.5))
    expect(before.series.map((s) => s.progress)).toEqual([0, 0])
    const mid = parts(seek(1.6))
    expect(mid.grid.reveal).toBe(1)
    expect(mid.series[0].progress).toBeGreaterThan(0)
    expect(mid.series[0].progress).toBeLessThan(1)
    const end = parts(seek(2.5))
    expect(end.series.map((s) => s.progress)).toEqual([1, 1])
    expect(end.legend.opacity).toBe(1)
  })

  it("hides and spotlights a series by index", () => {
    const seek = play<Node2D>(
      clipDoc("radarChart", RADAR, [
        { type: "hideSeries", args: { seriesIndex: 1 } } as never,
        { type: "spotlightSeries", at: 2.5, args: { seriesIndex: 0 } } as never,
      ])
    )
    const mid = parts(seek(1.5))
    expect(mid.series[1].progress).toBeCloseTo(0.5, 0)
    expect(mid.series[0].progress).toBe(1)
    const hidden = parts(seek(2.2))
    expect(hidden.series[1].enabled).toBe(false)
    expect(hidden.legend.reveal).toEqual([1, 0])
    const lit = parts(seek(3.6))
    expect(lit.series[0].opacity).toBe(1)
    expect(lit.series[1].opacity).toBeCloseTo(SPOTLIGHT_DIM)
  })
})
