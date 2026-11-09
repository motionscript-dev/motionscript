import { describe, expect, it } from "vitest"

import {
  DEG,
  pieArcs,
  relaxLabels,
  resolvePieSlices,
  ringPoint,
  sliceTotal,
  type PieSlice,
} from "./shared"

/**
 * The pie chart's geometry, which is the half of it a test can reach without a
 * laid-out node: how rows become slices, how slices become arcs, and how a
 * column of labels is spread so none of them overlap.
 *
 * The label relaxation is the part most worth pinning down. It is the only place
 * in the family where the *right* answer isn't derivable from the data alone —
 * two slices whose bisectors point almost the same way both want the same
 * vertical spot, and something has to give. What gives, and in which direction,
 * is what these assert.
 */

const slice = (category: string, value: number): PieSlice => ({
  category,
  value,
  fill: "white",
})

describe("resolvePieSlices", () => {
  it("cycles the palette by row, so a short palette repeats", () => {
    const rows = [
      { name: "a", n: 1 },
      { name: "b", n: 2 },
      { name: "c", n: 3 },
    ]

    const slices = resolvePieSlices(rows, "name", "n", ["red", "blue"])

    expect(slices.map((s) => s.fill)).toEqual(["red", "blue", "red"])
    expect(slices.map((s) => s.category)).toEqual(["a", "b", "c"])
    expect(slices.map((s) => s.value)).toEqual([1, 2, 3])
  })

  it("reads a non-string category column as its caption", () => {
    const slices = resolvePieSlices([{ year: 2024, n: 1 }], "year", "n", [])

    expect(slices[0].category).toBe("2024")
  })
})

describe("sliceTotal", () => {
  it("counts only what can be drawn", () => {
    expect(
      sliceTotal([slice("a", 3), slice("b", -2), slice("c", Number.NaN)])
    ).toBe(3)
  })
})

describe("pieArcs", () => {
  it("gives each slice exactly its share, walking clockwise from the start", () => {
    const arcs = pieArcs([slice("a", 1), slice("b", 3)], 0)

    expect(arcs.map((a) => a.fraction)).toEqual([0.25, 0.75])
    expect(arcs[0].a0).toBe(0)
    expect(arcs[0].a1).toBeCloseTo(Math.PI / 2)
    // Abutting: the gap between neighbours is inset when the wedge is drawn, so
    // a slice still covers its true percentage of the circle.
    expect(arcs[1].a0).toBe(arcs[0].a1)
    expect(arcs[1].a1).toBeCloseTo(Math.PI * 2)
  })

  it("offsets the whole ring by the start angle", () => {
    const arcs = pieArcs([slice("a", 1)], 90)

    expect(arcs[0].a0).toBeCloseTo(90 * DEG)
  })

  it("skips a slice with nothing to draw, keeping the source index", () => {
    const arcs = pieArcs([slice("a", 1), slice("b", 0), slice("c", 1)], 0)

    expect(arcs.map((a) => a.index)).toEqual([0, 2])
  })

  it("draws nothing at all when every value is zero", () => {
    expect(pieArcs([slice("a", 0), slice("b", 0)], 0)).toEqual([])
  })
})

describe("ringPoint", () => {
  it("measures clockwise from 12 o'clock in a y-up space", () => {
    const up = ringPoint(10, 0)
    expect(up.x).toBeCloseTo(0)
    expect(up.y).toBeCloseTo(10)

    const right = ringPoint(10, Math.PI / 2)
    expect(right.x).toBeCloseTo(10)
    expect(right.y).toBeCloseTo(0)
  })
})

describe("relaxLabels", () => {
  it("leaves a column that already clears itself where it is", () => {
    const slots = [
      { ideal: 60, y: 60 },
      { ideal: 0, y: 0 },
      { ideal: -60, y: -60 },
    ]

    relaxLabels(slots, 20, 100, -100)

    expect(slots.map((s) => s.y)).toEqual([60, 0, -60])
  })

  it("pushes a crowded pair apart, downward from the top", () => {
    const slots = [
      { ideal: 10, y: 10 },
      { ideal: 6, y: 6 },
    ]

    relaxLabels(slots, 20, 100, -100)

    // Sorted top-first; the upper one keeps its spot and the lower one drops to
    // clear it by the full gap.
    expect(slots[0].y).toBe(10)
    expect(slots[1].y).toBe(-10)
  })

  it("shares the crowding rather than spilling out of the box", () => {
    const slots = [
      { ideal: 30, y: 30 },
      { ideal: 20, y: 20 },
      { ideal: 10, y: 10 },
    ]

    relaxLabels(slots, 20, 20, -20)

    // Three labels, 20px apart, in a 40px column: the reverse pass wins, so the
    // column ends up exactly filling the space instead of running off the
    // bottom.
    expect(slots.map((s) => s.y)).toEqual([20, 0, -20])
  })

  it("returns the slots ordered top to bottom", () => {
    const slots = [
      { ideal: -40, y: 0 },
      { ideal: 40, y: 0 },
    ]

    const ordered = relaxLabels(slots, 10, 100, -100)

    expect(ordered.map((s) => s.ideal)).toEqual([40, -40])
  })
})
