import { describe, expect, it } from "vitest"

import { fillOps } from "@motionscript/sdk"

import {
  barSpans,
  barValueExtent,
  resolveBarFill,
  resolveBarScale,
  stackCapIndex,
  type BarSeries,
} from "./shared"

/**
 * The bar chart's arithmetic, which is all the parts of it a test can reach: the
 * geometry above this reads `layoutRect`, and the paint below it is the shared
 * theme resolver the line chart already exercises.
 *
 * Three things are worth pinning down, and each of them is a decision rather
 * than an implementation detail:
 *
 * - A bar is a **span**, not a height, so one walk covers grouped, stacked and
 *   negative without a special case anywhere.
 * - **Zero is always on the scale.** A bar chart's baseline is zero, and a scale
 *   that starts at 40 draws a column three times its neighbour for a 10%
 *   difference — the classic way to lie with one.
 * - The stack's **cap** is the last *non-zero* series, not the last one listed,
 *   so a series that happens to be 0 in one row doesn't take the rounded end and
 *   leave the segment below it square.
 */

const SERIES: BarSeries[] = [
  { field: "a", label: "A" },
  { field: "b", label: "B" },
  { field: "c", label: "C" },
]

describe("barSpans", () => {
  it("runs every grouped bar from zero to its own value", () => {
    const spans = barSpans({ a: 4, b: 7, c: 2 }, SERIES, false)

    expect(spans).toEqual([
      { from: 0, to: 4, value: 4 },
      { from: 0, to: 7, value: 7 },
      { from: 0, to: 2, value: 2 },
    ])
  })

  it("rides each stacked segment on the running total below it", () => {
    const spans = barSpans({ a: 4, b: 7, c: 2 }, SERIES, true)

    expect(spans).toEqual([
      { from: 0, to: 4, value: 4 },
      { from: 4, to: 11, value: 7 },
      { from: 11, to: 13, value: 2 },
    ])
  })

  it("lets a negative value run the span the other way", () => {
    const grouped = barSpans({ a: -6 }, [SERIES[0]], false)
    expect(grouped).toEqual([{ from: 0, to: -6, value: -6 }])

    // Signed stacking: the segment eats into what is below it rather than
    // being dropped or flipped.
    const stacked = barSpans({ a: 10, b: -4, c: 3 }, SERIES, true)
    expect(stacked).toEqual([
      { from: 0, to: 10, value: 10 },
      { from: 10, to: 6, value: -4 },
      { from: 6, to: 9, value: 3 },
    ])
  })

  it("keeps a zero-valued series in place, index-aligned with the list", () => {
    const spans = barSpans({ a: 4, c: 2 }, SERIES, true)

    expect(spans).toHaveLength(3)
    expect(spans[1]).toEqual({ from: 4, to: 4, value: 0 })
  })
})

describe("stackCapIndex", () => {
  it("caps the last series that actually draws", () => {
    expect(stackCapIndex({ a: 4, b: 7, c: 2 }, SERIES)).toBe(2)
    expect(stackCapIndex({ a: 4, b: 7, c: 0 }, SERIES)).toBe(1)
    expect(stackCapIndex({ a: 4, c: 3 }, SERIES)).toBe(2)
  })

  it("caps nothing when the row is empty", () => {
    expect(stackCapIndex({ a: 0, b: 0, c: 0 }, SERIES)).toBe(-1)
  })
})

describe("barValueExtent", () => {
  it("always includes zero, however far the data sits from it", () => {
    const data = [{ a: 40, b: 45, c: 50 }]

    expect(barValueExtent(data, SERIES, false)).toEqual([0, 50])
  })

  it("measures a stack by its running total, not its tallest segment", () => {
    const data = [{ a: 4, b: 7, c: 2 }]

    expect(barValueExtent(data, SERIES, true)).toEqual([0, 13])
    expect(barValueExtent(data, SERIES, false)).toEqual([0, 7])
  })

  it("reaches below zero for a loss", () => {
    const data = [{ a: 8 }, { a: -3 }]

    expect(barValueExtent(data, [SERIES[0]], false)).toEqual([-3, 8])
  })
})

describe("resolveBarScale", () => {
  it("takes an explicit range as given, cropped axis and all", () => {
    const data = [{ a: 40 }, { a: 50 }]

    expect(resolveBarScale(data, [SERIES[0]], false, [40, 50], 4)).toEqual([
      40, 50,
    ])
  })

  it("rounds an auto range out to tidy step bounds", () => {
    const data = [{ a: 37 }]

    // Four divisions over a 0–37 extent steps at ~9.25, rounded up to 10.
    expect(resolveBarScale(data, [SERIES[0]], false, undefined, 4)).toEqual([
      0, 40,
    ])
  })

  it("brackets a negative extent on both sides", () => {
    const data = [{ a: 8 }, { a: -3 }]

    const [min, max] = resolveBarScale(data, [SERIES[0]], false, undefined, 4)
    expect(min).toBeLessThanOrEqual(-3)
    expect(max).toBeGreaterThanOrEqual(8)
  })
})

describe("resolveBarFill", () => {
  const PALETTE = ["#aa0000", "#00bb00", "#0000cc"]

  it("takes the palette's entry for the series' index", () => {
    expect(resolveBarFill(PALETTE, { field: "a", label: "A" }, 0)).toBe("#aa0000")
    expect(resolveBarFill(PALETTE, { field: "a", label: "A" }, 2)).toBe("#0000cc")
  })

  it("cycles the palette past its end", () => {
    expect(resolveBarFill(PALETTE, { field: "a", label: "A" }, 3)).toBe("#aa0000")
    expect(resolveBarFill(PALETTE, { field: "a", label: "A" }, 4)).toBe("#00bb00")
  })

  it("lets a series' own fill replace its entry outright, resolved", () => {
    expect(resolveBarFill(PALETTE, { field: "a", label: "A", fill: "#ffffff" }, 1)).toEqual(fillOps.resolve("#ffffff"))
  })

  it("is white for an empty palette, when the series has no fill of its own", () => {
    expect(resolveBarFill([], { field: "a", label: "A" }, 0)).toBe("white")
  })

  it("still honours a series' fill over an empty palette", () => {
    expect(resolveBarFill([], { field: "a", label: "A", fill: "#123456" }, 0)).toEqual(fillOps.resolve("#123456"))
  })
})

