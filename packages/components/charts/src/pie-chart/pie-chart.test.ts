import { describe, expect, it } from "vitest"
import type { Node2D } from "@motionscript/sdk"

import { attachAt, layOut, scrub } from "../tests/harness"
import { PIE_SPOTLIGHT_DIM as SPOTLIGHT_DIM } from "./shared"
import { PieChart, isSliceSelected } from "./pie-chart"
import { PieLegend } from "../kit/pie-legend"
import { PieRing } from "./pie-ring"

/**
 * The pie chart's selection: how the pops move from where they stand, how the
 * rest of the chart dims behind them, and what a command that changes nothing
 * still does. The pops are the chart's own state, so every number here is read
 * off the chart at a time.
 */

const BOX = { width: 680, height: 480 }
const linear = (t: number) => t
const ROWS = [
  { m: "A", v: 50 },
  { m: "B", v: 30 },
  { m: "C", v: 20 },
]

function chart(props: Record<string, unknown> = {}): PieChart {
  const node = attachAt(new PieChart({ ...BOX, data: ROWS, categoryField: "m", valueField: "v", ...props } as never))
  layOut(node, BOX)
  return node
}

/** The ring and the legend, read off the row the chart built: its last child. */
function partsOf(node: PieChart) {
  const row = node.children[node.children.length - 1] as Node2D
  return {
    ring: row.children.find((part) => part instanceof PieRing) as PieRing,
    legend: (row.children.find((part) => part instanceof PieLegend) ?? null) as PieLegend | null,
  }
}

const ring = (node: PieChart) => partsOf(node).ring
const dims = (node: PieChart) => partsOf(node).legend!.dims
const expectClose = (actual: readonly number[], expected: readonly number[]) => {
  expect(actual).toHaveLength(expected.length)
  expected.forEach((value, i) => expect(actual[i], `[${i}]`).toBeCloseTo(value, 10))
}

/** The pie legend's entries, top → bottom: each sits in the wrapper that carries its slice's dim. */
const legendItems = (node: PieChart) => partsOf(node).legend!.children.map((wrapper) => wrapper.children[0] as Node2D)

describe("PieChart: parts", () => {
  it("starts with no slice out, one pop to a row", () => {
    expect(chart().pops).toEqual([0, 0, 0])
    expect(chart({ data: [...ROWS, { m: "D", v: 5 }] }).pops).toEqual([0, 0, 0, 0])
  })

  it("keeps the pops it is built with", () => {
    expect(chart({ pops: [0, 1, 0] }).pops).toEqual([0, 1, 0])
  })

  it("draws a legend unless it is told not to", () => {
    expect(partsOf(chart()).legend).not.toBeNull()
    expect(partsOf(chart({ style: { legend: "none" } })).legend).toBeNull()
  })

  it("hands the ring and the legend its pops and its dimming, so the three cannot drift", () => {
    const node = chart()
    node.set({ pops: [0, 1, 0] } as never)
    expect(ring(node).pops).toEqual([0, 1, 0])
    expectClose(partsOf(node).legend!.dims, [SPOTLIGHT_DIM, 1, SPOTLIGHT_DIM])
  })

  it("holds the hole's summary back only when asked to", () => {
    expect(ring(chart()).centerReveal).toBe(1)
    expect(ring(chart({ showCenter: false })).centerReveal).toBe(0)
  })
})

describe("isSliceSelected", () => {
  it("is true only past half way out, so a slice mid-swell is not yet counted", () => {
    const node = chart()
    expect(isSliceSelected(node, 1)).toBe(false)
    node.set({ pops: [0, 0.5, 0] } as never)
    expect(isSliceSelected(node, 1)).toBe(false)
    node.set({ pops: [0, 0.51, 0] } as never)
    expect(isSliceSelected(node, 1)).toBe(true)
    node.set({ pops: [0, 1, 0] } as never)
    expect(isSliceSelected(node, 1)).toBe(true)
    expect(isSliceSelected(node, 0)).toBe(false)
  })

  it("is false for a slice that is not there", () => {
    const node = chart()
    node.set({ pops: [1, 1, 1] } as never)
    expect(isSliceSelected(node, 3)).toBe(false)
    expect(isSliceSelected(node, -1)).toBe(false)
  })

  it("reads a pop outside 0 to 1 as the nearest end", () => {
    const node = chart()
    node.set({ pops: [7, -3, 0.9] } as never)
    expect([0, 1, 2].map((i) => isSliceSelected(node, i))).toEqual([true, false, true])
  })
})

