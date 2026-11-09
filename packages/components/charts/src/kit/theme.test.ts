import { describe, expect, it } from "vitest"

import { fillOps, strokeOps } from "@motionscript/sdk"

import { lerpBarChartTheme, resolveBarChartTheme } from "../bar-chart/shared"
import { lerpChartTheme, resolveChartTheme } from "../line-chart/shared"
import { PIE_SPOTLIGHT_DIM, lerpPieChartTheme, resolvePieChartTheme } from "../pie-chart/shared"
import { axisTweenTarget, lerpAxisDomain, resolveAxisDomain, type AxisDomainConfig } from "./shared"

/**
 * The three charts' themes: each is a tree of leaves that a partial write merges
 * onto, and that a tween interpolates leaf by leaf. A chart assembles its own out
 * of the shared branch resolvers, so the properties below are checked on all three.
 */

const RED = "#ff0000"
const BLUE = "#0000ff"

const redFill = fillOps.resolve(RED)
const blueFill = fillOps.resolve(BLUE)

/** One row per chart: how it resolves, how it tweens, and which branches a test may touch. */
const CHARTS = [
  {
    name: "line",
    resolve: resolveChartTheme as (theme: unknown, previous?: unknown) => any,
    lerp: lerpChartTheme as (a: unknown, b: unknown, t: number) => any,
    palette: (colour: string) => ({ seriesStyles: [{ weight: 9, fill: colour }] }),
    paletteKey: "seriesStyles",
    nested: { xAxis: { tickPadding: 7 } },
    other: { yAxis: { tickPadding: 9 } },
    leaf: (theme: any) => theme.xAxis.tickPadding.top,
    otherLeaf: (theme: any) => theme.yAxis.tickPadding.top,
    dim: (theme: any) => theme.region.dimOpacity,
    defaultDim: 0.2,
    dimPartial: { region: { dimOpacity: 0.7 } },
  },
  {
    name: "bar",
    resolve: resolveBarChartTheme as (theme: unknown, previous?: unknown) => any,
    lerp: lerpBarChartTheme as (a: unknown, b: unknown, t: number) => any,
    palette: (colour: string) => ({ seriesFills: [colour] }),
    paletteKey: "seriesFills",
    nested: { xAxis: { tickPadding: 7 } },
    other: { yAxis: { tickPadding: 9 } },
    leaf: (theme: any) => theme.xAxis.tickPadding.top,
    otherLeaf: (theme: any) => theme.yAxis.tickPadding.top,
    dim: (theme: any) => theme.spotlight.dimOpacity,
    dimPartial: { spotlight: { dimOpacity: 0.7 } },
    defaultDim: 0.2,
  },
  {
    name: "pie",
    resolve: resolvePieChartTheme as (theme: unknown, previous?: unknown) => any,
    lerp: lerpPieChartTheme as (a: unknown, b: unknown, t: number) => any,
    palette: (colour: string) => ({ sliceFills: [colour] }),
    paletteKey: "sliceFills",
    nested: { ring: { gap: 11 } },
    other: { ring: { holeRadius: 0.3 } },
    leaf: (theme: any) => theme.ring.gap,
    otherLeaf: (theme: any) => theme.ring.holeRadius,
    dim: (theme: any) => theme.spotlight.dimOpacity,
    dimPartial: { spotlight: { dimOpacity: 0.7 } },
    defaultDim: PIE_SPOTLIGHT_DIM,
  },
]

