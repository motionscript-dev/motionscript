import { describe, expect, it } from "vitest"
import { Registry } from "@motionscript/sdk"

import { GeoBorder } from "./border"
import { NODES } from "./nodes"

describe("the geo package's node types", () => {
    const registry = new Registry({ nodes: NODES })

    it("registers each component under its document key", () => {
        expect(registry.node("geoBorder")?.ctor).toBe(GeoBorder.node)
        expect(registry.hasNode("globe")).toBe(false)
    })

    it("describes GeoBorder's own props for an editor", () => {
        const props = registry.describe("geoBorder")?.properties ?? {}
        expect(Object.keys(props)).toEqual(expect.arrayContaining(["iso", "level", "detail", "projection", "frame", "borders"]))
    })
})
