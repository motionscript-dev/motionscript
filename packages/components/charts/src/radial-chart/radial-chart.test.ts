import { describe, expect, it } from "vitest"
import {
  Canvas2D,
  ContextMap,
  Registry,
  fillOps,
  type CommandSpec,
  type CompositionDocument,
  type Node2D,
  type PathCommand,
  type Size2D,
} from "@motionscript/sdk"
import { ManifestAssetCatalog, NullRenderContext, ClipTimeline, sampleTree } from "@motionscript/core"

import { NODES } from "../nodes"
import { PieLegend } from "../kit/pie-legend"
import { PIE_SPOTLIGHT_DIM } from "../kit/polar"
import { attachAt, draw, layOut, scrub } from "../tests/harness"
import { RadialChart } from "./radial-chart"
import { RadialGeometry, RadialRings, bandPath } from "./radial-rings"
import { radialFractions, radialMax, resolveRadialRows, type RadialRow } from "./shared"

type Row = Node2D & { flow: string; fill: never }
const BOX = { width: 600, height: 600 }
const linear = (t: number) => t
const ROWS = [
  { m: "A", v: 80 },
  { m: "B", v: 40 },
  { m: "C", v: 20 },
]

const rows = (values: number[]): RadialRow[] => values.map((value, i) => ({ category: `R${i}`, value, fill: "red" }))

function chart(props: Record<string, unknown> = {}): RadialChart {
  const node = attachAt(new RadialChart({ ...BOX, data: ROWS, categoryField: "m", valueField: "v", ...props } as never))
  layOut(node, BOX)
  return node
}

function partsOf(node: RadialChart) {
  const row = node.children[node.children.length - 1] as Row
  return {
    row,
    rings: row.children.find((part) => part instanceof RadialRings) as RadialRings,
    legend: (row.children.find((part) => part instanceof PieLegend) ?? null) as PieLegend | null,
  }
}

const marks = { innerRadius: 0.3, ringGap: 8, sweep: 360, startAngle: 0, track: true, roundCaps: true }

function rings(props: Record<string, unknown> = {}, box = BOX): RadialRings {
  const node = new RadialRings({ ...box, rows: rows([80, 40, 20]), marks, ...props } as never)
  layOut(node, box)
  return node
}

const geometry = (node: RadialRings, box = BOX) => new RadialGeometry(node as never, box)

describe("radial maths", () => {
  it("resolves one row per record, painted from the palette by row", () => {
    const resolved = resolveRadialRows(ROWS, "m", "v", { seriesFills: ["#111", "#222"] as never })
    expect(resolved.map((row) => row.category)).toEqual(["A", "B", "C"])
    expect(resolved.map((row) => row.value)).toEqual([80, 40, 20])
    expect(resolved.map((row) => row.fill)).toEqual(["#111", "#222", "#111"])
  })

  it("takes the largest value as a full sweep unless max says otherwise", () => {
    expect(radialMax(rows([80, 40]), 0)).toBe(80)
    expect(radialMax(rows([80, 40]), 200)).toBe(200)
    expect(radialMax(rows([80, 40]), -5)).toBe(80)
    expect(radialMax(rows([0, 0]), 0)).toBe(1)
    expect(radialFractions(rows([80, 40, 20]), 0)).toEqual([1, 0.5, 0.25])
    expect(radialFractions(rows([80, 40]), 160)).toEqual([0.5, 0.25])
  })

  it("clamps what a row overshoots, and reads a negative or missing value as nothing", () => {
    expect(radialFractions(rows([300, -2, NaN]), 100)).toEqual([1, 0, 0])
  })
})