describe("PieChart: sliceDims", () => {
  it("dims nothing while nothing is out", () => {
    expect(dims(chart())).toEqual([1, 1, 1])
  })

  it("dims the others as far as the furthest slice is out, and the selected one least of all", () => {
    const node = chart()
    node.set({ pops: [0, 0.5, 0] } as never)
    // focus = 0.5: an unselected slice falls by (1 - dim) * 0.5, the selected by half that.
    const fall = (1 - SPOTLIGHT_DIM) * 0.5
    expectClose(dims(node), [1 - fall, 1 - fall / 2, 1 - fall])
    node.set({ pops: [0, 1, 0] } as never)
    expectClose(dims(node), [SPOTLIGHT_DIM, 1, SPOTLIGHT_DIM])
  })

  it("dims by the furthest of two slices that are out, each less than the rest", () => {
    const node = chart()
    node.set({ pops: [1, 0.5, 0] } as never)
    // focus = 1; the slice half out is half dimmed, the one fully out not at all.
    expectClose(dims(node), [1, 1 - (1 - SPOTLIGHT_DIM) * 0.5, SPOTLIGHT_DIM])
  })

  it("dims nothing when every slice is out, since none is left behind", () => {
    const node = chart()
    node.set({ pops: [1, 1, 1] } as never)
    expect(dims(node)).toEqual([1, 1, 1])
  })

  it("clamps the pops it reads", () => {
    const node = chart()
    node.set({ pops: [4, 0, -2] } as never)
    expectClose(dims(node), [1, SPOTLIGHT_DIM, SPOTLIGHT_DIM])
  })

  it("has an entry for each row, whatever the pops have", () => {
    const node = chart()
    node.set({ pops: [1] } as never)
    expectClose(dims(node), [1, SPOTLIGHT_DIM, SPOTLIGHT_DIM])
    node.set({ pops: [1, 0, 0, 0, 0] } as never)
    expect(dims(node)).toHaveLength(3)
  })
})

describe("PieChart.selectSlice", () => {
  it("swells the chosen slice from where it is to fully out", () => {
    const node = chart()
    const seek = scrub(node.selectSlice({ data: { sliceIndex: 1 }, duration: 1, easing: linear }))
    seek(0.25)
    expectClose(node.pops, [0, 0.25, 0])
    seek(1)
    expect(node.pops).toEqual([0, 1, 0])
    expect(isSliceSelected(node, 1)).toBe(true)
  })

  it("leaves any other slice that is out where it is", () => {
    const node = chart()
    node.set({ pops: [1, 0, 0] } as never)
    const seek = scrub(node.selectSlice({ data: { sliceIndex: 2 }, duration: 1, easing: linear }))
    seek(0.5)
    expectClose(node.pops, [1, 0, 0.5])
    seek(1)
    expect(node.pops).toEqual([1, 0, 1])
  })

  it("brings a slice half out the rest of the way", () => {
    const node = chart()
    node.set({ pops: [0, 0.4, 0] } as never)
    expectClose(scrub0(node.selectSlice({ data: { sliceIndex: 1 }, duration: 1, easing: linear }), node, 0.5), [0, 0.7, 0])
  })

  it("reads its start from the chart when it is built, so one built after another starts where that one ends", () => {
    const node = chart()
    node.selectSlice({ data: { sliceIndex: 0 }, duration: 1, easing: linear }).at(1)
    const next = node.selectSlice({ data: { sliceIndex: 1 }, duration: 1, easing: linear })
    next.at(0.5)
    expectClose(node.pops, [1, 0.5, 0])
  })

  it("eases out when it is given no easing", () => {
    const node = chart()
    node.selectSlice({ data: { sliceIndex: 0 }, duration: 1 }).at(0.5)
    // easeOut is past the straight line at the middle.
    expect(node.pops[0]).toBeGreaterThan(0.5)
  })

  it("selects slice 0 when none is named", () => {
    const node = chart()
    scrub(node.selectSlice({ duration: 1, easing: linear } as never))(1)
    expect(node.pops).toEqual([1, 0, 0])
  })

  it("is a frame of its time: the same pops whichever way the playhead came", () => {
    const node = chart()
    const seek = scrub(node.selectSlice({ data: { sliceIndex: 2 }, duration: 1, easing: linear }))
    seek(0.4)
    const forward = [...node.pops]
    seek(1)
    seek(0)
    expect(node.pops).toEqual([0, 0, 0])
    seek(0.4)
    expect(node.pops).toEqual(forward)
  })
})

