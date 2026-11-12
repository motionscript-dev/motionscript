import { describe, expect, it } from "vitest"

import type { Text } from "@motionscript/sdk"

import { DEFAULT_X_AXIS, DEFAULT_Y_AXIS } from "../kit/shared"
import { layOut, scrub } from "../tests/harness"
import { CategoryAxis } from "./category-axis"

/**
 * The bar chart's bottom axis: a caption centred in each of equal slots. It has
 * no scale — it counts rows — and shares nothing with the numeric axis beyond
 * how it looks.
 */

const AXIS = DEFAULT_X_AXIS
const BOX = { width: 400, height: 100 }
const NAMES = ["Jan", "Feb", "Mar", "Apr"]
const linear = (t: number) => t

function axis(props: Record<string, unknown> = {}) {
  const node = new CategoryAxis({ categories: NAMES, axis: AXIS, label: "", dims: [], ...BOX, ...props } as never)
  layOut(node, BOX)
  return node
}

/** The box each caption sits in: the slot, which carries the spotlight dim. */
const slots = (node: CategoryAxis) => node.children[0].children[0].children
const captionNodes = (node: CategoryAxis) => slots(node).map((slot) => slot.children[0] as Text)
const caption = (node: CategoryAxis) => (node.children[0].children[1] as Text | undefined) ?? null
/** The entrance's first frame: every caption, and the title, armed. */
const arm = (node: CategoryAxis) => node.enter({ duration: 1 }).at(0)

describe("CategoryAxis: the slots", () => {
  it("holds one caption per category, in the order of the rows", () => {
    expect(captionNodes(axis()).map((c) => c.text)).toEqual(NAMES)
  })

  it("centres each caption in an equal share of the width", () => {
    expect(slots(axis()).map((s) => s.x)).toEqual([-150, -50, 50, 150])
    expect(slots(axis({ categories: ["a", "b"] })).map((s) => s.x)).toEqual([-100, 100])
  })

  it("puts a lone category in the middle", () => {
    expect(slots(axis({ categories: ["only"] })).map((s) => s.x)).toEqual([0])
  })

  it("divides the node's own width, so it follows a resize", () => {
    const node = axis()
    layOut(node, { width: 800, height: 100 })
    expect(slots(node).map((s) => s.x)).toEqual([-300, -100, 100, 300])
  })

  it("holds nothing for no categories", () => {
    const node = axis({ categories: [] })
    expect(captionNodes(node)).toHaveLength(0)
    expect(slots(node)).toHaveLength(0)
  })

  it("builds its captions once: a list of another length changes where the slots fall, not how many there are", () => {
    const node = axis()
    node.set({ categories: ["a", "b"] } as never)
    layOut(node, BOX)
    expect(captionNodes(node)).toHaveLength(4)
    expect(captionNodes(node).map((c) => c.text)).toEqual(NAMES)
    // Two slots of 200 now; the two surplus captions are in the slots that would follow them.
    expect(slots(node).map((s) => s.x)).toEqual([-100, 100, 300, 500])
  })
})

describe("CategoryAxis: the dim", () => {
  it("draws a caption at the opacity its category is dimmed to", () => {
    const node = axis({ dims: [1, 0.4, 0.1, 0] })
    expect(slots(node).map((s) => s.opacity)).toEqual([1, 0.4, 0.1, 0])
  })

  it("reads a category with no entry as undimmed", () => {
    const node = axis({ dims: [0.5] })
    expect(slots(node).map((s) => s.opacity)).toEqual([0.5, 1, 1, 1])
  })

  it("clamps a dim into 0..1", () => {
    const node = axis({ dims: [2, -1, 0.3] })
    expect(slots(node).map((s) => s.opacity)).toEqual([1, 0, 0.3, 1])
  })

  it("follows the dims as they change, which is how the chart's category spotlight reaches the captions", () => {
    const node = axis()
    node.set({ dims: [1, 0.2, 1, 1] } as never)
    expect(slots(node)[1].opacity).toBe(0.2)
    node.set({ dims: [] } as never)
    expect(slots(node)[1].opacity).toBe(1)
  })

  it("keeps the dim off the caption's own opacity, which the entrance animates", () => {
    const node = axis({ dims: [0.5, 1, 1, 1] })
    expect(captionNodes(node)[0].opacity).toBe(1)
    expect(slots(node)[0].opacity).toBe(0.5)
  })
})

