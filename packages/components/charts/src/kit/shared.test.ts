import { describe, expect, it } from "vitest"



import {
  SPOTLIGHT_DIM,
  formatMarker,
  formatPercent,
  markerStep,
  markerValues,
  num,
  numericFields,
  text,
  niceRange,
  niceTicks,
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

describe("SPOTLIGHT_DIM", () => {
  it("dims an unspotlit series to a fifth", () => {
    expect(SPOTLIGHT_DIM).toBe(0.2)
  })
})

describe("niceRange", () => {
  it("rounds an extent out to bounds a tidy step apart", () => {
    expect(niceRange([0, 305], 4)).toEqual([0, 400])
    expect(niceRange([-73, 305], 4)).toEqual([-100, 400])
  })

  it("widens a constant extent about its value", () => {
    expect(niceRange([5, 5], 4)).toEqual([3, 7])
    expect(niceRange([0, 0], 4)).toEqual([0, 1])
  })
})

describe("niceTicks", () => {
  it("ticks every multiple of the step, so zero is one when the range spans it", () => {
    expect(niceTicks([0, 400], 4)).toEqual([0, 100, 200, 300, 400])
    expect(niceTicks([-100, 400], 4)).toEqual([-100, 0, 100, 200, 300, 400])
    expect(niceTicks([0, 600], 4)).toEqual([0, 200, 400, 600])
  })

  it("splits a range no tidy step divides evenly, as an author's range may be", () => {
    expect(niceTicks([0, 37], 4)).toEqual([0, 9.25, 18.5, 27.75, 37])
    expect(niceTicks([0, 50], 4)).toEqual([0, 10, 20, 30, 40, 50])
  })

  it("writes each tick without floating-point noise", () => {
    expect(niceTicks([0, 0.3], 3)).toEqual([0, 0.1, 0.2, 0.3])
  })
})
