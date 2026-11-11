import { describe, expect, it } from "vitest"

import type { Node2D, Text } from "@motionscript/sdk"
import { enterBudget } from "@motionscript/sdk/component"

import { at, layOut, scrub } from "../tests/harness"
import { DEFAULT_Y_AXIS, resolveAxisConfig } from "./shared"
import { VerticalAxis } from "./vertical-axis"

/**
 * The value axis: a column of text nodes, one per marker, the highest at the top,
 * each centred on its value's fraction of the range. Only the marker count is
 * fixed at construction; the text and the positions are re-read every frame.
 */

const AXIS = resolveAxisConfig(undefined, DEFAULT_Y_AXIS)
const BOX = { width: 200, height: 300 }
const linear = (t: number) => t

function axis(props: Record<string, unknown> = {}) {
  const node = new VerticalAxis({ range: [0, 10], markers: [0, 5, 10], axis: AXIS, ...BOX, ...props } as never)
  layOut(node, BOX)
  return node
}

/** The row the axis is made of: the rotated caption, when it has one, then the column of markers. */
const row = (node: VerticalAxis) => node.children[0] as Node2D
const markers = (node: VerticalAxis) => row(node).children[row(node).children.length - 1].children as Text[]
const captions = (node: VerticalAxis) => markers(node).map((marker) => marker.text)
const ys = (node: VerticalAxis) => markers(node).map((marker) => marker.y)
const caption = (node: VerticalAxis) => (row(node).children.length > 1 ? (row(node).children[0].children[0] as Text) : null)
/** The entrance's first frame: every marker, and the caption, armed. */
const arm = (node: VerticalAxis, slide?: number) => node.enter({ data: slide === undefined ? {} : { slide }, duration: 1 }).at(0)

describe("VerticalAxis: the markers", () => {
  it("lists them highest at the top, whatever order the values arrive in", () => {
    expect(captions(axis({ markers: [5, 10, 0] }))).toEqual(["10", "5", "0"])
    expect(captions(axis({ markers: [0, 5, 10] }))).toEqual(["10", "5", "0"])
  })

  it("centres a marker on its value's fraction of the range, the lowest at the bottom", () => {
    const [top, middle, bottom] = ys(axis())
    expect(middle).toBeCloseTo(0)
    expect(bottom).toBeCloseTo(-150)
    // The top one is held inside the axis, 15 px lower than a centre on the edge would put it.
    expect(top).toBeLessThan(150)
  })

  it("places unevenly spaced markers where their values fall", () => {
    const [a, b, c] = ys(axis({ markers: [0, 2, 10], range: [0, 10] }))
    expect(c).toBeCloseTo(-150)
    // 2 of 10 is a fifth of the way up from the bottom: (0.2 - 0.5) of the height.
    expect(b).toBeCloseTo(-90)
    expect(a).toBeLessThanOrEqual(150)
  })

  it("holds the top marker inside the axis's top edge, by half its own height", () => {
    const top = markers(axis())[0]
    expect(top.y).toBeCloseTo(150 - top.layoutBounds.height / 2)
  })

  it("lets a marker at the bottom hang over the bottom edge: only the top is held", () => {
    const bottom = markers(axis())[2]
    expect(bottom.y).toBeCloseTo(-150)
  })

  it("does not hold a marker that is not near the top", () => {
    expect(ys(axis({ markers: [0, 5, 6], range: [0, 10] }))[0]).toBeCloseTo(30)
  })

  it("reads a range with no height as every marker at the bottom", () => {
    expect(ys(axis({ range: [5, 5] }))).toEqual([-150, -150, -150])
    expect(ys(axis({ range: [10, 0] }))).toEqual([-150, -150, -150])
  })

  it("positions a marker outside the range beyond the axis: nothing clamps it at the bottom", () => {
    const node = axis({ markers: [-5, 0, 10], range: [0, 10] })
    expect(ys(node)[2]).toBeCloseTo(-300)
  })
})

describe("VerticalAxis: the captions", () => {
  it("writes each marker with the default marker format", () => {
    expect(captions(axis({ markers: [0, 2.5, 10] }))).toEqual(["10", "2.5", "0"])
  })

  it("writes each marker with the caption listed for it, which a chart supplies", () => {
    const node = new VerticalAxis({ range: [0, 10], markers: [0, 5, 10], captions: ["$0", "$5", "$10"], axis: AXIS, ...BOX } as never)
    layOut(node, BOX)
    expect(captions(node)).toEqual(["$10", "$5", "$0"])
  })

  it("re-reads the markers every frame: a restated list changes the captions and the positions", () => {
    const node = axis()
    node.set({ markers: [0, 4, 8], range: [0, 8] } as never)
    layOut(node, BOX)
    expect(captions(node)).toEqual(["8", "4", "0"])
    expect(ys(node)[1]).toBeCloseTo(0)
  })

  it("fixes the count at construction: a longer list gains no marker", () => {
    const node = axis()
    node.set({ markers: [0, 2, 4, 6, 8, 10] } as never)
    layOut(node, BOX)
    expect(markers(node)).toHaveLength(3)
    expect(captions(node)).toEqual(["10", "8", "6"])
  })

  it("leaves a slot with no value empty: a shorter list does not repeat its neighbour", () => {
    const node = axis()
    node.set({ markers: [0, 10] } as never)
    layOut(node, BOX)
    expect(captions(node)).toEqual(["10", "0", ""])
  })

  it("builds no marker for no markers", () => {
    expect(markers(axis({ markers: [] }))).toHaveLength(0)
  })
})