describe("CategoryAxis: the title", () => {
  it("builds none for an empty label", () => {
    expect(caption(axis())).toBeNull()
  })

  it("builds one for a label, beneath the captions", () => {
    const node = axis({ label: "Quarter" })
    expect(caption(node)?.text).toBe("Quarter")
    expect(node.children[0].children[1]).toBe(caption(node))
  })
})

describe("CategoryAxis: arming and entering", () => {
  it("arms every caption transparent and lifted above its slot on its first frame", () => {
    const node = axis({ label: "Quarter" })
    arm(node)
    expect(captionNodes(node).map((c) => [c.opacity, c.y])).toEqual(NAMES.map(() => [0, 24]))
    expect([caption(node)!.opacity, caption(node)!.y]).toEqual([0, 24])
  })

  it("rests landed, and arming is idempotent", () => {
    const node = axis()
    expect(captionNodes(node).map((c) => c.opacity)).toEqual([1, 1, 1, 1])
    arm(node)
    arm(node)
    expect(captionNodes(node).map((c) => c.opacity)).toEqual([0, 0, 0, 0])
  })

  it("enters left to right", () => {
    const node = axis()
    const seek = scrub(node.enter({ data: {}, duration: 1, easing: linear } as never))
    seek(0.2)
    const opacities = captionNodes(node).map((c) => c.opacity)
    expect(opacities[0]).toBeGreaterThan(opacities[1])
    expect(opacities[1]).toBeGreaterThan(opacities[2])
    expect(opacities[3]).toBe(0)
  })

  it("lands every caption and the title by the end of the duration", () => {
    const node = axis({ label: "Quarter" })
    const seek = scrub(node.enter({ data: {}, duration: 1, easing: linear } as never))
    seek(1)
    expect(captionNodes(node).map((c) => [c.opacity, c.y])).toEqual(NAMES.map(() => [1, 0]))
    expect([caption(node)!.opacity, caption(node)!.y]).toEqual([1, 0])
  })

  it("is a frame of its time", () => {
    const node = axis()
    const seek = scrub(node.enter({ data: {}, duration: 1, easing: linear } as never))
    seek(0.4)
    const forward = captionNodes(node).map((c) => c.opacity)
    seek(1)
    seek(0)
    seek(0.4)
    expect(captionNodes(node).map((c) => c.opacity)).toEqual(forward)
  })

  it("holds for its duration when there is nothing to enter", () => {
    const node = axis({ categories: [] })
    const hold = node.enter({ data: {}, duration: 2 } as never)
    expect((hold as unknown as { duration: number }).duration).toBe(2)
  })
})

describe("CategoryAxis: a column beside the plot", () => {
  const TALL = { width: 120, height: 400 }
  const column = (props: Record<string, unknown> = {}) => {
    const node = new CategoryAxis({ categories: NAMES, axis: DEFAULT_Y_AXIS, orientation: "vertical", ...TALL, ...props } as never)
    layOut(node, TALL)
    return node
  }
  /** The captions, top to bottom: the column that ends the row the axis is made of. */
  const captions = (node: CategoryAxis) => {
    const row = node.children[0]
    return row.children[row.children.length - 1].children as Text[]
  }

  it("centres the first category in the top slot and the last in the bottom one", () => {
    expect(captions(column()).map((c) => c.y)).toEqual([150, 50, -50, -150])
  })

  it("right-aligns the captions against the plot", () => {
    const node = column({ categories: ["a", "much longer"] })
    const [short, long] = captions(node)
    const right = (c: Text) => c.x + c.layoutBounds.width / 2
    expect(right(short)).toBeCloseTo(right(long))
  })

  it("dims a caption with its category, on top of its entrance", () => {
    const node = column({ dims: [1, 0.5] })
    expect(captions(node).map((c) => c.opacity)).toEqual([1, 0.5, 1, 1])
    node.enter({ duration: 1 }).at(0)
    expect(captions(node).map((c) => c.opacity)).toEqual([0, 0, 0, 0])
  })
})