/** Seeks a freshly made command to `seconds` and returns the chart's pops. */
function scrub0(command: Parameters<typeof scrub>[0], node: PieChart, seconds: number): number[] {
  scrub(command)(seconds)
  return [...node.pops]
}

describe("PieChart.deselectSlice", () => {
  it("settles the chosen slice back flush and leaves the others", () => {
    const node = chart()
    node.set({ pops: [1, 1, 0] } as never)
    const seek = scrub(node.deselectSlice({ data: { sliceIndex: 1 }, duration: 1, easing: linear }))
    seek(0.5)
    expectClose(node.pops, [1, 0.5, 0])
    seek(1)
    expect(node.pops).toEqual([1, 0, 0])
    expect(isSliceSelected(node, 1)).toBe(false)
  })

  it("restores the pop on a seek back below the end", () => {
    const node = chart()
    node.set({ pops: [0, 1, 0] } as never)
    const seek = scrub(node.deselectSlice({ data: { sliceIndex: 1 }, duration: 1, easing: linear }))
    seek(1)
    seek(0.25)
    expectClose(node.pops, [0, 0.75, 0])
    seek(0)
    expect(node.pops).toEqual([0, 1, 0])
  })
})

describe("PieChart.selectOnlySlice", () => {
  it("swells the chosen slice while settling every other one that was out", () => {
    const node = chart()
    node.set({ pops: [1, 0, 0.5] } as never)
    const seek = scrub(node.selectOnlySlice({ data: { sliceIndex: 1 }, duration: 1, easing: linear }))
    seek(0.5)
    expectClose(node.pops, [0.5, 0.5, 0.25])
    seek(1)
    expect(node.pops).toEqual([0, 1, 0])
  })

  it("settles everything when the slice named is not there", () => {
    const node = chart()
    node.set({ pops: [1, 0, 0] } as never)
    scrub(node.selectOnlySlice({ data: { sliceIndex: 9 }, duration: 1, easing: linear }))(1)
    expect(node.pops).toEqual([0, 0, 0])
  })
})

describe("PieChart.clearSelection", () => {
  it("settles every slice and brings the chart back to full", () => {
    const node = chart()
    node.set({ pops: [1, 0.5, 0] } as never)
    const seek = scrub(node.clearSelection({ duration: 1, easing: linear }))
    seek(0.5)
    expectClose(node.pops, [0.5, 0.25, 0])
    expectClose(dims(node), [1 - (1 - SPOTLIGHT_DIM) * 0.5 * 0.5, 1 - (1 - SPOTLIGHT_DIM) * 0.5 * 0.75, 1 - (1 - SPOTLIGHT_DIM) * 0.5])
    seek(1)
    expect(node.pops).toEqual([0, 0, 0])
    expect(dims(node)).toEqual([1, 1, 1])
  })

  it("builds from an empty call, taking no time", () => {
    expect(chart().clearSelection({}).duration).toBe(0)
  })
})

describe("a selection that changes nothing", () => {
  const noops: [string, (node: PieChart, duration: number) => { duration: number; at(t: number): unknown }][] = [
    ["selectSlice on a slice already out", (node, duration) => {
      node.set({ pops: [0, 1, 0] } as never)
      return node.selectSlice({ data: { sliceIndex: 1 }, duration })
    }],
    ["selectSlice on a slice that is not there", (node, duration) => node.selectSlice({ data: { sliceIndex: 9 }, duration })],
    ["deselectSlice on a slice that is flush", (node, duration) => node.deselectSlice({ data: { sliceIndex: 1 }, duration })],
    ["selectOnlySlice on the only slice out", (node, duration) => {
      node.set({ pops: [0, 1, 0] } as never)
      return node.selectOnlySlice({ data: { sliceIndex: 1 }, duration })
    }],
    ["clearSelection with nothing out", (node, duration) => node.clearSelection({ duration })],
  ]

  it.each(noops)("%s holds its full duration and writes nothing", (_name, make) => {
    const node = chart()
    const command = make(node, 2.5)
    const before = [...node.pops]
    expect(command.duration).toBe(2.5)
    expect(command.at(0)).toEqual({})
    expect(command.at(1.25)).toEqual({})
    expect(command.at(2.5)).toEqual({})
    expect(node.pops).toEqual(before)
  })

  it("stays a no-op when the chart's value is within the same pops, even if they came by a different path", () => {
    const node = chart()
    node.set({ pops: [0, 1, 0] } as never)
    // The same selection reached by a command: still nothing left to do.
    node.selectOnlySlice({ data: { sliceIndex: 1 }, duration: 1 }).at(0.5)
    expect(node.pops).toEqual([0, 1, 0])
  })
})

