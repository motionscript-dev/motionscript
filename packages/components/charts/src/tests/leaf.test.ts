import { describe, expect, it } from "vitest"
import { Registry } from "@motionscript/sdk"

import { NODES } from "../nodes"

const registry = new Registry({ nodes: NODES })
const spec = (id: string, type: string, props: Record<string, unknown> = {}) => ({
  id,
  type,
  parentId: null,
  layerOrder: 0,
  props,
})
const rect = () => registry.instantiate(spec("rect", "rect"))

describe.each(["lineChart", "barChart", "pieChart"])("%s is a leaf", (type) => {
  it("builds its own parts and tells a host it holds nothing", () => {
    expect(registry.instantiate(spec("chart", type)).children.length).toBeGreaterThan(0)
    expect(registry.describe(type)?.holds).toEqual([])
  })

  it("refuses a child, added or passed in", () => {
    expect(() => registry.instantiate(spec("chart", type)).add(rect())).toThrow("It takes no children.")
    expect(() => registry.instantiate(spec("chart", type, { children: [rect()] }))).toThrow("It takes no children.")
  })
})