describe("RadialRings: geometry", () => {
  it("fits the radius to the smaller side, less a margin", () => {
    expect(geometry(rings()).outerRadius).toBe(296)
    expect(geometry(rings({ ...BOX, width: 900, height: 400 }), { width: 900, height: 400 }).outerRadius).toBe(196)
  })

  it("starts the innermost ring at innerRadius of the outer radius", () => {
    const g = geometry(rings())
    expect(g.holeRadius).toBeCloseTo(0.3 * 296)
    const last = g.count - 1
    expect(g.ringOuter(last) - g.thickness).toBeCloseTo(g.holeRadius)
  })

  it("stacks the rings from the outside in, a gap apart", () => {
    const g = geometry(rings())
    expect(g.ringOuter(0)).toBe(296)
    expect(g.ringOuter(0) - g.thickness - 8).toBeCloseTo(g.ringOuter(1))
    expect(g.ringOuter(1) - g.thickness - 8).toBeCloseTo(g.ringOuter(2))
  })

  it("thins the rings as the gap and the hole grow, never below nothing", () => {
    const wide = geometry(rings({ marks: { ...marks, ringGap: 8 } })).thickness
    expect(geometry(rings({ marks: { ...marks, ringGap: 30 } })).thickness).toBeLessThan(wide)
    expect(geometry(rings({ marks: { ...marks, ringGap: 9000 } })).thickness).toBe(0)
    expect(geometry(rings({ rows: [] })).thickness).toBe(0)
  })

  it("turns startAngle and sweep to radians, sweep held to a full turn", () => {
    const g = geometry(rings({ marks: { ...marks, startAngle: 90, sweep: 270 } }))
    expect(g.startRad).toBeCloseTo(Math.PI / 2)
    expect(g.sweepRad).toBeCloseTo((Math.PI * 3) / 2)
    expect(geometry(rings({ marks: { ...marks, sweep: 900 } })).sweepRad).toBeCloseTo(Math.PI * 2)
  })

  it("staggers the rings' entrance, outer first, and lands every ring at the end", () => {
    const g = geometry(rings())
    expect(g.progress(0, 0)).toBe(0)
    expect(g.progress(0, 0.3)).toBeGreaterThan(g.progress(1, 0.3))
    expect(g.progress(1, 0.3)).toBeGreaterThan(g.progress(2, 0.3))
    for (let i = 0; i < 3; i++) expect(g.progress(i, 1)).toBe(1)
  })

  it("dims the rest once a ring is selected", () => {
    const g = geometry(rings({ pops: [0, 1, 0], dimOpacity: 0.3 }))
    expect(g.ringOpacity(1)).toBe(1)
    expect(g.ringOpacity(0)).toBeCloseTo(0.3)
    expect(geometry(rings()).ringOpacity(0)).toBe(1)
  })

  it("pins a ring's caption just behind its start, which at 12 o'clock is the left", () => {
    const g = geometry(rings())
    const { at, side } = g.labelAnchor(0)
    expect(side).toBe(-1)
    expect(at.x).toBeLessThan(0)
    expect(at.y).toBeCloseTo(g.ringMid(0))
    // Starting at 6 o'clock the way back is to the right.
    expect(geometry(rings({ marks: { ...marks, startAngle: 180 } })).labelAnchor(0).side).toBe(1)
  })

  it("fits the centre text into the hole", () => {
    const g = geometry(rings({ centerLabel: "A long conclusion" }))
    expect(g.centerFont).toBeLessThan(50)
    expect(g.centerFont * 17 * 0.62).toBeLessThanOrEqual(g.holeRadius * 2 * 0.78 + 1e-6)
  })
})

