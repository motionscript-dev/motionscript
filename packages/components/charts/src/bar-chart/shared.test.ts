import { describe, expect, it } from "vitest"

import {
  barSpans,
  barValueExtent,
  inkOn,
  resolveBarScale,
  type BarSeries,
} from "./shared"

/**
 * The bar chart's arithmetic. A bar is a span, not a height, so one walk covers
 * grouped, stacked and negative; zero is always on the scale; and a stack keeps
 * a running sum on each side of zero, so a loss stacks downward instead of
 * eating into the gains. The rounded end goes to the last non-zero segment on
 * its side, so a zero in one row does not leave the segment below it square.
 */

const SERIES: BarSeries[] = [
  { field: "a", label: "A" },
  { field: "b", label: "B" },
  { field: "c", label: "C" },
]

describe("barSpans", () => {
  it("runs every grouped bar from zero to its own value, each rounded", () => {
    expect(barSpans({ a: 4, b: 7, c: 2 }, SERIES, "none")).toEqual([
      { from: 0, to: 4, value: 4, outer: true },
      { from: 0, to: 7, value: 7, outer: true },
      { from: 0, to: 2, value: 2, outer: true },
    ])
  })

  it("rides each stacked segment on the running total below it, rounding only the last", () => {
    expect(barSpans({ a: 4, b: 7, c: 2 }, SERIES, "stacked")).toEqual([
      { from: 0, to: 4, value: 4, outer: false },
      { from: 4, to: 11, value: 7, outer: false },
      { from: 11, to: 13, value: 2, outer: true },
    ])
  })

  it("stacks a loss downward from zero, apart from the gains", () => {
    expect(barSpans({ a: -6 }, [SERIES[0]], "none")).toEqual([{ from: 0, to: -6, value: -6, outer: true }])
    expect(barSpans({ a: 10, b: -4, c: 3 }, SERIES, "stacked")).toEqual([
      { from: 0, to: 10, value: 10, outer: false },
      { from: 0, to: -4, value: -4, outer: true },
      { from: 10, to: 13, value: 3, outer: true },
    ])
  })

  it("keeps a zero-valued series in place, index-aligned with the list, and rounds the last that draws", () => {
    const spans = barSpans({ a: 4, b: 7, c: 0 }, SERIES, "stacked")
    expect(spans).toHaveLength(3)
    expect(spans.map((span) => span.outer)).toEqual([false, true, false])
    expect(spans[2]).toMatchObject({ from: 11, to: 11, value: 0 })
  })

  it("reads each value as its share of the row in a percent stack", () => {
    const spans = barSpans({ a: 1, b: 3, c: 0 }, SERIES, "percent")
    expect(spans.map((span) => [span.from, span.to])).toEqual([[0, 25], [25, 100], [100, 100]])
  })

  it("scales each series' contribution by its weight, so a fading series lowers the ones beyond it", () => {
    const spans = barSpans({ a: 4, b: 7 }, SERIES.slice(0, 2), "stacked", [0.5, 1])
    expect(spans.map((span) => [span.from, span.to])).toEqual([[0, 2], [2, 9]])
    // Apart, a weight narrows a bar rather than shortening it.
    expect(barSpans({ a: 4 }, [SERIES[0]], "none", [0.5])[0].to).toBe(4)
  })
})

describe("barValueExtent", () => {
  it("always includes zero, however far the data sits from it", () => {
    expect(barValueExtent([{ a: 40, b: 45, c: 50 }], SERIES, "none")).toEqual([0, 50])
  })

  it("measures a stack by its running total, not its tallest segment", () => {
    const data = [{ a: 4, b: 7, c: 2 }]
    expect(barValueExtent(data, SERIES, "stacked")).toEqual([0, 13])
    expect(barValueExtent(data, SERIES, "none")).toEqual([0, 7])
  })

  it("reaches below zero for a loss", () => {
    expect(barValueExtent([{ a: 8 }, { a: -3 }], [SERIES[0]], "none")).toEqual([-3, 8])
  })
})

describe("resolveBarScale", () => {
  it("takes an explicit range as given, cropped axis and all", () => {
    expect(resolveBarScale([{ a: 40 }, { a: 50 }], [SERIES[0]], "none", [40, 50], 4)).toEqual([40, 50])
  })

  it("rounds an auto range out to tidy step bounds", () => {
    // Four divisions over a 0–37 extent steps at ~9.25, rounded up to 10.
    expect(resolveBarScale([{ a: 37 }], [SERIES[0]], "none", undefined, 4)).toEqual([0, 40])
  })

  it("brackets a negative extent on both sides", () => {
    const [min, max] = resolveBarScale([{ a: 8 }, { a: -3 }], [SERIES[0]], "none", undefined, 4)
    expect(min).toBeLessThanOrEqual(-3)
    expect(max).toBeGreaterThanOrEqual(8)
  })

  it("reads a percent stack to 100, and to -100 when it has losses", () => {
    expect(resolveBarScale([{ a: 3, b: 1 }], SERIES, "percent", undefined, 4)).toEqual([0, 100])
    expect(resolveBarScale([{ a: 3, b: -1 }], SERIES, "percent", undefined, 4)).toEqual([-100, 100])
  })
})

describe("inkOn", () => {
  it("prints white on a dark bar and near-black on a light one", () => {
    expect(inkOn("#1d4ed8")).toBe("white")
    expect(inkOn("#fde68a")).toBe("#0a0a0a")
  })

  it("prints white on a paint it cannot read a colour off", () => {
    expect(inkOn([])).toBe("white")
  })
})
