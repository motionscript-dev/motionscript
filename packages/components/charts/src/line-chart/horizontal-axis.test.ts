import { describe, expect, it } from "vitest"

import type { Node2D, Text } from "@motionscript/sdk"

import { DEFAULT_X_AXIS, enterBudget, resolveAxisConfig } from "../kit/shared"
import { layOut, scrub } from "../tests/harness"
import { HorizontalAxis } from "./horizontal-axis"

/**
 * The line chart's horizontal axis: a row of text nodes, left to right, each
 * centred on its value's fraction of the range — by value, not by slot.
 */

const AXIS = resolveAxisConfig(undefined, DEFAULT_X_AXIS)
const BOX = { width: 400, height: 100 }
const linear = (t: number) => t

function axis(props: Record<string, unknown> = {}) {
  const node = new HorizontalAxis({ range: [0, 10], markers: [0, 5, 10], axis: AXIS, ...BOX, ...props } as never)
  layOut(node, BOX)
  return node
}

/** The column the axis is made of: the row of markers, then the caption when it has one. */
const column = (node: HorizontalAxis) => node.children[0] as Node2D
const markers = (node: HorizontalAxis) => column(node).children[0].children as Text[]
const captions = (node: HorizontalAxis) => markers(node).map((marker) => marker.text)
const xs = (node: HorizontalAxis) => markers(node).map((marker) => marker.x)
const caption = (node: HorizontalAxis) => (column(node).children[1] as Text | undefined) ?? null
/** The entrance's first frame: every marker, and the caption, armed. */
const arm = (node: HorizontalAxis) => node.enter({ duration: 1 }).at(0)

describe("HorizontalAxis: the markers", () => {
  it("lists them left to right, whatever order the values arrive in", () => {
    expect(captions(axis({ markers: [10, 0, 5] }))).toEqual(["0", "5", "10"])
  })

  it("centres a marker on its value's fraction of the range", () => {
    const [left, middle] = xs(axis())
    expect(left).toBeCloseTo(-200)
    expect(middle).toBeCloseTo(0)
  })

  it("places markers by value: unevenly spaced values land unevenly", () => {
    const [a, b, c] = xs(axis({ markers: [0, 1, 10], range: [0, 10] }))
    expect(a).toBeCloseTo(-200)
    expect(b).toBeCloseTo(-160)
    expect(c).toBeLessThanOrEqual(200)
  })

  it("holds the last marker inside the axis's right edge, by half its own width", () => {
    const last = markers(axis())[2]
    expect(last.x).toBeCloseTo(200 - last.layoutBounds.width / 2)
  })

  it("lets the first marker hang over the left edge, since the vertical axis' gutter is beyond it", () => {
    expect(markers(axis())[0].x).toBeCloseTo(-200)
  })

  it("does not hold a marker that is not near the right edge", () => {
    expect(xs(axis({ markers: [0, 5, 6], range: [0, 10] }))[2]).toBeCloseTo(40)
  })

  it("reads a range with no width as every marker at the left", () => {
    expect(xs(axis({ range: [5, 5] }))).toEqual([-200, -200, -200])
  })

  it("positions a marker beyond the range beyond the axis on the left, and holds it on the right", () => {
    const node = axis({ markers: [-5, 5, 20], range: [0, 10] })
    expect(xs(node)[0]).toBeCloseTo(-400)
    const last = markers(node)[2]
    expect(last.x).toBeCloseTo(200 - last.layoutBounds.width / 2)
  })
})

describe("HorizontalAxis: the captions", () => {
  it("writes each marker with the default marker format", () => {
    expect(captions(axis({ markers: [0, 2.5, 10] }))).toEqual(["0", "2.5", "10"])
  })

  it("writes each marker with the caption listed for it, which a chart supplies for a month or a category column", () => {
    const node = new HorizontalAxis({ range: [0, 2], markers: [0, 1, 2], captions: ["Jan", "Feb", "Mar"], axis: AXIS, ...BOX } as never)
    layOut(node, BOX)
    expect(captions(node)).toEqual(["Jan", "Feb", "Mar"])
  })

  it("re-reads the markers every frame", () => {
    const node = axis()
    node.set({ markers: [0, 4, 8], range: [0, 8] } as never)
    layOut(node, BOX)
    expect(captions(node)).toEqual(["0", "4", "8"])
    expect(xs(node)[1]).toBeCloseTo(0)
  })

  it("fixes the count at construction, and leaves a slot with no value empty", () => {
    const longer = axis()
    longer.set({ markers: [0, 2, 4, 6, 8, 10] } as never)
    layOut(longer, BOX)
    expect(markers(longer)).toHaveLength(3)
    expect(captions(longer)).toEqual(["0", "2", "4"])

    const shorter = axis()
    shorter.set({ markers: [0, 10] } as never)
    layOut(shorter, BOX)
    expect(captions(shorter)).toEqual(["0", "10", ""])
  })
})