describe("bandPath", () => {
  it("closes a ring band with a move, lines and a close", () => {
    const commands = bandPath(0, Math.PI, 50, 100, false).toCommands()
    expect(commands[0].type).toBe("M")
    expect(commands[commands.length - 1].type).toBe("Z")
    for (const command of commands.slice(1, -1)) expect(command.type).toBe("L")
  })

  it("keeps every point of a square band between its radii", () => {
    for (const command of bandPath(0.2, 2, 50, 100, false).toCommands()) {
      if (command.type === "Z") continue
      const { x, y } = command as { x: number; y: number }
      const r = Math.hypot(x, y)
      expect(r).toBeGreaterThanOrEqual(50 - 1e-6)
      expect(r).toBeLessThanOrEqual(100 + 1e-6)
    }
  })

  it("rounds the ends with half circles that stay inside the band's reach", () => {
    const square = bandPath(0, Math.PI, 50, 100, false).toCommands().length
    const round = bandPath(0, Math.PI, 50, 100, true).toCommands()
    expect(round.length).toBeGreaterThan(square)
    // The tip of the end cap reaches past the start by the cap radius at most: x of the start tip is the band's mid radius minus nothing, y is 0.
    const xs = round.flatMap((c: PathCommand) => (c.type === "Z" ? [] : [(c as { x: number }).x]))
    expect(Math.max(...xs)).toBeLessThanOrEqual(100 + 1e-6)
  })

  it("draws a band shorter than its caps as a pill rather than failing", () => {
    const commands = bandPath(0, 0.001, 50, 100, true).toCommands()
    for (const command of commands) if (command.type !== "Z") expect(Number.isFinite((command as { x: number }).x)).toBe(true)
  })
})

describe("RadialRings: drawing", () => {
  const paths = (node: RadialRings) => draw(node, BOX).drawn.length

  it("draws a track and an arc per ring, or only arcs without tracks", () => {
    expect(paths(rings())).toBe(6)
    expect(paths(rings({ marks: { ...marks, track: false } }))).toBe(3)
  })

  it("skips an arc with nothing in it, and every arc at the start of the entrance", () => {
    expect(paths(rings({ rows: rows([80, 0, -4]), marks: { ...marks, track: false } }))).toBe(1)
    expect(paths(rings({ growth: 0, marks: { ...marks, track: false } }))).toBe(0)
  })

  it("builds a caption per row and the centre block only with text", () => {
    expect(rings().children).toHaveLength(3)
    expect(rings({ centerLabel: "925" }).children).toHaveLength(4)
  })

  it("hides the captions unless ringLabels, and fades them with their ring", () => {
    expect(rings({ ringLabels: false }).children.map((c) => c.opacity)).toEqual([0, 0, 0])
    expect(rings({ ringLabels: true }).children.map((c) => c.opacity)).toEqual([1, 1, 1])
    expect(rings({ ringLabels: true, labelReveal: 0.5 }).children[0].opacity).toBe(0.5)
  })
})

describe("RadialChart: parts and style", () => {
  it("starts with no ring selected, one pop per row", () => {
    expect(chart().pops).toEqual([0, 0, 0])
    expect(chart({ data: [...ROWS, { m: "D", v: 1 }] }).pops).toEqual([0, 0, 0, 0])
  })

  it("paints the rings from the style's palette", () => {
    const node = chart({ style: { seriesFills: ["#ff0000", "#00ff00"] } })
    const { rings: part, legend } = partsOf(node)
    expect(part.rows.map((row) => row.category)).toEqual(["A", "B", "C"])
    expect(part.rows.map((row) => fillOps.resolve(row.fill))).toEqual(["#ff0000", "#00ff00", "#ff0000"].map((c) => fillOps.resolve(c)))
    expect(legend!.slices).toEqual(part.rows)
  })

  it("hands the marks to the rings", () => {
    const part = partsOf(chart({ style: { sweep: 270, startAngle: 45, ringGap: 3, roundCaps: false, track: [], innerRadius: 0.5 } })).rings
    expect(part.marks).toEqual({ innerRadius: 0.5, ringGap: 3, sweep: 270, startAngle: 45, track: false, roundCaps: false })
  })

  it("follows a style change after build, since the parts read it live", () => {
    const node = chart()
    node.set({ style: { sweep: 180, ringLabels: true, track: "#123456" } } as never)
    const part = partsOf(node).rings
    expect(part.marks.sweep).toBe(180)
    expect(part.ringLabels).toBe(true)
    expect(fillOps.resolve(part.trackFill)).toEqual(fillOps.resolve("#123456"))
  })

  it("passes max and the centre text on", () => {
    const part = partsOf(chart({ max: 200, centerLabel: "7", centerCaption: "total" })).rings
    expect(part.max).toBe(200)
    expect(part.centerLabel).toBe("7")
    expect(part.centerCaption).toBe("total")
  })

  it("places the legend by style.legend", () => {
    const at = (legend: string) => partsOf(chart({ style: { legend } }))
    const right = at("right")
    expect(right.row.flow).toBe("horizontal")
    expect(right.row.children[1]).toBe(right.legend)
    expect(right.legend!.flow).toBe("vertical")

    const bottom = at("bottom")
    expect(bottom.row.flow).toBe("vertical")
    expect(bottom.row.children[1]).toBe(bottom.legend)
    expect(bottom.legend!.flow).toBe("horizontal")

    const top = at("top")
    expect(top.row.children[0]).toBe(top.legend)

    const none = at("none")
    expect(none.legend).toBeNull()
    expect(none.row.children).toHaveLength(1)
  })

  it("draws the background behind the chart", () => {
    const node = chart({ style: { background: "#fafaf9" } })
    expect(fillOps.resolve(partsOf(node).row.fill)).toEqual(fillOps.resolve("#fafaf9"))
  })

  it("dims the legend entries of the rings left behind", () => {
    const node = chart()
    node.set({ pops: [0, 1, 0] } as never)
    const dims = partsOf(node).legend!.dims
    expect(dims[1]).toBe(1)
    expect(dims[0]).toBeLessThan(1)
    expect(dims[0]).toBeGreaterThanOrEqual(PIE_SPOTLIGHT_DIM)
  })
})