describe.each(CHARTS)("the $name chart's theme: resolving", (chart) => {
  it("fills in every leaf on first resolution, from the defaults", () => {
    const theme = chart.resolve(undefined)
    expect(Object.keys(theme).length).toBeGreaterThan(3)
    // Resolved: a padding is four sides, a paint a list of layers.
    expect(chart.dim(theme)).toBe(chart.defaultDim)
  })

  it("merges a partial branch onto the defaults, leaving every other leaf of the branch as it was", () => {
    const base = chart.resolve(undefined)
    const patched = chart.resolve(chart.nested)
    expect(chart.leaf(patched)).not.toBe(chart.leaf(base))
    expect(chart.otherLeaf(patched)).toBe(chart.otherLeaf(base))
    expect(chart.dim(patched)).toBe(chart.dim(base))
  })

  it("keeps a branch it is not told about as the previous value", () => {
    const first = chart.resolve(chart.nested)
    const second = chart.resolve(chart.other, first)
    // The first write's leaf survives the second write, which names only another branch.
    expect(chart.leaf(second)).toBe(chart.leaf(first))
    expect(chart.otherLeaf(second)).not.toBe(chart.otherLeaf(first))
  })

  it("is idempotent: resolving a resolved theme with itself changes nothing", () => {
    const once = chart.resolve({ ...chart.nested, ...chart.other, ...chart.dimPartial })
    expect(chart.resolve(undefined, once)).toEqual(once)
    expect(chart.resolve({}, once)).toEqual(once)
    expect(chart.resolve(once, once)).toEqual(once)
  })

  it("does not change the previous value it merges onto", () => {
    const first = chart.resolve(chart.nested)
    const snapshot = JSON.stringify(first)
    chart.resolve(chart.other, first)
    expect(JSON.stringify(first)).toBe(snapshot)
  })

  it("replaces the palette outright rather than merging it by index", () => {
    const first = chart.resolve(chart.palette(RED))
    expect(first[chart.paletteKey]).toHaveLength(1)
    const second = chart.resolve(chart.palette(BLUE), first)
    expect(second[chart.paletteKey]).toHaveLength(1)
    expect(JSON.stringify(second[chart.paletteKey])).toContain(JSON.stringify((blueFill[0] as { color: unknown }).color))
    expect(JSON.stringify(second[chart.paletteKey])).not.toContain(JSON.stringify((redFill[0] as { color: unknown }).color))
  })

  it("keeps the five-colour default palette when none is stated", () => {
    expect(chart.resolve(undefined)[chart.paletteKey]).toHaveLength(5)
    expect(chart.resolve(chart.nested)[chart.paletteKey]).toHaveLength(5)
  })

  it("takes a partial opacity of the spotlight or region", () => {
    expect(chart.dim(chart.resolve(chart.dimPartial))).toBe(0.7)
  })

  it("lets a state of nothing leave the previous theme whole", () => {
    const first = chart.resolve({ ...chart.nested, ...chart.dimPartial })
    expect(chart.resolve({}, first)).toEqual(first)
  })
})

describe.each(CHARTS)("the $name chart's theme: tweening", (chart) => {
  const from = chart.resolve({ ...chart.nested, ...chart.palette(RED) })
  const to = chart.resolve({ ...chart.other, ...chart.dimPartial, ...chart.palette(BLUE) })

  it("is the first theme at t = 0 and the second at t = 1, number for number", () => {
    // A paint's opacity is the one leaf a tween writes where the resolved value left it unset, so it is left out.
    expect(numbersOf(chart.lerp(from, to, 0))).toEqual(numbersOf(from))
    expect(numbersOf(chart.lerp(from, to, 1))).toEqual(numbersOf(to))
  })

  it("moves every number that differs between the two, and none that does not", () => {
    const start = numbersOf(from)
    const end = numbersOf(to)
    const mid = numbersOf(chart.lerp(from, to, 0.5))
    expect(mid).toHaveLength(start.length)
    mid.forEach((value, i) => expect(value, `leaf ${i}`).toBeCloseTo((start[i] + end[i]) / 2, 9))
  })

  it("interpolates a number halfway at t = 0.5", () => {
    const mid = chart.lerp(from, to, 0.5)
    expect(chart.dim(mid)).toBeCloseTo((chart.dim(from) + chart.dim(to)) / 2)
    expect(chart.leaf(mid)).toBeCloseTo((chart.leaf(from) + chart.leaf(to)) / 2)
    expect(chart.otherLeaf(mid)).toBeCloseTo((chart.otherLeaf(from) + chart.otherLeaf(to)) / 2)
  })

  it("pairs the palettes by index", () => {
    const mid = chart.lerp(from, to, 0.5)[chart.paletteKey]
    expect(mid).toHaveLength(1)
    const layers = strokeOrFill(mid[0])
    // Red to blue, half way: the red and the blue channels each half.
    expect(layers.color[0]).toBeCloseTo(0.5)
    expect(layers.color[2]).toBeCloseTo(0.5)
  })

  it("holds the longer side's tail when a palette grows or shrinks", () => {
    const short = chart.resolve(chart.palette(RED))
    const long = chart.resolve(undefined)
    const toLong = chart.lerp(short, long, 0.5)[chart.paletteKey]
    expect(toLong).toHaveLength(5)
    // Beyond the shorter palette's end there is nothing to blend with: the tail is the longer side's own.
    expect(toLong[4]).toEqual(long[chart.paletteKey][4])
    const toShort = chart.lerp(long, short, 0.5)[chart.paletteKey]
    expect(toShort).toHaveLength(5)
    expect(toShort[4]).toEqual(long[chart.paletteKey][4])
  })
})

/** Every number in a resolved tree, in walk order, leaving a paint's `opacity` out. */
function numbersOf(tree: unknown, out: number[] = []): number[] {
  if (typeof tree === "number") out.push(tree)
  else if (Array.isArray(tree)) for (const item of tree) numbersOf(item, out)
  else if (tree && typeof tree === "object") {
    for (const [key, value] of Object.entries(tree)) if (key !== "opacity") numbersOf(value, out)
  }
  return out
}

