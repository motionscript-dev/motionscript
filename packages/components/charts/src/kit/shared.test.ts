import { describe, expect, it } from "vitest"

import { fillOps, strokeOps } from "@motionscript/sdk"

import {
  DEFAULT_SERIES_COLORS,
  DEFAULT_SERIES_FILLS,
  DEFAULT_SERIES_STROKES,
  SPOTLIGHT_DIM,
  clampUnit,
  formatMarker,
  formatPercent,
  markerStep,
  markerValues,
  num,
  numericFields,
  resolvePalettePaint,
  resolveSeriesFill,
  resolveSeriesStroke,
  text,
} from "./shared"
import { resolveYScale } from "../line-chart/shared"

describe("num", () => {
  it("reads a non-finite cell as 0, like a missing one", () => {
    expect(num({ a: Number.NaN }, "a")).toBe(0)
    expect(num({ a: Number.POSITIVE_INFINITY }, "a")).toBe(0)
    expect(num({ a: "7" }, "a")).toBe(0)
    expect(num({ a: 7 }, "a")).toBe(7)
  })

  it("keeps a NaN cell out of the line chart's scale", () => {
    const series = [{ field: "a", label: "A" }]
    expect(resolveYScale([{ a: 2 }, { a: Number.NaN }, { a: 8 }], series, undefined, 4)).toEqual([0, 8])
  })
})

describe("resolveYScale on a constant series", () => {
  const series = [{ field: "a", label: "A" }]
  const rows = (value: number) => [{ a: value }, { a: value }, { a: value }]

  it.each([5, 5000, -5, 0.3])("gives %s a scale with width and distinct ticks", (value) => {
    const scale = resolveYScale(rows(value), series, undefined, 4)
    expect(scale[0]).toBeLessThan(value)
    expect(scale[1]).toBeGreaterThan(value)
    const ticks = markerValues(scale, 4)
    expect(new Set(ticks).size).toBe(ticks.length)
  })

  it("puts the value mid-scale, and all zeros on [0, 1]", () => {
    expect(resolveYScale(rows(5), series, undefined, 4)).toEqual([3, 7])
    expect(resolveYScale(rows(0), series, undefined, 4)).toEqual([0, 1])
  })

  it("leaves an explicit range alone", () => {
    expect(resolveYScale(rows(5), series, [5, 5], 4)).toEqual([5, 5])
  })
})

describe("formatMarker", () => {
  it("keeps one decimal for the ordinary step", () => {
    expect(formatMarker(2.5)).toBe("2.5")
    expect(formatMarker(2.5, 0.5)).toBe("2.5")
    expect(formatMarker(3)).toBe("3")
    expect(formatMarker(0.25)).toBe("0.3")
  })

  it("writes as many decimals as a fine tick step needs, so neighbouring ticks differ", () => {
    const ticks = markerValues([0, 0.2], 4)
    const step = markerStep(ticks)
    expect(step).toBeCloseTo(0.05)
    const captions = ticks.map((tick) => formatMarker(tick, step))
    expect(captions).toEqual(["0", "0.05", "0.1", "0.15", "0.2"])
    expect(new Set(captions).size).toBe(captions.length)
  })

  it("finds the step of an unordered or repeated tick row", () => {
    expect(markerStep([10, 0, 5, 5])).toBe(5)
    expect(markerStep([3])).toBeUndefined()
  })
})

describe("text", () => {
  it("reads a cell as its caption", () => {
    expect(text({ a: "Jan" }, "a")).toBe("Jan")
    expect(text({ a: 5 }, "a")).toBe("5")
    expect(text({ a: true }, "a")).toBe("true")
  })

  it("reads a missing cell as empty, not as the string undefined", () => {
    expect(text({}, "a")).toBe("")
    expect(text({ a: undefined as never }, "a")).toBe("")
    expect(text({ a: null as never }, "a")).toBe("")
  })

  it("reads no field name as empty", () => {
    expect(text({ a: "x" }, undefined)).toBe("")
    expect(text({ a: "x" }, "")).toBe("")
  })

  it("keeps a zero and an empty string as they are written", () => {
    expect(text({ a: 0 }, "a")).toBe("0")
    expect(text({ a: "" }, "a")).toBe("")
  })
})