describe("PieChart: rows that change", () => {
  it("takes a new row's pop as flush, and writes one pop to each row afterwards", () => {
    const node = chart()
    node.set({ pops: [0, 1, 0] } as never)
    node.set({ data: [...ROWS, { m: "D", v: 10 }] })
    expect(isSliceSelected(node, 3)).toBe(false)
    expect(dims(node)).toHaveLength(4)
    scrub(node.selectSlice({ data: { sliceIndex: 3 }, duration: 1, easing: linear }))(1)
    expect(node.pops).toEqual([0, 1, 0, 1])
  })

  it("drops the pops of a row that is gone from what it writes", () => {
    const node = chart()
    node.set({ pops: [1, 1, 1] } as never)
    node.set({ data: ROWS.slice(0, 2) })
    scrub(node.clearSelection({ duration: 1, easing: linear }))(1)
    expect(node.pops).toEqual([0, 0])
  })
})

/** `enter` built and seeked to its first frame: what a timeline arriving at it shows. */
const armed = (node: PieChart) => scrub(node.enter({ duration: 1 }))(0)

describe("PieChart.enter's first frame", () => {
  it("puts the wedges, the labels and the legend at their pre-entrance state", () => {
    const node = chart()
    armed(node)
    expect(ring(node).growth).toBe(0)
    expect(ring(node).labelReveal).toBe(0)
    expect(legendItems(node).map((item) => item.opacity)).toEqual([0, 0, 0])
  })

  it("is the same however often the entrance is built", () => {
    const node = chart()
    armed(node)
    const first = { growth: ring(node).growth, labels: ring(node).labelReveal, items: legendItems(node).map((item) => [item.opacity, item.x]) }
    armed(node)
    armed(node)
    expect({ growth: ring(node).growth, labels: ring(node).labelReveal, items: legendItems(node).map((item) => [item.opacity, item.x]) }).toEqual(first)
  })

  it("leaves the hole's summary and the selection to their own signals", () => {
    const node = chart({ showCenter: false })
    node.set({ pops: [0, 1, 0] } as never)
    armed(node)
    expect(ring(node).centerReveal).toBe(0)
    expect(node.pops).toEqual([0, 1, 0])
    const shown = chart()
    armed(shown)
    expect(ring(shown).centerReveal).toBe(1)
  })

  it("needs no legend", () => {
    const node = chart({ style: { legend: "none" } })
    expect(() => armed(node)).not.toThrow()
    expect(ring(node).growth).toBe(0)
  })
})

describe("PieChart.enter", () => {
  it("takes exactly the duration it is given, with or without a legend", () => {
    expect(chart().enter({ duration: 2 }).duration).toBe(2)
    expect(chart({ style: { legend: "none" } }).enter({ duration: 2 }).duration).toBe(2)
  })

  // The ring's beats are component commands, which run to their end as they are
  // built; what the entrance shows ahead of its beat is its first frame.
  it("arms the chart at its start, so nothing shows ahead of its beat", () => {
    const node = chart()
    scrub(node.enter({ duration: 1 }))(0)
    expect(ring(node).growth).toBe(0)
    expect(ring(node).labelReveal).toBe(0)
  })

  it("lands every part at the end, legend or no legend", () => {
    for (const showLegend of [true, false]) {
      const node = chart({ style: { legend: showLegend ? "right" : "none" } })
      scrub(node.enter({ duration: 2, easing: linear }))(2)
      expect(ring(node).growth).toBe(1)
      expect(ring(node).labelReveal).toBe(1)
      if (showLegend) legendItems(node).forEach((item) => expect(item.opacity).toBeCloseTo(1, 10))
    }
  })
})

describe("PieChart.revealCenter", () => {
  it("fades the hole's summary up from clear", () => {
    const node = chart({ showCenter: false })
    const seek = scrub(node.revealCenter({ duration: 1, easing: linear }))
    seek(0.5)
    expect(ring(node).centerReveal).toBeCloseTo(0.5)
    seek(1)
    expect(ring(node).centerReveal).toBe(1)
  })

  it("fades up from where the reveal stands", () => {
    const node = chart({ showCenter: false })
    ring(node).set({ centerReveal: 0.5 })
    scrub(node.revealCenter({ duration: 1, easing: linear }))(0.5)
    expect(ring(node).centerReveal).toBeCloseTo(0.75)
  })
})
