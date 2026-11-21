import { describe, expect, it } from "vitest"
import { Registry } from "@motionscript/sdk"

import { GeoBorder } from "./border"
import { GeoGlobe, GeoGlobe3d } from "./globe"
import { NODES } from "./nodes"

const GLOBE_PROPS = ["fill", "land", "coast", "graticule", "longitude", "latitude", "highlight", "highlightFill", "shading", "farSide", "start", "end"]
const GLOBE_COMMANDS = ["turnTo", "spin", "fillTo", "progressTo", "landTo", "coastTo", "graticuleTo", "highlightFillTo"]

describe("the geo package's node types", () => {
    const registry = new Registry({ nodes: NODES })

    it("registers each component under its document key", () => {
        expect(registry.node("geoBorder")?.ctor).toBe(GeoBorder.node)
        expect(registry.node("geoGlobe")?.ctor).toBe(GeoGlobe.node)
        expect(registry.node("geoGlobe3d")?.ctor).toBe(GeoGlobe3d.node)
        expect(registry.hasNode("globe")).toBe(false)
    })

    it("describes GeoBorder's own props for an editor", () => {
        const props = registry.describe("geoBorder")?.properties ?? {}
        expect(Object.keys(props)).toEqual(expect.arrayContaining(["iso", "level", "detail", "projection", "frame", "borders"]))
    })

    it("tweens GeoBorder's projection with projectTo, listing the projections as its options", () => {
        expect([...(registry.node("geoBorder")?.commands.keys() ?? [])]).toContain("projectTo")
        const projection = registry.describe("geoBorder")?.properties?.projection as { options?: readonly string[] } | undefined
        expect(projection?.options).toEqual(["conic", "mercator", "equirectangular", "orthographic"])
    })

    it("describes GeoGlobe's paints, angle and commands, its rim, and no overlay", () => {
        const props = Object.keys(registry.describe("geoGlobe")?.properties ?? {})
        expect(props).toEqual(expect.arrayContaining([...GLOBE_PROPS, "stroke"]))
        expect(props).not.toContain("overlay")
        expect([...(registry.node("geoGlobe")?.commands.keys() ?? [])]).toEqual(expect.arrayContaining(GLOBE_COMMANDS))
    })

    it("describes GeoGlobe3d as a 3D node with the same globe, a radius and no rim", () => {
        const described = registry.describe("geoGlobe3d")
        expect(described?.dimension).toBe("3d")
        const props = Object.keys(described?.properties ?? {})
        expect(props).toEqual(expect.arrayContaining([...GLOBE_PROPS, "radius", "x", "rotationX"]))
        expect(props).not.toContain("stroke")
        expect([...(registry.node("geoGlobe3d")?.commands.keys() ?? [])]).toEqual(expect.arrayContaining(GLOBE_COMMANDS))
    })
})