describe("numericFields", () => {
  it("lists the columns that hold numbers, in the order they first appear", () => {
    expect(numericFields([{ month: "Jan", b: 1, a: 2 }, { month: "Feb", b: 3, a: 4 }])).toEqual(["b", "a"])
  })

  it("leaves out the names it is told to skip", () => {
    expect(numericFields([{ k: 1, a: 2 }], ["k"])).toEqual(["a"])
    expect(numericFields([{ k: 1, a: 2 }], ["k", "a"])).toEqual([])
  })

  it("leaves out a column with any text in it, rather than plotting it as zeros", () => {
    expect(numericFields([{ a: 1, b: 2 }, { a: "n/a", b: 3 }])).toEqual(["b"])
  })

  it("skips a blank or missing cell, and keeps the column", () => {
    expect(numericFields([{ a: 1 }, { a: "" }, { a: undefined as never }, {}, { a: 5 }])).toEqual(["a"])
  })

  it("leaves out a column with nothing in it", () => {
    expect(numericFields([{ a: "", b: 1 }, { a: undefined as never, b: 2 }])).toEqual(["b"])
  })

  it("finds a column that only a later row has", () => {
    expect(numericFields([{ a: 1 }, { a: 2, late: 9 }])).toEqual(["a", "late"])
  })

  it("is empty for no rows", () => {
    expect(numericFields([])).toEqual([])
    expect(numericFields([], ["a"])).toEqual([])
  })

  it("counts a NaN or an infinity as a number, since it is typed as one", () => {
    expect(numericFields([{ a: Number.NaN }, { a: 1 }])).toEqual(["a"])
  })
})

describe("markerValues", () => {
  it("lays count + 1 values evenly across the range, ends included", () => {
    expect(markerValues([0, 10], 4)).toEqual([0, 2.5, 5, 7.5, 10])
    expect(markerValues([-5, 5], 2)).toEqual([-5, 0, 5])
  })

  it("makes at least two segments, whatever count it is given", () => {
    expect(markerValues([0, 10], 0)).toEqual([0, 5, 10])
    expect(markerValues([0, 10], 1)).toEqual([0, 5, 10])
    expect(markerValues([0, 10], -3)).toEqual([0, 5, 10])
  })

  it("rounds a fractional count", () => {
    expect(markerValues([0, 9], 2.6)).toHaveLength(4)
    expect(markerValues([0, 9], 2.4)).toHaveLength(3)
  })

  it("repeats a value for a range with no width", () => {
    expect(markerValues([5, 5], 3)).toEqual([5, 5, 5, 5])
  })

  it("runs backwards for a reversed range", () => {
    expect(markerValues([10, 0], 2)).toEqual([10, 5, 0])
  })
})

describe("formatPercent", () => {
  it("writes a whole percentage plain", () => {
    expect(formatPercent(0.5)).toBe("50%")
    expect(formatPercent(0)).toBe("0%")
    expect(formatPercent(1)).toBe("100%")
  })

  it("writes any other with one decimal, dropping a trailing .0", () => {
    expect(formatPercent(0.123)).toBe("12.3%")
    expect(formatPercent(1 / 3)).toBe("33.3%")
    expect(formatPercent(0.9996)).toBe("100%")
  })
})

describe("clampUnit and SPOTLIGHT_DIM", () => {
  it("holds a number inside 0..1", () => {
    expect(clampUnit(-1)).toBe(0)
    expect(clampUnit(0.25)).toBe(0.25)
    expect(clampUnit(2)).toBe(1)
  })

  it("dims an unspotlit series to a fifth", () => {
    expect(SPOTLIGHT_DIM).toBe(0.2)
  })
})

describe("the series palettes", () => {
  it("cycles five colours as strokes of 4 px and as fills", () => {
    expect(DEFAULT_SERIES_COLORS).toHaveLength(5)
    expect(DEFAULT_SERIES_STROKES).toHaveLength(5)
    expect(DEFAULT_SERIES_STROKES.every((stroke) => (stroke as { weight: number }).weight === 4)).toBe(true)
    expect(DEFAULT_SERIES_FILLS).toEqual([...DEFAULT_SERIES_COLORS])
  })
})