describe("HorizontalAxis: the caption", () => {
  it("builds none for an empty label", () => {
    const node = axis({ label: "" })
    expect(caption(node)).toBeNull()
    expect(node.children[0].children).toHaveLength(1)
  })

  it("builds one for a label, beneath the markers", () => {
    const node = axis({ label: "Month" })
    expect(caption(node)?.text).toBe("Month")
    const [row, title] = node.children[0].children
    expect(row.children).toHaveLength(3)
    expect(title).toBe(caption(node))
  })

  it("leaves the gap between the markers and the caption the axis' title padding", () => {
    expect((axis({ label: "Month" }).children[0] as unknown as { gap: number }).gap).toBe(4)
  })
})

describe("HorizontalAxis: arming and entering", () => {
  it("arms every marker transparent and lifted above its slot on its first frame", () => {
    const node = axis({ label: "Month" })
    arm(node)
    expect(markers(node).map((m) => [m.opacity, m.y])).toEqual([[0, 24], [0, 24], [0, 24]])
    expect([caption(node)!.opacity, caption(node)!.y]).toEqual([0, 24])
  })

  it("is idempotent", () => {
    const node = axis({ label: "Month" })
    arm(node)
    const once = markers(node).map((m) => [m.opacity, m.y])
    arm(node)
    expect(markers(node).map((m) => [m.opacity, m.y])).toEqual(once)
  })

  it("rests landed", () => {
    expect(markers(axis()).map((m) => [m.opacity, m.y])).toEqual([[1, 0], [1, 0], [1, 0]])
  })

  it("enters left to right: the first marker leads", () => {
    const node = axis()
    const seek = scrub(node.enter({ data: {}, duration: 1, easing: linear } as never))
    seek(0.2)
    const [first, second, third] = markers(node).map((m) => m.opacity)
    expect(first).toBeGreaterThan(second)
    expect(second).toBeGreaterThan(third)
    expect(third).toBe(0)
  })

  it("drops each marker down into its slot as it fades up", () => {
    const node = axis()
    const seek = scrub(node.enter({ data: {}, duration: 1, easing: linear } as never))
    seek(0.2)
    const first = markers(node)[0]
    expect(first.y).toBeCloseTo(24 * (1 - first.opacity))
  })

  it("lands every marker and the caption by the end of the duration, the caption after the markers", () => {
    const node = axis({ label: "Month" })
    const seek = scrub(node.enter({ data: {}, duration: 1, easing: linear } as never))
    const { step, per } = enterBudget(1, 3, true, undefined)
    seek(2 * step + per - 0.01)
    expect(caption(node)!.opacity).toBe(0)
    seek(1)
    expect(markers(node).map((m) => [m.opacity, m.y])).toEqual([[1, 0], [1, 0], [1, 0]])
    expect([caption(node)!.opacity, caption(node)!.y]).toEqual([1, 0])
  })

  it("is a frame of its time", () => {
    const node = axis()
    const seek = scrub(node.enter({ data: {}, duration: 1, easing: linear } as never))
    seek(0.3)
    const forward = markers(node).map((m) => m.opacity)
    seek(1)
    seek(0.1)
    seek(0.3)
    expect(markers(node).map((m) => m.opacity)).toEqual(forward)
  })

  it("takes the slide it is given, and is a seekable of nothing for no markers", () => {
    const node = axis()
    scrub(node.enter({ data: { slide: 50 }, duration: 1, easing: linear } as never))
    expect(markers(node).map((m) => m.y)).toEqual([50, 50, 50])
    const empty = axis({ markers: [] })
    expect(() => scrub(empty.enter({ data: {}, duration: 1 } as never))(0.5)).not.toThrow()
  })
})