describe("RadialChart: commands", () => {
  it("selectRing grows one ring, and selects more without clearing the first", () => {
    const node = chart()
    scrub(node.selectRing({ data: { ringIndex: 1 }, duration: 1, easing: linear }))(0.5)
    expect(node.pops[1]).toBeCloseTo(0.5)
    scrub(node.selectRing({ data: { ringIndex: 1 }, duration: 1, easing: linear }))(1)
    expect(node.pops).toEqual([0, 1, 0])
    scrub(node.selectRing({ data: { ringIndex: 2 }, duration: 1, easing: linear }))(1)
    expect(node.pops).toEqual([0, 1, 1])
  })

  it("clearSelection settles every ring", () => {
    const node = chart({ pops: [0, 1, 0.5] })
    scrub(node.clearSelection({ duration: 1, easing: linear }))(0.5)
    expect(node.pops[1]).toBeCloseTo(0.5)
    scrub(node.clearSelection({ duration: 1, easing: linear }))(1)
    expect(node.pops).toEqual([0, 0, 0])
  })

  it("takes its slot even when it changes nothing", () => {
    expect(chart().clearSelection({ duration: 2 }).duration).toBe(2)
  })

  it("enter takes exactly its duration, with or without a legend", () => {
    expect(chart().enter({ duration: 2 }).duration).toBe(2)
    expect(chart({ style: { legend: "none" } }).enter({ duration: 2 }).duration).toBe(2)
  })

  it("enter arms the rings, then sweeps and reveals them", () => {
    const node = chart()
    const seek = scrub(node.enter({ duration: 2, easing: linear }))
    const part = () => partsOf(node).rings
    seek(0)
    expect(part().growth).toBe(0)
    expect(part().labelReveal).toBe(0)
    seek(0.7)
    expect(part().growth).toBeCloseTo(0.7 / 1.4)
    expect(part().labelReveal).toBe(0)
    seek(2)
    expect(part().growth).toBe(1)
    expect(part().labelReveal).toBe(1)
    partsOf(node).legend!.children.forEach((wrapper) => expect(wrapper.children[0].opacity).toBeCloseTo(1, 10))
  })

  it("revealCenter fades a held-back summary up", () => {
    const node = chart({ showCenter: false, centerLabel: "1" })
    expect(partsOf(node).rings.centerReveal).toBe(0)
    const seek = scrub(node.revealCenter({ duration: 1, easing: linear }))
    seek(0.5)
    expect(partsOf(node).rings.centerReveal).toBeCloseTo(0.5)
    seek(1)
    expect(partsOf(node).rings.centerReveal).toBe(1)
  })
})