describe("resolveSeriesStroke", () => {
  const PALETTE = [{ weight: 4, fill: "#ff0000" }, { weight: 6, fill: "#0000ff" }]
  const layers = (stroke: ReturnType<typeof resolveSeriesStroke>) => strokeOps.resolve(stroke)

  it("takes the palette's entry for the series' index", () => {
    const stroke = layers(resolveSeriesStroke(PALETTE, { field: "a", label: "A" }, 1))
    expect(stroke[0].weight).toBe(6)
    expect(stroke[0].fill).toEqual(fillOps.resolve("#0000ff"))
  })

  it("cycles the palette past its end", () => {
    const first = layers(resolveSeriesStroke(PALETTE, { field: "a", label: "A" }, 0))
    const third = layers(resolveSeriesStroke(PALETTE, { field: "a", label: "A" }, 2))
    expect(third[0].fill).toEqual(first[0].fill)
    expect(layers(resolveSeriesStroke(PALETTE, { field: "a", label: "A" }, 5))[0].weight).toBe(6)
  })

  it("lets the series' own fill replace the colour and keep the palette entry's weight", () => {
    const stroke = layers(resolveSeriesStroke(PALETTE, { field: "a", label: "A", fill: "#00ff00" }, 1))
    expect(stroke).toHaveLength(1)
    expect(stroke[0].weight).toBe(6)
    expect(stroke[0].fill).toEqual(fillOps.resolve("#00ff00"))
  })

  it("overrides only the topmost layer of a stroke of several", () => {
    const stacked = [[{ weight: 8, fill: "#111111" }, { weight: 3, fill: "#222222" }]]
    const stroke = layers(resolveSeriesStroke(stacked as never, { field: "a", label: "A", fill: "#333333" }, 0))
    expect(stroke).toHaveLength(2)
    expect(stroke[0].fill).toEqual(fillOps.resolve("#111111"))
    expect(stroke[1].fill).toEqual(fillOps.resolve("#333333"))
  })

  it("draws a series with an override over an empty palette in a 4 px line of that colour", () => {
    const stroke = layers(resolveSeriesStroke([], { field: "a", label: "A", fill: "#00ff00" }, 0))
    expect(stroke).toHaveLength(1)
    expect(stroke[0].weight).toBe(4)
    expect(stroke[0].fill).toEqual(fillOps.resolve("#00ff00"))
  })

  it("draws a series with no override over an empty palette in a 4 px white line", () => {
    expect(resolveSeriesStroke([], { field: "a", label: "A" }, 0)).toEqual({ weight: 4, fill: "white" })
  })

  it("draws a series with an override over a palette entry with no layers in a 4 px line of the colour", () => {
    // The unresolved form, as the empty entry has no layers to be resolved into.
    expect(resolveSeriesStroke([[]] as never, { field: "a", label: "A", fill: "#00ff00" }, 0)).toEqual({ weight: 4, fill: "#00ff00" })
  })
})

describe("resolveSeriesFill", () => {
  const PALETTE = [{ weight: 4, fill: "#ff0000" }, { weight: 6, fill: "#0000ff" }]

  it("is the colour the series' line is drawn in", () => {
    expect(resolveSeriesFill(PALETTE, { field: "a", label: "A" }, 1)).toEqual(fillOps.resolve("#0000ff"))
    expect(resolveSeriesFill(PALETTE, { field: "a", label: "A", fill: "#00ff00" }, 1)).toEqual(fillOps.resolve("#00ff00"))
  })

  it("is white for an empty palette and no override", () => {
    expect(resolveSeriesFill([], { field: "a", label: "A" }, 0)).toEqual(fillOps.resolve("white"))
  })

  it("is the topmost layer's colour for a stroke of several", () => {
    const stacked = [[{ weight: 8, fill: "#111111" }, { weight: 3, fill: "#222222" }]]
    expect(resolveSeriesFill(stacked as never, { field: "a", label: "A" }, 0)).toEqual(fillOps.resolve("#222222"))
  })
})

describe("resolvePalettePaint", () => {
  const PALETTE = ["#aa0000", "#00bb00", "#0000cc"]

  it("is the override when there is one, whatever the palette", () => {
    expect(resolvePalettePaint(PALETTE, "#ffffff", 1)).toBe("#ffffff")
    expect(resolvePalettePaint([], "#ffffff", 1)).toBe("#ffffff")
  })

  it("is the palette's entry for the index, cycling past the end", () => {
    expect(resolvePalettePaint(PALETTE, undefined, 0)).toBe("#aa0000")
    expect(resolvePalettePaint(PALETTE, undefined, 2)).toBe("#0000cc")
    expect(resolvePalettePaint(PALETTE, undefined, 3)).toBe("#aa0000")
    expect(resolvePalettePaint(PALETTE, undefined, 7)).toBe("#00bb00")
  })

  it("is white for an empty palette and no override", () => {
    expect(resolvePalettePaint([], undefined, 0)).toBe("white")
  })

  it("treats a null override as none", () => {
    expect(resolvePalettePaint(PALETTE, null as never, 1)).toBe("#00bb00")
  })
})