/** The first solid layer of a palette entry, whether a stroke's paint or a fill. */
function strokeOrFill(entry: unknown): { color: number[] } {
  const layers = Array.isArray(entry) ? entry : [entry]
  const first = layers[0] as { color?: number[]; fill?: { color: number[] }[] }
  return first.color !== undefined ? { color: first.color } : { color: first.fill![0].color }
}

describe("a categorical leaf of a theme", () => {
  it("steps at the midpoint instead of blending: a font family has no halfway", () => {
    const a = resolveChartTheme({ xAxis: { labelStyle: { fontFamily: "Serif" } } })
    const b = resolveChartTheme({ xAxis: { labelStyle: { fontFamily: "Mono" } } })
    expect(lerpChartTheme(a, b, 0.49).xAxis.labelStyle.fontFamily).toBe("Serif")
    expect(lerpChartTheme(a, b, 0.5).xAxis.labelStyle.fontFamily).toBe("Mono")
  })

  it("steps the alignment at the midpoint", () => {
    const a = resolveChartTheme({ yAxis: { labelStyle: { textAlign: "left" } } })
    const b = resolveChartTheme({ yAxis: { labelStyle: { textAlign: "right" } } })
    expect(lerpChartTheme(a, b, 0.4).yAxis.labelStyle.textAlign).toBe("left")
    expect(lerpChartTheme(a, b, 0.6).yAxis.labelStyle.textAlign).toBe("right")
  })

  it("steps a field that only one side has, rather than animating it from nothing", () => {
    const a = resolveChartTheme({ xAxis: { labelStyle: { fontFamily: "Serif" } } })
    const b = resolveChartTheme(undefined)
    expect(lerpChartTheme(a, b, 0.3).xAxis.labelStyle.fontFamily).toBe("Serif")
    expect(lerpChartTheme(a, b, 0.7).xAxis.labelStyle.fontFamily).toBeUndefined()
  })

  it("interpolates a font size and a weight, which are numbers", () => {
    const a = resolveChartTheme({ xAxis: { labelStyle: { fontSize: 20, fontWeight: 400 } } })
    const b = resolveChartTheme({ xAxis: { labelStyle: { fontSize: 40, fontWeight: 800 } } })
    const mid = lerpChartTheme(a, b, 0.5).xAxis.labelStyle
    expect(mid.fontSize).toBe(30)
    expect(mid.fontWeight).toBe(600)
  })
})

describe("the line chart's region theme", () => {
  it("merges the stroke, the wash and the dim independently", () => {
    const theme = resolveChartTheme({ region: { dimOpacity: 0.5 } })
    expect(theme.region.dimOpacity).toBe(0.5)
    expect(theme.region.stroke).toEqual(resolveChartTheme(undefined).region.stroke)
    expect(theme.region.fill).toEqual(resolveChartTheme(undefined).region.fill)
  })

  it("blends the wash's colour and the dim between two themes", () => {
    const a = resolveChartTheme({ region: { fill: RED, dimOpacity: 0 } })
    const b = resolveChartTheme({ region: { fill: BLUE, dimOpacity: 1 } })
    const mid = lerpChartTheme(a, b, 0.5).region
    expect(mid.dimOpacity).toBe(0.5)
    expect((fillOps.resolve(mid.fill as never)[0] as { color: unknown }).color).toEqual([0.5, 0, 0.5, 1])
  })

  it("keeps the dashes of the rule through a merge that restates its colour", () => {
    const theme = resolveChartTheme({ region: { stroke: { weight: 2, fill: RED, dash: [3, 4] } } })
    expect(strokeOps.resolve(theme.region.stroke as never)[0].dash).toEqual([3, 4])
  })
})

describe("resolveAxisDomain", () => {
  it("fills a domain that is stated in part: no caption is the empty caption, and the rest stays unset", () => {
    expect(resolveAxisDomain(undefined)).toEqual({ label: "", range: undefined, ticks: undefined, format: undefined })
    expect(resolveAxisDomain({ range: [0, 10] })).toEqual({ label: "", range: [0, 10], ticks: undefined, format: undefined })
  })

  it("merges a partial write onto the previous domain, each field on its own", () => {
    const first = resolveAxisDomain({ label: "Revenue", range: [0, 100] })
    const second = resolveAxisDomain({ ticks: [0, 50, 100], format: "$#,##0" }, first)
    expect(second).toEqual({ label: "Revenue", range: [0, 100], ticks: [0, 50, 100], format: "$#,##0" })
  })

  it("lets a later write replace a field it states", () => {
    const first = resolveAxisDomain({ label: "A", range: [0, 1] })
    expect(resolveAxisDomain({ label: "B" }, first)).toEqual({ label: "B", range: [0, 1], ticks: undefined, format: undefined })
  })
})