describe("a radial chart, from a document", () => {
  const STAGE = { width: 1280, height: 720 }
  class Measurer extends NullRenderContext {
    override measureText(...args: unknown[]): Size2D {
      const [text, fontSize] = args as [string, number]
      return { width: text.length * fontSize * 0.55, height: fontSize * 1.2 }
    }
  }
  type Row = Omit<CommandSpec, "id" | "targetId" | "at" | "duration" | "args"> & Partial<Pick<CommandSpec, "at" | "duration" | "args">>

  function doc(props: Record<string, unknown>, commands: Row[]): CompositionDocument {
    return {
      kind: "composition",
      nodes: [
        { id: "", type: "canvas2d", parentId: null, layerOrder: 0, props: {} },
        { id: "chart", type: "radialChart", parentId: "", layerOrder: 0, props: { width: 760, height: 460, data: ROWS, categoryField: "m", valueField: "v", ...props } },
      ],
      commands: commands.map((command, i) => ({ id: `c${i}`, targetId: "chart", at: 1, duration: 1, args: {}, easing: { kind: "linear" }, ...command })),
    } as CompositionDocument
  }

  function play(document: CompositionDocument) {
    const registry = new Registry({ nodes: NODES })
    const canvas = new Canvas2D({ id: "", ...STAGE, flow: "freeform" } as never)
    const timeline = new ClipTimeline(document, registry, canvas)
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
    return (time: number): RadialChart => {
      attach(time)
      timeline.syncPresence(time)
      timeline.evaluateAt(time)
      layout()
      const node = timeline.liveNode("chart") as Node2D
      measurer.execute(() => node.render(measurer))
      return node as unknown as RadialChart
    }
  }

  it("holds enter's first frame from arrival, sweeps at mid, lands at the end", () => {
    const seek = play(doc({}, [{ type: "enter" }]))
    expect(partsOf(seek(0.5)).rings.growth).toBe(0)
    expect(partsOf(seek(1.5)).rings.growth).toBeCloseTo(0.5 / 0.7)
    expect(partsOf(seek(2.5)).rings).toMatchObject({ growth: 1, labelReveal: 1 })
    // A seek back lands on the held first frame, not the end.
    expect(partsOf(seek(0.5)).rings.growth).toBe(0)
  })

  it("selectRing and clearSelection move the rings' pops, frame by frame", () => {
    const seek = play(doc({}, [{ type: "selectRing", args: { ringIndex: 0 } }, { type: "clearSelection", at: 3 }]))
    expect(seek(0.5).pops).toEqual([0, 0, 0])
    expect(seek(1.5).pops[0]).toBeCloseTo(0.5)
    expect(seek(2.5).pops).toEqual([1, 0, 0])
    expect(seek(3.5).pops[0]).toBeCloseTo(0.5)
    expect(seek(1.5).pops[0]).toBeCloseTo(0.5)
  })

  it("tweens style field by field through a to command", () => {
    const seek = play(doc({ style: { sweep: 360, innerRadius: 0.2, palette: ["#000000"], legend: "bottom" } }, [{ type: "to", args: { style: { sweep: 180, innerRadius: 0.6, palette: ["#ffffff"] } } }]))
    const rings = (time: number) => partsOf(seek(time)).rings
    expect(rings(0.5).marks).toMatchObject({ sweep: 360, innerRadius: 0.2 })
    expect(rings(1.5).marks).toMatchObject({ sweep: 270, innerRadius: 0.4 })
    expect(rings(2.5).marks).toMatchObject({ sweep: 180, innerRadius: 0.6 })
    const mid = fillOps.resolve(rings(1.5).rows[0].fill)[0] as { color: number[] }
    expect(mid.color[0]).toBeGreaterThan(0.2)
    expect(mid.color[0]).toBeLessThan(0.8)
  })
})