describe("VerticalAxis: the caption", () => {
  it("builds none for an empty label, and reserves no gutter for it", () => {
    const node = axis({ label: "" })
    expect(caption(node)).toBeNull()
    expect(node.children[0].children).toHaveLength(1)
  })

  it("builds a caption for a label, rotated to read bottom to top, to the left of the markers", () => {
    const node = axis({ label: "Revenue" })
    expect(caption(node)?.text).toBe("Revenue")
    const [rotated, column] = node.children[0].children
    expect(rotated.constructor.name).toBe("RotatedBox")
    expect((rotated as unknown as { angle: number }).angle).toBe(-90)
    expect(rotated.children[0]).toBe(caption(node))
    expect(column.children).toHaveLength(3)
  })

  it("sets the caption in the axis' title style, and the markers in its label style", () => {
    const node = axis({ label: "Revenue" })
    expect(caption(node)?.fontSize).toBe(30)
    expect(markers(node)[0].fontSize).toBe(24)
  })

  it("leaves the gap between the caption and the markers the axis' title padding", () => {
    const node = axis({ label: "Revenue" })
    expect((node.children[0] as unknown as { gap: number }).gap).toBe(24)
  })
})

describe("VerticalAxis: arming and entering", () => {
  it("arms every marker and the caption transparent and shifted right on its first frame", () => {
    const node = axis({ label: "Sales" })
    arm(node)
    expect(markers(node).map((m) => [m.opacity, m.x])).toEqual([[0, 24], [0, 24], [0, 24]])
    expect([caption(node)!.opacity, caption(node)!.x]).toEqual([0, 24])
  })

  it("arms to a slide it is given", () => {
    const node = axis()
    arm(node, 40)
    expect(markers(node).map((m) => m.x)).toEqual([40, 40, 40])
  })

  it("is idempotent", () => {
    const node = axis({ label: "Sales" })
    arm(node)
    const once = markers(node).map((m) => [m.opacity, m.x])
    arm(node)
    expect(markers(node).map((m) => [m.opacity, m.x])).toEqual(once)
  })

  it("rests landed: a chart never told to enter reads as finished", () => {
    const node = axis()
    expect(markers(node).map((m) => [m.opacity, m.x])).toEqual([[1, 0], [1, 0], [1, 0]])
  })

  it("enters bottom to top: the lowest marker leads, the highest follows", () => {
    const node = axis()
    const enter = node.enter({ data: {}, duration: 1, easing: linear } as never)
    at(enter, 0.2)
    const [top, middle, bottom] = markers(node).map((m) => m.opacity)
    expect(bottom).toBeGreaterThan(middle)
    expect(middle).toBeGreaterThan(top)
    expect(top).toBe(0)
  })

  it("slides each marker in from the right as it fades up", () => {
    const node = axis()
    const enter = node.enter({ data: {}, duration: 1, easing: linear } as never)
    at(enter, 0.2)
    const bottom = markers(node)[2]
    expect(bottom.x).toBeGreaterThan(0)
    expect(bottom.x).toBeLessThan(24)
    expect(bottom.x).toBeCloseTo(24 * (1 - bottom.opacity))
  })

  it("lands every marker and the caption by the end of the whole duration", () => {
    const node = axis({ label: "Sales" })
    const enter = node.enter({ data: {}, duration: 1, easing: linear } as never)
    at(enter, 1)
    expect(markers(node).map((m) => [m.opacity, m.x])).toEqual([[1, 0], [1, 0], [1, 0]])
    expect([caption(node)!.opacity, caption(node)!.x]).toEqual([1, 0])
  })

  it("brings the caption in after the markers", () => {
    const node = axis({ label: "Sales" })
    const enter = node.enter({ data: {}, duration: 1, easing: linear } as never)
    const { step, per } = enterBudget(1, 3, true, undefined)
    const markersLand = 2 * step + per
    at(enter, markersLand - 0.01)
    expect(caption(node)!.opacity).toBe(0)
    at(enter, 1)
    expect(caption(node)!.opacity).toBe(1)
  })

  it("starts from the armed state at 0, and is a frame of its time", () => {
    const node = axis()
    const seek = scrub(node.enter({ data: {}, duration: 1, easing: linear } as never))
    expect(markers(node).map((m) => m.opacity)).toEqual([0, 0, 0])
    seek(0.4)
    const forward = markers(node).map((m) => m.opacity)
    seek(1)
    seek(0.4)
    expect(markers(node).map((m) => m.opacity)).toEqual(forward)
  })

  it("takes the stagger and the slide it is given", () => {
    const node = axis()
    const enter = node.enter({ data: { stagger: 0.1, slide: 60 }, duration: 1, easing: linear } as never)
    at(enter, 0)
    expect(markers(node).map((m) => m.x)).toEqual([60, 60, 60])
  })

  it("is a seekable of no marker for no markers", () => {
    const node = axis({ markers: [] })
    expect(() => at(node.enter({ data: {}, duration: 1 } as never), 0.5)).not.toThrow()
  })
})