describe("lerpAxisDomain", () => {
  const A: AxisDomainConfig = { label: "A", range: [0, 10], ticks: [0, 5, 10], format: "0" }
  const B: AxisDomainConfig = { label: "B", range: [10, 30], ticks: [10, 20, 30], format: "0.0" }

  it("blends a range and its ticks numerically when both sides state them", () => {
    const mid = lerpAxisDomain(A, B, 0.5)
    expect(mid.range).toEqual([5, 20])
    expect(mid.ticks).toEqual([5, 12.5, 20])
  })

  it("steps the caption and the format at the midpoint", () => {
    expect(lerpAxisDomain(A, B, 0.49)).toMatchObject({ label: "A", format: "0" })
    expect(lerpAxisDomain(A, B, 0.5)).toMatchObject({ label: "B", format: "0.0" })
  })

  it("is each side at the ends", () => {
    expect(lerpAxisDomain(A, B, 0)).toEqual(A)
    expect(lerpAxisDomain(A, B, 1)).toEqual(B)
  })

  it("pairs ticks by index and holds the longer side's tail", () => {
    const longer: AxisDomainConfig = { label: "", range: [0, 10], ticks: [0, 2, 4, 6, 8, 10] }
    const shorter: AxisDomainConfig = { label: "", range: [0, 10], ticks: [0, 10] }
    const mid = lerpAxisDomain(shorter, longer, 0.5)
    expect(mid.ticks).toHaveLength(6)
    expect(mid.ticks![0]).toBe(0)
    expect(mid.ticks![1]).toBe(6)
    // Past the shorter side's end: the longer side's own values.
    expect(mid.ticks!.slice(2)).toEqual([4, 6, 8, 10])
  })

  it("steps a range that only one side states, rather than blending it from nothing", () => {
    const auto: AxisDomainConfig = { label: "" }
    const explicit: AxisDomainConfig = { label: "", range: [0, 40] }
    expect(lerpAxisDomain(auto, explicit, 0.3).range).toBeUndefined()
    expect(lerpAxisDomain(auto, explicit, 0.7).range).toEqual([0, 40])
    expect(lerpAxisDomain(explicit, auto, 0.3).range).toEqual([0, 40])
    expect(lerpAxisDomain(explicit, auto, 0.7).range).toBeUndefined()
  })

  it("steps the ticks of an auto side the same way", () => {
    const auto: AxisDomainConfig = { label: "" }
    const explicit: AxisDomainConfig = { label: "", ticks: [0, 10] }
    expect(lerpAxisDomain(auto, explicit, 0.3).ticks).toBeUndefined()
    expect(lerpAxisDomain(auto, explicit, 0.7).ticks).toEqual([0, 10])
  })

  it("stays auto when both sides are", () => {
    expect(lerpAxisDomain({ label: "" }, { label: "" }, 0.5)).toEqual({ label: "", range: undefined, ticks: undefined, format: undefined })
  })
})

describe("axisTweenTarget", () => {
  const DRAWN: AxisDomainConfig = { label: "Sales", range: [0, 10], ticks: [0, 5, 10] }

  it("is nothing when the request states neither a range nor ticks: the plain property tween will do", () => {
    expect(axisTweenTarget(DRAWN, undefined)).toBeUndefined()
    expect(axisTweenTarget(DRAWN, { label: "Revenue" })).toBeUndefined()
    expect(axisTweenTarget(DRAWN, { format: "$0" })).toBeUndefined()
  })

  it("keeps the tick count the axis draws when only a range is given, spaced across the new range", () => {
    expect(axisTweenTarget(DRAWN, { range: [0, 40] })).toEqual({ label: "Sales", range: [0, 40], ticks: [0, 20, 40], format: undefined })
  })

  it("uses the ticks it is given, with the range it has", () => {
    expect(axisTweenTarget(DRAWN, { ticks: [0, 4, 8] })).toEqual({ label: "Sales", range: [0, 10], ticks: [0, 4, 8], format: undefined })
  })

  it("takes both when both are given", () => {
    expect(axisTweenTarget(DRAWN, { range: [5, 15], ticks: [5, 10, 15] })).toEqual({ label: "Sales", range: [5, 15], ticks: [5, 10, 15], format: undefined })
  })

  it("carries the caption and the format it is also given", () => {
    expect(axisTweenTarget(DRAWN, { range: [0, 20], label: "Revenue", format: "$0" })).toMatchObject({ label: "Revenue", format: "$0", range: [0, 20] })
  })

  it("draws at least two markers, whatever the drawn axis had", () => {
    expect(axisTweenTarget({ label: "", range: [0, 10] }, { range: [0, 6] })?.ticks).toEqual([0, 3, 6])
    expect(axisTweenTarget({ label: "", range: [0, 10], ticks: [3] }, { range: [0, 6] })?.ticks).toEqual([0, 3, 6])
  })
})
